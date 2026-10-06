import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function report(id='saved',count=51){
 const inputs=Array.from({length:count},(_,i)=>({id:String(i),title:`合成历史案例 ${i}`,publisher:'合成测试来源',publishedAt:'2019-06-01',firstSeen:'2026-10-03T00:00:00Z',availableAt:'2026-10-03T00:00:00Z',revision:1,url:i===0?'javascript:alert(1)':i===1?'https://user:secret@example.invalid/':'https://example.invalid/case'}));
 return {id,version:'historical-recall/1',hash:'frozen-hash',frozenAt:'2026-10-04T00:00:00Z',mode:'demo',anchor:{revision:1},inputs,rows:inputs.map(i=>({newsId:i.id,status:'candidate',reasons:['共同机制线索：药品商业准入'],differences:['不能归为同一事件']})),candidateIds:inputs.map(i=>i.id),summary:{candidate:count,no_mechanism:9,anchor:1},coverage:{scanned:count+10,total:count+10,inputScope:'本机当前修订'}};
}
async function harness(run){
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client'),{default:View}=await vite.ssrLoadModule('/src/major/HistoricalRecall.jsx');root=createRoot(document.getElementById('root'));
  const render=(id='anchor',extra={})=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View,{key:id,news:{id,revision:1},...extra}))));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text),click=text=>act(async()=>button(text).click()),choose=id=>act(async()=>{const s=document.querySelector('select');s.value=id;s.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await run({render,button,click,choose,dom});
 }finally{if(root)await act(()=>root.unmount());await vite.close();dom.window.close();for(const name of names){if(before[name]===undefined)delete globalThis[name];else globalThis[name]=before[name];}}
}
test('history UI retries an unknown write unchanged, pages every case and exports the full frozen report',()=>harness(async({render,button,click})=>{
 const frozen=report(),calls=[];let fail=true;
 globalThis.fetch=async(path,options)=>{if(options.method!=='POST')return json({reports:[]});calls.push({path,...JSON.parse(options.body)});if(fail){fail=false;throw Error('响应中断');}return json(frozen);};
 await render();await click('检索并保存历史类比');assert.match(document.querySelector('[role=alert]').textContent,/响应中断/);await click('重试本次检索');assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].revision,1);
 assert.match(document.querySelector('[role=status]').textContent,/61\/61.*51/);assert.match(document.body.textContent,/2019-06-01（仅日期）/);assert.match(document.body.textContent,/离线演示/);assert.equal(document.querySelectorAll('article').length,25);assert.equal(document.querySelectorAll('article a').length,23);
 assert.equal(button('上一页类比').getAttribute('aria-disabled'),'true');await click('上一页类比');assert.match(document.body.textContent,/第1页/);
 await click('下一页类比');assert.equal(document.querySelectorAll('article').length,25);await click('下一页类比');assert.equal(document.querySelectorAll('article').length,1);assert.match(document.querySelector('article').textContent,/合成历史案例 50/);await click('下一页类比');assert.equal(document.querySelectorAll('article').length,1);
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalClick=window.HTMLAnchorElement.prototype.click;let blob,download;
 try{URL.createObjectURL=value=>{blob=value;return 'blob:history-test';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){download=this.download;};await click('导出本次完整检索');assert.equal(download,'historical-recall-saved.json');assert.deepEqual(JSON.parse(await blob.text()),frozen);}finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;window.HTMLAnchorElement.prototype.click=originalClick;}
}));
test('saved history selection remains separate from new retrieval and preserves empty-result denominators',()=>harness(async({render,choose})=>{
 const frozen=report('empty',0),calls=[];
 globalThis.fetch=async(path,options)=>{calls.push(options.method);return json(path.endsWith('/empty')?frozen:{reports:[{id:'empty',frozenAt:frozen.frozenAt,newsRevision:1,candidates:0}]});};
 await render();await choose('empty');assert.match(document.body.textContent,/本次扫描 10\/10/);assert.match(document.body.textContent,/不代表历史上没有同类事件/);assert.match(document.body.textContent,/9/);assert.equal(document.querySelectorAll('article').length,0);assert(calls.every(m=>m==='GET'));
}));
test('late history responses cannot replace another news item or revive its pending write',()=>harness(async({render,click})=>{
 let resolve;globalThis.fetch=async(path,options)=>options.method==='POST'?new Promise(done=>resolve=done):json({reports:[]});
 await render('first');await click('检索并保存历史类比');assert(resolve);await render('second');await act(async()=>resolve(json(report('late'))));assert.equal(document.querySelector('[role=status]'),null);assert.equal(document.querySelector('select'),null);assert.match(document.body.textContent,/检索并保存历史类比/);
}));

test('material history UI uses the material endpoint and displays exact quotes as text with reading scope',()=>harness(async({render,click})=>{
 const frozen=report('body',1),calls=[];frozen.anchor.kind='material';frozen.inputs[0].contentScope='excerpt';frozen.rows[0].quotes={anchor:{inputId:'material:anchor',field:'body',revision:1,start:7,end:55,text:'FDA approves obesity drug. <img src=x>',contentScope:'excerpt'},candidate:{inputId:'0',field:'title',revision:1,start:0,end:8,text:'历史原题',contentScope:'headline-only'}};
 globalThis.fetch=async(path,options)=>{calls.push(path);return json(options.method==='POST'?frozen:{enabled:true,reports:[]});};
 await render('material-view',{material:{id:'material-id',revision:1}});await click('检索并保存历史类比');assert(calls.every(path=>path==='/api/materials/material-id/history-recall'));assert.match(document.body.textContent,/依据材料 v1/);assert.match(document.body.textContent,/部分摘录/);assert.equal(document.querySelectorAll('blockquote').length,2);assert.match(document.querySelector('blockquote').textContent,/<img src=x>/);assert.equal(document.querySelector('img'),null);
}));

test('history comparison fixes the report pair, retries the same request, and returns to the saved page',()=>harness(async({render,click,button})=>{
 const frozen=report('history-report',26),calls=[];frozen.anchor={id:'anchor',title:'本条合成公告',revision:1};let fail=true;
 globalThis.fetch=async(path,options)=>{
  if(path.includes('/comparisons')){calls.push({path,method:options.method,body:options.body&&JSON.parse(options.body)});if(options.method==='POST'){if(fail){fail=false;throw Error('连接中断');}return json({id:'run'});}return json({enabled:true,model:'synthetic',total:0,runs:[]});}
  if(path==='/api/semantic-events/run')return json({id:'run',status:'failed',createdAt:frozen.frozenAt,packet:{inputHash:'hash',input:{left:{title:'本条合成公告'},right:{title:'合成历史案例 25'}}},failure:{message:'合成失败记录'}});
  return json(options.method==='POST'?frozen:{enabled:true,reports:[]});
 };
 await render();await click('检索并保存历史类比');await click('下一页类比');await click('用 Codex 核对这对类比');
 for(let i=0;i<60&&!button('比较所选输入');i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
 assert(button('比较所选输入'));assert.equal(button('选择左侧新闻'),undefined);assert.equal(button('持久比较批次'),undefined);assert.match(document.body.textContent,/本条合成公告/);assert.match(document.body.textContent,/合成历史案例 25/);
 await click('比较所选输入');assert.match(document.querySelector('[role=alert]').textContent,/连接中断/);await click('重试本次比较');
 const writes=calls.filter(c=>c.method==='POST');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].body.candidateId,'25');assert.equal(writes[0].body.reportHash,frozen.hash);assert.equal(writes[0].path,'/api/historical-recall/history-report/comparisons');assert.match(document.body.textContent,/合成失败记录/);
 await click('返回历史类比');assert.match(document.body.textContent,/第2页/);assert.equal(document.querySelector('select').value,'history-report');assert.equal(document.querySelectorAll('article').length,1);
}));

test('unmatched history filter pages every eligible miss, keeps original counts and returns from fixed-pair review',()=>harness(async({render,choose,click,button})=>{
 const frozen=report('mixed',1),calls=[];frozen.anchor={id:'anchor',title:'本条合成公告',revision:1};
 const misses=Array.from({length:26},(_,i)=>({id:`miss-${i}`,title:`未命中资料 ${i}`,publisher:'虚构来源',publishedAt:'2020-01-01',revision:1,url:'https://example.invalid/miss'}));
 const excluded=['anchor','invalid_time','future_input','not_earlier','same_source','duplicate_title'];
 frozen.inputs.push(...misses,...excluded.map(status=>({id:`excluded-${status}`,title:`排除资料 ${status}`,revision:1})));
 frozen.rows.push(...misses.map((i,n)=>({newsId:i.id,status:n%2?'no_context':'no_mechanism'})),...excluded.map(status=>({newsId:`excluded-${status}`,status})));
 frozen.summary={candidate:1,no_mechanism:13,no_context:13,...Object.fromEntries(excluded.map(status=>[status,1]))};frozen.coverage={...frozen.coverage,total:33,scanned:33};
 let fail=true;
 globalThis.fetch=async(path,options)=>{
  calls.push({path,method:options.method,body:options.body&&JSON.parse(options.body)});
  if(path.includes('/comparisons')){if(options.method==='POST'){if(fail){fail=false;throw Error('结果响应中断');}return json({id:'miss-run'});}return json({enabled:true,model:'synthetic',total:0,runs:[]});}
  if(path==='/api/semantic-events/miss-run')return json({id:'miss-run',status:'failed',createdAt:frozen.frozenAt,packet:{inputHash:'hash',input:{left:{title:frozen.anchor.title},right:{title:'未命中资料 25'}}},failure:{message:'合成失败记录'}});
  if(path.endsWith('/mixed')||options.method==='POST')return json(frozen);
  return json({enabled:true,reports:[{id:'mixed',frozenAt:frozen.frozenAt,newsRevision:1,candidates:1}]});
 };
 const filter=value=>act(async()=>{const s=document.querySelector('[aria-label="历史结果范围"]');s.value=value;s.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await render();await choose('mixed');assert.equal(document.querySelectorAll('article').length,1);
 const select=document.querySelector('[aria-label="历史结果范围"]');assert.match(select.textContent,/规则命中（1）.*规则未命中，待复核（26）/);
 await filter('missed');assert.equal(document.querySelectorAll('article').length,25);assert.match(document.querySelector('[role=status]').textContent,/33\/33.*找到 1/);assert.match(document.querySelector('article').textContent,/原检索结果：未命中共同机制/);assert(!document.querySelector('.source-news-list').textContent.includes('排除资料'));
 assert.equal(calls.filter(c=>c.method==='POST').length,0);await click('下一页类比');assert.equal(document.querySelectorAll('article').length,1);assert.match(document.querySelector('article').textContent,/未命中资料 25/);
 await click('用 Codex 核对这条未命中');for(let i=0;i<60&&!button('比较所选输入');i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
 assert.match(document.body.textContent,/原检索结果：缺少共同领域或发行人依据/);assert.equal(button('选择右侧新闻'),undefined);assert.equal(calls.filter(c=>c.method==='POST').length,0);
 await click('比较所选输入');await click('重试本次比较');const writes=calls.filter(c=>c.method==='POST');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].body.candidateId,'miss-25');assert.deepEqual(Object.keys(writes[0].body).sort(),['candidateId','reportHash','requestId']);
 await click('返回历史类比');assert.equal(document.querySelector('[aria-label="历史结果范围"]').value,'missed');assert.match(document.body.textContent,/第2页/);assert.match(document.querySelector('[role=status]').textContent,/找到 1/);
 await filter('candidate');assert.match(document.body.textContent,/第1页/);assert.equal(document.querySelectorAll('article').length,1);
 await filter('missed');await click('下一页类比');await choose('mixed');assert.equal(document.querySelector('[aria-label="历史结果范围"]').value,'candidate');assert.match(document.body.textContent,/第1页/);
 await filter('missed');await click('下一页类比');await click('检索并保存历史类比');assert.equal(document.querySelector('[aria-label="历史结果范围"]').value,'candidate');assert.match(document.body.textContent,/第1页/);
}));
