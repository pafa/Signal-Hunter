import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {dossierDraftKey,readDossierDraft,writeDossierDraft,clearDossierDraft} from '../src/major/dossier-drafts.js';
const topic={id:'legacy-editor-test',createdAt:'2026-10-01T12:00:00Z',version:1,evidence:[{id:'source',sourceName:'Synthetic',claim:'Test source'}],dossier:{sections:[{id:'s',title:'Legacy analysis',paragraphs:['Legacy content']}]}};
const vite=()=>createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
test('actual legacy editor renders absent sourceIds and incomplete drafts have no required section textareas',async()=>{const server=await vite();try{const {default:Editor}=await server.ssrLoadModule('/src/major/DossierEditor.jsx');const html=renderToStaticMarkup(React.createElement(Editor,{topic,mutate:()=>{}}));assert.match(html,/Legacy content/);assert.match(html,/checkbox/);assert.doesNotMatch(html,/<textarea required/);}finally{await server.close();}});
test('topic-scoped drafts retain base version; unavailable session storage falls back without mixing topics',()=>{const a=dossierDraftKey(topic),b=dossierDraftKey({...topic,id:'other'}),storage={setItem(){throw Error('Quota');},getItem(){return null;}};const draft={base:1,sections:[{id:'s',title:'T',paragraphs:['Unsaved'] }],reason:'Reason',status:'draft'};assert.equal(writeDossierDraft(a,draft,storage),false);assert.equal(readDossierDraft(a,{...draft,base:2},storage).base,1);assert.deepEqual(readDossierDraft(a,draft,storage).sections[0].sourceIds,[]);assert.equal(readDossierDraft(b,{...draft,base:4},storage).base,4);clearDossierDraft(a,storage);});
test('actual editor survives unmount, a new research version and returning from another topic',async()=>{const server=await vite(),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),before={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};let root;try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client'),{default:Editor}=await server.ssrLoadModule('/src/major/DossierEditor.jsx');root=createRoot(document.getElementById('root'));const show=t=>act(()=>root.render(React.createElement(Editor,{key:t.id,topic:t,mutate:async()=>null})));await show(topic);const input=document.querySelector('textarea');await act(()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(input,'Unsaved long research');input.dispatchEvent(new window.Event('input',{bubbles:true}));});assert.match(window.sessionStorage.getItem(dossierDraftKey(topic))||'',/Unsaved long research/);await act(()=>root.render(React.createElement('p',{},'History view')));await show({...topic,version:2});assert.equal(document.querySelector('textarea').value,'Unsaved long research');assert.match(document.querySelector('[role="alert"]').textContent,/研究已有新版本/);assert(document.querySelector('button[type="submit"]')?.disabled||[...document.querySelectorAll('button')].at(-1).disabled);await show({...topic,id:'other-editor-test',version:5});assert.equal(document.querySelector('textarea').value,'Legacy content');await show({...topic,version:2});assert.equal(document.querySelector('textarea').value,'Unsaved long research');}finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await server.close();}});
import {persistDossierDraft,acknowledgeDossierSave} from '../src/major/dossier-drafts.js';
test('save acknowledgement preserves later generations and ignores older completed replies',()=>{const key='save-generation-helper',values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const initial={base:1,sections:[{id:'s',title:'T',paragraphs:['A'],sourceIds:[]}],reason:'R',status:'draft'};readDossierDraft(key,initial,storage);const a=persistDossierDraft(key,initial,storage).draft;persistDossierDraft(key,{...a,sections:[{...a.sections[0],paragraphs:['B']}]},storage);const reply=acknowledgeDossierSave(key,a,2,storage);assert.equal(reply.saved,'newer-edits');assert.equal(reply.draft.sections[0].paragraphs[0],'B');assert.equal(reply.draft.base,2);assert.match(storage.getItem(key),/B/);assert.equal(acknowledgeDossierSave(key,reply.draft,3,storage).saved,true);assert.equal(storage.getItem(key),null);assert.equal(acknowledgeDossierSave(key,a,2,storage).ignored,true);});
test('delayed save never erases edits in the same editor, after remount, or on an old unmounted reply',async()=>{const server=await vite(),dom=new JSDOM('<div id="race-root"></div>',{url:'http://localhost/'}),before={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};let root;try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client'),{default:Editor}=await server.ssrLoadModule('/src/major/DossierEditor.jsx');root=createRoot(document.getElementById('race-root'));const fill=async(el,value)=>act(()=>{const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});for(const scenario of ['same-editor','remounted-editor','reply-while-unmounted']){let resolve,request;const t={...topic,id:`race-${scenario}`},mutate=async(path,method,body)=>{request=body;return new Promise(r=>resolve=r);},show=next=>act(()=>root.render(React.createElement(Editor,{key:t.id,topic:next,mutate})));await show(t);await fill(document.querySelector('textarea'),'Submitted A');await fill(document.querySelector('input:not([type="checkbox"])'),'Save A');await act(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(request.dossier.sections[0].paragraphs[0],'Submitted A');if(scenario!=='same-editor'){await act(()=>root.render(React.createElement('p',{},'History')));await show(t);}await fill(document.querySelector('textarea'),'Later B must survive');if(scenario==='reply-while-unmounted')await act(()=>root.render(React.createElement('p',{},'History during reply')));const next={...t,version:2,dossier:{sections:request.dossier.sections}};await act(async()=>resolve({research:{topics:[next]}}));await show(next);assert.equal(document.querySelector('textarea').value,'Later B must survive',scenario);const stored=JSON.parse(window.sessionStorage.getItem(dossierDraftKey(t)));assert.equal(stored.sections[0].paragraphs[0],'Later B must survive');assert.equal(stored.base,2);await act(()=>root.render(React.createElement('p',{},'Next scenario')));}}finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await server.close();}});


test('dossier conflict acknowledgement never submits; busy, stale and duplicate pending submits preserve the draft',async()=>{
 const server=await vite(),dom=new JSDOM('<div id="submit-root"></div>',{url:'http://localhost/'}),before={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await server.ssrLoadModule('/src/major/DossierEditor.jsx');root=createRoot(document.getElementById('submit-root'));
  const t={...topic,id:'explicit-dossier-submit'},calls=[];let resolve;
  const mutate=async(path,method,body)=>{calls.push({path,method,body});return new Promise(r=>resolve=r);};
  const show=(version,busy=false)=>act(()=>root.render(React.createElement(Editor,{topic:{...t,version},busy,mutate})));
  const fill=(selector,value)=>act(()=>{const el=document.querySelector(selector),proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const submit=()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await show(1);await fill('textarea','Retained conflict draft');await fill('input:not([type="checkbox"])','Explicit save only');
  await show(2);
  const rebase=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('保留草稿继续编辑'));
  await act(()=>rebase.click());
  assert.equal(calls.length,0,'acknowledging the new version must not submit the form');
  assert.equal(document.querySelector('textarea').value,'Retained conflict draft');
  assert.equal(JSON.parse(window.sessionStorage.getItem(dossierDraftKey(t))).base,2);
  await show(3);await act(submit);assert.equal(calls.length,0,'stale submit events must be rejected independently of the button');
  await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('保留草稿继续编辑')).click());
  await show(3,true);await act(submit);assert.equal(calls.length,0,'busy submit events must be rejected');
  await show(3);await act(()=>{submit();submit();});assert.equal(calls.length,1,'only one pending request');
  assert.equal(calls[0].body.version,3);assert.equal(calls[0].body.dossier.sections[0].paragraphs[0],'Retained conflict draft');
  await act(async()=>resolve(null));assert.match(window.sessionStorage.getItem(dossierDraftKey(t)),/Retained conflict draft/,'failed save retains the draft');
  await act(submit);assert.equal(calls.length,2,'failed request releases the in-flight guard');
  await act(async()=>resolve({research:{topics:[{...t,version:4}]}}));await show(4);
  assert.equal(window.sessionStorage.getItem(dossierDraftKey(t)),null,'explicit successful save clears only its submitted draft');
  assert.match(document.querySelector('[role="status"]').textContent,/已保存/);
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await server.close();}
});

test('dossier drafts separate cloned research across datasets and late acknowledgement cannot clear another dataset',()=>{
 const t={...topic,id:'dataset-clone'},a=dossierDraftKey(t,'dataset-a'),b=dossierDraftKey(t,'dataset-b');assert.notEqual(a,b);
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const initial={base:1,sections:[{id:'s',title:'T',paragraphs:['Server content'],sourceIds:[]}],reason:'',status:'draft'};
 const first=persistDossierDraft(a,initial,storage).draft;persistDossierDraft(a,{...first,reason:'A pending'},storage);
 assert.equal(readDossierDraft(b,initial,storage).reason,'');
 const other=persistDossierDraft(b,{...initial,reason:'B pending'},storage).draft;
 acknowledgeDossierSave(a,first,2,storage);assert.equal(readDossierDraft(b,initial,storage).reason,'B pending');
 assert.equal(JSON.parse(storage.getItem(b)).generation,other.generation);assert.equal(readDossierDraft(a,initial,storage).reason,'A pending');
});


import {legacyDossierDraftKey,readLegacyDossierDraft} from '../src/major/dossier-drafts.js';
test('unscoped legacy drafts stay unchanged, are never implicitly loaded, and malformed entries remain recoverable',()=>{
 const t={...topic,id:'legacy-migration-helper'},values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},oldKey=legacyDossierDraftKey(t);
 const original={base:1,sections:[{id:'s',title:'Original',paragraphs:['Legacy full text']}],reason:'Old reason',status:'complete'};
 const raw=JSON.stringify(original);storage.setItem(oldKey,raw);
 const old=readLegacyDossierDraft(t,storage);assert.deepEqual(old.draft.sections[0].sourceIds,[]);
 assert.equal(readDossierDraft(dossierDraftKey(t,'new-instance'),{...original,reason:'Current initial'},storage).reason,'Current initial');
 assert.equal(storage.getItem(oldKey),raw);
 for(const bad of ['broken',JSON.stringify({...original,base:0}),JSON.stringify({...original,sections:[null]}),JSON.stringify({...original,sections:[{...original.sections[0],paragraphs:[42]}]})]){
  storage.setItem(oldKey,bad);assert.deepEqual(readLegacyDossierDraft(t,storage),{invalid:true});assert.equal(storage.getItem(oldKey),bad);
 }
 assert.equal(readLegacyDossierDraft(t,{getItem(){throw Error('blocked');}}),null);
});

test('legacy draft preview requires explicit import, preserves conflicts and originals, and never overwrites a current draft',async()=>{
 const server=await vite(),dom=new JSDOM('<div id="migration-root"></div>',{url:'http://localhost/'}),before={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await server.ssrLoadModule('/src/major/DossierEditor.jsx');root=createRoot(document.getElementById('migration-root'));
  const t={...topic,id:'legacy-ui-migration',version:2},old={base:1,sections:[{id:'s',title:'Legacy analysis',paragraphs:['Unscoped original'],sourceIds:['lost-evidence']}],reason:'Legacy rationale',status:'draft'},raw=JSON.stringify(old);window.sessionStorage.setItem(legacyDossierDraftKey(t),raw);
  let calls=0;const mutate=async()=>{calls++;return {research:{topics:[{...t,version:3}]}};},show=next=>act(()=>root.render(React.createElement(Editor,{topic:next,busy:false,mutate})));
  const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name),importButton=()=>button('已确认属于当前研究，载入旧版草稿');
  const fill=value=>act(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await show(t);assert.equal(document.querySelector('textarea').value,'Legacy content');assert.match(document.querySelector('aside').textContent,/Unscoped original/);
  await act(()=>importButton().click());assert.equal(calls,0);assert.equal(document.querySelector('textarea').value,'Unscoped original');assert(button('保存研判新版本').disabled);assert.match(document.querySelector('form').textContent,/来源记录已缺失：lost-evidence/);
  await fill('Current edit after import');assert(importButton().disabled);await act(()=>importButton().click());assert.equal(document.querySelector('textarea').value,'Current edit after import');
  assert.equal(window.sessionStorage.getItem(legacyDossierDraftKey(t)),raw);
  await act(()=>root.render(null));await show(t);assert.equal(document.querySelector('textarea').value,'Current edit after import');assert(importButton().disabled);
  // Changing topic identity without a parent key must remount its draft state.
  await show({...t,createdAt:'different-creation'});assert.equal(document.querySelector('textarea').value,'Legacy content');assert.equal(document.querySelector('aside'),null);await show(t);assert.equal(document.querySelector('textarea').value,'Current edit after import');
  await act(()=>button('已核对更新，保留草稿继续编辑').click());await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls,1);assert.equal(window.sessionStorage.getItem(legacyDossierDraftKey(t)),raw);
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await server.close();}
});
