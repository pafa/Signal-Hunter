import test from 'node:test';import assert from 'node:assert/strict';
import React,{act} from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';
const h=React.createElement;
test('sidebar retains older cursor after an empty poll, deduplicates repeat output, ignores a late scope reply and cancels on unmount',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const names=['window','document','HTMLElement','fetch','setTimeout','clearTimeout','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;const timeouts=new Map(),pending=[],originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let next=100000;
 const settle=async()=>{await act(async()=>{await new Promise(resolve=>originalTimeout(resolve,0));});};
 const response=(items,cursor)=>({instance:{id:'fixture'},items,cursor,olderCursor:items[0]?.id||null,hasMore:false,tasks:{news:{paused:false,running:true}},serverTime:'2026-10-07T00:00:00Z',processing:[]});
 const line=(id,text)=>({id,at:'2026-10-07T00:00:00Z',kind:'pipeline',action:'ready',lane:'discovery',detail:{},topicId:text});
 try{
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:async path=>{
 if(path.startsWith('/api/workbench-queue'))return new Response(JSON.stringify({items:[],total:0,counts:{},nextOffset:null}),{headers:{'content-type':'application/json'}});
 return await new Promise(resolve=>pending.push({path,resolve:body=>resolve(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}))}));
 },setTimeout:(fn,ms,...args)=>{if(ms===2000||ms===10000){const id=next++;timeouts.set(id,fn);return id;}return originalTimeout(fn,ms,...args);},clearTimeout:id=>{if(timeouts.has(id))timeouts.delete(id);else originalClear(id);}});
 const {createRoot}=await import('react-dom/client'),{default:Sidebar}=await vite.ssrLoadModule('/src/integrated/ActivitySidebar.jsx');root=createRoot(document.getElementById('root'));
 await act(()=>root.render(h(Sidebar,{instanceId:'fixture',topicId:'topic-a',onTodo:()=>{},onRecord:()=>{},onOperations:()=>{}})));await settle();pending.shift().resolve(response([line(3,'a'),line(4,'a')],4));await settle();
 assert.equal(document.querySelector('.activity-stream>.m-button').disabled,false);
 const poll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void poll();});await settle();const second=pending.shift();assert.match(second.path,/after=4/);second.resolve(response([],4));await settle();assert.equal(document.querySelector('.activity-stream>.m-button').disabled,false,'empty incremental reply must not erase older history');
 const again=[...timeouts.values()][0];timeouts.clear();await act(()=>{void again();});await settle();pending.shift().resolve(response([line(4,'a'),line(5,'a')],5));await settle();assert.equal(document.querySelectorAll('.activity-line').length,3);
 // Begin a global poll, change the scope, then resolve old work last.
 const lastPoll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void lastPoll();});await settle();const stale=pending.shift();const select=document.querySelector('[aria-label="日志与待办范围"]');await act(()=>{select.value='topic';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await settle();const current=pending.shift();assert.match(current.path,/topic=topic-a/);current.resolve(response([line(9,'current')],9));await settle();stale.resolve(response([line(8,'stale')],8));await settle();assert.equal(document.querySelectorAll('.activity-line').length,1);assert.equal(document.querySelector('.activity-line button').textContent,'查看对应记录 ↗');
 }finally{if(root)await act(()=>root.unmount());assert.equal(timeouts.size,0);for(const[k,v]of before)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];dom.window.close();await vite.close();}
});
