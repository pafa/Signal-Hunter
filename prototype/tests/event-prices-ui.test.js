import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('price UI retries an unknown freeze with the same identity, separates zero from missing and pages the entire window',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const rows=Array.from({length:51},(_,i)=>({sampleId:String(i),symbol:'AAPL.US',bucket:'quiet',decisionAt:'2026-10-01T14:00:00Z',window:'1h',returnPct:i===0?0:null,benchmarkReturnPct:null,excessPct:null,reason:i===0?'可计算':'窗口缺价',benchmarkReason:'未配置参照',baseline:null,endpoint:null,benchmarkBaseline:null,benchmarkEndpoint:null}));
  const report={id:'report',asOf:'2026-10-04T00:00:00Z',hash:'hash',summary:{samples:51,samplesWithoutUsableSymbol:0,pairs:204,priced:1,pairedBenchmark:0},cohort:{batch:{samples:rows.map(r=>({id:r.sampleId,input:{title:`合成标题 ${r.sampleId}`}}))}},rows,noSymbols:[],archives:[],limitations:['不是模拟收益']},calls=[];let fail=true;
  const dailyReport={...report,id:'daily-report',format:'event-daily-prices/1',rows:rows.map(r=>({...r,window:'1td',maxDrawdownPct:r.returnPct===0?0:null,pathReason:'收盘序列'}))};
  globalThis.fetch=async(path,options)=>{if(options.method==='POST'){calls.push(JSON.parse(options.body));if(fail){fail=false;throw Error('合成响应中断');}return new Response(JSON.stringify(calls.at(-1).basis==='daily'?dailyReport:report),{headers:{'content-type':'application/json'}});}return new Response(JSON.stringify({enabled:true,reports:[]}),{headers:{'content-type':'application/json'}});};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/EventPrices.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(View,{batchId:'batch'})));
  const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))),button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
  await submit();assert.match(document.querySelector('[role=alert]').textContent,/响应中断/);await submit();assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].basis,'daily');assert.equal(document.querySelectorAll('tbody tr').length,50);assert.match(document.querySelector('tbody').textContent,/0.00%/);assert.match(document.querySelector('tbody').textContent,/不可计算/);assert.match(document.querySelector('thead').textContent,/收盘最大回撤/);assert.deepEqual([...document.querySelector('select[aria-label="价格观察窗口"]').options].map(o=>o.value),['1td','5td','20td']);
  await act(()=>button('下一页价格').click());assert.equal(document.querySelectorAll('tbody tr').length,1);assert.match(document.querySelector('tbody').textContent,/合成标题 50/);assert.equal(button('下一页价格').disabled,true);
  await act(()=>{const select=document.querySelector('select[aria-label="价格观察窗口"]');select.value='20td';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(document.querySelectorAll('tbody tr').length,0);assert.match(document.body.textContent,/本窗口无可核验证券/);assert.equal(button('上一页价格').disabled,true);
  await act(()=>{const select=document.querySelector('select[aria-label="行情粒度"]');select.value='minute';select.dispatchEvent(new window.Event('change',{bubbles:true}));});await submit();assert.equal(calls.at(-1).basis,undefined);assert.notEqual(calls.at(-1).requestId,calls[0].requestId);assert.equal(document.querySelector('select[aria-label="价格观察窗口"]').value,'1h');assert.doesNotMatch(document.querySelector('thead').textContent,/收盘最大回撤/);
 }finally{if(root)await act(()=>root.unmount());await vite.close();dom.window.close();for(const name of names){if(before[name]===undefined)delete globalThis[name];else globalThis[name]=before[name];}}
});
