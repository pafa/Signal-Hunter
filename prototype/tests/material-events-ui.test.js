import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('review drafts survive record switches and refresh, pending decisions lock inputs and only clear the submitted draft',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const material={id:'material',title:'合成材料',revision:1,body:'合成正文'},event={title:'合成事项',actor:'甲',action:'计划',object:'乙',stage:'待核',eventTime:'未知',timeRole:'unknown',timeEvidence:{basis:'unknown',quote:''},quote:'合成正文',quoteField:'body',boundaryReason:'单独核对'};
  const records=Object.fromEntries(['a','b'].map(id=>[id,{id,status:'candidate',stale:false,packet:{input:{topicVersion:1,material},inputHash:'frozen'},candidate:{decomposition:{events:[event,{...event,title:'第二事项'}],scopeNote:'合成摘录',missingEvidence:[]},trace:{}},reviews:[[],[]]}]));
  const base='/api/research/topic/material-events',response=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}});let finish;const calls=[];
  globalThis.fetch=async path=>{if(path===base)return response({enabled:true,model:'synthetic',runs:Object.values(records)});const id=path.split('/').at(-1);assert(records[id],path);return response(records[id]);};
  const mutate=(path,method,body)=>{calls.push({path,method,body});return new Promise(resolve=>{finish=resolve;});};
  const {createRoot}=await import('react-dom/client'),{default:MaterialEvents}=await vite.ssrLoadModule('/src/major/MaterialEvents.jsx');root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(MaterialEvents,{topic:{id:'topic',version:1,status:'active'},materials:[material],busy:false,mutate})));
  const textareas=()=>[...document.querySelectorAll('textarea')],select=()=>document.querySelectorAll('select')[1],buttons=label=>[...document.querySelectorAll('button')].filter(b=>b.textContent===label);
  const note=(i,value)=>act(()=>{const el=textareas()[i];Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const choose=id=>act(async()=>{if(select().disabled)return;select().value=id;select().dispatchEvent(new window.Event('change',{bubbles:true}));});
  await note(0,'a事项一说明');await note(1,'a事项二未提交');await choose('b');assert.equal(textareas()[0].value,'');await note(0,'b待处理说明');await choose('a');
  assert.equal(textareas()[0].value,'a事项一说明','switching records must preserve unsent review notes');assert.equal(textareas()[1].value,'a事项二未提交');
  await act(async()=>buttons('刷新拆分记录')[0].click());assert.equal(textareas()[0].value,'a事项一说明');
  await act(()=>buttons('排除此事项')[0].click());assert.equal(calls[0].path,base+'/a/decision');assert.equal(select().disabled,true);assert([...document.querySelectorAll('select,textarea')].every(el=>el.disabled));await choose('b');assert.equal(select().value,'a');await act(()=>buttons('排除此事项')[0].click());assert.equal(calls.length,1);
  await act(async()=>finish(null));assert.equal(textareas()[0].value,'a事项一说明');await act(()=>buttons('排除此事项')[0].click());assert.deepEqual(calls[1],calls[0]);
  records.a.reviews[0]=[{version:1,action:'reject',note:'a事项一说明',inputHash:'frozen',at:'2026-10-03T00:00:00Z'}];await act(async()=>finish({materialEventRun:records.a}));assert.equal(textareas()[0].value,'');assert.equal(textareas()[1].value,'a事项二未提交');await choose('b');assert.equal(textareas()[0].value,'b待处理说明');
  records.b.reviews[0]=[{version:1,action:'reject',note:'其他窗口完成核对',at:'2026-10-03T00:00:00Z'}];await act(async()=>buttons('刷新拆分记录')[0].click());assert.equal(textareas()[0].value,'','new decision versions must not reuse old unsent notes');
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
