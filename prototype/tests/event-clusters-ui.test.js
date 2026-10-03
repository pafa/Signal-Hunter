import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('cluster review displays conflicts, source scopes, stable identity, historical quotes and escaped input',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {ClusterCandidate,ClusterRecord}=await vite.ssrLoadModule('/src/integrated/EventClusters.jsx');
 const members=[{id:'a',title:'<script>甲</script>',revision:1,contentScope:'excerpt'},{id:'b',title:'乙',revision:2,contentScope:'headline-only'}],comparison={relation:'related',left:{quote:'甲原文'},right:{quote:'乙原文'},reason:'对象不同',missingEvidence:['仍需原始来源']},basis={runId:'run',model:'configured',decisionVersion:0,comparison};
 const group={id:'group',hash:'hash',indices:[0,1],members,pairs:[{ordinal:0,left:0,right:1,status:'different',relation:'related',basis}],state:'conflict',overlaps:[],missing:[],canSave:false};const conflict=renderToStaticMarkup(React.createElement(ClusterCandidate,{group,batchId:'batch'}));
 for(const text of ['存在冲突','不可确认','关系链不足以证明','&lt;script&gt;','仅标题','摘录','尚非同一事件'])assert.ok(conflict.includes(text),text);assert.ok(!conflict.includes('<script>'));assert.ok(!conflict.includes('确认建立事件簇'));
 const record={id:'stable-id',version:2,status:'active',health:{current:false,reason:'输入修订，需复核'},title:'事件簇',note:'保留旧判断',confirmedAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',members,pairs:[{left:members[0],right:members[1],basis}],history:[{version:1,status:'active',title:'旧名称',note:'旧说明',updatedAt:'2026-10-02T00:00:00Z',members,pairs:[],snapshotHash:'frozen-hash'}]};const html=renderToStaticMarkup(React.createElement(ClusterRecord,{record}));for(const text of ['stable-id','依据需复核','甲原文','乙原文','旧说明','frozen-hash','事件簇历史'])assert.ok(html.includes(text),text);
 }finally{await vite.close();}
});
test('archive drafts stay with their exact cluster version and a pending receipt cannot clear another draft',async()=>{
 const {JSDOM}=await import('jsdom'),{act}=await import('react');
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const records=Object.fromEntries(['a','b'].map(id=>[id,{id,title:`事件簇${id}`,version:1,status:'active',health:{current:true,reason:'合成匹配'},members:[],pairs:[],history:[],memberCount:0}]));
  const response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});let finish,submitted,calls=0;
  globalThis.fetch=async(path,options)=>{
   if(path.startsWith('/api/event-clusters?'))return response({items:Object.values(records),total:2});
   if(path==='/api/event-clusters/a/archive'){calls++;submitted=JSON.parse(options.body);return new Promise(resolve=>{finish=resolve;});}
   const id=path.split('/').at(-1);assert(records[id],path);return response(records[id]);
  };
  const {createRoot}=await import('react-dom/client'),{default:EventClusters}=await vite.ssrLoadModule('/src/integrated/EventClusters.jsx');
  root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(EventClusters,{initialClusterId:'a',onBack:()=>{}})));
  const select=async id=>act(async()=>[...document.querySelectorAll('.source-news-list button')].find(b=>b.textContent.includes(`事件簇${id}`)).click());
  const note=value=>act(()=>{const textarea=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,value);textarea.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await note('只用于a第一版的归档说明');await select('b');
  assert.equal(document.querySelector('textarea').value,'','a draft must not be submitted for b');
  await note('b的未提交说明');await select('a');assert.equal(document.querySelector('textarea').value,'只用于a第一版的归档说明');
  const submit=()=>document.querySelector('textarea').closest('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await act(submit);assert.equal(submitted.note,'只用于a第一版的归档说明');await select('b');
  assert(document.querySelector('[aria-label="已保存事件簇"] h3').textContent.includes('事件簇a'));assert.equal(document.querySelector('textarea').disabled,true);
  await act(submit);assert.equal(calls,1);
  records.a={...records.a,version:2,status:'archived',health:{current:false,reason:'已归档'}};
  await act(async()=>finish(response({id:'a',version:2})));await select('b');assert.equal(document.querySelector('textarea').value,'b的未提交说明');
  records.b={...records.b,version:2};await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='刷新事件簇依据').click());
  assert.equal(document.querySelector('textarea').value,'','a newer cluster version must not inherit an unreviewed archive reason');
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
