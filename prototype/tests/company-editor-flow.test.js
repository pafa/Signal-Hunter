import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await vite.ssrLoadModule('/src/major/CompanyRelations.jsx'),drafts=await vite.ssrLoadModule('/src/major/company-drafts.js');root=createRoot(document.getElementById('root'));
  const topic={id:crypto.randomUUID(),createdAt:'2026-10-04',version:1,evidence:[],companies:['BA.US','AAPL.US'].map(symbol=>({symbol,name:symbol,kind:'mentioned',relationStatus:'pending',direction:'unclear',note:'Original '+symbol,url:'',evidenceIds:[],materiality:[]}))};
  const button=text=>[...document.querySelectorAll('button')].find(e=>e.textContent===text),field=label=>[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent===label)?.querySelector('input,textarea,select');
  const fill=(label,value)=>act(()=>{const e=field(label),proto=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await run({Editor,topic,...drafts,render:n=>act(()=>root.render(n)),button,field,fill,submit:()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),select:symbol=>act(()=>[...document.querySelectorAll('.company-relations article')].find(e=>e.textContent.includes(symbol)).querySelector('button').click())});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}
test('company revoke rationale stays company-scoped across switches and remount; conflict and failure keep it until explicit discard or success',()=>ui(async({Editor,topic,render,button,field,fill,select})=>{
 const calls=[];let t=topic,success=false,closed=0;const props=()=>({topic:t,initialSymbol:'BA.US',busy:false,onClose:()=>closed++,mutate:async(path,method,body)=>{calls.push({method,body});return success;}}),show=()=>render(React.createElement(Editor,props()));
 await show();await fill('公司与事件的关系依据','Boeing draft');await fill('撤销此关联的原因','Boeing revoke draft');await select('AAPL.US');await fill('撤销此关联的原因','Apple revoke draft');await select('BA.US');assert.equal(field('撤销此关联的原因').value,'Boeing revoke draft');
 await render(null);await show();assert.equal(field('公司与事件的关系依据').value,'Boeing draft');assert.equal(field('撤销此关联的原因').value,'Boeing revoke draft');
 t={...t,version:2};await show();assert(button('撤销本事件关联').disabled);await act(()=>button('撤销本事件关联').click());assert.equal(calls.length,0);assert.equal(field('撤销此关联的原因').value,'Boeing revoke draft');
 await act(()=>button('丢弃当前公司草稿并载入最新版本').click());assert.equal(field('撤销此关联的原因').value,'');assert.equal(field('公司与事件的关系依据').value,'Original BA.US');
 await fill('撤销此关联的原因','Reviewed at version 2');await act(async()=>button('撤销本事件关联').click());assert.equal(calls[0].body.version,2);assert.equal(field('撤销此关联的原因').value,'Reviewed at version 2');assert.equal(closed,0);
 success=true;await act(async()=>{button('撤销本事件关联').click();button('撤销本事件关联').click();});assert.equal(calls.length,2,'revoke also submits once while pending');assert.equal(closed,1);await render(null);await render(React.createElement(Editor,{...props(),initialSymbol:'AAPL.US'}));assert.equal(field('撤销此关联的原因').value,'Apple revoke draft');
}));
test('company pending save immediately blocks duplicate submits, company switching and close even before parent busy updates',()=>ui(async({Editor,topic,render,button,field,fill,submit,select})=>{
 let resolve,calls=0,closed=0;const mutate=()=>{calls++;return new Promise(r=>resolve=r);},view=busy=>React.createElement(Editor,{topic,initialSymbol:'BA.US',busy,mutate,onClose:()=>closed++});await render(view(true));assert.equal(field('股票代码').value,'BA.US','busy initial mount must still load the selected company');assert(document.querySelector('fieldset').disabled);await render(view(false));await fill('公司与事件的关系依据','Pending draft');
 await act(()=>{submit();submit();});assert.equal(calls,1);assert(document.querySelector('fieldset').disabled);
 await select('AAPL.US');await act(()=>button('关闭').click());assert.equal(field('股票代码').value,'BA.US');assert.equal(closed,0);
 await act(async()=>resolve(null));assert.equal(field('公司与事件的关系依据').value,'Pending draft');assert(!document.querySelector('fieldset').disabled);
 await act(submit);assert.equal(calls,2);await act(async()=>resolve(true));assert.equal(closed,1);
}));
test('late company save cannot clear a newer remounted draft or close the new dialog',()=>ui(async({Editor,topic,render,field,fill,submit,companyDraftKey,readCompanyDraft})=>{
 let resolve,closed=0;const props={topic,initialSymbol:'BA.US',busy:false,mutate:()=>new Promise(r=>resolve=r),onClose:()=>closed++};
 await render(React.createElement(Editor,props));await fill('公司与事件的关系依据','Submitted before unmount');await act(submit);await render(null);
 await render(React.createElement(Editor,props));await fill('公司与事件的关系依据','Newer reopened draft');await act(async()=>resolve(true));assert.equal(closed,0);assert.equal(field('公司与事件的关系依据').value,'Newer reopened draft');assert.equal(readCompanyDraft(companyDraftKey(topic,'legacy','BA.US'),sessionStorage).form.note,'Newer reopened draft');
}));
