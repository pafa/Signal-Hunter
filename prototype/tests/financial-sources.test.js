import test from 'node:test';
import assert from 'node:assert/strict';
import {financialMaterial,secIssuer,SEC_TICKERS_URL,secFactsUrl,financialDigest} from '../server/financial-source-material.mjs';
import {immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {secSubmissionsUrl} from '../server/financial-filing-material.mjs';
import {filingIndex,syntheticFilingHtml,quarterlyUrl} from './helpers/financial-filing-fixture.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';

const receivedAt='2026-10-08T00:00:00.000Z',map={0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA CORP'}};
const fact=(patch={})=>({val:200,end:'2026-07-26',start:'2026-01-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2',...patch});
const raw=()=>({cik:1045810,entityName:'NVIDIA CORP',facts:{'us-gaap':{Revenues:{units:{USD:[fact(),fact({val:100,start:'2026-04-27'})]}},CashAndCashEquivalentsAtCarryingValue:{units:{USD:[fact({val:80,start:undefined})]}}}}});
const documents=(f=raw(),m=map)=>[{url:SEC_TICKERS_URL,receivedAt,body:Buffer.from(JSON.stringify(m))},{url:secFactsUrl('0001045810'),receivedAt,body:Buffer.from(JSON.stringify(f))}];
function publicResponse(url){
 if(url===quarterlyUrl)return new Response(syntheticFilingHtml,{headers:{'Content-Type':'text/html'}});
 return new Response(JSON.stringify(url===SEC_TICKERS_URL?map:url===secSubmissionsUrl('0001045810')?filingIndex():raw()),{headers:{'Content-Type':'application/json'}});
}
const words='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。';
function make({fetcher,financial=true,path}={}){
 const requests=[],packets=[];
 const f=fixture({path,fetcher:async(url,options)=>{requests.push(url);assert.equal(options.redirect,'error');assert.match(options.headers['User-Agent'],/SignalHunter/);return fetcher?fetcher(url,options):publicResponse(url);},
 sourceReader:async url=>({url,title:'NVIDIA合成回购公告',sourceName:'合成',body:words+'这些文字仅测试财务补证流程。'.repeat(40),scope:'extracted-text'}),
 extractionRunner:p=>output(p,'decomposition',{events:[{title:'NVIDIA合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote:words,quoteField:'body',boundaryReason:'具体回购事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']}),
 identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:words,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成测试使用冻结别名'}],scopeNote:'合成',missingEvidence:['历史身份']}),
 researchRunner:p=>{packets.push(p);return dossier(p);}});
 if(financial){const s=f.queue.snapshot().settings;f.queue.configure({...s,financialSources:true});}
 return {...f,requests,packets};
}
const event=f=>f.service.research.list().find(t=>t.eventExtraction);
const ready=async f=>{f.add(1);await f.until(()=>f.queue.snapshot().events.items.some(j=>j.kind==='dossier'&&j.status==='queued'));};

test('financial projection keeps actual periods, units, amendments and same-day conflicts without TTM or assumed zero',()=>{
 const r=raw();r.facts['us-gaap'].Revenues.units.USD.push(fact({val:250,filed:'2026-09-01',form:'10-Q/A',accn:'0001045810-26-000076'}),fact({val:260,filed:'2026-09-01',form:'10-Q/A',accn:'0001045810-26-000077'}),fact({val:999,filed:'2026-10-09'}));r.facts['us-gaap'].Revenues.units.EUR=[fact({val:180})];
 const m=financialMaterial('NVDA.US',documents(r)),facts=m.financialSource.selected;
 assert.equal(m.scope,'excerpt');assert.equal(m.publishedAt,null);assert(facts.some(f=>f.start==='2026-01-26'&&f.value===250));assert(facts.some(f=>f.start==='2026-04-27'&&f.value===100));assert(facts.some(f=>f.value===260));assert(facts.some(f=>f.unit==='EUR'));assert(!facts.some(f=>f.value===200||f.value===999));assert(!facts.some(f=>f.tag==='NetIncomeLoss'));assert.equal(m.financialSource.sources[1].receivedAt,receivedAt);assert.match(m.body,/不能把累计期间直接当季度/);
});
test('mapping ambiguity, mismatched issuer, unsupported securities and empty fact coverage remain gaps',()=>{
 assert.throws(()=>secIssuer('NVDA.US',documents(raw(),{...map,1:{...map[0],cik_str:9}})[0].body),/不唯一/);
 assert.throws(()=>financialMaterial('NVDA.US',documents({...raw(),cik:9})),/身份不一致/);
 assert.throws(()=>financialMaterial('00700.HK',documents()),/美国上市证券/);
 assert.throws(()=>financialMaterial('NVDA.US',documents({...raw(),facts:{}})),/没有/);
});
test('automatic issuer evidence reaches the same event dossier and survives immutable reads without changing accounts',async()=>{
 const f=make();try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!event(f)?.dossier);const t=event(f),p=f.packets[0];
  assert.deepEqual(f.requests,[SEC_TICKERS_URL,secFactsUrl('0001045810'),secSubmissionsUrl('0001045810'),quarterlyUrl]);assert.equal(t.financialSources[0].status,'saved');assert.equal(f.calls.dossier,1);assert.equal(p.input.financialSources[0].symbol,'NVDA.US');assert.equal(t.evidence.length,3);assert.equal(t.eventExtraction.event.quote,words);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
  const material=p.input.evidence.find(e=>e.material?.financialSource).material;assert.equal(material.method,'public-financial');assert.equal(immutableMaterialSnapshot(f.store.db,material).body,material.body);assert.match(material.body,/USD 200/);assert.equal(t.dossier.sourceModelRun.inputHash,p.inputHash);
  const filing=p.input.evidence.find(e=>e.material?.filingSource).material;assert.equal(filing.method,'public-filing');assert.equal(immutableMaterialSnapshot(f.store.db,filing).body,filing.body);assert.match(filing.body,/不是全文、附件/);assert.equal(p.input.financialSources[0].filings[0].materialId,filing.id);
  await f.drive(6);assert.equal(f.requests.length,4);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
  const source=material.financialSource.sources[1];f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),source.sha256);assert.throws(()=>immutableMaterialSnapshot(f.store.db,material),/原始响应校验失败/);
 }finally{await f.close();}
});
test('existing settings omit new financial requests; omitted field preserves a saved one-time choice',async()=>{
 const f=make({financial:false});try{assert.equal(f.queue.snapshot().settings.financialSources,false);f.add(1);await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,0);assert.equal(event(f).financialSources,undefined);const s=f.queue.snapshot().settings;f.queue.configure({...s,financialSources:true});const n=f.queue.snapshot().settings;f.queue.configure({version:n.version,dailyCalls:n.dailyCalls,includeClues:n.includeClues});assert.equal(f.queue.snapshot().settings.financialSources,true);}finally{await f.close();}
});
test('HTTP restriction is cooled, bounded retries finish as a dossier gap rather than a manual task',async()=>{
 const f=make({fetcher:()=>new Response('Restricted',{status:403})});try{await ready(f);await f.drive(3);assert.equal(f.requests.length,1);assert.equal(f.calls.dossier,0);f.advance(60001);await f.drive(3);assert.equal(f.requests.length,1);f.advance(120001);await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,1);assert.equal(event(f).financialSources[0].status,'unavailable');assert.match(f.packets[0].input.financialSources[0].reason,/三次/);assert.equal(f.queue.snapshot().events.items.find(j=>j.kind==='dossier').financial.attempts.filter(a=>a.state==='started').length,3);await f.drive(4);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);}finally{await f.close();}
});
test('research, raw-linked material and refreshed model packet roll back together, then reuse saved response',async()=>{
 const f=make();try{await ready(f);const before=event(f);f.store.db.exec(`CREATE TRIGGER fail_financial_job BEFORE UPDATE ON research_pipeline_event_jobs WHEN json_extract(NEW.payload,'$.financial.results[0].status')='saved' BEGIN SELECT RAISE(ABORT,'financial atomic fixture'); END`);
  let failed=false;for(let i=0;i<6;i++){const res=await f.step();if(res.error){failed=true;break;}}assert(failed);assert.deepEqual(event(f),before);assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM research_materials WHERE json_extract(payload,'$.method') IN ('public-financial','public-filing')").get().n,0);assert.equal(f.calls.dossier,0);assert.equal(f.requests.length,4);
  f.store.db.exec('DROP TRIGGER fail_financial_job');await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,4);assert.equal(event(f).financialSources[0].status,'saved');assert.equal(f.packets[0].input.evidence.length,3);
 }finally{await f.close();}
});
test('pause during an external financial read prevents attaching or starting a dossier, then resumes',async()=>{
 let release,entered;const enteredP=new Promise(r=>entered=r);let first=true;
 const f=make({fetcher:async url=>{if(first){first=false;entered();await new Promise(r=>release=r);}return publicResponse(url);}});
 try{await ready(f);const before=event(f);let pending;for(let i=0;i<4;i++){pending=f.step();const state=await Promise.race([enteredP.then(()=>true),pending.then(()=>false)]);if(state)break;}await enteredP;f.service.controlOperation('discovery','pause');release();await pending;assert.deepEqual(event(f),before);assert.equal(f.calls.dossier,0);await f.until(()=>!!event(f)?.dossier);assert.equal(event(f).financialSources[0].status,'saved');}finally{release?.();await f.close();}
});

test('three persisted interrupted attempts do not restart an unbounded fourth fetch after recovery',async()=>{
 const f=make();try{await ready(f);const row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier'").get(),p=JSON.parse(row.payload);p.financial={results:[],attempts:[1,2,3].map(attempt=>({symbol:'NVDA.US',state:'started',attempt,at:receivedAt}))};f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);
  await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,0);assert.equal(event(f).financialSources[0].status,'unavailable');assert.match(event(f).financialSources[0].reason,/含中断/);
 }finally{await f.close();}
});
test('turning the source off before a queued dossier avoids fetching and preserves its original evidence',async()=>{
 const f=make();try{await ready(f);const s=f.queue.snapshot().settings;f.queue.configure({...s,financialSources:false});await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,0);assert.equal(event(f).evidence.length,1);assert.equal(event(f).financialSources,undefined);}finally{await f.close();}
});

test('automatic financial material is readable in the existing source UI, including retained attempts without a URL',async()=>{
 const f=make();let vite,dom,root,act,before;
 try{
  f.add(1);await f.until(()=>!!event(f)?.dossier);const topic=event(f),api=f.service.research;
  const list=api.materialList(topic.id,{view:'summary'});assert.equal(list.attempts[0].url,secFactsUrl('0001045810'));
  const row=f.store.db.prepare('SELECT id,payload FROM research_source_attempts WHERE topic_id=? ORDER BY id DESC LIMIT 1').get(topic.id),legacy=JSON.parse(row.payload);delete legacy.url;
  const legacyText=JSON.stringify(legacy);f.store.db.prepare('UPDATE research_source_attempts SET payload=? WHERE id=?').run(legacyText,row.id);
  const projected=api.materialList(topic.id,{view:'summary'});assert.equal(projected.attempts[0].url,secFactsUrl('0001045810'));assert.equal(f.store.db.prepare('SELECT payload FROM research_source_attempts WHERE id=?').get(row.id).payload,legacyText);
  const React=await import('react');act=React.act;const {createServer}=await import('vite'),{JSDOM}=await import('jsdom'),{fileURLToPath}=await import('node:url');
  vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
  before=new Map(['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const {default:Source}=await vite.ssrLoadModule('/src/major/SourceResearch.jsx');
  globalThis.fetch=async path=>new Response(JSON.stringify(path.endsWith('/materials?view=summary')?projected:path.includes('/materials/')?api.materialDetail(topic.id,path.split('/').at(-1)):{enabled:false,runs:[],items:[],attempts:[],materials:[],history:[],search:{total:0,items:[]}}),{headers:{'content-type':'application/json'}});
  await act(async()=>root.render(React.createElement(Source,{topic,busy:false,instanceId:'financial-ui',mutate(){throw Error('read only');}})));
  assert.equal(document.querySelector('[role="alert"]'),null);assert.equal(document.querySelectorAll('.source-item').length,3);
  const item=[...document.querySelectorAll('.source-item')].find(el=>el.textContent.includes('SEC财务披露选摘'));await act(async()=>{item.open=true;item.dispatchEvent(new dom.window.Event('toggle'));});
  assert.match(item.textContent,/官方财务数据选摘/);assert.match(item.textContent,/CIK 0001045810/);assert.match(item.querySelector('.source-body').textContent,/USD 200/);
  await act(async()=>{item.open=false;item.dispatchEvent(new dom.window.Event('toggle'));});assert.equal(item.querySelector('.source-body'),null);
  const filingItem=[...document.querySelectorAll('.source-item')].find(el=>el.textContent.includes('10-Q 原文选段'));await act(async()=>{filingItem.open=true;filingItem.dispatchEvent(new dom.window.Event('toggle'));});assert.match(filingItem.textContent,/完整HTML/);assert.match(filingItem.textContent,/附件与未选内容尚未分析/);assert.match(filingItem.querySelector('.source-body').textContent,/r2 c2 td/);
 }finally{if(root)await act(()=>root.unmount());if(before)for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom?.window.close();if(vite)await vite.close();await f.close();}
});

for(const failing of ['directory','filing'])test(`partial ${failing} failure retries twice, then preserves facts and an explicit gap without manual work`,async()=>{
 const bad=failing==='directory'?secSubmissionsUrl('0001045810'):quarterlyUrl;
 const f=make({fetcher:url=>url===bad?new Response('temporarily unavailable',{status:503}):publicResponse(url)});
 try{await ready(f);await f.drive(3);assert.equal(f.calls.dossier,0);assert.equal(event(f).financialSources,undefined);f.advance(60001);await f.drive(3);assert.equal(f.calls.dossier,0);f.advance(120001);await f.until(()=>!!event(f)?.dossier);
  const result=event(f).financialSources[0];assert.equal(result.status,'saved');assert.equal(result.filings.length,1);assert.equal(result.filings[0].status,'unavailable');assert.equal(result.filings[0].url,bad);assert.equal(f.packets[0].input.evidence.length,2);assert.equal(f.packets[0].input.financialSources[0].filings[0].status,'unavailable');assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);const count=f.requests.length;await f.drive(6);assert.equal(f.requests.length,count);assert.equal(f.calls.dossier,1);
 }finally{await f.close();}
});

test('a failed second filing preserves the first full original and the facts on the final bounded attempt',async()=>{
 const current='https://www.sec.gov/Archives/edgar/data/1045810/000119312526000076/current.htm';
 const f=make({fetcher:url=>url===current?new Response('unavailable',{status:503}):url===secSubmissionsUrl('0001045810')?new Response(JSON.stringify(filingIndex({both:true}))):publicResponse(url)});
 try{await ready(f);await f.drive(3);assert.equal(f.calls.dossier,0);f.advance(60001);await f.drive(3);f.advance(120001);await f.until(()=>!!event(f)?.dossier);const r=event(f).financialSources[0];assert.deepEqual(r.filings.map(x=>x.status),['saved','unavailable']);assert.equal(f.packets[0].input.evidence.length,3);assert.equal(f.packets[0].input.evidence.filter(e=>e.material?.filingSource).length,1);assert.equal(f.requests.filter(x=>x===quarterlyUrl).length,1);assert.equal(f.requests.filter(x=>x===secFactsUrl('0001045810')).length,1);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);}finally{await f.close();}
});

test('linked filing exhibits automatically enter the same frozen dossier without following their nested links',async()=>{
 const url=quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),linked=syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Synthetic release</a></body>');
 const f=make({fetcher:u=>u===quarterlyUrl?new Response(linked,{headers:{'content-type':'text/html'}}):u===url?new Response(syntheticFilingHtml.replace('</body>','<a href="nested.htm">Do not crawl</a></body>'),{headers:{'content-type':'text/html'}}):publicResponse(u)});
 try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!event(f)?.dossier);const t=event(f),entry=t.financialSources[0].filings.find(x=>x.kind==='exhibit'),material=f.packets[0].input.evidence.find(e=>e.material?.filingSource?.exhibit).material;
  assert.equal(t.evidence.length,4);assert.equal(entry.status,'saved');assert.equal(entry.materialId,material.id);assert.equal(entry.parentUrl,quarterlyUrl);assert.equal(material.filingSource.sources.length,4);assert.equal(immutableMaterialSnapshot(f.store.db,material).body,material.body);assert.equal(f.requests.length,5);assert.equal(f.requests.at(-1),url);assert(!f.requests.some(x=>x.endsWith('nested.htm')));assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});
test('unavailable linked exhibits retry within the original policy and end as explicit gaps while primary evidence survives',async()=>{
 const url=quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),linked=syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Synthetic release</a></body>');
 const f=make({fetcher:u=>u===quarterlyUrl?new Response(linked,{headers:{'content-type':'text/html'}}):u===url?new Response('Restricted',{status:403}):publicResponse(u)});
 try{await ready(f);await f.drive(3);assert.equal(f.calls.dossier,0);f.advance(60001);await f.drive(3);f.advance(120001);await f.until(()=>!!event(f)?.dossier);const result=event(f).financialSources[0];assert.equal(result.status,'saved');assert.deepEqual(result.filings.map(x=>x.status),['saved','unavailable']);assert.equal(result.filings[1].kind,'exhibit');assert.equal(result.filings[1].url,url);assert.equal(f.packets[0].input.evidence.length,3);assert.equal(f.requests.filter(x=>x===quarterlyUrl).length,1);assert.equal(f.requests.filter(x=>x===url).length,1);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});

test('pause during an exhibit request cannot attach late evidence and resume keeps the original bounded pipeline',async()=>{
 let release,entered;const enteredP=new Promise(r=>entered=r);let first=true;
 const url=quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),linked=syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Synthetic release</a></body>');
 const f=make({fetcher:async u=>{if(u===url){if(first){first=false;entered();await new Promise(r=>release=r);}return new Response(syntheticFilingHtml,{headers:{'content-type':'text/html'}});}return u===quarterlyUrl?new Response(linked,{headers:{'content-type':'text/html'}}):publicResponse(u);}});
 try{await ready(f);const before=event(f);let pending;for(let i=0;i<4;i++){pending=f.step();if(await Promise.race([enteredP.then(()=>true),pending.then(()=>false)]))break;}await enteredP;f.service.controlOperation('discovery','pause');release();await pending;assert.deepEqual(event(f),before);assert.equal(f.calls.dossier,0);await f.until(()=>!!event(f)?.dossier);assert.equal(event(f).evidence.length,4);assert.equal(event(f).financialSources[0].filings[1].status,'saved');assert.equal(f.requests.filter(u=>u===quarterlyUrl).length,1);
 }finally{release?.();await f.close();}
});
