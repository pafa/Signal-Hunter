import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const id='actual:'+'a'.repeat(64),other='actual:'+'b'.repeat(64),at='2026-10-06T14:02:00.000Z';
const summary={current:true,ledgerVersion:1,lastId:3,reason:'最新有效采样已核对',asOf:at,windowStart:'2026-10-06T14:00:00.000Z',windowSamples:3,referenceReturnPct:2,currentDrawdownPct:1,maxDrawdownPct:2,eligibleSamples:3,gapSamples:1,timeZone:'America/New_York',basis:'原币 · 资金流调整近似收益',limit:'缺口不填补；不是券商收益'};
const item=(n,extra={})=>({id:n,at:`2026-10-06T14:0${n}:00.000Z`,eligible:true,navCents:100000+n*1000,cashCents:90000,currency:'USD',index:100+n,drawdownPct:0,windowStart:'2026-10-06T14:00:00.000Z',ledgerVersion:1,quotes:[],interval:{state:'available',flows:[],netFlowCents:0,pnlCents:1000,reason:'无外部资金流'},...extra});
async function ui(run){const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});try{const m=await vite.ssrLoadModule('/src/integrated/ActualPerformance.jsx');await run(m);}finally{await vite.close();}}
test('account performance clearly labels reference returns and sampled drawdowns, and never bridges missing chart points',()=>ui(async({default:View,PerformanceChart})=>{
 const html=renderToStaticMarkup(React.createElement(View,{account:{id,label:'Synthetic <unsafe>',performance:summary}}));assert.match(html,/区间参考收益/);assert.match(html,/2.00%/);assert.match(html,/采样当前/);assert.match(html,/不等于完整交易日收益/);assert.doesNotMatch(html,/<unsafe>/);
 const chart=renderToStaticMarkup(React.createElement(PerformanceChart,{items:[item(5),item(4),item(3,{eligible:false,index:null}),item(2),item(1)]}));assert.equal((chart.match(/<path /g)||[]).length,2);assert.match(chart,/缺口与重建窗口不连线/);assert.doesNotMatch(chart,/NaN|Infinity/);
 const empty=renderToStaticMarkup(React.createElement(PerformanceChart,{items:[item(1)]}));assert.match(empty,/至少两个有效采样/);assert.doesNotMatch(empty,/<svg/);
}));
test('history is loaded only when expanded, pagination pins its ceiling, current ledger changes warn and failure does not retain a false latest page',()=>ui(async({default:View})=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));let failed=false;const calls=[],account={id,label:'Synthetic actual',performance:summary};
 globalThis.fetch=async path=>{calls.push(path);if(failed)throw Error('Synthetic read failure');return new Response(JSON.stringify({accountId:id,currency:'USD',summary,ceiling:70,total:70,items:path.includes('before=')?[item(1)]:[item(3),item(2)],nextCursor:path.includes('before=')?null:'2',note:'冻结新增边界'}),{headers:{'content-type':'application/json'}});};
 const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
 await act(()=>root.render(React.createElement(View,{account})));assert.equal(calls.length,0);const details=document.querySelector('details');await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});assert.equal(calls.length,1);assert.equal(document.querySelectorAll('table tbody tr').length,2);
 await act(async()=>button('较早采样').click());assert.match(calls.at(-1),/ceiling=70&before=2/);assert.equal(document.querySelectorAll('table tbody tr').length,1);
 await act(()=>root.render(React.createElement(View,{account:{...account,performance:{...summary,ledgerVersion:2}}})));assert.match(document.body.textContent,/账本已有变化/);assert.equal(calls.length,2);
 failed=true;await act(async()=>button('刷新净值记录').click());assert.equal(document.querySelectorAll('table').length,0);assert.match(document.querySelector('[role="alert"]').textContent,/读取失败/);
 }finally{if(root)await act(()=>root.unmount());for(const [k,v]of saved)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];dom.window.close();}
}));
test('switching account while history loads cannot show or apply a late response from the prior account',()=>ui(async({default:View})=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));let resolve;
 globalThis.fetch=path=>path.includes(other)?Promise.resolve(new Response(JSON.stringify({accountId:other,currency:'USD',summary:{...summary,reason:'Other account'},ceiling:0,total:0,items:[],nextCursor:null}),{headers:{'content-type':'application/json'}})):new Promise(r=>{resolve=()=>r(new Response(JSON.stringify({accountId:id,currency:'USD',summary,ceiling:3,total:3,items:[item(3)],nextCursor:null}),{headers:{'content-type':'application/json'}}));});
 await act(()=>root.render(React.createElement(View,{account:{id,label:'First',performance:summary}})));const details=document.querySelector('details');await act(()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});await act(async()=>root.render(React.createElement(View,{account:{id:other,label:'Other',performance:{...summary,reason:'Other account'}}})));await act(async()=>resolve());assert.equal(document.querySelectorAll('table tbody tr').length,0);assert.match(document.body.textContent,/Other account/);
 }finally{if(root)await act(()=>root.unmount());for(const [k,v]of saved)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];dom.window.close();}
}));
