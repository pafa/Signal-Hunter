import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const topic={id:crypto.randomUUID(),createdAt:'2026-10-05',version:1,status:'active',evidence:[]},hash='a'.repeat(64),record=(id,version=1)=>({id,topicId:topic.id,createdAt:'2026-10-05T00:00:00Z',status:'candidate',model:'synthetic',packet:{input:{topicId:topic.id,topicVersion:version,evidence:[]},inputHash:hash},candidate:{sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['Synthetic candidate'],sourceIds:[]})),missingEvidence:[],trace:{model:'synthetic',inputHash:hash,topicId:topic.id,topicVersion:version}}});
  const records={a:record('a'),b:record('b')},calls=[],base=`/api/research/${topic.id}/model-runs`,response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});let intercept=null;
  const summary=r=>({id:r.id,topicId:r.topicId,createdAt:r.createdAt,topicVersion:r.packet.input.topicVersion,inputHash:r.packet.inputHash,status:r.status,model:r.model,...(r.requestId?{requestId:r.requestId}:{})});
  const receipt=r=>({research:{topics:[{...topic,version:r.packet.input.topicVersion+1,dossier:{sections:r.candidate.sections,reviewStatus:'draft',basedOnResearchVersion:r.packet.input.topicVersion+1,missingEvidence:r.candidate.missingEvidence,sourceModelRun:{id:r.id,...r.candidate.trace}}}]}});
  globalThis.fetch=async(path,options)=>{const handled=intercept?.(path,options);if(handled)return handled;
   if(path===base&&options.method==='GET')return response({enabled:true,model:'synthetic',runs:Object.values(records).map(summary)});
   if(path===base&&options.method==='POST'){calls.push(JSON.parse(options.body));throw Error('Synthetic uncertain response');}
   const r=records[path.split('/').at(-1)];assert(r,path);return response(r);
  };
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await vite.ssrLoadModule('/src/major/ModelResearch.jsx');root=createRoot(document.getElementById('root'));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),select=()=>document.querySelector('select');
  const choose=value=>act(async()=>{const e=select();e.value=value;e.dispatchEvent(new window.Event('change',{bubbles:true}));}),click=text=>act(async()=>button(text).click()),render=node=>act(async()=>root.render(node));
  await run({Editor,topic,records,record,hash,base,response,summary,receipt,calls,button,select,choose,click,render,intercept:f=>intercept=f});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}
test('model history selection survives close and dataset A/B/A without mixing records',()=>ui(async({Editor,topic,render,select,choose})=>{
 let instance='A';const show=()=>render(React.createElement(Editor,{topic,instanceId:instance,mutate:async()=>null}));await show();await choose('b');await render(null);await show();assert.equal(select().value,'b');
 instance='B';await show();assert.equal(select().value,'a');instance='A';await show();assert.equal(select().value,'b');
}));
test('unknown generation preserves original request identity across close and same-turn double clicks',()=>ui(async({Editor,topic,render,button,calls,click})=>{
 const show=()=>render(React.createElement(Editor,{topic,mutate:async()=>null}));await show();await act(async()=>{const b=button('使用 Codex 生成候选');b.click();b.click();});assert.equal(calls.length,1);assert.match(calls[0].requestId,/^[-a-zA-Z0-9]{16,80}$/);
 await render(null);await show();await click('重试本次生成');assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);
}));
test('unresolved old-version request cannot become a new current-version generation without explicit reset',()=>ui(async({Editor,topic,render,button,calls,click})=>{
 let t=topic;const show=()=>render(React.createElement(Editor,{topic:t,mutate:async()=>null}));await show();await click('使用 Codex 生成候选');t={...topic,version:2};await show();assert.equal(button('重试本次生成').disabled,true);assert.equal(calls.length,1);
 await click('丢弃未确认请求并重新核对');await click('使用 Codex 生成候选');assert.equal(calls.length,2);assert.equal(calls[1].version,2);assert.notEqual(calls[1].requestId,calls[0].requestId);
}));
test('malformed generation receipt retains the same pending request for an explicit retry',()=>ui(async({Editor,topic,base,response,intercept,render,calls,click})=>{
 intercept((path,options)=>path===base&&options.method==='POST'?Promise.resolve().then(()=>{calls.push(JSON.parse(options.body));return response({id:'a'});}):null);
 await render(React.createElement(Editor,{topic,mutate:async()=>null}));await click('使用 Codex 生成候选');assert(document.body.textContent.includes('未能核对'));await click('重试本次生成');assert.deepEqual(calls[1],calls[0]);
}));
test('successful list read resolves a lost generation receipt without another POST or clearing a later selection',()=>ui(async({Editor,topic,records,record,render,calls,summary,select,choose,click})=>{
 const show=()=>render(React.createElement(Editor,{topic,mutate:async()=>null}));await show();await click('使用 Codex 生成候选');const submitted=calls[0];records.c={...record('c'),requestId:submitted.requestId};await choose('b');await click('刷新记录');assert.equal(select().value,'b');assert(buttonExists('使用 Codex 生成候选'));assert.equal(calls.length,1);
 function buttonExists(text){return [...document.querySelectorAll('button')].some(b=>b.textContent===text);}
 await render(null);await show();assert.equal(select().value,'b');
}));
test('late generation cannot switch a reopened selection or clear a newer request',()=>ui(async({Editor,topic,base,response,intercept,render,select,choose,button,calls,click,hash})=>{
 let finish;intercept((path,options)=>path===base&&options.method==='POST'?new Promise(r=>{calls.push(JSON.parse(options.body));finish=r;}):null);
 const show=()=>render(React.createElement(Editor,{topic,mutate:async()=>null}));await show();await act(()=>button('使用 Codex 生成候选').click());await render(null);await show();await choose('b');await click('丢弃未确认请求并重新核对');
 await act(async()=>finish(response({id:'new-run',topicId:topic.id,topicVersion:1,inputHash:hash,status:'running',requestId:calls[0].requestId})));assert.equal(select().value,'b');intercept(()=>null);await click('使用 Codex 生成候选');assert.notEqual(calls[1].requestId,calls[0].requestId);
}));
test('same-turn adoption submits once and freezes record selection during the mutation',()=>ui(async({Editor,topic,render,button,select})=>{
 let finish,calls=0;await render(React.createElement(Editor,{topic,mutate:()=>{calls++;return new Promise(r=>finish=r);}}));await act(()=>{const b=button('采纳为研判草稿');b.click();b.click();});assert.equal(calls,1);assert.equal(select().disabled,true);await act(async()=>finish(null));
}));
test('old model input and parent busy state block adoption before sending any mutation',()=>ui(async({Editor,topic,render,button})=>{
 let calls=0;const mutate=async()=>{calls++;return null;};await render(React.createElement(Editor,{topic:{...topic,version:2},mutate}));assert.equal(button('采纳为研判草稿').disabled,true);await act(()=>button('采纳为研判草稿').click());assert.equal(calls,0);
 await render(React.createElement(Editor,{topic,busy:true,mutate}));assert.equal(button('采纳为研判草稿').disabled,true);
}));
test('unverified adoption receipt blocks another adoption until a successful manual read',()=>ui(async({Editor,topic,records,receipt,render,button,click})=>{
 let result={research:{topics:[{...topic,version:2,dossier:{reviewStatus:'draft',sourceModelRun:{id:'unrelated'}}}]}},calls=0;
 await render(React.createElement(Editor,{topic,mutate:async()=>{calls++;return result;}}));await click('采纳为研判草稿');assert(document.body.textContent.includes('未能核对'));assert.equal(button('采纳为研判草稿').disabled,true);assert.equal(calls,1);
 await click('刷新记录');assert.equal(button('采纳为研判草稿').disabled,false);result=receipt(records.a);await click('采纳为研判草稿');assert.equal(calls,2);
}));
test('read failure preserves visible candidate but blocks adoption until refreshed',()=>ui(async({Editor,topic,base,intercept,render,button,click})=>{
 await render(React.createElement(Editor,{topic,mutate:async()=>null}));intercept(path=>path===base+'/a'?Promise.resolve(new Response(JSON.stringify({error:'Synthetic read failure'}),{status:503,headers:{'content-type':'application/json'}})):null);await click('刷新记录');assert(document.body.textContent.includes('Synthetic candidate'));assert.equal(button('采纳为研判草稿').disabled,true);
 intercept(()=>null);await click('刷新记录');assert.equal(button('采纳为研判草稿').disabled,false);
}));
test('late adoption cannot alter a newer reopened selection',()=>ui(async({Editor,topic,records,receipt,render,button,choose,select})=>{
 let finish;const show=()=>render(React.createElement(Editor,{topic,mutate:()=>new Promise(r=>finish=r)}));await show();await act(()=>button('采纳为研判草稿').click());await render(null);await show();await choose('b');await act(async()=>finish(receipt(records.a)));assert.equal(select().value,'b');
}));
test('adoption receipt with matching run but changed chapter text or provenance is not accepted',()=>ui(async({Editor,topic,records,receipt,render,click,button})=>{
 let result=structuredClone(receipt(records.a));result.research.topics[0].dossier.sections[0].paragraphs=['Changed'];await render(React.createElement(Editor,{topic,mutate:async()=>result}));await click('采纳为研判草稿');assert.equal(button('采纳为研判草稿').disabled,true);assert(document.body.textContent.includes('未能核对'));
 await click('刷新记录');result=structuredClone(receipt(records.a));result.research.topics[0].dossier.sourceModelRun.inputHash='wrong';await click('采纳为研判草稿');assert.equal(button('采纳为研判草稿').disabled,true);
}));
test('verified adoption shows the saved original run and accepted version after refreshing',()=>ui(async({Editor,topic,records,receipt,render,click})=>{
 await render(React.createElement(Editor,{topic,mutate:async()=>{const result=receipt(records.a);records.a={...records.a,status:'adopted',acceptedVersion:2};return result;}}));
 await click('采纳为研判草稿');assert(document.body.textContent.includes('已采纳为草稿'));assert(document.body.textContent.includes('已保存为 v2'));assert(!document.body.textContent.includes('未能核对'));
}));
test('malformed detail identity or review payload preserves the last candidate and locks adoption',()=>ui(async({Editor,topic,records,base,response,intercept,render,click,button})=>{
 await render(React.createElement(Editor,{topic,mutate:async()=>null}));let bad=structuredClone(records.a);bad.candidate.trace.topicId='unrelated';
 intercept(path=>path===base+'/a'?Promise.resolve(response(bad)):null);await click('刷新记录');assert(document.body.textContent.includes('Synthetic candidate'));assert.equal(button('采纳为研判草稿').disabled,true);
 bad=structuredClone(records.a);bad.candidate.materialityReviews=[null];bad.packet.input.materialityReview={targets:[]};await click('刷新记录');assert(document.body.textContent.includes('未能核对研判记录'));assert.equal(button('采纳为研判草稿').disabled,true);
}));
