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

test('operations result drilldown preserves the actual expanded DOM, draft, scroll, account and prior research without writes',()=>ui(async({data,vite,render,click,calls})=>{
 const target=data.research.topics[1];data.researchPipeline.items=[{id:'source',title:'Synthetic result navigation',revision:1,status:'completed',topicId:data.research.topics[0].id,researchResults:{state:'available',items:[{topicId:target.id,title:target.title,version:target.version,hasDossier:true}],unavailable:0}}];
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 const title=document.querySelector('.i-topic-heading h1').textContent,account=document.querySelector('[aria-label="持仓账户"]');await act(()=>{account.value='steady';account.dispatchEvent(new window.Event('change',{bubbles:true}));});await click('6个月');await click('运行详情');
 const original=document.querySelector('dialog[open]'),body=original.querySelector('.m-modal-body'),group=[...original.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('自动化设置'));group.open=true;body.scrollTop=321;
 const draft=[...original.querySelectorAll('label')].find(l=>l.textContent.includes('同时选择主题线索')).querySelector('input'),wasChecked=draft.checked;await act(()=>draft.click());
 const link=[...original.querySelectorAll('a')].find(a=>a.textContent==='查看研判 · '+target.title);await act(()=>link.click());
 assert.equal(document.querySelectorAll('dialog[open]').length,1);assert.match(document.querySelector('dialog[open]>header').textContent,/研究、证据与历史追踪/);assert.equal(document.querySelector('.i-topic-heading h1').textContent,target.title);assert(original.isConnected,'operations stays mounted while research is visible');assert(!original.open);
 await click('← 返回上一层');assert.equal(document.querySelector('dialog[open]'),original);assert(group.open);assert.equal(body.scrollTop,321);assert.equal(draft.checked,!wasChecked);assert.equal(document.querySelector('.i-topic-heading h1').textContent,title);assert.equal(account.value,'steady');
 await click('关闭');assert.equal(document.querySelectorAll('dialog[open]').length,0);assert.equal([...document.querySelectorAll('[aria-label="日线时间范围"] button')].find(e=>e.getAttribute('aria-pressed')==='true').textContent,'6个月');assert(calls.every(c=>!c.method||c.method==='GET'));
}));

test('operations source links return through settings and keep original source versus result identity',()=>ui(async({data,vite,render,click,calls})=>{
 const [source,target]=data.research.topics;data.researchPipeline.items=[{id:'source',title:'Synthetic shared record',revision:1,status:'reused',topicId:source.id,duplicateSource:{topicId:target.id},researchResults:{state:'waiting',items:[],unavailable:0}}];
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});await click('设置');await act(()=>[...document.querySelectorAll('.settings-links button')].find(b=>b.textContent.includes('自动化与运维')).click());
 const ops=document.querySelector('dialog[open]');for(const [label,expected] of [['来源记录',source],['共用来源记录',target]]){
  await act(()=>[...ops.querySelectorAll('a')].find(a=>a.textContent===label).click());assert.equal(document.querySelector('.i-topic-heading h1').textContent,expected.title);await act(()=>[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent==='← 返回上一层').click());assert.equal(document.querySelector('dialog[open]'),ops);
 }
 await act(()=>[...ops.querySelectorAll('button')].find(b=>b.textContent==='← 返回上一层').click());assert.equal(document.querySelector('dialog[open]>header h2').textContent,'设置');await click('关闭');assert(calls.every(c=>!c.method||c.method==='GET'));
}));

test('operations intercept only accepted plain local research links and preserve native modifier, target, external and missing-result navigation',()=>ui(async({vite})=>{
 const {followOperationResearch}=await vite.ssrLoadModule('/src/integrated/Operations.jsx'),wrapper=document.createElement('div'),link=document.createElement('a');wrapper.append(link);document.body.append(wrapper);let attempts=[];
 const check=(href,extra={},accept=true)=>{link.href=href;const event={button:0,target:link,currentTarget:wrapper,preventDefault(){this.prevented=true;},...extra};followOperationResearch(event,id=>{attempts.push(id);return accept;});return event;};
 assert(check('/?topic=a%26b').prevented);assert.equal(attempts.at(-1),'a&b');assert(!check('/?topic=missing',{},false).prevented);
 const count=attempts.length;for(const extra of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert(!check('/?topic=a',extra).prevented);
 for(const href of ['https://other.example/?topic=a','/?topic=a#source','/other?topic=a','/?topic=a&range=6','/'])assert(!check(href).prevented);
 link.target='_blank';assert(!check('/?topic=a').prevented);link.removeAttribute('target');link.setAttribute('download','file');assert(!check('/?topic=a').prevented);assert.equal(attempts.length,count);wrapper.remove();
}));

test('browser back and forward restore the operations research layer and its source context',()=>ui(async({data,vite,render,click,calls})=>{
 const target=data.research.topics[1];data.researchPipeline.items=[{id:'history-source',title:'Synthetic browser history',revision:1,status:'completed',topicId:data.research.topics[0].id,researchResults:{state:'available',items:[{topicId:target.id,title:target.title,version:target.version,hasDossier:true}],unavailable:0}}];
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});const title=document.querySelector('.i-topic-heading h1').textContent;await click('运行详情');const ops=document.querySelector('dialog[open]'),group=ops.querySelector('details');group.open=true;
 await act(()=>[...ops.querySelectorAll('a')].find(a=>a.textContent==='查看研判 · '+target.title).click());assert.equal(window.history.state.operationsResearch,true);
 const travel=direction=>act(()=>new Promise(resolve=>{window.addEventListener('popstate',()=>setTimeout(resolve,0),{once:true});window.history[direction]();}));
 await travel('back');assert.equal(document.querySelector('dialog[open]'),ops);assert(group.open);assert.equal(document.querySelector('.i-topic-heading h1').textContent,title);
 await travel('forward');assert.match(document.querySelector('dialog[open]>header').textContent,/研究、证据与历史追踪/);assert.equal(document.querySelector('.i-topic-heading h1').textContent,target.title);await click('← 返回上一层');assert.equal(document.querySelector('dialog[open]'),ops);assert.equal(document.querySelector('.i-topic-heading h1').textContent,title);assert(calls.every(c=>!c.method||c.method==='GET'));
}));

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

test('occupied-account default remains separate from a manual choice across background updates and detail return',()=>ui(async({data,vite,render,click,calls})=>{
 const a=data.overview.accounts.find(a=>a.id==='scenario');data.overview.defaultAccount=a.id;
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 const select=()=>document.querySelector('[aria-label="持仓账户"]');assert.equal(select().value,a.id);
 await act(()=>{select().value='steady';select().dispatchEvent(new window.Event('change',{bubbles:true}));});assert.match(document.querySelector('.dashboard-empty').textContent,/尚未初始化/);
 data.overview.defaultAccount='aggressive';await click('查看更多事件 · 3 →');await click('← 返回原看板');assert.equal(select().value,'steady');assert.match(document.querySelector('.dashboard-empty').textContent,/尚未初始化/);assert(calls.every(c=>!c.method||c.method==='GET'));
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

test('event grouping expands research, filters across members and preserves selection and expansion through full list and detail return',()=>ui(async({data,vite,render,click,calls})=>{
 const [a,b,other]=data.research.topics;a.categoryId='policy';b.categoryId='product';other.categoryId='clinical';
 data.overview.eventClusters=[{id:'fixture-group',title:'Synthetic shared event',status:'active',version:2,health:{current:true},actor:{kind:'system'},topicIds:[a.id,b.id]}];
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 assert.equal(document.querySelectorAll('.dashboard-event').length,2);assert.match(document.querySelector('.i-section-head').textContent,/2 项 · 3 份研究/);
 await click('展开 2 份研究');const members=[...document.querySelectorAll('.dashboard-event-members>button')];assert.equal(members.length,2);
 await act(()=>members.find(el=>el.querySelector('strong').textContent===b.title).click());assert.equal(document.querySelector('.i-topic-heading h1').textContent,b.title);
 await click('深入研究 →');await click('← 返回原看板');assert(document.querySelector('.dashboard-event-members'));assert.equal(document.querySelector('.i-topic-heading h1').textContent,b.title);
 await click('查看更多事件 · 2 →');assert(document.querySelector('.dashboard-radar-full .dashboard-event-members'));await act(()=>[...document.querySelectorAll('.dashboard-event-members>button')].find(el=>el.querySelector('strong').textContent===b.title).click());await click('← 返回事件列表');assert(document.querySelector('.dashboard-radar-full .dashboard-event-members'));await click('← 返回原看板');assert(document.querySelector('.dashboard-event-members'));assert.equal(document.querySelector('.i-topic-heading h1').textContent,b.title);
 const scope=document.querySelector('[aria-label="事件类型"]'),type=(await vite.ssrLoadModule('/src/integrated/event-view.js')).eventProfile(a).id;
 await act(()=>{scope.value=type;scope.dispatchEvent(new window.Event('change',{bubbles:true}));});
 assert(document.querySelector('.dashboard-event-members'),'filtering keeps the group expanded');assert.match(document.querySelector('.dashboard-event-members').textContent,new RegExp(b.title));
 assert(calls.every(c=>!c.method||c.method==='GET'));assert(data.research.topics.some(t=>t.id===other.id));
}));

test('background group expansion and invalidation retain the selected research even outside the first five rows',()=>ui(async({data,vite,render,click})=>{
 const {default:Radar}=await vite.ssrLoadModule('/src/integrated/EventRadar.jsx'),{groupEventResearch}=await import('../shared/workbench-events.mjs');
 const base=data.research.topics[0],topics=Array.from({length:8},(_,i)=>({...base,id:'fixture-'+i,title:'Fixture research '+i,updatedAt:`2026-10-0${8-i}T08:00:00Z`}));
 const cluster={id:'stable-cluster',title:'Stable event',status:'active',version:1,health:{current:true},topicIds:['fixture-6','fixture-7']};let overview={eventClusters:[cluster]};const selected='fixture-7';
 function Harness(){const [expanded,onExpand]=useState(null);return React.createElement(Radar,{topics,rows:groupEventResearch(topics,overview),overview,selected,expanded,onExpand,filters:{search:'',archived:false,eventType:'all',researchStage:'ready',eventScope:'all'},onFilter:()=>{},onSelect:()=>{},onMore:()=>{},onNews:()=>{},onRelations:()=>{}});}
 await render(React.createElement(Harness));assert.equal(document.querySelectorAll('.dashboard-event').length,5);assert.match(document.querySelector('.dashboard-event.selected').textContent,/Stable event/);await click('展开 2 份研究');
 overview={eventClusters:[{...cluster,version:2,topicIds:['fixture-5','fixture-6','fixture-7']}]};await render(React.createElement(Harness));assert.equal(document.querySelectorAll('.dashboard-event-members>button').length,3);assert.equal(document.querySelector('.dashboard-event-members>button[aria-pressed="true"] strong').textContent,'Fixture research 7');
 overview={eventClusters:[{...cluster,health:{current:false}}]};await render(React.createElement(Harness));assert(!document.querySelector('.dashboard-event-members'));assert.match(document.querySelector('.dashboard-event.selected').textContent,/Fixture research 7/);assert.match(document.querySelector('.dashboard-event.selected').textContent,/原归组依据已变化/);
}));

test('retired research stays inside event history, carries an explicit old-judgement label and returns without losing context',()=>ui(async({data,vite,render,click,calls})=>{
 const [a,b,old]=data.research.topics;const history={topicId:old.id,currentTopicId:a.id,replacedByTopicId:a.id,materialRevision:1,clusterVersion:2,replacedAt:'2026-10-08T00:00:00Z'};
 data.overview.eventClusters=[{id:'history-event',title:'Synthetic continuing event',status:'active',version:2,health:{current:true},topicIds:[a.id,b.id],history:[history]}];window.history.replaceState(null,'','/?topic='+old.id);
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 assert.equal(document.querySelectorAll('.dashboard-event').length,1);assert.match(document.querySelector('.i-section-head').textContent,/1 项 · 2 份当前研究 · 1 份历史/);assert.equal(document.querySelectorAll('.dashboard-event-members>button:not(.dashboard-history-toggle)').length,2);assert.equal(document.querySelectorAll('.dashboard-event-history>button').length,1);assert.match(document.querySelector('.dashboard-history-notice').textContent,/不代表当前事件判断/);assert.match(document.querySelector('.v8-verdict').textContent,/原判断/);
 await click('深入研究 →');assert(document.querySelector('dialog .dashboard-history-notice'));await click('← 返回原看板');assert.equal(new URL(window.location.href).searchParams.get('topic'),old.id);assert(document.querySelector('.dashboard-event-history'));
 await click('查看更多事件 · 1 →');await act(()=>document.querySelector('.dashboard-event-history>button').click());await click('← 返回事件列表');assert(document.querySelector('.dashboard-event-history'));await click('← 返回原看板');
 await click('查看当前研究');assert.equal(new URL(window.location.href).searchParams.get('topic'),a.id);assert(!document.querySelector('.dashboard-history-notice'));await click('收起历史研究 · 1 份');assert(!document.querySelector('.dashboard-event-history'));await click('查看历史研究 · 1 份');await act(()=>document.querySelector('.dashboard-event-history>button').click());assert.equal(new URL(window.location.href).searchParams.get('topic'),old.id);
 await click('收起 2 份研究 · 历史 1 份');assert(!document.querySelector('.dashboard-event-members'));assert.match(document.querySelector('.dashboard-event.selected').textContent,/正在查看历史研究/);assert(calls.every(c=>!c.method||c.method==='GET'));
}));
test('a filter matching only historical research still exposes its event and labels the matching history',()=>ui(async({data,vite,render,click})=>{
 const {default:Radar}=await vite.ssrLoadModule('/src/integrated/EventRadar.jsx'),{groupEventResearch}=await import('../shared/workbench-events.mjs');const [a,b,old]=data.research.topics;
 const overview={eventClusters:[{id:'filtered-history',title:'Event with history',status:'active',version:2,health:{current:true},topicIds:[a.id,b.id],history:[{topicId:old.id,currentTopicId:a.id,materialRevision:1,clusterVersion:2}]}]};
 function Harness(){const [expanded,onExpand]=useState(null),[historyExpanded,onHistoryExpand]=useState(null);return React.createElement(Radar,{topics:[old],rows:groupEventResearch(data.research.topics,overview),overview,selected:a.id,expanded,onExpand,historyExpanded,onHistoryExpand,filters:{search:'historical',archived:false,eventType:'all',researchStage:'ready',eventScope:'all'},onFilter:()=>{},onSelect:()=>{},onMore:()=>{},onNews:()=>{},onRelations:()=>{}});}
 await render(React.createElement(Harness));assert.equal(document.querySelectorAll('.dashboard-event').length,1);assert.match(document.querySelector('.dashboard-event-expand').textContent,/命中 0 份当前 \/ 1 份历史/);await act(()=>document.querySelector('.dashboard-event-expand').click());await click('查看历史研究 · 1 份');assert.match(document.querySelector('.dashboard-event-history').textContent,new RegExp(old.title));assert.equal(document.querySelectorAll('.dashboard-event-members>button:not(.dashboard-history-toggle)').length,2);
}));

function sourceHistoryFixture(data){
 const [old,current,middle]=data.research.topics;old.updatedAt='2026-10-10T00:00:00Z';current.updatedAt='2026-10-08T00:00:00Z';
 data.overview.eventClusters=[];data.overview.sourceHistory={groups:[{id:'source-history:'+old.id,title:current.title,currentTopicId:current.id,materialRevision:3,history:[{kind:'source-succession',topicId:old.id,currentTopicId:current.id,materialRevision:1},{kind:'source-succession',topicId:middle.id,currentTopicId:current.id,materialRevision:2}]}],warnings:[]};return {old,current,middle};
}
test('standalone source history defaults to the current judgement, expands in place and retains original-detail return',()=>ui(async({data,vite,render,click,calls})=>{
 const {old,current}=sourceHistoryFixture(data),{default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 assert.equal(document.querySelectorAll('.dashboard-event').length,1);assert.match(document.querySelector('.i-section-head').textContent,/1 项 · 1 份当前研究 · 2 份历史/);assert.equal(document.querySelector('.i-topic-heading h1').textContent,current.title);assert(!document.querySelector('.dashboard-history-notice'));
 await click('展开 1 份研究 · 历史 2 份');await click('查看历史研究 · 2 份');assert.match(document.querySelector('.dashboard-event-members').textContent,/不代表独立来源增加/);
 await act(()=>[...document.querySelectorAll('.dashboard-event-history>button')].find(el=>el.querySelector('strong').textContent===old.title).click());assert(document.querySelector('.dashboard-history-notice'));assert.match(document.querySelector('.v8-verdict').textContent,/原判断/);
 await click('深入研究 →');assert(document.querySelector('dialog .dashboard-history-notice'));await click('← 返回原看板');assert.equal(new URL(window.location.href).searchParams.get('topic'),old.id);assert(document.querySelector('.dashboard-event-history'));
 await click('查看当前研究');assert.equal(new URL(window.location.href).searchParams.get('topic'),current.id);assert(!document.querySelector('.dashboard-history-notice'));assert(calls.every(c=>!c.method||c.method==='GET'));
}));
test('an explicit old-research link stays on that original judgement and expands source history automatically',()=>ui(async({data,vite,render,click})=>{
 const {old,current}=sourceHistoryFixture(data);window.history.replaceState({},'',`/?topic=${encodeURIComponent(old.id)}`);
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});
 assert.equal(document.querySelector('.i-topic-heading h1').textContent,old.title);assert(document.querySelector('.dashboard-event-history'));assert(document.querySelector('.dashboard-history-notice'));
 await click('查看更多事件 · 1 →');await act(()=>[...document.querySelectorAll('.dashboard-event-history>button')].find(el=>el.querySelector('strong').textContent===old.title).click());await click('← 返回事件列表');assert(document.querySelector('.dashboard-event-history'));await click('← 返回原看板');await click('查看当前研究');assert.equal(new URL(window.location.href).searchParams.get('topic'),current.id);
}));

test('daily risk summary counts affected holdings and puts a later-account trigger ahead of the first gap',()=>ui(async({data,DecisionSidebar,DashboardStatus,render})=>{
 const p=data.overview.accounts.find(a=>a.kind==='scenario').positions[0];data.overview.risks=[{id:'gap',category:'gap',account:p.account,positionId:p.id,symbol:p.symbol,message:'Synthetic input missing'},{id:'risk1',category:'risk',account:'other',positionId:'other:one',symbol:'NVDA.US',message:'Synthetic active trigger'},{id:'risk2',category:'risk',account:'other',positionId:'other:one',symbol:'NVDA.US',message:'Synthetic second trigger'}];let selected;
 await render(React.createElement(DecisionSidebar,{overview:data.overview,onRisk:r=>selected=r,onAllRisks:()=>{},onRuntime:()=>{}}));assert.match(document.querySelector('.dashboard-side-scroll section').textContent,/风险 1 · 复核 0 · 缺口 1/);assert.match(document.querySelector('.dashboard-side-scroll section button').textContent,/Synthetic active trigger/);await act(()=>document.querySelector('.dashboard-side-scroll section button').click());assert.equal(selected.positionId,'other:one');
 await render(React.createElement(DashboardStatus,{data}));assert.match(document.querySelector('.dashboard-status').textContent,/风险 1 · 复核 0 · 缺口 1/);
}));
test('full reminders filter and paginate all items, retain account identity and return from an exact holding without losing the list page',()=>ui(async({data,vite,render,click,calls})=>{
 const p=data.overview.accounts.find(a=>a.kind==='scenario').positions[0];data.overview.risks=Array.from({length:61},(_,i)=>({id:'fixture-risk-'+i,account:p.account,positionId:p.id,topicId:p.topicId,symbol:p.symbol,category:i===60?'risk':'gap',message:'Synthetic reminder '+i}));
 const {default:Workbench}=await vite.ssrLoadModule('/src/integrated/IntegratedWorkbench.jsx');await render(React.createElement(Workbench));await act(async()=>{});await click('全部提醒 · 61 条 →');
 let panel=()=>document.querySelector('[aria-label="全部持仓提醒"]');assert.equal(panel().querySelectorAll('.dashboard-list-item').length,50);assert.match(panel().querySelector('.dashboard-list-item').textContent,/Synthetic reminder 60/);
 await act(()=>{const s=document.querySelector('[aria-label="提醒类型"]');s.value='gap';s.dispatchEvent(new window.Event('change',{bubbles:true}));});await click('下一页提醒');assert.equal(panel().querySelectorAll('.dashboard-list-item').length,10);assert.match(panel().textContent,/51–60 \/ 60/);
 await act(()=>panel().querySelector('.dashboard-list-item').click());assert(document.querySelector('[aria-label="持仓长期档案"]'));await click('← 返回上一层');assert.equal(document.querySelector('[aria-label="提醒类型"]').value,'gap');assert.match(panel().textContent,/51–60 \/ 60/);
 await click('上一页提醒');assert.equal(panel().querySelectorAll('.dashboard-list-item').length,50);await click('← 返回原看板');assert.equal(document.querySelectorAll('dialog[open]').length,0);assert(calls.every(c=>!c.method||c.method==='GET'));
}));
