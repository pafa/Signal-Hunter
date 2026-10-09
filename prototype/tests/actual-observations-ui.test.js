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
