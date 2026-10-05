import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {fixture,freeze,start} from './helpers/forward-fixture.js';
import {createHandler} from '../server/index.mjs';
import {randomUUID} from 'node:crypto';
test('review UI uses real handlers, retries unknown writes once, preserves drafts on conflict and appends unresolved outcomes',async()=>{
 const f=fixture();freeze(f);const p=await f.prepare(),topic=f.service.research.saveClaim(p.topic.id,{version:p.topic.version,claim:{kind:'outcome',outcome:'open',status:'unverified',claim:'合成事件是否完成',probability:60,basis:'合成依据',impactIfTrue:'正向',impactIfFalse:'反向',horizon:'短期',resolveBy:'2026-10-05',evidenceIds:[],resolutionReason:'',revisionReason:'初始'}}),run=start(f,topic);await f.service.modelResearch.wait(run.id);f.tick();
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});const calls=[],handler=createHandler(f.store,f.service);let lose=true;
  globalThis.fetch=async(path,options)=>{calls.push({path,options});let code,body;await handler({method:options.method,url:path,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield options.body||'{}';}},{writeHead:c=>code=c,end:b=>body=b});if(options.method==='POST'&&lose){lose=false;throw Error('合成响应丢失');}return new Response(body,{status:code,headers:{'content-type':'application/json'}});};
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/integrated/ForwardReview.jsx');root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(View,{runId:run.id})));assert.equal(calls.length,0);
  await act(async()=>{const details=document.querySelector('details');details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t),field=t=>[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent===t)?.querySelector('input,textarea,select');
  async function fill(t,value){await act(()=>{const el=field(t),proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
  const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await fill('评审者','合成评审者');await fill('复核依据','<img onerror=x> 不确定');await fill('事件簇核对依据','需要独立复核');await fill('本次新增或更正原因','初次登记');await submit();assert.match(document.body.textContent,/合成响应丢失/);assert.equal(field('复核依据').value,'<img onerror=x> 不确定');await submit();
  const posts=calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.equal(f.service.forwardReviews.detail(run.id).version,1);assert.equal(document.querySelectorAll('img').length,0);
  await fill('复核依据','未提交的草稿');const current=f.service.forwardReviews.detail(run.id);f.service.forwardReviews.write(run.id,'label',{requestId:randomUUID(),version:current.version,value:{verdict:'ordinary',exposure:'already-seen',reviewer:'另一测试者',reason:'另一标签',novelty:'',scale:'',mechanism:'',clusterVerdict:'uncertain',clusterReason:'待核',revisionReason:'另一次变更'}});
  await act(async()=>button('刷新复核档案').click());assert.match(document.body.textContent,/草稿保留/);assert.equal(field('复核依据').value,'未提交的草稿');assert(document.querySelector('fieldset').disabled);
  await act(()=>button('放弃草稿并载入当前版本').click());assert.equal(field('复核依据').value,'另一标签');assert.equal(document.querySelector('fieldset').disabled,false);
  await act(()=>button('冻结主张的结局').click());assert.match(document.body.textContent,/冻结概率 60%/);await fill('评审者','合成结局测试者');await fill('结局依据与不确定性','暂缺结局');await fill('本次新增或更正原因','首次跟踪');await submit();
  const saved=f.service.forwardReviews.detail(run.id);assert.equal(saved.version,3);assert.equal(saved.claims[0].resolution.outcome,'unresolved');assert.equal(saved.claims[0].score,null);assert.equal(saved.forwardEligible,false);assert.match(document.body.textContent,/已保存 3 个复核版本/);
 }finally{if(root)await act(()=>root.unmount());for(const k of names)if(before[k]===undefined)delete globalThis[k];else globalThis[k]=before[k];dom.window.close();await vite.close();await f.close();}
});
