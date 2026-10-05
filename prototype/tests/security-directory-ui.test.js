import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('directory market controls bind refresh requests, retry unknown outcomes and disclose future snapshots without adopting them',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});let finish;const calls=[];
  const response=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}}),snapshot=m=>({id:m+'-snapshot',counts:{rows:2,eligible:1,excluded:1},receivedAt:'2026-10-03T00:00:00Z',futureDated:m==='HK',asOfDateUTC:'2026-10-03',sources:[{id:m,url:'https://example.com/directory',sourceDate:m==='CN'?null:'2026-10-05',receivedAt:'2026-10-03T00:00:00Z'}]});
  globalThis.fetch=async(path,options)=>{calls.push({path,options});if(options?.method==='POST')return new Promise(resolve=>{finish=resolve;});const u=new URL(path,'http://localhost'),m=u.searchParams.get('market');assert(['US','CN','HK'].includes(m));return response({enabled:true,running:false,current:snapshot(m),active:m==='HK'?null:snapshot(m),ageDays:0,coverage:{CN:'沪深，不含北交所',HK:'港币证券'},history:[snapshot(m)],attempts:[],search:{snapshot:snapshot(m),total:1,items:[{symbol:m==='HK'?'01211.HK':'002594.SZ',name:'合成公司',venue:m,currency:m==='HK'?'HKD':'CNY'}]}});};
  const {createRoot}=await import('react-dom/client'),{default:SecurityDirectory}=await vite.ssrLoadModule('/src/major/SecurityDirectory.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(SecurityDirectory)));
  const selects=()=>[...document.querySelectorAll('select')],button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label),choose=m=>act(async()=>{if(selects()[0].disabled)return;selects()[0].value=m;selects()[0].dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(calls.filter(c=>c.options?.method==='POST').length,0);await choose('HK');assert.match(document.body.textContent,/晚于当前 UTC 日期 2026-10-03/);assert.match(document.body.textContent,/本市场暂无可用官方版本/);
  await act(()=>button('获取官方港股目录').click());const first=calls.find(c=>c.options?.method==='POST');assert.equal(JSON.parse(first.options.body).market,'HK');assert(selects().every(s=>s.disabled));await choose('CN');assert.equal(selects()[0].value,'HK');await act(()=>button('获取官方港股目录').click());assert.equal(calls.filter(c=>c.options?.method==='POST').length,1);
  await act(async()=>finish(new Response(JSON.stringify({error:'合成连接错误'}),{status:500,headers:{'content-type':'application/json'}})));assert.equal(selects()[0].disabled,false);await act(()=>button('获取官方港股目录').click());assert.equal(calls.filter(c=>c.options?.method==='POST')[1].options.body,first.options.body);await act(async()=>finish(response({status:'running'})));
  await choose('CN');assert.match(document.body.textContent,/生成日期 未知/);assert.doesNotMatch(document.body.textContent,/本市场暂无可用官方版本/);await act(()=>button('获取官方沪深 A 股目录').click());const third=calls.filter(c=>c.options?.method==='POST')[2];assert.equal(JSON.parse(third.options.body).market,'CN');assert.notEqual(JSON.parse(third.options.body).requestId,JSON.parse(first.options.body).requestId);await act(async()=>finish(response({status:'running'})));
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
