import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';import {JSDOM} from 'jsdom';
async function ui(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const {default:Review}=await vite.ssrLoadModule('/src/major/ScreeningReview.jsx');const button=t=>[...document.querySelectorAll('button')].find(x=>x.textContent===t),area=t=>[...document.querySelectorAll('label')].find(x=>x.firstChild?.textContent===t).querySelector('textarea,input,select');
 const edit=async(label,value)=>act(()=>{const e=area(label);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,value);e.dispatchEvent(new dom.window.Event('input',{bubbles:true}));e.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 const respond=b=>new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}});let handler=()=>({enabled:false,runs:[],materials:[],attempts:[],history:[],search:{items:[],total:0},samples:[]});globalThis.fetch=async path=>respond(await handler(path));
 await run({Review,setFetch:f=>{handler=f;},render:n=>act(()=>root.render(n)),button,area,edit,submit:()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))});
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
}



const sample=(id,revision=1)=>({id,input:{revision,title:'Synthetic title '+revision},inputHash:'frozen-input',rulesHash:'rules',decisionAt:'2026-10-04T00:00:00Z',origin:'historical-diagnostic',reviews:[]});
const news=revision=>({id:crypto.randomUUID(),revision,triage:{}});
const row=(version,note)=>({version,note,verdict:'unclear',scope:'headline-only',sourceUrl:'',novelty:'',scale:'',mechanism:'',expectations:'',duration:''});
test('screening draft survives remount and failed submit, successful save reloads immutable review history',()=>ui(async({Review,render,button,area,edit,submit,setFetch})=>{
 const s=sample(crypto.randomUUID()),n=news(1);setFetch(()=>({samples:[s],currentRulesHash:'rules'}));let succeed=false,calls=[];const view=()=>React.createElement(Review,{news:n,busy:false,mutate:async(p,m,d)=>{calls.push(d);if(!succeed)return null;s.reviews.unshift({...d,version:d.version+1});return {saved:true};}});
 await render(view());await edit('复核依据与限制','Unsent note');await render(null);await render(view());assert.equal(area('复核依据与限制').value,'Unsent note');assert(document.querySelector('.screening-edit').open);await submit();assert.equal(s.reviews.length,0);assert.equal(area('复核依据与限制').value,'Unsent note');succeed=true;await submit();assert.equal(calls[1].version,0);assert.equal(s.reviews.length,1);assert.equal(area('复核依据与限制').value,'Unsent note');assert(!document.querySelector('.screening-edit').open);
}));
test('concurrent screening review refresh preserves old base and blocks submit until explicit reset',()=>ui(async({Review,render,button,area,edit,submit,setFetch})=>{
 const s=sample(crypto.randomUUID()),n=news(1);setFetch(()=>({samples:[s],currentRulesHash:'rules'}));const calls=[];await render(React.createElement(Review,{news:n,busy:false,mutate:async(p,m,d)=>{calls.push(d);return null;}}));await edit('复核依据与限制','Original pending note');s.reviews=[row(1,'Other window saved')];await act(async()=>button('刷新初筛复核').click());assert.equal(area('复核依据与限制').value,'Original pending note');assert(button('保存初筛复核').disabled);await submit();assert.equal(calls.length,0);await act(()=>button('丢弃初筛复核草稿并载入最新版本').click());assert.equal(area('复核依据与限制').value,'Other window saved');await edit('复核依据与限制','Reviewed new note');await submit();assert.equal(calls[0].version,1);assert.equal(s.reviews[0].note,'Other window saved');
}));
test('source revision and rules samples keep separate drafts, with an explicit old-sample title',()=>ui(async({Review,render,area,edit,setFetch})=>{
 const old=sample(crypto.randomUUID()),next=sample(crypto.randomUUID(),2),newRules={...sample(crypto.randomUUID(),2),rulesHash:'new-rules'},n=news(1);let samples=[old],rules='rules';setFetch(()=>({samples,currentRulesHash:rules}));const view=revision=>React.createElement(Review,{news:{...n,revision},busy:false,mutate(){throw Error('no save');}});
 await render(view(1));await edit('复核依据与限制','Original v1 note');samples=[next,old];await render(view(2));assert.equal(area('复核依据与限制').value,'');await edit('复核依据与限制','Source v2 note');await edit('初筛留样版本',old.id);assert.equal(area('复核依据与限制').value,'Original v1 note');assert(document.body.textContent.includes('本份留样标题：Synthetic title 1'));await render(null);samples=[newRules,next,old];rules='new-rules';await render(view(2));assert.equal(area('复核依据与限制').value,'');await edit('初筛留样版本',next.id);assert.equal(area('复核依据与限制').value,'Source v2 note');await edit('初筛留样版本',old.id);assert.equal(area('复核依据与限制').value,'Original v1 note');
}));
test('history pagination restores page selections and drafts while new samples stay outside the pinned range',()=>ui(async({Review,render,button,area,edit,setFetch})=>{
 const rows=Array.from({length:25},(_,i)=>sample('history-'+crypto.randomUUID(),25-i)),n=news(25),seen=[];let newer=false;
 setFetch(path=>{seen.push(path);const u=new URL(path,'http://localhost'),before=u.searchParams.get('before'),start=before?rows.findIndex(s=>s.id===before)+1:0;return {samples:rows.slice(start,start+12),currentRulesHash:'rules',total:newer&&!u.searchParams.has('ceiling')?26:25,ceiling:25,nextCursor:rows[start+12]?rows[start+11].id:null};});
 await render(React.createElement(Review,{news:n,busy:false,mutate(){throw Error('no save');}}));await edit('复核依据与限制','Latest draft');
 await act(async()=>button('下一页留样').click());assert.equal(area('复核依据与限制').value,'');await edit('初筛留样版本',rows[14].id);await edit('复核依据与限制','Older selected draft');
 newer=true;await act(async()=>button('下一页留样').click());assert(button('下一页留样').disabled);assert(document.body.textContent.includes('第 3 页'));
 await act(async()=>button('上一页留样').click());assert.equal(area('初筛留样版本').value,rows[14].id);assert.equal(area('复核依据与限制').value,'Older selected draft');
 await act(async()=>button('刷新初筛复核').click());assert.match(seen.at(-1),/ceiling=25/);assert(document.body.textContent.includes('共 25 份'));
 await act(async()=>button('回到最新留样').click());assert(!seen.at(-1).includes('?'));assert.equal(area('复核依据与限制').value,'Latest draft');assert(document.body.textContent.includes('共 26 份'));
}));
test('late history pages cannot replace a newly selected news revision',()=>ui(async({Review,render,button,area,setFetch})=>{
 const n=news(2),old=sample(crypto.randomUUID(),2),fresh=sample(crypto.randomUUID(),3);let resolve;
 setFetch(path=>path.includes('?')?new Promise(r=>{resolve=r;}):{samples:[n.revision===2?old:fresh],currentRulesHash:'rules',total:13,ceiling:13,nextCursor:old.id});
 const view=()=>React.createElement(Review,{news:{...n},busy:false,mutate(){throw Error('no save');}});
 await render(view());await act(()=>button('下一页留样').click());n.revision=3;await render(view());assert.equal(area('初筛留样版本').value,fresh.id);
 await act(async()=>resolve({samples:[old],currentRulesHash:'rules',total:13,ceiling:13,nextCursor:null}));assert.equal(area('初筛留样版本').value,fresh.id);assert(document.body.textContent.includes('Synthetic title 3'));
}));
