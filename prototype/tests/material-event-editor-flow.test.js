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
  const topic={id:crypto.randomUUID(),createdAt:'2026-10-04',version:1,status:'active'},material={id:'material',title:'Synthetic material',revision:1,body:'Synthetic event'},event={title:'Synthetic event',actor:'Synthetic actor',action:'plans',object:'Synthetic project',stage:'unverified',eventTime:'unknown',timeRole:'unknown',timeEvidence:{basis:'unknown',quote:''},quote:material.body,quoteField:'body',boundaryReason:'Synthetic independent event'};
  const record=(id,version=1)=>({id,topicId:topic.id,createdAt:'2026-10-04T00:00:00Z',status:'candidate',stale:false,materialId:material.id,materialTitle:material.title,materialRevision:1,packet:{input:{material,topicVersion:version},inputHash:'frozen-'+id},candidate:{decomposition:{events:[event],scopeNote:'Synthetic',missingEvidence:[]},trace:{}},reviews:[[]]});
  const records={a:record('a'),b:record('b')},calls=[],base=`/api/research/${topic.id}/material-events`,response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});let intercept=null;
  globalThis.fetch=async(path,options)=>{const handled=intercept?.(path,options);if(handled)return handled;
   if(path===base&&(!options?.method||options.method==='GET'))return response({enabled:true,model:'synthetic',runs:Object.values(records)});
   if(path===base&&options.method==='POST'){const body=JSON.parse(options.body);calls.push(body);throw Error('Synthetic uncertain response');}
   const r=records[path.split('/').at(-1)];assert(r,path);return response(r);
  };
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await vite.ssrLoadModule('/src/major/MaterialEvents.jsx');root=createRoot(document.getElementById('root'));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),field=text=>[...document.querySelectorAll('label')].find(l=>[...l.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')===text)?.querySelector('select,textarea'),note=()=>document.querySelector('textarea');
  const fill=value=>act(()=>{const e=note();Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(e,value);e.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const choose=(label,value)=>act(async()=>{const e=field(label);e.value=value;e.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const click=text=>act(async()=>button(text).click()),render=node=>act(async()=>root.render(node));
  await run({Editor,topic,material,records,record,base,response,calls,button,field,note,fill,choose,click,render,intercept:f=>intercept=f});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}
test('event notes and selected record survive close/reopen and dataset A/B/A without mixing drafts',()=>ui(async({Editor,topic,material,render,fill,note,field,choose})=>{
 let instance='A';const show=()=>render(React.createElement(Editor,{topic,materials:[material],instanceId:instance,mutate:async()=>null}));
 await show();await choose('拆分记录','b');await fill('Dataset A record B draft');await render(null);await show();assert.equal(field('拆分记录').value,'b');assert.equal(note().value,'Dataset A record B draft');
 instance='B';await show();assert.equal(note().value,'');await fill('Dataset B draft');instance='A';await show();assert.equal(note().value,'Dataset A record B draft');
}));
test('research updates preserve old notes but require a newly generated packet before creation',()=>ui(async({Editor,topic,material,records,record,render,choose,fill,note,button,click})=>{
 let t=topic,calls=0;const show=()=>render(React.createElement(Editor,{topic:t,materials:[material],mutate:async()=>{calls++;return null;}}));
 await show();await fill('Research v1 note');t={...topic,version:2};await show();assert.equal(note().value,'Research v1 note');assert.equal(button('为此事项建立研究').disabled,true);await click('为此事项建立研究');assert.equal(calls,0);
 await click('丢弃事项草稿并重新核对');assert.equal(note().value,'');assert.equal(button('为此事项建立研究').disabled,true,'discard must not reauthorize an old model packet');
 records.c=record('c',2);await click('刷新拆分记录');await choose('拆分记录','c');await fill('New packet v2 note');await click('为此事项建立研究');assert.equal(calls,1);
}));
test('same-turn event decisions issue one mutation before React or parent busy state updates',()=>ui(async({Editor,topic,material,render,fill,button})=>{
 let finish,calls=0;await render(React.createElement(Editor,{topic,materials:[material],mutate:()=>{calls++;return new Promise(r=>finish=r);}}));await fill('One event decision');await act(()=>{const b=button('为此事项建立研究');b.click();b.click();});assert.equal(calls,1);await act(async()=>finish(null));
}));
test('late event creation cannot clear a newer reopened note or change its selected record',()=>ui(async({Editor,topic,material,records,render,choose,fill,note,field,button})=>{
 let finish;const show=()=>render(React.createElement(Editor,{topic,materials:[material],mutate:()=>new Promise(r=>finish=r)}));await show();await fill('Submitted original');await act(()=>button('为此事项建立研究').click());await render(null);await show();await fill('Newer reopened note');await choose('拆分记录','b');
 const saved=structuredClone(records.a);saved.reviews[0]=[{version:1,action:'create',topicId:'synthetic-child',note:'Submitted original',inputHash:'frozen-a'}];await act(async()=>finish({materialEventRun:saved}));assert.equal(field('拆分记录').value,'b');await choose('拆分记录','a');assert.equal(note().value,'Newer reopened note');
}));
test('uncertain generation retries keep the original research/material revision and request id after reopening',()=>ui(async({Editor,topic,material,render,choose,click,calls})=>{
 const show=()=>render(React.createElement(Editor,{topic,materials:[material],mutate:async()=>null}));await show();await choose('拆分材料','material');await click('使用 Codex 拆分事项');assert.equal(calls.length,1);await render(null);await show();await click('使用 Codex 拆分事项');assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);
}));
test('same-turn generation submits once and cannot advance stale material selection',()=>ui(async({Editor,topic,material,render,choose,button,calls})=>{
 let t=topic,materials=[material];const show=()=>render(React.createElement(Editor,{topic:t,materials,mutate:async()=>null}));await show();await choose('拆分材料','material');await act(async()=>{const b=button('使用 Codex 拆分事项');b.click();b.click();});assert.equal(calls.length,1);
 materials=[{...material,revision:2}];t={...topic,version:2};await show();assert.equal(button('使用 Codex 拆分事项').disabled,true);
}));
test('unverified creation receipts keep the note and failed reads block decisions until a successful refresh',()=>ui(async({Editor,topic,material,base,response,intercept,render,fill,note,button,click})=>{
 await render(React.createElement(Editor,{topic,materials:[material],mutate:async()=>({materialEventRun:{id:'unrelated'}})}));await fill('Keep until checked receipt');await click('为此事项建立研究');assert.equal(note().value,'Keep until checked receipt');assert(document.body.textContent.includes('未能核对'));
 intercept(path=>path===base+'/a'?Promise.resolve(new Response(JSON.stringify({error:'Synthetic read failure'}),{status:503,headers:{'content-type':'application/json'}})):null);await click('刷新拆分记录');assert.equal(note().value,'Keep until checked receipt');assert.equal(button('为此事项建立研究').disabled,true);
 intercept(()=>null);await click('刷新拆分记录');assert.equal(button('为此事项建立研究').disabled,false);
}));
test('late generation cannot erase a new request or switch a newer reopened record',()=>ui(async({Editor,topic,material,base,response,intercept,render,choose,button,field,click,calls})=>{
 let finish;intercept((path,options)=>path===base&&options.method==='POST'?new Promise(r=>{calls.push(JSON.parse(options.body));finish=r;}):null);
 const show=()=>render(React.createElement(Editor,{topic,materials:[material],mutate:async()=>null}));await show();await choose('拆分材料','material');await act(()=>button('使用 Codex 拆分事项').click());await render(null);await show();await choose('拆分材料','material');await choose('拆分记录','b');
 await act(async()=>finish(response({id:'a',topicId:topic.id,materialId:'material',materialRevision:1})));assert.equal(field('拆分记录').value,'b');intercept(()=>null);await click('使用 Codex 拆分事项');assert.equal(calls.length,2);assert.notEqual(calls[0].requestId,calls[1].requestId);
}));
test('a matching create decision cannot acknowledge a changed packet or a missing created topic',()=>ui(async({Editor,topic,material,records,render,fill,note,click})=>{
 let saved=structuredClone(records.a);saved.packet.input.material.body='Changed without a new hash';saved.reviews[0]=[{version:1,action:'create',topicId:'synthetic-child',note:'Keep original input',inputHash:'frozen-a'}];
 await render(React.createElement(Editor,{topic,materials:[material],mutate:async()=>({materialEventRun:saved})}));await fill('Keep original input');await click('为此事项建立研究');assert.equal(note().value,'Keep original input');assert(document.body.textContent.includes('未能核对'));
 saved=structuredClone(records.a);saved.reviews[0]=[{version:1,action:'create',note:'Keep original input',inputHash:'frozen-a'}];await click('为此事项建立研究');assert.equal(note().value,'Keep original input');assert(document.body.textContent.includes('未能核对'));
}));
