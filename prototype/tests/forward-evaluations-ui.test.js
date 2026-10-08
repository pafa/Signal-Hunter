import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('forward UI retries the same freeze, preserves input, shows exclusions and pauses without deleting history',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const calls=[],response=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}}),baseline={id:'baseline',title:'<script>合成基线</script>',frozenAt:'2026-10-03T00:00:00Z',execution:{model:'fixture',effort:'high',promptVersion:'fixture'},rulesHash:'rules'};
  let catalog={enabled:true,activeBaselineId:null,totalRecords:0,totalBaselines:0,baselines:[],records:[]},fail=true;
  const record={subject:'event-cluster',runId:'record-123',topicId:'synthetic-topic',topicVersion:1,modelStatus:'failed',inputEligibility:{eligible:false,reasons:['同事件簇或来源已有前向调用记录']},integrity:{valid:true,reasons:[]}};
  globalThis.fetch=async(path,options)=>{calls.push({path,options});if(options.method==='POST'){
   if(path.endsWith('/pause'))catalog={...catalog,activeBaselineId:null};else{catalog={...catalog,activeBaselineId:'baseline',baselines:[baseline],records:[record],totalBaselines:1,totalRecords:1};if(fail){fail=false;throw Error('合成连接中断');}}return response(baseline);
  }if(path.endsWith('/records/record-123'))return response({...record,baselineId:'baseline',synthesis:{clusterVersion:2,memberResearch:[{},{}]},record:{decisionAt:'2026-10-03T01:00:00Z',inputHash:'input',rulesHash:'rules'},packetHash:'packet',executionVerified:false,qualification:'缺独立标签',clusterSnapshots:[{id:'cluster',title:'<script>冻结簇</script>',version:1,members:[{kind:'news',id:'source',revision:2}]}]});return response(catalog);};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/ForwardEvaluations.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(View)));
  const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t),submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  const input=document.querySelector('input:not([type=checkbox])');await act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'合成前向');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  // React's DOM renderer is imported after the browser globals are installed.
  await act(()=>document.querySelector('input[type=checkbox]').click());await submit();assert.match(document.body.textContent,/合成连接中断/);assert.equal(input.value,'合成前向');await submit();
  const posts=calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.match(document.body.textContent,/输入排除/);assert.match(document.body.textContent,/失败/);assert.equal(document.querySelectorAll('script').length,0);
  await act(async()=>button('查看调用 record-1').click());assert.match(document.body.textContent,/冻结调用详情/);assert.match(document.body.textContent,/修订 2/);assert.match(document.body.textContent,/事件综合/);assert.match(document.body.textContent,/成员概率不合并/);assert.equal(document.querySelectorAll('script').length,0);
  await act(async()=>button('暂停新调用登记').click());assert.equal(JSON.parse(calls.at(-2).options.body).baselineId,'baseline');assert.match(document.body.textContent,/已有档案保留/);assert.match(document.body.textContent,/全部登记 1 次/);
  catalog={...catalog,enabled:false};await act(async()=>button('刷新前向档案').click());assert(document.querySelector('fieldset').disabled);assert.match(document.body.textContent,/仅在已配置本机 Codex/);
 }finally{if(root)await act(()=>root.unmount());for(const k of names)if(before[k]===undefined)delete globalThis[k];else globalThis[k]=before[k];dom.window.close();await vite.close();}
});
