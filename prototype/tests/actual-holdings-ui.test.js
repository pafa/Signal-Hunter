import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {actualTemplate} from '../shared/actual-holdings.mjs';
const book={enabled:true,version:0,records:[]};
const preview={id:'synthetic-preview',hash:'synthetic-hash',baseVersion:0,canApply:true,expiresAt:'2026-10-09T12:30:00Z',items:[{index:1,action:'add',row:{account:'Synthetic',symbol:'AAPL.US',quantity:'2',currency:'USD',asOf:'2026-10-09T10:00:00Z',source:'Synthetic fixture',feeBasis:'unknown'}}]};
async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 let handler=async(path)=>path.endsWith('/preview')?preview:book;const calls=[];
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  globalThis.fetch=async(path,opts={})=>{calls.push({path,method:opts.method,body:opts.body&&JSON.parse(opts.body)});const b=await handler(path,opts);return {ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},json:async()=>structuredClone(b)};};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/ActualHoldings.jsx');root=createRoot(document.getElementById('root'));
  const data={serverTime:'2026-10-09T12:00:00Z',runtime:{instance:{id:'synthetic-a'}},research:{topics:[]}},button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  const render=(props={})=>act(()=>root.render(React.createElement(View,{data,onClose(){},...props}))),click=text=>act(()=>button(text).click());
  const fill=value=>act(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(e,value);e.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const setup=async()=>{await render();await click('持仓快照');await click('批量导入 CSV');await fill(actualTemplate+'Synthetic,AAPL.US,2,,,2026-10-09T10:00:00Z,Synthetic fixture,unknown,,,');};
  const submit=()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await run({render,click,fill,setup,submit,button,calls,data,handler:f=>handler=f,text:()=>document.body.textContent});
 }finally{if(root)await act(()=>root.unmount());for(const [key,value] of before)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];dom.window.close();await vite.close();}
}
test('actual holdings preview is invalidated by input edits and conflict batches cannot be saved',()=>ui(async({setup,submit,fill,text,button,handler})=>{
 await setup();await act(()=>submit());assert.match(text(),/还没有修改持仓/);assert.equal(button('保存本批记录').disabled,false);
 await fill(actualTemplate);assert.equal(button('保存本批记录'),undefined);
 handler(async path=>path.endsWith('/preview')?{...preview,canApply:false,items:[{index:1,action:'invalid',issue:'Synthetic invalid row'}]}:book);await act(()=>submit());assert.equal(button('保存本批记录').disabled,true);assert.match(text(),/Synthetic invalid row/);
}));
test('double submit and save clicks issue one request each; committed save survives refresh failure',()=>ui(async({setup,submit,click,calls,handler,render,button,text})=>{
 await setup();let resolve;handler(async path=>path.endsWith('/preview')?new Promise(r=>resolve=r):{...book,version:1});
 await act(()=>{submit();submit();});assert.equal(calls.filter(c=>c.path.endsWith('/preview')).length,1);await act(async()=>resolve(preview));
 await render({onRefresh:async()=>{throw Error('Synthetic refresh failure');}});handler(async()=>new Promise(r=>resolve=r));
 await act(()=>{button('保存本批记录').click();button('保存本批记录').click();});assert.equal(calls.filter(c=>c.path.endsWith('/apply')).length,1);await act(async()=>resolve({...book,version:1}));assert.match(text(),/已保存持仓记录 v1/);assert.match(text(),/首页暂未刷新/);
}));
test('an old background read cannot replace committed actual records or revalidate an old preview',()=>ui(async({setup,submit,render,data,handler,click,text})=>{
 await setup();await act(()=>submit());let old;handler(async(path,opts)=>opts.method==='POST'?{...book,version:1}:new Promise(r=>old=r));
 await render({data:{...data,serverTime:'2026-10-09T12:00:15Z'}});await click('保存本批记录');await act(async()=>old(book));assert.match(text(),/记录 v1/);
}));
test('dataset changes reset drafts and reject late results from the previous dataset',()=>ui(async({setup,submit,render,data,handler,button,text})=>{
 await setup();let finish;handler(async path=>path.endsWith('/preview')?new Promise(r=>finish=r):book);await act(()=>submit());await render({data:{...data,runtime:{instance:{id:'synthetic-b'}}}});await act(async()=>finish(preview));assert.equal(button('保存本批记录'),undefined);assert.doesNotMatch(text(),/还没有修改持仓/);
}));
