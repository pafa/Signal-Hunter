import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useEffect,useState} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

const h=React.createElement;
async function setup(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<button id="launcher">入口</button><div id="root"></div>',{url:'http://localhost/?view=classic&topic=kept-topic&range=3'});
 const names=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('button')?.focus();};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {createRoot}=await import('react-dom/client'),{createDeferredView}=await vite.ssrLoadModule('/src/DeferredView.jsx');
  root=createRoot(document.getElementById('root'),{onCaughtError:()=>{}});
  await run({createDeferredView,render:node=>act(()=>root.render(node))});
 }finally{
  if(root)await act(()=>root.unmount());
  for(const [name,value] of before)if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];
  dom.window.close();await vite.close();
 }
}
function pending(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('deferred view loads only when mounted and reuses a successful module on reopen',()=>setup(async({createDeferredView,render})=>{
 let loads=0,mounts=0;const request=pending();
 const View=createDeferredView(()=>{loads++;return request.promise;},{title:'研究'});
 function Loaded({value}){useEffect(()=>{mounts++;},[]);return h('p',{id:'loaded'},value);}
 assert.equal(loads,0);await render(h(View,{value:'旧参数'}));assert.equal(loads,1);assert.match(document.querySelector('[role="status"]').textContent,/正在打开研究/);
 await render(h(View,{value:'当前参数'}));assert.equal(loads,1);
 await act(async()=>request.resolve({default:Loaded}));assert.equal(document.getElementById('loaded').textContent,'当前参数');assert.equal(mounts,1);
 await render(null);await render(h(View,{value:'重新打开'}));assert.equal(loads,1);assert.equal(mounts,2);assert.equal(document.getElementById('loaded').textContent,'重新打开');
}));

test('load failure and explicit retry retain parent draft and do not submit business actions',()=>setup(async({createDeferredView,render})=>{
 const first=pending(),second=pending();let loads=0,saves=0;
 const View=createDeferredView(()=>++loads===1?first.promise:second.promise,{title:'研究详情'});
 function Parent(){const [draft,setDraft]=useState('研究草稿');return h('div',null,h('input',{value:draft,onInput:e=>setDraft(e.target.value)}),h(View,{onSave:()=>saves++}));}
 await render(h(Parent));const input=document.querySelector('input');input.focus();
 await act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'保留当前未保存内容');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
 await act(async()=>first.reject(new Error('private upstream detail')));
 assert.match(document.querySelector('[role="alert"]').textContent,/未能打开研究详情/);assert.doesNotMatch(document.body.textContent,/private upstream detail/);
 assert.equal(document.activeElement,input);assert.equal(input.value,'保留当前未保存内容');assert.equal(loads,1);assert.equal(saves,0);
 await act(()=>document.querySelector('.deferred-message button').click());assert.equal(loads,2);assert.equal(document.querySelector('input'),input);assert.equal(input.value,'保留当前未保存内容');
 await act(async()=>second.resolve({default:({onSave})=>h('button',{id:'save',onClick:onSave},'保存')}));
 assert.equal(saves,0);assert.equal(document.querySelector('input').value,'保留当前未保存内容');
 await act(()=>document.getElementById('save').click());assert.equal(saves,1);
 await render(null);await render(h(Parent));
 assert.equal(loads,2,'a successful retry stays cached after closing and reopening');assert.equal(document.querySelector('[role="alert"]'),null);assert.ok(document.getElementById('save'));
}));

test('closing a pending dialog prevents late resolution from reopening or mounting its contents',()=>setup(async({createDeferredView,render})=>{
 const request=pending();let mounts=0;
 const View=createDeferredView(()=>request.promise,{title:'公司研究',mode:'dialog'});
 function Parent(){const [open,setOpen]=useState(true);return open?h(View,{onClose:()=>setOpen(false)}):h('p',null,'工作台仍在');}
 const launcher=document.getElementById('launcher');launcher.focus();await render(h(Parent));
 assert.equal(document.querySelector('dialog').open,true);
 await act(()=>document.querySelector('dialog button').click());assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,launcher);
 await act(async()=>request.resolve({default:()=>{useEffect(()=>{mounts++;},[]);return h('p',null,'迟到的内容');}}));
 assert.equal(mounts,0);assert.match(document.body.textContent,/工作台仍在/);assert.doesNotMatch(document.body.textContent,/迟到的内容/);
}));

test('page failure offers recovery without discarding the existing topic and range',()=>setup(async({createDeferredView,render})=>{
 const request=pending();const View=createDeferredView(()=>request.promise,{title:'经典演示',mode:'page'});
 await render(h(View));assert.equal(document.querySelector('main').getAttribute('aria-label'),'经典演示');
 await act(async()=>request.reject(new Error('missing chunk')));
 assert.ok(document.querySelector('[role="alert"]'));assert.ok(document.querySelector('button'));
 const url=new URL(document.querySelector('a').href);assert.equal(url.searchParams.get('view'),'grid');assert.equal(url.searchParams.get('topic'),'kept-topic');assert.equal(url.searchParams.get('range'),'3');
}));
