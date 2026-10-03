import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('semantic research basis preserves original direction, scope, warning and escaped citations',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/major/SemanticResearchBasis.jsx'),record={title:'<script>合成标题</script>',revision:2,contentScope:'excerpt'},basis={sourceSide:'right',source:record,target:{...record,contentScope:'headline-only'},relation:'followup',decisionVersion:3,model:'test-model',comparison:{left:{quote:'标题引用'},right:{quote:'<script>正文引用</script>',quoteField:'body'},reason:'左右顺序须核对',missingEvidence:['还需来源']},decisionNote:'核对',decisionAt:'2026-10-03T01:00:00Z',runId:'run',inputHash:'input-hash',hash:'basis-hash'};
 const html=renderToStaticMarkup(React.createElement(View,{basis,status:{current:false,message:'比较依据已变化'}}));for(const text of ['本研究对应右侧','目标研究对应左侧','左侧相对于右侧','摘录','仅标题','比较依据已变化','引用来自正文','引用来自标题','basis-hash','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.ok(!html.includes('<script>'));
 }finally{await vite.close();}
});
test('pending research relation save cannot switch targets or discard the submitted comparison before its response',async()=>{
 const {JSDOM}=await import('jsdom'),{act}=await import('react');
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  const topics=['a','b','c'].map(id=>({id,title:`研究${id}`,version:1,status:'active',hypothesis:{logic:`合成${id}`}})),record={title:'合成材料',revision:1,contentScope:'excerpt'};
  const basis={runId:'comparison-b',decisionVersion:1,sourceSide:'left',source:record,target:record,relation:'related',comparison:{left:{quote:'甲'},right:{quote:'乙'},reason:'合成依据',missingEvidence:[]},decisionNote:'已核对'};
  globalThis.fetch=async path=>{assert.match(path,/^\/api\/research\/a\/related\?/);return new Response(JSON.stringify({candidates:[{topicId:'c',title:'研究c',version:1,status:'active',reasons:['规则召回']}],semantic:{items:[{id:'b-clue',topicId:'b',title:'研究b',version:1,status:'active',basis}],total:1,acceptedPairs:1},links:[],incoming:[]}),{headers:{'content-type':'application/json'}});};
  const {createRoot}=await import('react-dom/client'),{default:RelatedResearch}=await vite.ssrLoadModule('/src/major/RelatedResearch.jsx');
  let resolve,submitted,calls=0;const mutate=async(path,method,body)=>{calls++;submitted=body;return new Promise(r=>{resolve=r;});};
  root=createRoot(document.getElementById('root'));
  const render=busy=>act(async()=>root.render(React.createElement(RelatedResearch,{topic:topics[0],topics,busy,mutate})));
  await render(false);
  await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='用此比较核对：研究b').click());
  await act(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,'待保存的关系说明');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const submit=()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await act(submit);assert.equal(submitted.topicId,'b');assert.equal(submitted.semanticBasis.runId,'comparison-b');await render(true);
  await act(()=>document.querySelector('.source-news-list button').click());
  assert.equal(document.querySelector('form select').value,'b','pending save must retain the submitted target and evidence');
  assert(document.querySelector('form').textContent.includes('取消使用此比较依据'));
  assert([...document.querySelectorAll('form select,form textarea')].every(e=>e.disabled));
  await act(submit);assert.equal(calls,1,'pending submission cannot be repeated');
  await act(async()=>resolve(null));await render(false);
  assert.equal(document.querySelector('textarea').value,'待保存的关系说明');assert(document.querySelector('form').textContent.includes('取消使用此比较依据'));
  await act(submit);await render(true);await act(async()=>resolve({research:{topics:[{...topics[0],version:2}]}}));
  assert.equal(calls,2);assert.equal(submitted.topicId,'b');assert.equal(submitted.note,'待保存的关系说明');assert.equal(submitted.semanticBasis.runId,'comparison-b');
  assert.equal(document.querySelector('textarea').value,'');assert(!document.querySelector('form').textContent.includes('取消使用此比较依据'));
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
