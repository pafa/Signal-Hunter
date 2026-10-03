import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useState} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

async function withComponents(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<button id="launcher">打开研究</button><div id="root"></div>',{url:'http://localhost/'});
 const names=['window','document','HTMLElement','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let root;const calls={show:0,close:0};
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class{observe(){}disconnect(){}}});
  // JSDOM has no top layer, native Tab trap, or Escape default action. Test component behavior only.
  dom.window.HTMLDialogElement.prototype.showModal=function(){calls.show++;this.open=true;this.querySelector('button')?.focus();};
  dom.window.HTMLDialogElement.prototype.close=function(){calls.close++;this.open=false;};
  const {createRoot}=await import('react-dom/client');
  const primitives=await vite.ssrLoadModule('/src/major/Primitives.jsx'),{default:DailyChart}=await vite.ssrLoadModule('/src/integrated/DailyChart.jsx');
  root=createRoot(document.getElementById('root'));
  await run({...primitives,DailyChart,calls,render:node=>act(()=>root.render(node)),launcher:document.getElementById('launcher')});
 }finally{
  if(root)await act(()=>root.unmount());
  for(const [name,descriptor] of before)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  dom.window.close();await vite.close();
 }
}
const h=React.createElement;

test('simultaneous dialogs keep distinct, stable accessible titles',()=>withComponents(async({Modal,render})=>{
 const dialogs=title=>h(React.Fragment,null,h(Modal,{title:'公司研究',onClose:()=>{}},'研究正文'),h(Modal,{title,onClose:()=>{}},'数据正文'));
 await render(dialogs('每日数据'));
 const ids=[...document.querySelectorAll('dialog')].map(el=>el.getAttribute('aria-labelledby'));
 assert.equal(new Set(ids).size,2);
 assert.deepEqual(ids.map(id=>document.getElementById(id).textContent),['公司研究','每日数据']);
 await render(dialogs('更新后的每日数据'));
 assert.deepEqual([...document.querySelectorAll('dialog')].map(el=>el.getAttribute('aria-labelledby')),ids);
 assert.equal(document.getElementById(ids[1]).textContent,'更新后的每日数据');
}));

test('opening focuses the title; updates preserve editing focus; closing returns to the launcher in StrictMode',()=>withComponents(async({Modal,ErrorContext,render,launcher,calls})=>{
 launcher.focus();let closed=0;
 const view=error=>h(React.StrictMode,null,h(ErrorContext.Provider,{value:error},h(Modal,{title:'研究与版本',onClose:()=>closed++},h('label',null,'研究内容',h('input',{defaultValue:'未保存输入'})))));
 await render(view(''));
 const dialog=document.querySelector('dialog'),heading=dialog.querySelector('h2');
 assert.equal(document.activeElement,heading);assert.equal(heading.tabIndex,-1);assert.equal(dialog.open,true);
 const input=dialog.querySelector('input');input.focus();input.value='继续编辑的草稿';
 const shown=calls.show;
 await render(view('保存失败，请保留草稿'));
 assert.equal(document.activeElement,input);assert.equal(input.value,'继续编辑的草稿');assert.equal(calls.show,shown);
 assert.equal(document.querySelector('[role="alert"]').textContent,'保存失败，请保留草稿');
 await act(()=>dialog.querySelector('button').click());assert.equal(closed,1);
 await render(null);assert.equal(document.activeElement,launcher);assert.equal(calls.show,calls.close);
}));

test('cancel invokes the latest close callback without bypassing its guard',()=>withComponents(async({Modal,render,launcher})=>{
 launcher.focus();let stale=0,current=0;
 await render(h(Modal,{title:'审批研究',onClose:()=>stale++},'内容'));
 await render(h(Modal,{title:'审批研究',onClose:()=>current++},'内容'));
 const dialog=document.querySelector('dialog'),cancel=new window.Event('cancel',{cancelable:true});
 await act(()=>dialog.dispatchEvent(cancel));
 assert.equal(cancel.defaultPrevented,true);assert.equal(stale,0);assert.equal(current,1);
 assert.equal(dialog.open,true,'a parent close guard may retain the dialog');
 await render(null);assert.equal(document.activeElement,launcher);
}));

test('chart Escape clears inspection once, then permits native dialog cancellation and launcher return',()=>withComponents(async({Modal,DailyChart,render,launcher})=>{
 launcher.focus();let closes=0;
 function View(){
  const [date,setDate]=useState(null),[open,setOpen]=useState(true);
  return open?h(Modal,{title:'每日数据',onClose:()=>{closes++;setOpen(false);}},
   h(DailyChart,{series:[{name:'合成样本',points:[{date:'2026-09-28',close:10},{date:'2026-09-29',close:11},{date:'2026-09-30',close:12}]}],focusDate:date,onFocusDate:setDate}),
   h('output',null,date||'末日')):null;
 }
 await render(h(View));
 const svg=document.querySelector('svg');svg.focus();
 async function key(value){const event=new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true});await act(()=>svg.dispatchEvent(event));return event;}
 assert.equal((await key('Escape')).defaultPrevented,false,'no active inspection must not consume Escape');
 assert.equal((await key('ArrowLeft')).defaultPrevented,true);assert.equal(document.querySelector('output').textContent,'2026-09-29');
 assert.equal((await key('Escape')).defaultPrevented,true);assert.equal(document.querySelector('output').textContent,'末日');assert.equal(closes,0);
 assert.equal((await key('Home')).defaultPrevented,true);assert.equal(document.querySelector('output').textContent,'2026-09-28');
 assert.equal((await key('End')).defaultPrevented,true);assert.equal(document.querySelector('output').textContent,'2026-09-30');
 await key('Escape');assert.equal((await key('Escape')).defaultPrevented,false);
 assert.equal((await key('Tab')).defaultPrevented,false);
 // Dispatch cancel explicitly: JSDOM does not implement the browser's Escape -> cancel default action.
 await act(()=>document.querySelector('dialog').dispatchEvent(new window.Event('cancel',{cancelable:true})));
 assert.equal(closes,1);assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,launcher);
}));

test('read-only or out-of-range chart inspection does not consume Escape',()=>withComponents(async({DailyChart,render})=>{
 const series=[{name:'合成样本',points:[{date:'2026-09-29',close:11},{date:'2026-09-30',close:12}]}];
 let changes=0;
 for(const props of [{focusDate:'2026-09-29'},{focusDate:'2026-09-28',onFocusDate:()=>changes++}]){
  await render(h(DailyChart,{series,...props}));
  const event=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
  await act(()=>document.querySelector('svg').dispatchEvent(event));
  assert.equal(event.defaultPrevented,false);
 }
 assert.equal(changes,0);
}));
