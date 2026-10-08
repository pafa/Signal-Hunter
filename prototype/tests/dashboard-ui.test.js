import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useState} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';

async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),store=openStore(':memory:'),service=createService(store,{mode:'demo'});
 const names=['window','document','HTMLElement','sessionStorage','localStorage','ResizeObserver','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  const data=service.snapshot(),calls=[];
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,ResizeObserver:class{observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true,fetch:async(path,options)=>{calls.push({path,method:options?.method});return Response.json(path==='/api/data'?data:{records:[],items:[],todos:[],lanes:[],counts:{}});}});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {createRoot}=await import('react-dom/client'),panels=await vite.ssrLoadModule('/src/integrated/DashboardPanels.jsx');root=createRoot(document.getElementById('root'));
  const button=text=>[...document.querySelectorAll('button')].find(e=>e.textContent===text),click=async text=>{assert(button(text),`Missing button ${text}`);await act(()=>button(text).click());};
  await run({data,calls,vite,...panels,button,click,render:node=>act(()=>root.render(node))});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];await service.close();store.close();dom.window.close();await vite.close();}
}

test('home offers one automatic-research control and leaves unavailable demo mode disabled',()=>ui(async({data,DashboardStatus,render,click,button})=>{
 const actions=[];
 await render(React.createElement(DashboardStatus,{data,onRuntime:()=>{},onAutomation:a=>actions.push(a)}));assert(button('启动自动研究').disabled);
 data.researchPipeline.enabled=true;data.runtime.offline=false;
 await render(React.createElement(DashboardStatus,{data,onRuntime:()=>{},onAutomation:a=>actions.push(a)}));await click('启动自动研究');assert.deepEqual(actions,['start']);
 data.researchPipeline.settings.automatic=true;data.operations.discovery.paused=false;
 await render(React.createElement(DashboardStatus,{data,onRuntime:()=>{},onAutomation:a=>actions.push(a)}));await click('暂停自动研究');assert.deepEqual(actions,['start','pause']);
}));

test('holdings keep unrelated positions, expand one row and isolate uninitialized accounts',()=>ui(async({data,HoldingsSummary,render,calls})=>{
 const selected=data.overview.accounts.find(a=>a.id==='scenario').positions[0];
 function Harness(){const [account,setAccount]=useState('scenario'),[expanded,setExpanded]=useState(null);return React.createElement(HoldingsSummary,{overview:data.overview,accountId:account,onAccount:setAccount,expanded,onExpand:setExpanded,selectedTopic:selected.topicId,selectedSymbol:selected.symbol,onSelect:()=>{},onDetail:()=>{},onPortfolio:()=>{}});}
 await render(React.createElement(Harness));assert.equal(document.querySelectorAll('tbody tr').length,5);assert(document.querySelector('tbody tr.selected'));assert.equal(document.querySelectorAll('tbody tr:not(.selected):not(.related)').length,3);
 let expand=[...document.querySelectorAll('button[aria-expanded]')];await act(()=>expand[0].click());assert.equal(document.querySelectorAll('.dashboard-position-expanded').length,1);await act(()=>expand[1].click());assert.equal(document.querySelectorAll('.dashboard-position-expanded').length,1);assert.equal(expand[0].getAttribute('aria-expanded'),'false');
 await act(()=>{const select=document.querySelector('select');select.value='aggressive';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 assert.match(document.querySelector('.dashboard-empty').textContent,/尚未初始化/);assert(!document.querySelector('.dashboard-metrics').textContent.includes('$'));assert.equal(calls.length,0,'reading and account selection cannot trigger writes');
}));

test('global sidebar opens exact account/position and stays independent of the selected research',()=>ui(async({data,DecisionSidebar,render})=>{
 const picked=[];await render(React.createElement(DecisionSidebar,{overview:data.overview,onRisk:r=>picked.push(r),onDecision:r=>picked.push(r),onPosition:id=>picked.push(id),onAllRisks:()=>{},onMonitoring:()=>{},onRuntime:()=>{}}));
 const sections=[...document.querySelectorAll('.dashboard-side-scroll section')];assert.equal(sections.length,3);await act(()=>sections[0].querySelector('button').click());await act(()=>sections[1].querySelector('button').click());
 assert.equal(picked[0].account,'scenario');assert(picked[0].positionId.startsWith('scenario:'));assert.equal(picked[1].side,'sell');assert.equal(picked[1].account,'scenario');assert(!document.querySelector('details').open);
}));

test('workbench detail history returns to holdings and preserves event, account and chart scope without writes',()=>ui(async({data,vite,render,click,calls})=>{
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));
 await act(async()=>{});const title=document.querySelector('.i-topic-heading h1').textContent,account=document.querySelector('[aria-label="持仓账户"]').value;
 await act(()=>document.querySelector('[aria-label^="展开持仓"]').click());await click('深入查看持仓 →');assert.match(document.querySelector('dialog').textContent,/持仓长期档案/);
 await click('查看对应研究');assert.equal(document.querySelectorAll('dialog[open]').length,1);assert.match(document.querySelector('dialog>header').textContent,/返回上一层/);
 await click('← 返回上一层');assert.match(document.querySelector('dialog>header').textContent,/持仓长期档案/);await click('← 返回原看板');
 assert.equal(document.querySelectorAll('dialog[open]').length,0);assert.equal(document.querySelector('.i-topic-heading h1').textContent,title);assert.equal(document.querySelector('[aria-label="持仓账户"]').value,account);assert.equal(document.querySelectorAll('.dashboard-position-expanded').length,1);
 await click('查看更多事件 · 3 →');assert(document.querySelector('.dashboard-radar-full'));await click('← 返回原看板');assert.equal(document.querySelector('[aria-label="持仓账户"]').value,account);
 await act(()=>document.querySelector('[aria-label="展开持仓 SPOT.US"]').click());await click('深入查看持仓 →');await click('查看对应研究');assert.match(document.querySelector('.i-topic-heading h1').textContent,/平台/);await click('← 返回上一层');await click('← 返回原看板');assert.equal(document.querySelector('.i-topic-heading h1').textContent,title,'cross-event detail returns to the original dashboard event');
 await click('关注池 9');await click('6个月');await click('下一组');assert.match(document.querySelector('.daily-pagination').textContent,/2 \/ 3/);
 await click('查看更多事件 · 3 →');await click('← 返回原看板');assert.match(document.querySelector('.daily-pagination').textContent,/2 \/ 3/);assert.equal(document.querySelector('.v6-chart-toolbar button.on')?.textContent,'多股并列');assert.equal([...document.querySelectorAll('[aria-label="日线时间范围"] button')].find(e=>e.getAttribute('aria-pressed')==='true').textContent,'6个月');
 assert(calls.every(c=>!c.method||c.method==='GET'),'drilldown and returning must not write or run research');
}));
