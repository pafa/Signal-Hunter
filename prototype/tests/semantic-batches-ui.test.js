import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('batch detail distinguishes attempts, frozen direction, failure, cancellation and explicit extra calls',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {BatchDetail}=await vite.ssrLoadModule('/src/integrated/SemanticBatches.jsx');const batch={state:'paused',createdAt:'2026-10-03T00:00:00Z',inputCount:2,pairCount:1,model:'configured',planHash:'frozen-plan',counts:{failed:1},inputs:[{title:'<script>甲</script>'},{title:'乙'}],items:[{ordinal:0,left:0,right:1,status:'failed',failure:'合成失败',runId:'b',attempts:['a','b']}],audit:[{action:'retry',at:'2026-10-03T00:00:00Z',payload:{ordinal:0}}]};const render=b=>renderToStaticMarkup(React.createElement(BatchDetail,{batch:b})),html=render(batch);
 for(const text of ['已暂停后续调用','左、右顺序','再调用一次','合成失败','历次调用','不会中止已经开始','明确重试','frozen-plan','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.ok(!html.includes('<script>'));assert.ok(!render({...batch,state:'cancelled'}).includes('再调用一次'));const automatic=render({...batch,id:'auto-cluster-batch',owner:'research-pipeline',items:[{...batch.items[0],status:'candidate',attempts:[],reusedRunId:'old-run'}]});for(const text of ['auto-cluster-batch','共用其24小时额度','复用已有比较，未再次调用模型'])assert(automatic.includes(text),text);
 }finally{await vite.close();}
});
test('pending batch preview and creation keep the selected inputs fixed and retry creation with the same request id',async()=>{
 const {JSDOM}=await import('jsdom'),{act}=await import('react');
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const records=['a','b','c'].map(id=>({id,kind:'material',title:`材料${id}`,revision:1,contentScope:'excerpt'})),response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  let resolvePreview,resolveCreate,saved=null,previewInput,back=0;const creates=[];
  globalThis.fetch=async(path,options)=>{
   if(path.startsWith('/api/semantic-events/materials?'))return response({items:records,total:3});
   if(path==='/api/semantic-batches/preview'){previewInput=JSON.parse(options.body);return new Promise(resolve=>{resolvePreview=resolve;});}
   if(path==='/api/semantic-batches'&&options.method==='POST'){creates.push(JSON.parse(options.body));return new Promise(resolve=>{resolveCreate=resolve;});}
   if(path==='/api/semantic-batches')return response({enabled:true,task:{paused:true},batches:saved?[saved]:[]});
   if(saved&&path===`/api/semantic-batches/${saved.id}`)return response(saved);
   throw Error(`Unexpected isolated test request: ${path}`);
  };
  const {createRoot}=await import('react-dom/client'),{default:SemanticBatches}=await vite.ssrLoadModule('/src/integrated/SemanticBatches.jsx');
  root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(SemanticBatches,{onBack:()=>back++,onResult:()=>{}})));
  const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label),click=label=>act(()=>{assert(button(label),label);button(label).click();});
  const openPicker=async()=>{await click('加入已保存材料');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});};
  for(const id of ['a','b']){await openPicker();await click(`选择材料：材料${id}`);}
  await openPicker();await click('预览比较计划');
  await act(()=>button('选择材料：材料c')?.click());
  assert.equal(document.querySelector('ol').children.length,2,'preview response must not be paired with newly added inputs');
  assert.deepEqual(previewInput.inputs.map(r=>r.id),['a','b']);
  const plan={inputs:records.slice(0,2),pairs:[{left:0,right:1}],maximumCalls:1,model:'synthetic',planHash:'frozen-plan'};
  await act(async()=>resolvePreview(response(plan)));
  await openPicker();await click('确认建立 1 次调用的批次');
  await act(()=>button('选择材料：材料c')?.click());await click('返回单次比较');
  assert.equal(back,0,'pending creation must keep the recoverable request on screen');assert.equal(document.querySelector('ol').children.length,2);
  await act(async()=>resolveCreate(response({error:'合成响应失败，可重试'},500)));
  assert.equal(document.querySelector('ol').children.length,2);assert(button('确认建立 1 次调用的批次'));
  await click('确认建立 1 次调用的批次');assert.equal(creates.length,2);assert.deepEqual(creates[1],creates[0]);assert.deepEqual(creates[0].inputs.map(r=>r.id),['a','b']);assert(creates[0].requestId);
  saved={id:'saved-batch',state:'active',inputCount:2,pairCount:1,model:'synthetic',inputs:records.slice(0,2),counts:{queued:1},items:[{ordinal:0,left:0,right:1,status:'queued',attempts:[]}],audit:[],planHash:'frozen-plan'};
  await act(async()=>resolveCreate(response(saved)));assert.equal(document.querySelector('ol').children.length,0);assert(!button('确认建立 1 次调用的批次'));
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
