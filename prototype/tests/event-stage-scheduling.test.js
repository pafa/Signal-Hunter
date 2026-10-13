import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,output,dossier,at} from './automatic-research-fixture.mjs';

const key='research_pipeline_event_next_kind';
const quotes=Array.from({length:12},(_,i)=>`Meta 拟收购虚构标的${i+1}，仍需批准。`);
function make({path,failIdentity=false,prices=false}={}){
 const order=[],requests=[];
 const f=fixture({path,sourceReader:async url=>({url,title:'合成多事项公告',sourceName:'合成',body:quotes.join('\n')+'仅用于调度测试，不代表真实事件。'.repeat(30),scope:'extracted-text'}),
  extractionRunner:p=>{order.push('extract');return output(p,'decomposition',{events:quotes.map((quote,i)=>({title:`合成收购 ${i+1}`,actor:'Meta',action:'拟收购',object:`虚构标的${i+1}`,stage:'待批准',eventTime:'未知',quote,quoteField:'body',boundaryReason:'不同收购对象，分别保留',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'})),scopeNote:'合成调度输入',missingEvidence:['事实核验']});},
  identityRunner:p=>{order.push('identity');if(failIdentity&&order.filter(x=>x==='identity').length===1)throw Error('synthetic-identity-failure');return output(p,'resolution',{mentions:[{name:'Meta',quote:p.input.eventFocus.quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['META.US'],reason:'合成目录对应'}],scopeNote:'合成',missingEvidence:['上市身份核验']});},
  researchRunner:p=>{order.push('dossier');return dossier(p);},
  fetcher:async url=>{requests.push(url);if(url.includes('eastmoney.com'))return Response.json({data:null});const interval=new URL(url).searchParams.get('interval');return Response.json({chart:{result:[{meta:{symbol:'META',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[Date.parse(interval==='1d'?'2026-10-07T13:30:00Z':'2026-10-07T19:59:00Z')/1000],indicators:{quote:[{close:[100],volume:[1000]}]}}]}});}});
 if(prices)f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});
 return {...f,order,requests};
}
const saved=f=>f.store.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
const queuedDossier=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='queued' ORDER BY rowid LIMIT 1").get();
const readyDossier=f=>f.service.research.list().some(t=>t.eventExtraction&&t.dossier);

test('a multi-event source produces a dossier within three calls instead of draining its quota on identities',async()=>{
 const f=make();try{
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:3});const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>readyDossier(f));
  assert.deepEqual(f.order,['extract','identity','dossier']);assert.equal(f.queue.snapshot().callsInLast24Hours,3);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='identity' AND status='queued'").get().n,11);
  assert.equal(f.service.research.list().filter(t=>t.eventExtraction).length,12,'all extracted matters remain available');
  const before=saved(f);await f.drive(5);assert.equal(saved(f),before);assert.deepEqual(f.order,['extract','identity','dossier']);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});

test('new source extraction and old dossiers both advance before a large identity backlog is exhausted',async()=>{
 const f=make();try{f.add(1);await f.until(()=>!!queuedDossier(f));f.add(2);await f.until(()=>f.calls.extract===2&&f.calls.dossier>=2);
  assert(f.calls.identity<12,JSON.stringify(f.order));assert(f.order.slice(f.order.indexOf('dossier')+1).includes('extract'));
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='extract'").get().n,2);
 }finally{await f.close();}
});

test('the next stage survives restart; pause, model occupancy and the rolling allowance do not consume it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'event-stage-')),path=join(dir,'test.sqlite');let f=make({path});try{
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:2});f.add(1);await f.until(()=>!!queuedDossier(f));assert.equal(saved(f),'dossier');
  const job=queuedDossier(f),attempts=f.store.db.prepare('SELECT * FROM research_pipeline_attempts').all();f.service.controlOperation('discovery','pause');await f.close();f=make({path});
  assert.equal(saved(f),'dossier');assert.throws(()=>f.service.runOperation('discovery'),/暂停/);await f.drive(4);assert.deepEqual(f.order,[]);assert.equal(saved(f),'dossier');assert.equal(queuedDossier(f).payload,job.payload);
  f.advance(86400001);f.store.db.prepare('INSERT INTO model_job_lease VALUES(1,?,?)').run('synthetic-occupancy',Date.parse(at)+86401001);await f.drive(3);assert.deepEqual(f.order,[]);assert.equal(saved(f),'dossier');
  f.store.db.prepare('DELETE FROM model_job_lease WHERE owner=?').run('synthetic-occupancy');await f.until(()=>readyDossier(f));assert.deepEqual(f.order,['dossier']);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_attempts WHERE id<=?').all(attempts.at(-1).id),attempts);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('the model run, attempt, lease and stage cursor roll back together if dispatch persistence fails',async()=>{
 const f=make();try{f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.add(1);await f.until(()=>f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='identity' AND status='queued'").get().n===12);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});
  const before=saved(f),used=f.queue.snapshot().callsInLast24Hours;
  f.store.db.exec(`CREATE TRIGGER fail_stage BEFORE INSERT ON settings WHEN NEW.key='${key}' AND NEW.value='dossier' BEGIN SELECT RAISE(ABORT,'synthetic-stage-write'); END`);
  await f.step();assert.equal(f.calls.identity,0);assert.equal(saved(f),before);assert.equal(f.queue.snapshot().callsInLast24Hours,used);assert.equal(f.store.db.prepare('SELECT count(*) n FROM company_entity_runs').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  f.store.db.exec('DROP TRIGGER fail_stage');await f.until(()=>readyDossier(f));assert.deepEqual(f.order,['extract','identity','dossier']);
 }finally{await f.close();}
});

test('a failed identity waits for its backoff while another matter reaches a dossier',async()=>{
 const f=make({failIdentity:true});try{f.add(1);await f.until(()=>readyDossier(f));assert.deepEqual(f.order,['extract','identity','identity','dossier']);
  const retry=f.queue.snapshot().events.items.find(j=>j.kind==='identity'&&j.retryAt);assert(retry);assert.equal(retry.attempts.length,1);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM company_entity_runs WHERE status='failed'").get().n,1);
 }finally{await f.close();}
});

test('price preparation retains the dossier turn until its two inputs are ready',async()=>{
 const f=make({prices:true});try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>readyDossier(f));
  const first=f.service.research.list().find(t=>t.eventExtraction&&t.dossier),row=f.store.db.prepare("SELECT payload FROM research_pipeline_event_jobs WHERE kind='dossier' AND topic_id=?").get(first.id),p=JSON.parse(row.payload);
  assert.equal(p.prices.results.length,2);assert(p.prices.results.every(x=>x.status==='saved'));assert(f.calls.identity<12,JSON.stringify(f.order));
  assert.deepEqual(f.order,['extract','identity','dossier']);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});
