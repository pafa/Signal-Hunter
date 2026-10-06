import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('identity drafts retain both listing and note across records, lock pending decisions and clear only the submitted version',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const material={id:'material',title:'合成材料',revision:1,body:'合成正文'},directory=[{symbol:'002594.SZ',name:'比亚迪',market:'CN',currency:'CNY',identityBasis:'合成A股依据'},{symbol:'01211.HK',name:'比亚迪',market:'HK',currency:'HKD',identityBasis:'合成H股依据'}],mention={name:'比亚迪',entityType:'company',resolution:'ambiguous',symbols:directory.map(c=>c.symbol),quote:'合成正文',quoteField:'body',reason:'需核对上市证券'};
  const records=Object.fromEntries(['a','b'].map(id=>[id,{id,status:'candidate',stale:false,packet:{input:{material,directory},inputHash:'frozen'},candidate:{resolution:{mentions:[mention,{...mention,name:'第二提及'}],scopeNote:'合成身份',missingEvidence:[]},trace:{}},reviews:[[],[]]}]));
  const base='/api/research/topic/company-entities',response=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}});let finish;const calls=[];
  globalThis.fetch=async path=>{if(path.startsWith('/api/security-directory?'))return response({enabled:false,running:false,current:null,history:[],attempts:[],search:{items:[],total:0,snapshot:null}});if(path===base)return response({enabled:true,model:'synthetic',runs:Object.values(records)});const id=path.split('/').at(-1);assert(records[id],path);return response(records[id]);};
  const mutate=(path,method,body)=>{calls.push({path,method,body});return new Promise(resolve=>{finish=resolve;});};
  const {createRoot}=await import('react-dom/client'),{default:CompanyEntities}=await vite.ssrLoadModule('/src/major/CompanyEntities.jsx');root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(CompanyEntities,{topic:{id:'topic',version:1,status:'active'},materials:[material],busy:false,mutate})));
  const textareas=()=>[...document.querySelectorAll('textarea')],selects=()=>[...document.querySelectorAll('select')].filter(el=>!el.closest('.security-directory')),buttons=label=>[...document.querySelectorAll('button')].filter(b=>b.textContent===label);
  const note=(i,value)=>act(()=>{const el=textareas()[i];Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const choose=(i,value)=>act(async()=>{const el=selects()[i];if(el.disabled)return;el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await note(0,'a身份一说明');await choose(2,'01211.HK');await note(1,'a身份二未提交');await choose(3,'002594.SZ');await choose(1,'b');assert.equal(textareas()[0].value,'');assert.equal(selects()[2].value,'');await note(0,'b待处理说明');await choose(2,'002594.SZ');await choose(1,'a');
  assert.equal(textareas()[0].value,'a身份一说明','record switches must preserve the unsent note');assert.equal(selects()[2].value,'01211.HK','record switches must preserve the chosen listing');assert.equal(textareas()[1].value,'a身份二未提交');
  await act(async()=>buttons('刷新身份识别记录')[0].click());assert.equal(textareas()[0].value,'a身份一说明');assert.equal(selects()[2].value,'01211.HK');
  await act(()=>buttons('确认证券并关联研究')[0].click());assert.equal(calls[0].path,base+'/a/decision');assert.equal(calls[0].body.symbol,'01211.HK');assert([...selects(),...textareas()].every(el=>el.disabled));await choose(1,'b');assert.equal(selects()[1].value,'a');await act(()=>buttons('确认证券并关联研究')[0].click());assert.equal(calls.length,1);
  await act(async()=>finish(null));assert.equal(textareas()[0].value,'a身份一说明');assert.equal(selects()[2].value,'01211.HK');await act(()=>buttons('确认证券并关联研究')[0].click());assert.deepEqual(calls[1],calls[0]);
  records.a.reviews[0]=[{version:1,action:'link',symbol:'01211.HK',note:'a身份一说明',inputHash:'frozen',at:'2026-10-03T00:00:00Z'}];await act(async()=>finish({companyEntityRun:records.a}));assert.equal(textareas().length,1);assert.equal(textareas()[0].value,'a身份二未提交');assert.equal(selects()[2].value,'002594.SZ');await choose(1,'b');assert.equal(textareas()[0].value,'b待处理说明');assert.equal(selects()[2].value,'002594.SZ');
  records.b.reviews[0]=[{version:1,action:'reject',note:'其他窗口完成核对',at:'2026-10-03T00:00:00Z'}];await act(async()=>buttons('刷新身份识别记录')[0].click());assert.equal(textareas()[0].value,'','new decision versions must not reuse old notes');assert.equal(selects()[2].value,'','new decision versions must not reuse old listings');
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
