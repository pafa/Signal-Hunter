import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client'),{default:Rules}=await vite.ssrLoadModule('/src/integrated/ObservationRules.jsx');root=createRoot(document.getElementById('root'));
  const id=crypto.randomUUID(),topic={id,createdAt:'2026-10-04',title:'Synthetic topic',version:1,status:'active',companies:[]},rule={id:crypto.randomUUID(),createdAt:'2026-10-04',topicId:id,version:1,active:true,binding:{topicVersion:1},definition:{label:'Synthetic rule',join:'all',conditions:[{type:'research-change'}]}};
  const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t),field=t=>[...document.querySelectorAll('label')].find(e=>e.textContent.startsWith(t))?.querySelector('input,select');
  const fill=(label,value)=>act(()=>{const e=field(label);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const click=t=>act(async()=>button(t).click()),submit=()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const data=(r=rule,t=topic,instance='fixture')=>({runtime:{offline:true,instance:{id:instance}},research:{topics:[t]},observationInbox:{rules:r?[r]:[]}});
  await run({Rules,topic,rule,data,button,field,fill,click,submit,render:n=>act(()=>root.render(n))});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}
test('observation operation rationale keeps its original config version across updates and close/reopen',()=>ui(async({Rules,rule,data,render,fill,field,button,click})=>{
 const calls=[];let current=rule;const show=()=>render(React.createElement(Rules,{data:data(current),mutate:async(...args)=>{calls.push(args);return null;}}));
 await show();await fill('操作说明','Reason written for v1');await render(null);await show();assert.equal(field('操作说明').value,'Reason written for v1');
 current={...rule,version:2};await show();assert.equal(button('暂停观察').disabled,true);await click('暂停观察');assert.equal(calls.length,0);
 assert(document.body.textContent.includes('v1'));assert(document.body.textContent.includes('v2'));
 await click('丢弃操作说明并载入最新版本');assert.equal(field('操作说明').value,'');await fill('操作说明','Rechecked v2');await click('暂停观察');assert.equal(calls[0][2].version,2);assert.equal(field('操作说明').value,'Rechecked v2');
}));
test('rule editors isolate drafts when identical topic/rule ids occur in another dataset, including A/B/A',()=>ui(async({Rules,data,render,click,fill,field,button})=>{
 let instance='A';const show=()=>render(React.createElement(Rules,{data:data(undefined,undefined,instance),mutate:async()=>null}));
 await show();await click('编辑条件');await fill('观察名称','Draft A');instance='B';await show();if(button('编辑条件'))await click('编辑条件');assert.equal(field('观察名称').value,'Synthetic rule');await fill('观察名称','Draft B');instance='A';await show();if(button('编辑条件'))await click('编辑条件');assert.equal(field('观察名称').value,'Draft A');
}));
test('operation text does not silently authorize a newer configuration revision',()=>ui(async({Rules,rule,data,render,fill,button,click})=>{
 let r=rule,calls=0;const show=()=>render(React.createElement(Rules,{data:data(r),mutate:async()=>{calls++;return null;}}));
 await show();await fill('操作说明','Based on original configuration');r={...rule,version:2};await show();assert.equal(button('暂停观察').disabled,true);await click('暂停观察');assert.equal(calls,0);
}));
test('a removed edited rule cannot silently become a new observation creation',()=>ui(async({Rules,data,render,click,button,submit})=>{
 let present=true,calls=0;const show=()=>render(React.createElement(Rules,{data:data(present?undefined:null),mutate:async()=>{calls++;return null;}}));
 await show();await click('编辑条件');present=false;await show();assert(document.body.textContent.includes('配置已不在当前列表'));assert.equal(button('保存观察条件'),undefined);assert.equal(document.querySelector('form'),null);assert.equal(calls,0);
}));
test('editor rejects forced stale submits and concurrent submissions before parent busy updates',()=>ui(async({Rules,topic,rule,data,render,click,fill,submit,field,button})=>{
 let t=topic,release,calls=0;const show=()=>render(React.createElement(Rules,{data:data(rule,t),mutate:()=>{calls++;return new Promise(r=>release=r);}}));
 await show();await click('编辑条件');await fill('变更说明','Review original config');t={...topic,version:2};await show();await act(submit);assert.equal(calls,0);
 await click('已核对，使用当前研究版本');await act(()=>{submit();submit();});assert.equal(calls,1);await act(async()=>release(null));assert.equal(field('变更说明').value,'Review original config');assert.equal(button('保存观察条件').disabled,false);
}));
test('late successful edit preserves a newer reopened draft and leaves its editor visible',()=>ui(async({Rules,rule,data,render,click,fill,field,submit})=>{
 let release,current=rule;const props=()=>({data:data(current),mutate:()=>new Promise(r=>release=r)}),show=()=>render(React.createElement(Rules,props()));
 await show();await click('编辑条件');await fill('观察名称','Submitted draft');await fill('变更说明','First edit');await act(submit);await render(null);await show();await click('编辑条件');await fill('观察名称','Newer reopened draft');
 current={...rule,version:2};await act(async()=>release(data(current)));await show();assert.equal(field('观察名称').value,'Newer reopened draft');assert(document.querySelector('form'));assert(document.body.textContent.includes('配置已被其他操作更新'));
}));
test('rule operation blocks same-turn duplicates and its late success cannot clear a newer remounted reason',()=>ui(async({Rules,rule,data,render,fill,field,button})=>{
 let release,calls=0,current=rule;const show=()=>render(React.createElement(Rules,{data:data(current),mutate:()=>{calls++;return new Promise(r=>release=r);}}));
 await show();await fill('操作说明','Submitted pause reason');await act(()=>{button('暂停观察').click();button('暂停观察').click();});assert.equal(calls,1);
 await render(null);await show();await fill('操作说明','Newer reopened reason');current={...rule,version:2,active:false};await act(async()=>release(data(current)));await show();assert.equal(field('操作说明').value,'Newer reopened reason');assert.equal(button('恢复观察').disabled,true);
}));
test('new-rule failed retry retains its client id and legacy drafts require explicit loading without deleting the old record',()=>ui(async({Rules,topic,data,render,click,fill,field,submit})=>{
 const calls=[],legacyKey=`signal-observation-draft:fixture:${topic.id}:new`,legacy={clientId:crypto.randomUUID(),topicVersion:1,version:0,label:'Legacy draft',join:'all',conditions:[{type:'research-change'}],note:''},raw=JSON.stringify(legacy);sessionStorage.setItem(legacyKey,raw);
 const show=()=>render(React.createElement(Rules,{data:data(null),mutate:async(path,method,body)=>{calls.push(body);return null;}}));await show();await click('添加观察条件');assert.equal(field('观察名称').value,'');await click('载入旧观察条件草稿');assert.equal(field('观察名称').value,'Legacy draft');await act(submit);await render(null);await show();await click('添加观察条件');await act(submit);assert.equal(calls.length,2);assert.equal(calls[0].clientId,legacy.clientId);assert.equal(calls[1].clientId,calls[0].clientId);assert.equal(sessionStorage.getItem(legacyKey),raw);
}));
