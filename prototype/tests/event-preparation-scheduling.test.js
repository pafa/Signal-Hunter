import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,output,dossier,at} from './automatic-research-fixture.mjs';
import {SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {secSubmissionsUrl} from '../server/financial-filing-material.mjs';
import {filingMap,filingIndex,quarterlyUrl,syntheticFilingHtml} from './helpers/financial-filing-fixture.mjs';

const stageKey='research_pipeline_event_next_kind',turnKey='research_pipeline_event_preparation_turn';
function make({path,multiple=false,financial=true,fetcher}={}){
 const order=[],requests=[],packets=[];
 const names=multiple?['NVIDIA','Meta']:['NVIDIA'];
 const quotes=Array.from({length:12},(_,i)=>`${names.join('、')} 拟合作虚构项目${i+1}，仍需批准。`);
 const response=url=>{
  if(url===SEC_TICKERS_URL)return Response.json(filingMap);
  if(url===secFactsUrl('0001045810'))return Response.json({cik:1045810,entityName:'NVIDIA CORP',facts:{'us-gaap':{Revenues:{units:{USD:[{val:100,start:'2026-04-27',end:'2026-07-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}}});
  if(url===secSubmissionsUrl('0001045810'))return Response.json(filingIndex());
  if(url===quarterlyUrl)return new Response(syntheticFilingHtml,{headers:{'content-type':'text/html'}});
  if(url.includes('eastmoney.com'))return Response.json({data:null});
  const u=new URL(url),symbol=u.pathname.split('/').at(-1),interval=u.searchParams.get('interval');
  assert(['NVDA','META'].includes(symbol),url);
  return Response.json({chart:{result:[{meta:{symbol,currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[Date.parse(interval==='1d'?'2026-10-07T13:30:00Z':'2026-10-07T19:59:00Z')/1000],indicators:{quote:[{close:[100],volume:[1000]}]}}]}});
 };
 const f=fixture({path,sourceReader:async url=>({url,title:'合成多事项公告',sourceName:'合成',body:quotes.join('\n')+'仅用于调度测试，不代表真实事件。'.repeat(30),scope:'extracted-text'}),
  extractionRunner:p=>{order.push('extract');return output(p,'decomposition',{events:quotes.map((quote,i)=>({title:`合成合作 ${i+1}`,actor:names.join('、'),action:'拟合作',object:`虚构项目${i+1}`,stage:'待批准',eventTime:'未知',quote,quoteField:'body',boundaryReason:'不同合作项目，分别保留',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'})),scopeNote:'合成调度输入',missingEvidence:['事实核验']});},
  identityRunner:p=>{order.push('identity');return output(p,'resolution',{mentions:names.map(name=>({name,quote:p.input.eventFocus.quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:[name==='NVIDIA'?'NVDA.US':'META.US'],reason:'合成目录对应'})),scopeNote:'合成',missingEvidence:['上市身份核验']});},
  researchRunner:p=>{order.push('dossier');packets.push(p);return dossier(p);},
  fetcher:async(url,options)=>{requests.push(url);return fetcher?fetcher(url,options,response):response(url);}});
 f.queue.configure({...f.queue.snapshot().settings,researchPrices:true,financialSources:financial});
 return {...f,order,requests,packets};
}
const setting=(f,key)=>f.store.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
const job=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' ORDER BY rowid LIMIT 1").get();
const payload=f=>JSON.parse(job(f).payload);
const ready=f=>f.service.research.list().some(t=>t.eventExtraction&&t.dossier);

test('day, minute and financial preparation reach a saved dossier within three shared model calls',async()=>{
 const f=make();try{const paper=f.service.paper.snapshot();f.queue.configure({...f.queue.snapshot().settings,dailyCalls:3});f.add(1);await f.drive(32);
  assert(ready(f),'the shared allowance must reach a complete dossier, not another identity');
  assert.deepEqual(f.order,['extract','identity','dossier']);assert.equal(f.queue.snapshot().callsInLast24Hours,3);
  assert.equal(payload(f).prices.results.length,2);assert.equal(payload(f).financial.results[0].status,'saved');
  assert.equal(f.packets[0].input.financialSources[0].symbol,'NVDA.US');assert.equal(setting(f,turnKey),undefined);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='identity' AND status='queued'").get().n,11);
  assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
 }finally{await f.close();}
});

test('new articles still reach extraction after an already identified single-company dossier',async()=>{
 const f=make();try{f.add(1);await f.until(()=>!!job(f));f.add(2);await f.until(()=>f.calls.extract>=2&&f.calls.dossier>=2);
  assert.deepEqual(f.order.slice(0,3),['extract','identity','dossier']);
  assert(f.order.slice(3).includes('extract'));assert(f.calls.identity<12);assert.equal(f.calls.extract,2);
 }finally{await f.close();}
});

test('a multi-company dossier yields after three preparation attempts and later finishes its remaining inputs',async()=>{
 const f=make({multiple:true,financial:false});try{f.add(1);await f.until(()=>!!job(f));f.add(2);
  await f.until(()=>payload(f).prices?.results.length===3);
  assert.deepEqual(f.order,['extract','identity']);assert.equal(JSON.parse(setting(f,turnKey)).steps,3);
  const requests=f.requests.length;await f.until(()=>setting(f,stageKey)==='extract');
  assert.equal(f.requests.length,requests,'yield does not start a fourth preparation');assert.equal(setting(f,turnKey),undefined);
  await f.until(()=>ready(f)&&f.calls.extract>=2);assert.equal(payload(f).prices.results.length,4);
  assert(f.order.indexOf('identity',2)<f.order.indexOf('dossier'));assert(f.calls.identity<12);
 }finally{await f.close();}
});

test('a reserved preparation turn survives restart, pause, occupancy and exhausted rolling allowance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'event-preparation-')),path=join(dir,'test.sqlite');let f=make({path});
 try{f.add(1);await f.until(()=>!!job(f)&&payload(f).prices?.results.length===1);
  const turn=setting(f,turnKey),before=job(f).payload;assert.equal(JSON.parse(turn).steps,1);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:2});f.service.controlOperation('discovery','pause');await f.close();f=make({path});
  assert.throws(()=>f.service.runOperation('discovery'),/暂停/);await f.drive(3);
  assert.deepEqual(f.requests,[]);assert.deepEqual(f.order,[]);assert.equal(setting(f,turnKey),turn);assert.equal(job(f).payload,before);
  f.advance(86400001);f.store.db.prepare('INSERT INTO model_job_lease VALUES(1,?,?)').run('synthetic-occupancy',Date.parse(at)+86401001);
  await f.drive(3);assert.deepEqual(f.requests,[]);assert.equal(setting(f,turnKey),turn);
  f.store.db.prepare('DELETE FROM model_job_lease WHERE owner=?').run('synthetic-occupancy');await f.until(()=>ready(f));
  assert.deepEqual(f.order,['dossier']);assert.equal(payload(f).prices.results.length,2);assert.equal(payload(f).financial.results[0].status,'saved');assert.equal(setting(f,turnKey),undefined);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

for(const failure of ['price','financial'])test(`${failure} backoff releases the preparation turn immediately without erasing attempts`,async()=>{
 let failed=false;const f=make({fetcher:(url,options,response)=>{
  if(!failed&&(failure==='financial'?url===SEC_TICKERS_URL:url.includes('finance.yahoo.com'))){failed=true;return Response.json({});}return response(url);
 }});
 try{f.add(1);await f.until(()=>!!job(f)&&!!payload(f).retryAt);
  const before=payload(f),field=failure==='price'?'prices':'financial';assert.equal(before[field].attempts.filter(a=>a.state==='started').length,1);
  assert.equal(setting(f,stageKey),'extract');assert.equal(setting(f,turnKey),undefined);assert.equal(f.calls.dossier,0);
  await f.until(()=>f.calls.identity>=2);assert.equal(payload(f).retryAt,before.retryAt);assert.deepEqual(payload(f)[field],before[field]);
 }finally{await f.close();}
});

test('preparation reservation and model dispatch persistence failures do not lose the turn or spend a call',async()=>{
 const f=make();try{f.add(1);await f.until(()=>!!job(f));const before=job(f).payload;
  f.store.db.exec(`CREATE TRIGGER fail_prepare BEFORE INSERT ON settings WHEN NEW.key='${turnKey}' BEGIN SELECT RAISE(ABORT,'synthetic-preparation-write'); END`);
  await f.step();assert.equal(job(f).payload,before);assert.equal(f.requests.length,0);assert.equal(setting(f,turnKey),undefined);assert.equal(setting(f,stageKey),'dossier');
  f.store.db.exec('DROP TRIGGER fail_prepare');await f.until(()=>!!payload(f).financial?.results.length);
  const turn=setting(f,turnKey),attempts=f.store.db.prepare('SELECT * FROM research_pipeline_attempts').all();assert.equal(JSON.parse(turn).steps,3);
  f.store.db.exec(`CREATE TRIGGER fail_dispatch BEFORE INSERT ON settings WHEN NEW.key='${stageKey}' AND NEW.value='extract' BEGIN SELECT RAISE(ABORT,'synthetic-dispatch-write'); END`);
  await f.step();assert.equal(f.calls.dossier,0);assert.equal(setting(f,turnKey),turn);assert.equal(setting(f,stageKey),'dossier');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_attempts').all(),attempts);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_runs').get().n,0);
  const requests=f.requests.length;f.store.db.exec('DROP TRIGGER fail_dispatch');await f.until(()=>ready(f));
  assert.equal(f.requests.length,requests);assert.deepEqual(f.order,['extract','identity','dossier']);assert.equal(setting(f,turnKey),undefined);
 }finally{await f.close();}
});

test('pausing during input I/O preserves the reserved attempt and cannot expand the preparation bound on resume',async()=>{
 let release,entered,first=true;const enteredP=new Promise(r=>entered=r);
 const f=make({financial:false,multiple:true,fetcher:async(url,options,response)=>{if(first){first=false;entered();await new Promise(r=>release=r);}return response(url);}});
 try{f.add(1);await f.until(()=>!!job(f));const before=f.service.research.get(job(f).topic_id);
  const running=f.step();await enteredP;f.service.controlOperation('discovery','pause');release();await running;
  assert.deepEqual(f.service.research.get(job(f).topic_id),before);assert.equal(JSON.parse(setting(f,turnKey)).steps,1);assert.equal(f.calls.dossier,0);
  await f.until(()=>payload(f).prices?.results.length===2);assert.equal(JSON.parse(setting(f,turnKey)).steps,3);
  const requests=f.requests.length;await f.until(()=>setting(f,stageKey)==='extract');assert.equal(f.requests.length,requests);assert.equal(setting(f,turnKey),undefined);
  await f.until(()=>ready(f));assert.equal(payload(f).prices.results.length,4);assert.equal(payload(f).prices.attempts.filter(a=>a.symbol==='NVDA.US'&&a.interval==='1d'&&a.state==='started').length,2);
 }finally{release?.();await f.close();}
});
