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
  const topic={id:crypto.randomUUID(),createdAt:'2026-10-05',version:1,status:'active',chain:[{id:'fact',title:'Synthetic fact'}],evidence:[],companies:[]},base=`/api/research/${topic.id}`;
  const form={url:'https://example.test/source',title:'Synthetic title',sourceName:'Synthetic source',publishedAt:'',body:'Synthetic immutable body',scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'Synthetic relevance'};
  const material={id:'a'.repeat(64),documentId:'b'.repeat(64),contentHash:'c'.repeat(64),revision:1,...form,publishedAt:null,availableAt:'2026-10-05T00:00:00Z',verification:'unverified',method:'manual'};
  const evidence={id:`material:${material.id}`,materialId:material.id,materialRevision:1,claim:form.title,sourceName:form.sourceName,url:form.url,publishedAt:null,contentScope:'excerpt',stance:form.stance,family:form.family,step:form.step,interpretation:form.interpretation,verification:'unverified'};
  const saved={...topic,version:2,evidence:[evidence]},receipt={research:{topics:[saved]}},summary={...material,evidenceId:evidence.id};delete summary.body;
  const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}}),calls=[];let intercept=null,current=topic;
  globalThis.fetch=async(path,options)=>{
   calls.push({path,method:options.method});const handled=intercept?.(path,options);if(handled)return handled;
   if(path===base+'/materials?view=summary')return response({materials:current.evidence.length?[summary]:[],attempts:[]});
   if(path===base+'/materials/'+material.id)return response(material);
   if(path===base+'/packet')return response({schema:'event-research-packet-1',analysisMode:'assistant-review-required',inputHash:'d'.repeat(64),generatedAt:'2026-10-05T00:00:00Z',instructions:['Synthetic'],input:{topicId:topic.id,topicVersion:current.version,evidence:[]}});
   if(/\/(model-runs|company-entities|material-events)$/.test(path))return response({enabled:false,runs:[]});
   throw Error('Unexpected path '+path);
  };
  const {createRoot}=await import('react-dom/client'),{default:Editor}=await vite.ssrLoadModule('/src/major/SourceResearch.jsx');root=createRoot(document.getElementById('root'));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),field=text=>[...document.querySelectorAll('.source-add label')].find(l=>[...l.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')===text)?.querySelector('input,textarea,select');
  const fill=(label,value)=>act(()=>{const e=field(label),p=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:e.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,value);e.dispatchEvent(new window.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  const fillForm=async()=>{for(const [label,key] of [['来源链接（可选）','url'],['材料标题','title'],['来源名称','sourceName'],['材料正文','body'],['为什么与这个环节有关？','interpretation']])await fill(label,form[key]);};
  const submit=()=>act(async()=>document.querySelector('.source-add form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))),click=text=>act(async()=>button(text).click()),render=node=>act(async()=>root.render(node));
  await run({Editor,topic,form,material,evidence,saved,receipt,summary,base,response,calls,button,field,fill,fillForm,submit,click,render,intercept:f=>intercept=f,current:t=>current=t});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}
test('source draft survives close and instance A/B/A without mixing inputs',()=>ui(async({Editor,topic,render,fill,field})=>{
 let instance='A';const show=()=>render(React.createElement(Editor,{topic,instanceId:instance,mutate:async()=>null}));await show();await fill('材料正文','Keep A');await render(null);await show();assert.equal(field('材料正文').value,'Keep A');instance='B';await show();assert.equal(field('材料正文').value,'');instance='A';await show();assert.equal(field('材料正文').value,'Keep A');
}));
test('source save synchronously excludes repeat submits, resets, mode switches and packet reads',()=>ui(async({Editor,topic,render,fillForm,button,field,calls})=>{
 let finish,count=0;await render(React.createElement(Editor,{topic,mutate:()=>{count++;return new Promise(r=>finish=r);}}));await fillForm();
 await act(()=>{const f=document.querySelector('.source-add form');f.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));button('丢弃材料草稿并载入最新版本').click();button('读取公开网页').click();button('生成研判材料包').click();});
 assert.equal(count,1);assert.equal(field('材料正文').value,'Synthetic immutable body');assert.equal(calls.filter(c=>c.path.endsWith('/packet')).length,0);assert.equal(document.querySelector('.source-add fieldset').disabled,true);await act(async()=>finish(null));
}));
test('unknown save keeps input and requires a successful material refresh before another submit',()=>ui(async({Editor,topic,render,fillForm,submit,field,button,click})=>{
 let count=0;await render(React.createElement(Editor,{topic,mutate:async()=>{count++;return null;}}));await fillForm();await submit();assert.match(document.body.textContent,/未能核对材料保存/);assert.equal(field('材料正文').value,'Synthetic immutable body');assert.equal(button('保存材料快照').disabled,true);await submit();assert.equal(count,1);await click('刷新材料记录');assert.equal(button('保存材料快照').disabled,false);
}));
test('wrong-version or incomplete write receipt cannot acknowledge source input',()=>ui(async({Editor,topic,receipt,render,fillForm,submit,field,click,button})=>{
 let value={research:{topics:[{...topic,version:2}]}},count=0;await render(React.createElement(Editor,{topic,mutate:async()=>{count++;return value;}}));await fillForm();await submit();assert.equal(field('材料正文').value,'Synthetic immutable body');assert.equal(button('保存材料快照').disabled,true);await click('刷新材料记录');value=structuredClone(receipt);value.research.topics[0].version=7;await submit();assert.equal(count,2);assert.equal(field('材料正文').value,'Synthetic immutable body');assert.match(document.body.textContent,/未能核对材料保存/);
}));
test('matching evidence cannot acknowledge altered immutable material text',()=>ui(async({Editor,topic,base,receipt,material,response,intercept,render,fillForm,submit,field,button})=>{
 intercept(path=>path===base+'/materials/'+material.id?Promise.resolve(response({...material,body:'Different body'})):null);await render(React.createElement(Editor,{topic,mutate:async()=>receipt}));await fillForm();await submit();assert.equal(field('材料正文').value,'Synthetic immutable body');assert.equal(button('保存材料快照').disabled,true);assert.match(document.body.textContent,/未能核对材料保存/);
}));
test('verified save clears only submitted input and preserves the saved material across reopen',()=>ui(async({Editor,topic,saved,receipt,current,render,fillForm,submit,field})=>{
 let t=topic;const show=()=>render(React.createElement(Editor,{topic:t,mutate:async()=>receipt}));await show();await fillForm();await submit();assert.equal(field('材料正文').value,'');t=saved;current(t);await show();assert(document.body.textContent.includes('Synthetic title'));await render(null);await show();assert.equal(field('材料正文').value,'');assert(document.body.textContent.includes('已关联材料'));
}));
test('already linked identical material is acknowledged without inventing another research version',()=>ui(async({Editor,saved,receipt,current,render,fillForm,submit,field})=>{
 current(saved);await render(React.createElement(Editor,{topic:saved,mutate:async()=>receipt}));await fillForm();await submit();assert.equal(field('材料正文').value,'');assert(!document.body.textContent.includes('未能核对材料保存'));
}));
test('stale source draft remains on its original version until explicit review',()=>ui(async({Editor,topic,current,render,fillForm,submit,field,button,click})=>{
 let t=topic,count=0;const show=()=>render(React.createElement(Editor,{topic:t,mutate:async()=>{count++;return null;}}));await show();await fillForm();t={...topic,version:2};current(t);await show();assert.equal(button('保存材料快照').disabled,true);await submit();assert.equal(count,0);assert.equal(field('材料正文').value,'Synthetic immutable body');await click('已核对更新，保留材料草稿继续编辑');assert.equal(button('保存材料快照').disabled,false);
}));
test('failed or mismatched summary retains prior material and draft while locking related actions',()=>ui(async({Editor,saved,current,base,summary,response,intercept,render,fill,field,click,button})=>{
 current(saved);await render(React.createElement(Editor,{topic:saved,mutate:async()=>null}));await fill('材料正文','Keep my notes');let value={materials:[{...summary,evidenceId:'wrong'}],attempts:[]};intercept(path=>path===base+'/materials?view=summary'?Promise.resolve(response(value)):null);await click('刷新材料记录');assert(document.body.textContent.includes('Synthetic title'));assert.equal(field('材料正文').value,'Keep my notes');assert.equal(button('保存材料快照').disabled,true);assert.equal(button('生成研判材料包').disabled,true);intercept(()=>null);await click('刷新材料记录');assert.equal(button('保存材料快照').disabled,false);
}));
test('packet requests submit once and a late old-version packet cannot replace current research',()=>ui(async({Editor,topic,base,response,intercept,render,button,current})=>{
 let finish,count=0;intercept(path=>path===base+'/packet'?new Promise(r=>{count++;finish=r;}):null);let t=topic;const show=()=>render(React.createElement(Editor,{topic:t,mutate:async()=>null}));await show();await act(()=>{button('生成研判材料包').click();button('生成研判材料包').click();});assert.equal(count,1);t={...topic,version:2};current(t);await show();await act(async()=>finish(response({schema:'event-research-packet-1',analysisMode:'assistant-review-required',inputHash:'d'.repeat(64),instructions:[],input:{topicId:topic.id,topicVersion:1}})));assert.equal(document.querySelector('textarea[aria-label="研判材料包"]'),null);assert.match(document.body.textContent,/研究已更新/);
}));
test('late source save cannot clear a reopened newer draft or change its version',()=>ui(async({Editor,topic,receipt,render,fillForm,fill,field})=>{
 let finish;const show=()=>render(React.createElement(Editor,{topic,mutate:()=>new Promise(r=>finish=r)}));await show();await fillForm();await act(()=>document.querySelector('.source-add form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await render(null);await show();await fill('材料正文','New reopened draft');await act(async()=>finish(receipt));assert.equal(field('材料正文').value,'New reopened draft');assert(!document.body.textContent.includes('研究已从 v2'));
}));
test('verified public-web save accepts a final redirected URL while keeping source scope distinct',()=>ui(async({Editor,topic,material,evidence,base,response,intercept,render,click,fill,field,submit})=>{
 const m={...material,url:'https://example.test/final',scope:'extracted-text',method:'public-web'},e={...evidence,url:m.url,contentScope:m.scope},result={research:{topics:[{...topic,version:2,evidence:[e]}]}};
 intercept(path=>path===base+'/materials/'+material.id?Promise.resolve(response(m)):null);await render(React.createElement(Editor,{topic,mutate:async()=>result}));await click('读取公开网页');await fill('来源链接','https://example.test/requested');await fill('为什么与这个环节有关？','Synthetic relevance');await submit();assert.equal(field('材料正文').value,'');assert(!document.body.textContent.includes('未能核对材料保存'));
}));
test('an unrelated packet is refused without removing the previously verified frozen packet',()=>ui(async({Editor,topic,base,response,intercept,render,click})=>{
 await render(React.createElement(Editor,{topic,mutate:async()=>null}));await click('生成研判材料包');const previous=document.querySelector('textarea[aria-label="研判材料包"]').value;
 intercept(path=>path===base+'/packet'?Promise.resolve(response({schema:'event-research-packet-1',analysisMode:'assistant-review-required',inputHash:'d'.repeat(64),instructions:[],input:{topicId:'wrong',topicVersion:1}})):null);await click('生成研判材料包');assert.equal(document.querySelector('textarea[aria-label="研判材料包"]').value,previous);assert.match(document.body.textContent,/未能核对研判材料包/);
}));
test('save receipt older than the newly visible research cannot rebase or clear its draft',()=>ui(async({Editor,topic,receipt,current,render,fillForm,field})=>{
 let t=topic,finish;const show=()=>render(React.createElement(Editor,{topic:t,mutate:()=>new Promise(r=>finish=r)}));await show();await fillForm();await act(()=>document.querySelector('.source-add form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));t={...topic,version:3};current(t);await show();await act(async()=>finish(receipt));assert.equal(field('材料正文').value,'Synthetic immutable body');assert.match(document.body.textContent,/研究已从 v1 更新到 v3/);
}));
