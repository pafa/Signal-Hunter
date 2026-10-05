import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
test('replacement preview and save lock parent navigation and retain the reviewed command on failure',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const old={kind:'event',id:'old',documentId:'doc',revision:1,materialRevision:1,title:'原事项',contentScope:'excerpt',eventFocus:{actor:'甲',action:'收购',object:'乙',stage:'拟议',quote:'合成原文',eventTime:'未知',timeRole:'unknown',timeEvidence:{basis:'unknown'}}},next={...old,id:'new',title:'新事项',materialRevision:2};
  const records=Object.fromEntries(['a','b'].map(id=>[id,{id,title:`事件簇${id}`,version:1,status:'active',health:{current:false,reason:'待更新'},members:[old],pairs:[],history:[],memberCount:1}]));
  const group={id:'g',hash:'group-hash',state:'ready',canSave:false,members:[next],indices:[0],pairs:[],overlaps:[],missing:[old]},response=(b,status=200)=>new Response(JSON.stringify(b),{status,headers:{'content-type':'application/json'}});let previewFinish,saveFinish,back=0;const saves=[];
  globalThis.fetch=async(path,options)=>{
   if(path.startsWith('/api/event-clusters?'))return response({items:Object.values(records),total:2});
   if(path==='/api/semantic-batches/batch/clusters')return response({inputCount:1,groups:[group],unmergedPairs:[]});
   if(path==='/api/event-clusters/a/replacement-preview')return new Promise(resolve=>{previewFinish=resolve;});
   if(path==='/api/event-clusters/a/replace'){saves.push(JSON.parse(options.body));return new Promise(resolve=>{saveFinish=resolve;});}
   const id=path.split('/').at(-1);assert(records[id],path);return response(records[id]);
  };
  const {createRoot}=await import('react-dom/client'),{default:EventClusters}=await vite.ssrLoadModule('/src/integrated/EventClusters.jsx');root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(EventClusters,{batchId:'batch',initialClusterId:'a',onBack:()=>back++})));
  const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label),other=()=>document.querySelectorAll('.source-news-list button')[1],form=()=>document.querySelector('[aria-label="延续事件簇 事件簇a"]');
  await act(()=>{const el=form().querySelector('select');el.value='new';el.dispatchEvent(new window.Event('change',{bubbles:true}));});await act(()=>button('预览新旧事项对应').click());
  assert.equal(other().disabled,true,'pending replacement must lock the parent cluster selection');await act(()=>{other().click();button('返回').click();});assert.equal(back,0);assert(form());
  await act(async()=>previewFinish(response({previewHash:'preview-hash',groupHash:'group-hash',members:[next],pairs:[],mappings:[{before:old,after:next}]})));
  await act(()=>{const el=form().querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,'逐项核对后的说明');el.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await act(()=>button('确认延续原事件簇').click());assert(other().disabled);assert(button('刷新事件簇依据').disabled);assert(form().querySelector('textarea').disabled);await act(()=>button('确认延续原事件簇').click());assert.equal(saves.length,1);
  await act(async()=>saveFinish(response({error:'合成暂时失败'},500)));assert.equal(form().querySelector('textarea').value,'逐项核对后的说明');assert.equal(other().disabled,false);await act(()=>button('确认延续原事件簇').click());assert.deepEqual(saves[1],saves[0]);
  records.a={...records.a,version:2,members:[next],health:{current:true,reason:'仍匹配'}};await act(async()=>saveFinish(response({id:'a',version:2})));assert.match(document.querySelector('[aria-label="已保存事件簇"] h3').textContent,/事件簇a · v2/);assert.equal(other().disabled,false);
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
