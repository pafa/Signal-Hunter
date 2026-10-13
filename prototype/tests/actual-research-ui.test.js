import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';

async function ui(run){
 const f=await marketResearchFixture({composite:true}),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
  const ts=f.service.research.list().filter(t=>t.eventExtraction),base={account:'Synthetic actual UI',currency:'USD',at:f.at(),source:'Synthetic only'},rows=[{...base,type:'opening',externalId:'open',sequence:'0',amount:'10000',costMethod:'average'},...ts.map((t,i)=>({...base,type:'buy',externalId:'buy-'+i,sequence:String(i+1),symbol:'NVDA.US',quantity:'1',amount:'100',fees:'0',topicId:t.id,topicVersion:t.version}))];
  const h=f.service.actualHoldings.ledger,p=h.preview({rows,confirmOpening:true});assert(p.canApply);h.apply({id:p.id,hash:p.hash});f.service.syncWatches();await f.observe();
  const {PositionDetails,HoldingsSummary}=await vite.ssrLoadModule('/src/integrated/DashboardPanels.jsx'),{ActualObservationInput}=await vite.ssrLoadModule('/src/integrated/ActualObservationDetails.jsx');
  const snapshot=()=>{const overview=f.service.snapshot().overview,account=overview.accounts.find(a=>a.kind==='actual');return {overview,account,position:account.positions[0]};};
  await run({f,snapshot,PositionDetails,HoldingsSummary,ActualObservationInput});
 }finally{await vite.close();await f.close();}
}
test('actual detail keeps each original version reachable and displays current composite conditions without an order form',()=>ui(async({snapshot,PositionDetails})=>{
 const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const s=snapshot(),calls=[];
  await act(()=>root.render(React.createElement(PositionDetails,{...s,onResearch:(...args)=>calls.push(args),onAccount:()=>{}})));
  const buttons=[...document.querySelectorAll('button')],originals=buttons.filter(b=>b.textContent.startsWith('查看原记录关联版本'));assert.equal(originals.length,2);assert.match(document.body.textContent,/事件综合/);assert.match(document.body.textContent,/原记录关联 · 2 项/);assert.equal(document.querySelectorAll('input,form,textarea').length,0);
  for(const [i,b]of originals.entries()){await act(()=>b.click());assert.equal(calls.at(-1)[0].topicId,s.position.actualResearch.origins[i].topicId);assert.equal(calls.at(-1)[0].openingVersion,s.position.actualResearch.origins[i].version);assert.equal(calls.at(-1)[1],true);}
  const current=buttons.find(b=>b.textContent==='查看对应研究');assert.equal(current.disabled,false);await act(()=>current.click());assert.equal(calls.at(-1)[0].currentBinding.kind,'event-cluster');assert.equal(calls.at(-1)[0].topicId,null);assert.equal(calls.at(-1)[1],false);
  const origins=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='原记录关联 · 2 项');await act(()=>{origins.open=true;origins.dispatchEvent(new window.Event('toggle'));});await act(()=>originals[0].click());assert.equal(calls.at(-1)[2].expanded['actual-origins'],true);
  await act(()=>root.render(React.createElement(PositionDetails,{key:'return-to-position',...s,initialExpanded:calls.at(-1)[2].expanded,onResearch:()=>{},onAccount:()=>{}})));assert.equal([...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='原记录关联 · 2 项').open,true);
 }finally{if(root)await act(()=>root.unmount());for(const [k,d]of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();}
}));
test('holding summary shows the current composite and dated review window; unavailable original associations stay explicit and safely escaped',()=>ui(async({snapshot,PositionDetails,HoldingsSummary})=>{
 const s=snapshot(),p=structuredClone(s.position);p.actualResearch.title='Synthetic <script>unsafe</script>';p.actualResearch.origins[0].baselineAvailable=false;
 let html=renderToStaticMarkup(React.createElement(PositionDetails,{position:p,account:s.account,onResearch:()=>{},onAccount:()=>{}}));assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/历史不可用/);assert.equal((html.match(/查看原记录关联版本/g)||[]).length,1);assert.match(html,/不是卖出限价或日期/);
 html=renderToStaticMarkup(React.createElement(HoldingsSummary,{overview:s.overview,accountId:s.account.id,expanded:p.id}));assert.match(html,/综合 v1/);assert.match(html,/原记录 2 项研究关联/);assert.equal(s.position.actualResearch.horizonAt,'2026-10-09T14:00:00Z');assert.match(html,/10\/09/);assert.doesNotMatch(html,/原记录 vnull/);
}));
test('expired guidance and retained trigger details are labeled separately from current conditions and research targets',()=>ui(async({f,snapshot,PositionDetails,ActualObservationInput})=>{
 const before=snapshot(),check=f.service.observations.summary().actualChecks.find(c=>c.reviewKind==='research-exitCondition');assert(check.details.metrics.researchCondition);
 const history=renderToStaticMarkup(React.createElement(ActualObservationInput,{input:check.details}));assert.match(history,/原记录关联 2 项研究/);assert.match(history,/检查时当前监控：事件综合/);assert.doesNotMatch(history,/历史研究不可用/);
 f.tick(6*3600000);const current=snapshot(),html=renderToStaticMarkup(React.createElement(PositionDetails,{...current,onResearch:()=>{},onAccount:()=>{}}));assert.match(html,/历史参考|等待有效判断/);assert.match(html,/以下为上次检查输入/);assert.doesNotMatch(html,/估值情景 .*USD \/ 股/);assert.equal(current.position.costCents,before.position.costCents);
}));
test('actual alert opens the monitored composite company inside the receipt dialog and preserves the unsaved note on return',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const {default:Inbox}=await vite.ssrLoadModule('/src/integrated/ObservationInbox.jsx'),requests=[],item={id:'actual-alert',revision:1,title:'Synthetic exit review',state:'pending',kind:'actual-review',topicId:'original',topicVersion:3,symbols:['NVDA.US'],createdAt:'2026-10-08T14:00:00Z',input:{evaluatedAt:'2026-10-08T14:00:00Z',record:{account:'Synthetic actual',symbol:'NVDA.US',version:1,quantity:'1',asOf:'2026-10-08T14:00:00Z'},monitoringLink:{origins:[{baselineAvailable:true}],current:{kind:'event-cluster',id:'current-composite',version:1},reason:'Synthetic verified association'},metrics:{}}};
  globalThis.fetch=async path=>{requests.push(path);return new Response(JSON.stringify(path.startsWith('/api/event-clusters/')?{selected:null,overview:{reason:'Synthetic no current result'},history:[]}:{items:[item],total:1,ceiling:1,nextCursor:null,revision:'1:0'}),{headers:{'content-type':'application/json'}});};
  await act(async()=>root.render(React.createElement(Inbox,{data:{runtime:{instance:{id:'fixture'}},observationInbox:{revision:'1:0'}},initialTodoId:item.id,closeLabel:'← 返回上一层',onClose:()=>{},onTopic:()=>assert.fail('must not choose the superseded original'),mutate:()=>assert.fail('read path must not write')})));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),input=document.querySelector('input');assert(button('← 返回上一层'));assert(!button('查看当前研究'));
  await act(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'Keep receipt draft');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await act(async()=>button('查看监控事件综合').click());assert(requests.includes('/api/event-clusters/current-composite/research'));assert.equal(button('公司依据').getAttribute('aria-selected'),'true');assert.equal(document.querySelectorAll('dialog[open]').length,1);
  await act(()=>button('← 返回待办记录').click());assert.equal(document.querySelector('input').value,'Keep receipt draft');assert.equal(document.querySelector('select').value,'all');assert.equal(requests.filter(p=>p.startsWith('/api/observations')).length,1);assert(button('查看监控事件综合'));
 }finally{if(root)await act(()=>root.unmount());for(const [k,d]of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
});
