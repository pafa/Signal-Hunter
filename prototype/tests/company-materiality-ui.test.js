import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {normalizeMateriality} from '../shared/company-materiality.mjs';

test('company materiality renders assumptions, unknown ratios, timing limits and escaped source text',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {CompanyMaterialityView}=await vite.ssrLoadModule('/src/major/CompanyMateriality.jsx');
  const value=normalizeMateriality([{id:'test',label:'Synthetic <script>bad()</script>',scope:'Consolidated',period:'FY2026',unit:'million USD',basis:'Hypothesis only',comparable:true,baseline:{value:0,kind:'assumption',evidenceIds:[]},observed:{value:20,kind:'assumption',evidenceIds:[]}}],{evidence:[]},'2026-10-03T00:00:00Z');
  const html=renderToStaticMarkup(React.createElement(CompanyMaterialityView,{value}));assert.match(html,/无法计算/);assert.match(html,/人工假设/);assert.match(html,/事前可用时间未证实/);assert.match(html,/不证明价格尚未反映/);assert.match(html,/20 million USD/);assert.doesNotMatch(html,/<script>/);
  assert.match(renderToStaticMarkup(React.createElement(CompanyMaterialityView,{value:null})),/尚无结构化量级计算/);
 }finally{await vite.close();}
});

test('pending company save cannot switch to and clear another company draft',async()=>{
 const {JSDOM}=await import('jsdom'),{act}=await import('react');
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const names=['window','document','HTMLElement','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {createRoot}=await import('react-dom/client'),{default:CompanyRelations}=await vite.ssrLoadModule('/src/major/CompanyRelations.jsx');
  const {companyDraftKey}=await vite.ssrLoadModule('/src/major/company-drafts.js');
  const topic={id:'company-save-race',createdAt:'2026-10-03T00:00:00Z',version:1,companies:[],evidence:[]};
  const form={symbol:'BA.US',name:'Boeing',kind:'mentioned',relationStatus:'pending',direction:'unclear',note:'Submitted Boeing draft',url:'',evidenceIds:[],identityReviewed:false,materiality:[]};
  const submittedKey=companyDraftKey(topic,'legacy',''),otherKey=companyDraftKey(topic,'legacy','AAPL.US');
  const otherDraft=JSON.stringify({base:1,editing:false,form:{...form,symbol:'AAPL.US',note:'Unsaved Apple research'}});
  sessionStorage.setItem(submittedKey,JSON.stringify({base:1,editing:false,form}));sessionStorage.setItem(otherKey,otherDraft);
  let resolve,submitted,closed=0;const mutate=async(path,method,body)=>{submitted=body;return new Promise(r=>{resolve=r;});};
  root=createRoot(document.getElementById('root'));
  const render=busy=>act(()=>root.render(React.createElement(CompanyRelations,{topic,busy,mutate,onClose:()=>closed++})));
  await render(false);
  await act(()=>{const input=document.querySelector('.screening-title + .m-form input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'AAPL');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await act(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(submitted.symbol,'BA.US');await render(true);
  const apple=[...document.querySelectorAll('.company-search button')].find(b=>b.textContent.includes('AAPL.US'));assert.ok(apple);
  await act(()=>apple.click());
  assert.equal(document.querySelector('form input').value,'BA.US','pending save must retain its submitted company');
  await act(async()=>resolve(true));
  assert.equal(closed,1);assert.equal(sessionStorage.getItem(submittedKey),null);
  assert.equal(sessionStorage.getItem(otherKey),otherDraft,'another company draft must survive the response');
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
