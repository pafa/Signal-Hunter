import test from 'node:test';import assert from 'node:assert/strict';
import React,{act} from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';
const h=React.createElement;
test('sidebar retains older cursor after an empty poll, deduplicates repeat output, ignores a late scope reply and cancels on unmount',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const names=['window','document','HTMLElement','fetch','setTimeout','clearTimeout','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;const timeouts=new Map(),pending=[],opened=[],originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let next=100000;
 const settle=async()=>{await act(async()=>{await new Promise(resolve=>originalTimeout(resolve,0));});};
 const response=(items,cursor)=>({instance:{id:'fixture'},items,cursor,olderCursor:items[0]?.id||null,hasMore:false,tasks:{news:{paused:false,running:true}},serverTime:'2026-10-07T00:00:00Z',processing:[]});
 const line=(id,text)=>({id,at:'2026-10-07T00:00:00Z',kind:'pipeline',action:'ready',lane:'discovery',detail:{},topicId:text});
 try{
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:async path=>{
 if(path.startsWith('/api/workbench-queue'))return new Response(JSON.stringify({items:[],total:0,counts:{},nextOffset:null}),{headers:{'content-type':'application/json'}});
 return await new Promise(resolve=>pending.push({path,resolve:body=>resolve(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}))}));
 },setTimeout:(fn,ms,...args)=>{if(ms===2000||ms===10000){const id=next++;timeouts.set(id,fn);return id;}return originalTimeout(fn,ms,...args);},clearTimeout:id=>{if(timeouts.has(id))timeouts.delete(id);else originalClear(id);}});
 const {createRoot}=await import('react-dom/client'),{default:Sidebar}=await vite.ssrLoadModule('/src/integrated/ActivitySidebar.jsx');root=createRoot(document.getElementById('root'));
 await act(()=>root.render(h(Sidebar,{instanceId:'fixture',topicId:'topic-a',onTodo:()=>{},onRecord:item=>opened.push(item),onOperations:()=>{}})));await settle();const initial=response([line(3,'a'),line(4,'a')],4);initial.processing=[{id:'auto',title:'Automatic financial research',createdAt:initial.serverTime,automatic:true},{id:'manual',title:'Manual research',createdAt:initial.serverTime,automatic:false}];pending.shift().resolve(initial);await settle();
 const progressing=[...document.querySelectorAll('.activity-status>div')];assert.match(progressing.find(x=>x.textContent.startsWith('Automatic')).textContent,/后台/);assert.doesNotMatch(progressing.find(x=>x.textContent.startsWith('Automatic')).textContent,/本人复核/);assert.match(progressing.find(x=>x.textContent.startsWith('Manual')).textContent,/本人复核/);
 assert.equal(document.querySelector('.activity-stream>.m-button').disabled,false);
 const poll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void poll();});await settle();const second=pending.shift();assert.match(second.path,/after=4/);second.resolve(response([],4));await settle();assert.equal(document.querySelector('.activity-stream>.m-button').disabled,false,'empty incremental reply must not erase older history');
 const again=[...timeouts.values()][0];timeouts.clear();await act(()=>{void again();});await settle();pending.shift().resolve(response([line(4,'a'),line(5,'a')],5));await settle();assert.equal(document.querySelectorAll('.activity-line').length,3);
 // Begin a global poll, change the scope, then resolve old work last.
 const lastPoll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void lastPoll();});await settle();const stale=pending.shift();const select=document.querySelector('[aria-label="日志与待办范围"]');await act(()=>{select.value='topic';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await settle();const current=pending.shift();assert.match(current.path,/topic=topic-a/);current.resolve(response([line(9,'current')],9));await settle();stale.resolve(response([line(8,'stale')],8));await settle();assert.equal(document.querySelectorAll('.activity-line').length,1);assert.equal(document.querySelector('.activity-line button').textContent,'查看对应记录 ↗');await act(()=>document.querySelector('.activity-line button').click());assert.equal(opened[0].topicId,'current');
 const retryPoll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void retryPoll();});await settle();
 const retryReply=response([],9);retryReply.tasks={minutes:{blocked:true,automaticRecovery:true,nextRunAt:'2026-10-07T00:02:00Z'},news:{paused:true,nextRunAt:'2026-10-07T00:01:00Z'},execution:{blocked:true,nextRunAt:'2026-10-07T00:01:00Z'}};pending.shift().resolve(retryReply);await settle();
 assert.match(document.querySelector('.activity-status').textContent,/下一步：分钟行情 · 后台重试/);
 assert.match(document.querySelector('.activity-waiting').textContent,/分钟行情 · 连续失败，后台按退避时间重试/);
 const pausePoll=[...timeouts.values()][0];timeouts.clear();await act(()=>{void pausePoll();});await settle();retryReply.tasks.minutes.paused=true;pending.shift().resolve(retryReply);await settle();assert.doesNotMatch(document.querySelector('.activity-status').textContent,/下一步：/);

 }finally{if(root)await act(()=>root.unmount());assert.equal(timeouts.size,0);for(const[k,v]of before)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];dom.window.close();await vite.close();}
});

test('returning from a detail retains log history, filters, paused reading and queue page while hidden work stops',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const names=['window','document','HTMLElement','fetch','setTimeout','clearTimeout','setInterval','clearInterval','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),timeouts=new Map(),intervals=new Map(),requests=[];
 const realTimeout=globalThis.setTimeout,realClear=globalThis.clearTimeout;let root,next=100000,mode='visible',topic='original',defer=false,late;
 const settle=async()=>{await act(async()=>{await new Promise(resolve=>realTimeout(resolve,0));});};
 const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 const line=id=>({id,at:'2026-10-07T00:00:00Z',kind:'pipeline',action:'failed',lane:'discovery',detail:{reason:'Saved record '+id},topicId:'original'});
 const response=(items,cursor)=>({instance:{id:'fixture'},items,cursor,olderCursor:items[0]?.id??null,hasMore:false,tasks:{news:{paused:true}},serverTime:'2026-10-07T00:00:00Z',processing:[]});
 let Sidebar;
 const render=()=>act(()=>root.render(h(React.Activity,{mode},h(Sidebar,{instanceId:'fixture',topicId:topic,onTodo:()=>{},onRecord:()=>{},onOperations:()=>{}}))));
 const select=async(label,value)=>{const el=document.querySelector(`[aria-label="${label}"]`);await act(()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await settle();};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(text));
 try{
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:async path=>{
  requests.push(path);const u=new URL(path,'http://localhost'),p=u.searchParams;
  if(u.pathname==='/api/workbench-queue'){const offset=Number(p.get('offset'));return json({items:[{id:'model:'+offset,kind:'model',status:'candidate',title:'Saved queue '+offset}],counts:{model:40},total:40,nextOffset:offset?null:20});}
  if(defer)return await new Promise(resolve=>late=resolve);
  return json(p.has('before')?(p.get('before')==='101'?response([],303):response([line(101),line(102)],102)):p.has('after')?response([line(303)],303):response([line(301),line(302)],302));
 },setTimeout:(fn,ms,...args)=>{if([100,2000,10000].includes(ms)){const id=next++;timeouts.set(id,fn);return id;}return realTimeout(fn,ms,...args);},clearTimeout:id=>{if(timeouts.has(id))timeouts.delete(id);else realClear(id);},setInterval:fn=>{const id=next++;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)});
 const {createRoot}=await import('react-dom/client');Sidebar=(await vite.ssrLoadModule('/src/integrated/ActivitySidebar.jsx')).default;root=createRoot(document.getElementById('root'));await render();await settle();
 await select('日志与待办范围','topic');const issues=document.querySelector('.activity-tools input');await act(()=>issues.click());await settle();
 await act(()=>button('加载更早记录').click());await settle();
 assert.equal(document.querySelectorAll('.activity-line').length,4);assert.equal(button('跟随最新').getAttribute('aria-pressed'),'false');
 const stream=document.querySelector('.activity-stream');stream.scrollTop=173;
 defer=true;const poll=[...timeouts.values()][0];timeouts.clear();await act(()=>void poll());await settle();assert.ok(late);
 mode='hidden';await render();await settle();assert.equal(timeouts.size,0);assert.equal(intervals.size,0);
 const count=requests.length;topic='detail-topic';await render();await settle();assert.equal(requests.length,count,'hidden detail navigation must not read another research journal');
 late(json(response([line(999)],999)));await settle();assert.equal(timeouts.size,0);
 defer=false;topic='original';mode='visible';await render();await settle();
 assert.equal(document.querySelector('[aria-label="日志与待办范围"]').value,'topic');assert.equal(document.querySelector('.activity-tools input').checked,true);
 assert.equal(document.querySelectorAll('.activity-line').length,5,'loaded older records survive returning, then new records append');assert.ok(!document.querySelector('.activity-stream').textContent.includes('Saved record 999'));
 assert.equal(button('跟随最新').getAttribute('aria-pressed'),'false');assert.equal(document.querySelector('.activity-stream').scrollTop,173);
 assert.ok(requests.some(p=>p.includes('after=302')&&p.includes('topic=original')&&p.includes('issues=1')));
 await act(()=>button('加载更早记录').click());await settle();assert.equal(button('加载更早记录').disabled,true);const atEnd=[...timeouts.values()][0];timeouts.clear();await act(()=>void atEnd());await settle();assert.equal(button('加载更早记录').disabled,true,'a later poll must not re-open exhausted history pagination');
 await act(()=>button('待办').click());await settle();await select('待办类型','model');await act(()=>button('下一页').click());await settle();assert.match(document.querySelector('.activity-todos').textContent,/Saved queue 20/);
 mode='hidden';await render();await settle();mode='visible';await render();await settle();assert.equal(document.querySelector('[aria-label="待办类型"]').value,'model');assert.match(document.querySelector('.activity-todos').textContent,/Saved queue 20/);
 await act(()=>button('运行日志').click());await settle();assert.equal(document.querySelector('.activity-stream').scrollTop,173);
 // A deliberate filter change starts its own fresh log; retained history must not leak into it.
 await select('日志与待办范围','all');assert.equal(document.querySelectorAll('.activity-line').length,2);assert.equal(button('暂停跟随').getAttribute('aria-pressed'),'true');
 }finally{if(root)await act(()=>root.unmount());assert.equal(timeouts.size,0);assert.equal(intervals.size,0);for(const[k,v]of before)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];dom.window.close();await vite.close();}
});
