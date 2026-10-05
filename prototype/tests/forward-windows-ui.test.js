import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {fixture,freeze,start} from './helpers/forward-fixture.js';
import {createHandler} from '../server/index.mjs';
test('window UI freezes through real handlers, safely retries a lost response and keeps old reports',async()=>{
 const f=fixture(),b=freeze(f),p=await f.prepare(),run=start(f,p.topic);await f.service.modelResearch.wait(run.id);f.tick();
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const calls=[],handler=createHandler(f.store,f.service);let lose=true;
  globalThis.fetch=async(path,options)=>{calls.push({path,options});let code,body;await handler({method:options.method,url:path,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield options.body||'{}';}},{writeHead:c=>code=c,end:b=>body=b});if(options.method==='POST'&&lose){lose=false;throw Error('合成响应丢失');}return new Response(body,{status:code,headers:{'content-type':'application/json'}});};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/ForwardWindows.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(View,{baselines:[b]})));
  const field=t=>[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent===t)?.querySelector('input');
  async function fill(t,value){await act(()=>{const el=field(t);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});}
  const local=v=>{const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);};
  await fill('窗口报告名称','<img onerror=x> 合成窗口');await fill('调用窗口开始（本机时间）',local('2026-10-03T00:00:00Z'));await fill('调用窗口结束（不含，本机时间）',local(f.time()));
  const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await submit();assert.match(document.body.textContent,/合成响应丢失/);await submit();const posts=calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.equal(f.service.forwardWindows.list().total,1);assert.match(document.body.textContent,/全部调用 1/);assert.match(document.body.textContent,/未评分 0/);assert.equal(document.querySelectorAll('img').length,0);
  const frozen=f.service.forwardWindows.list().reports[0];await fill('窗口报告名称','第二份报告');await submit();assert.equal(f.service.forwardWindows.list().total,2);const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='查看窗口 '+frozen.id.slice(0,8));await act(async()=>button.click());assert.equal(document.querySelector('[aria-label="冻结窗口报告"] h4').textContent,'<img onerror=x> 合成窗口');
 }finally{if(root)await act(()=>root.unmount());for(const k of names)if(before[k]===undefined)delete globalThis[k];else globalThis[k]=before[k];dom.window.close();await vite.close();await f.close();}
});
