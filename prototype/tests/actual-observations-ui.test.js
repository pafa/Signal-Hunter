import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const input={record:{account:'Synthetic <script>unsafe</script>',symbol:'00700.HK',version:2,quantity:'10.5',asOf:'2026-10-02T06:00:00Z',topicVersion:1},currentTopicVersion:3,evaluatedAt:'2026-10-02T06:01:00Z',episode:1,baselineAvailable:true,metrics:{marketTimezone:'Asia/Hong_Kong',localDate:'2026-10-02',deadlines:[{id:'t',kind:'research',value:'2026-10-02'}],due:[{id:'t',kind:'research',value:'2026-10-02'}]},evidence:[{id:'e',claim:'Synthetic <img onerror="bad()">',verification:'unverified'}]};
const withView=async run=>{const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});try{await run(await vite.ssrLoadModule('/src/integrated/ActualObservationDetails.jsx'));}finally{await vite.close();}};
test('frozen actual trigger details preserve native account identity, research versions and safe evidence rendering',()=>withView(async({default:View})=>{
 const html=renderToStaticMarkup(React.createElement(View,{input}));assert.match(html,/持仓记录 v2/);assert.match(html,/绑定研究 v1/);assert.match(html,/检查时 v3/);assert.match(html,/Asia\/Hong_Kong/);assert.match(html,/已到期/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img onerror/);assert.match(html,/已读、已处理不解除风险/);assert.doesNotMatch(html,/vnull/);
}));
test('stale current checks stay labeled as old and open the exact frozen trigger rather than an unfiltered list',()=>withView(async({ActualMonitoring})=>{
 const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));let selected;
 const monitoring={label:'巡检已暂停',current:false,checkedAt:input.evaluatedAt,gaps:['分钟行情任务已暂停'],checks:[{id:'check',reviewKind:'counterevidence',status:'unknown',active:true,reason:'Synthetic unknown',details:input,lastTodoId:'exact-fixture-todo'}],policy:'Synthetic policy'};
 await act(()=>root.render(React.createElement(ActualMonitoring,{monitoring,onObservation:id=>selected=id})));assert.match(document.body.textContent,/上次检查，不代表当前状态/);assert.match(document.body.textContent,/旧触发未确认解除/);await act(()=>document.querySelector('button').click());assert.equal(selected,'exact-fixture-todo');
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();}
}));

const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
async function withDom(run){
 const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));await run(root,dom);}
 finally{if(root)await act(()=>root.unmount());for(const [k,d] of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();}
}
const ref=(hash='a',record='b')=>({recordId:record.repeat(64),checkId:'c'.repeat(64),hash:hash.repeat(64)});
const summary=detailRef=>({id:detailRef.checkId,recordId:detailRef.recordId,reviewKind:'condition:fixture',conditionLabel:'Synthetic custom condition',status:'unknown',active:true,reason:'Synthetic missing input',detailRef,lastTodoId:'frozen-trigger'});
const monitor=c=>({label:'后台已检查',current:true,checkedAt:input.evaluatedAt,gaps:[],checks:[c],policy:'Synthetic policy',hitCount:0,unknownCount:1});
const reply=(r,account)=>Response.json({...r,check:{id:r.checkId,recordId:r.recordId,details:{...input,record:{...input.record,account}}}});
test('check details load only on expansion, reuse a matching read on reopen, and preserve trigger navigation',()=>withView(async({ActualMonitoring})=>withDom(async(root,dom)=>{
 const calls=[],r=ref();globalThis.fetch=async(path,options)=>{calls.push({path,options});return reply(r,'Exact synthetic account');};
 let selected;await act(()=>root.render(React.createElement(ActualMonitoring,{monitoring:monitor(summary(r)),onObservation:id=>selected=id})));
 assert.equal(calls.length,0);assert.match(document.body.textContent,/Synthetic custom condition/);assert.doesNotMatch(document.body.textContent,/Exact synthetic account/);
 const toggle=async open=>act(async()=>{const d=document.querySelector('details');d.open=open;d.dispatchEvent(new dom.window.Event('toggle'));await new Promise(r=>setTimeout(r,0));});
 await toggle(true);assert.equal(calls.length,1);assert.match(document.body.textContent,/Exact synthetic account/);assert.equal(calls[0].options.headers['X-Signal-Holding-Checks'],'summary-v1');
 await toggle(false);await toggle(true);assert.equal(calls.length,1);
 await act(()=>document.querySelector('button').click());assert.equal(selected,'frozen-trigger');
})));
test('new check version and account supersede pending reads; closed checks do not load until a restored expansion',()=>withView(async({ActualMonitoring})=>withDom(async root=>{
 const pending=[],seen=[];globalThis.fetch=path=>{seen.push(path);const d=deferred();pending.push(d);return d.promise;};
 const render=(r,open)=>act(()=>root.render(React.createElement(ActualMonitoring,{monitoring:monitor(summary(r)),disclosure:()=>({open})})));
 const old=ref(),next=ref('d'),other=ref('e','f');
 await render(old,true);assert.equal(seen.length,1);
 await render(next,true);assert.equal(seen.length,2);assert.doesNotMatch(document.body.textContent,/旧版账户/);
 await act(()=>{pending[0].resolve(reply(old,'旧版账户'));});assert.doesNotMatch(document.body.textContent,/旧版账户/);
 await render(other,false);await act(()=>{pending[1].resolve(reply(next,'已离开账户'));});assert.equal(seen.length,2);assert.doesNotMatch(document.body.textContent,/已离开账户/);
 await render(other,true);assert.equal(seen.length,3);await act(()=>{pending[2].resolve(reply(other,'当前账户依据'));});assert.match(document.body.textContent,/当前账户依据/);assert.doesNotMatch(document.body.textContent,/旧版账户|已离开账户/);
 const changed=ref('1','f');await render(changed,true);assert.equal(seen.length,4);assert.doesNotMatch(document.body.textContent,/当前账户依据/);await act(()=>{pending[3].resolve(reply(changed,'更新检查依据'));});assert.match(document.body.textContent,/更新检查依据/);
})));
test('failed or mismatched detail responses never render as evidence and retry without touching historical triggers',()=>withView(async({ActualMonitoring})=>withDom(async root=>{
 const r=ref();let calls=0,selected;globalThis.fetch=async()=>{calls++;if(calls===1)return Response.json({error:'巡检依据已更新，请等待看板刷新后重新展开'},{status:400});if(calls===2)return reply(ref('9'),'错配依据');return reply(r,'重试正确依据');};
 await act(()=>root.render(React.createElement(ActualMonitoring,{monitoring:monitor(summary(r)),disclosure:()=>({open:true}),onObservation:id=>selected=id})));
 assert.match(document.body.textContent,/巡检依据已更新/);assert.equal(calls,1);
 const retry=()=>act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试读取依据').click());
 await retry();assert.match(document.body.textContent,/巡检依据校验失败/);assert.doesNotMatch(document.body.textContent,/错配依据/);
 await retry();assert.match(document.body.textContent,/重试正确依据/);assert.equal(calls,3);
 await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='查看最近触发与回执').click());assert.equal(selected,'frozen-trigger');
})));
