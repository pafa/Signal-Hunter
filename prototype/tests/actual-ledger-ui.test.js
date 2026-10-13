import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {ledgerTemplate,LEDGER_COLUMNS} from '../shared/actual-ledger.mjs';
const row={id:'a'.repeat(64),account:'Synthetic',currency:'USD',externalId:'opening-1',revision:1,type:'opening',at:'2026-10-06T10:00:00.000Z',sequence:0,amount:'10000.00',costMethod:'average',source:'Synthetic statement'};
const account={key:'["Synthetic","USD"]',account:'Synthetic',currency:'USD',costMethod:'average',cashCents:1000000,realizedCents:0,incomeCents:0,feesCents:0,netFlowsCents:0,entryCount:1,startingAt:row.at,asOf:row.at,issues:[],positions:[]};
const book={enabled:true,version:0,records:[],legacyRecords:[],ledger:{version:0,accounts:[],entries:[]}};
const saved={...book,ledger:{version:1,accounts:[account],entries:[row]}};
const preview={id:'reviewed-ledger-batch',hash:'reviewed-ledger-hash',baseVersion:0,baseSnapshotVersion:0,canApply:true,expiresAt:'2026-10-09T12:30:00Z',items:[{index:1,action:'add',row}],accounts:[account],replacedSnapshots:[{account:'Synthetic',symbol:'AAPL.US',quantity:'2'}]};
const csv=ledgerTemplate+LEDGER_COLUMNS.map(k=>row[k]??'').join(',');
async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 let handler=async path=>path.endsWith('/preview')?preview:book;const calls=[];
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  globalThis.fetch=async(path,opts={})=>{calls.push({path,method:opts.method,body:opts.body&&JSON.parse(opts.body)});const b=await handler(path,opts);return {ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},json:async()=>structuredClone(b)};};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/ActualHoldings.jsx');root=createRoot(document.getElementById('root'));
  const data={serverTime:'2026-10-09T12:00:00Z',runtime:{instance:{id:'synthetic-a'}},research:{topics:[]}},section=()=>document.querySelector('section[aria-label="确认成交账本"]'),button=(text,scope=section()||document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===text);
  const render=(props={})=>act(()=>root.render(React.createElement(View,{data,onClose(){},...props}))),click=(text,scope)=>act(()=>button(text,scope).click());
  const field=label=>[...section().querySelectorAll('label')].find(l=>l.childNodes[0].textContent===label)?.querySelector('input,select,textarea');
  const fill=(label,value)=>act(()=>{const e=field(label),proto=e.tagName==='SELECT'?window.HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new window.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  const setup=async()=>{await render();await click('逐笔账本',document);await click('导入流水 CSV');await fill('流水 CSV 文本',csv);};
  const submit=()=>section().querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await run({render,click,fill,setup,submit,button,field,section,calls,data,handler:f=>handler=f,text:()=>section()?.textContent||''});
 }finally{if(root)await act(()=>root.unmount());for(const [key,value] of before)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];dom.window.close();await vite.close();}
}
test('ledger opening preview carries explicit confirmation and superseded snapshots; input edits invalidate it',()=>ui(async({setup,submit,section,calls,text,button,fill,handler})=>{
 await setup();await act(()=>section().querySelector('input[type="checkbox"]').click());await act(()=>submit());
 assert.equal(calls.at(-1).body.confirmOpening,true);assert.equal(calls.at(-1).body.csv,csv);assert.match(text(),/不会自动转换/);assert.match(text(),/AAPL.US 2 股/);assert.equal(button('保存本批流水').disabled,false);
 await fill('流水 CSV 文本',ledgerTemplate);assert.equal(button('保存本批流水'),undefined);
 handler(async path=>path.endsWith('/preview')?{...preview,canApply:false,issue:'Synthetic opening incomplete'}:book);await act(()=>submit());assert.equal(button('保存本批流水').disabled,true);assert.match(text(),/Synthetic opening incomplete/);
}));
test('ledger double clicks issue one request, failed save retries the same reviewed identity, and refresh failure preserves the receipt',()=>ui(async({setup,submit,handler,calls,button,render,text,click})=>{
 await setup();let finish;handler(async()=>new Promise(r=>finish=r));await act(()=>{submit();submit();});assert.equal(calls.filter(c=>c.path.endsWith('/preview')).length,1);await act(async()=>finish(preview));
 handler(async()=>{throw Error('Synthetic lost response');});await click('保存本批流水');assert.match(text(),/Synthetic lost response/);assert.ok(button('保存本批流水'));
 await render({onRefresh:async()=>{throw Error('Synthetic refresh failure');}});handler(async()=>new Promise(r=>finish=r));await act(()=>{button('保存本批流水').click();button('保存本批流水').click();});
 const saves=calls.filter(c=>c.path.endsWith('/apply'));assert.equal(saves.length,2);assert.deepEqual(saves[0].body,saves[1].body);assert.deepEqual(saves[1].body,{id:preview.id,hash:preview.hash});await act(async()=>finish(saved));assert.match(text(),/已保存实际记录账本 v1/);assert.match(text(),/首页暂未刷新/);assert.equal(button('保存本批流水'),undefined);
}));
test('ledger ignores stale background reads and resets drafts and late preview results when the dataset changes',()=>ui(async({setup,submit,handler,render,data,click,text,button})=>{
 await setup();await act(()=>submit());let old;handler(async(path,opts)=>opts.method==='POST'?saved:new Promise(r=>old=r));await render({data:{...data,serverTime:'2026-10-09T12:00:15Z'}});await click('保存本批流水');await act(async()=>old(book));assert.match(text(),/账本 v1/);
 let finish;handler(async path=>path.endsWith('/preview')?new Promise(r=>finish=r):book);await act(()=>submit());await render({data:{...data,runtime:{instance:{id:'synthetic-b'}}}});await act(async()=>finish(preview));assert.ok(document.querySelector('section[aria-label="确认成交账本"]'));await click('逐笔账本',document);assert.equal(button('保存本批流水'),undefined);assert.doesNotMatch(text(),/尚未记账/);
}));
test('ledger revision keeps immutable identity and historical research version; original history stays readable',()=>ui(async({handler,render,click,field,text,fill,calls,submit,data})=>{
 const buy={...row,type:'buy',externalId:'buy-1',symbol:'AAPL.US',quantity:'2',amount:'200.00',fees:null,costMethod:null,topicId:'t',topicVersion:1};handler(async path=>path.endsWith('/history')?[{...buy,recordedAt:row.at}]:path.endsWith('/preview')?preview:{...saved,ledger:{...saved.ledger,entries:[buy]}});
 await render({data:{...data,research:{topics:[{id:'t',title:'Current research',version:2,status:'active',companies:[{symbol:'AAPL.US'}]}]}}});await click('逐笔账本',document);await click('修正流水');
 assert.equal(field('账户别名').disabled,true);assert.equal(field('币种').disabled,true);assert.equal(field('原始记录编号').disabled,true);assert.equal(field('修订 / 对账说明').required,true);assert.equal(field('原研究（可选）').value,'["t",1]');assert.match(field('原研究（可选）').selectedOptions[0].textContent,/v1/);
 await fill('数量','3');await fill('修订 / 对账说明','Corrected statement');await act(()=>submit());assert.equal(calls.at(-1).body.rows[0].revision,'2');assert.equal(calls.at(-1).body.rows[0].topicVersion,1);assert.equal(calls.at(-1).body.rows[0].fees,'');
 await click('查看修订');assert.match(text(),/修订 1 · 保存于/);assert.ok(calls.some(c=>c.path===`/api/actual-holdings/ledger/${buy.id}/history`));
}));
test('record-mode switches retain drafts, changed ledger versions invalidate previews, and legacy snapshots stay read-only after conversion',()=>ui(async({setup,fill,click,field,handler,render,data,submit,button})=>{
 await setup();await fill('流水 CSV 文本',csv+'\n');await click('持仓快照',document);await click('逐笔账本',document);assert.equal(field('流水 CSV 文本').value,csv+'\n');await act(()=>submit());
 const legacy={id:'old',version:1,account:'Synthetic',currency:'USD',symbol:'AAPL.US',quantity:'2',unitCost:'100',price:null,asOf:row.at,feeBasis:'included'};handler(async()=>({...saved,legacyRecords:[legacy]}));await render({data:{...data,serverTime:'2026-10-09T12:01:00Z'}});assert.equal(button('保存本批流水'),undefined);
 await click('持仓快照',document);const scope=document.querySelector('section[aria-label="实际持仓记录"]');assert.equal(button('更新 / 修正',scope).disabled,true);assert.match(scope.textContent,/此账户币种已转逐笔账本/);assert.doesNotMatch(scope.textContent,/项在持/);
}));
test('manual simulation selection labels the preview, separates account scope and invalidates a pending preview when switched',()=>ui(async({setup,fill,submit,handler,calls,text,button})=>{
 await setup();await fill('记录性质','manual-simulation');
 handler(async path=>path.endsWith('/preview')?{...preview,items:[{index:1,action:'add',row:{...row,accountKind:'manual-simulation'}}],accounts:[{...account,accountKind:'manual-simulation'}],replacedSnapshots:[]}:book);
 await act(()=>submit());assert.equal(calls.at(-1).body.accountKind,'manual-simulation');assert.match(text(),/手动模拟 · 保存前核对/);assert.match(text(),/不证明市场能够成交/);
 await fill('记录性质','actual');assert.equal(button('保存本批流水'),undefined);
}));
