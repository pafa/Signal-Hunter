import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
test('operation refresh keeps one price configuration panel, preserves edits and reads immutable detail without submitting configuration',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),store=openStore(':memory:'),service=createService(store,{mode:'research'});let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {createRoot}=await import('react-dom/client'),{Operations}=await vite.ssrLoadModule('/src/integrated/Operations.jsx');root=createRoot(document.getElementById('root'));
  service.priceCollection.configure({version:0,requestId:'synthetic-ui-config',benchmarks:{}});const data=service.snapshot();assert.equal(data.priceCollection.config.version,data.researchPipeline.settings.version);
  data.priceCollection.recent=[{id:'synthetic-plan',title:'Synthetic original',decisionAt:data.serverTime,symbols:['AAPL.US'],reason:'scheduled',configVersion:1}];
  let submissions=0,reads=0;globalThis.fetch=async path=>{reads++;assert.equal(path,'/api/price-collection/synthetic-plan');return Response.json({plan:{sample:{input:{title:'Synthetic frozen input'},triage:{bucket:'quiet'},decisionAt:data.serverTime},reason:'scheduled'},config:{policy:{maximumBoundaryDelayMs:300000,receiptGraceMs:120000}},boundaries:[],history:[]});};
  const render=()=>act(()=>root.render(React.createElement(Operations,{data:structuredClone(data),busy:false,onClose:()=>{},onControl:()=>{},onPipeline:()=>{},onPriceCollection:()=>submissions++})));
  await render();const field=document.querySelector('input[maxlength="40"]');await act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,'SPY.US');field.dispatchEvent(new window.Event('input',{bubbles:true}));});
  for(let i=0;i<6;i++){data.serverTime=new Date(Date.parse(data.serverTime)+1000).toISOString();await render();}
  assert.equal([...document.querySelectorAll('h3')].filter(e=>e.textContent==='价格评估采集').length,1);assert.equal(document.querySelectorAll('input[maxlength="40"]').length,3);assert.equal(document.querySelector('input[maxlength="40"]').value,'SPY.US');
  await act(async()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='查看窗口依据').click());assert.equal(reads,1);assert.match(document.querySelector('[aria-label="窗口采集依据"]').textContent,/Synthetic frozen input/);assert.equal(submissions,0);
  data.operations.pricecollection.paused=false;await render();assert([...document.querySelectorAll('button')].find(e=>e.textContent==='保存价格采集配置').disabled);assert.equal(document.querySelector('input[maxlength="40"]').value,'SPY.US');
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();await service.close();store.close();}
});
