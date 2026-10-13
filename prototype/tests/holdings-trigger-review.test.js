import {activityText} from '../shared/activity-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,event,jobs} from './helpers/financial-recovery-fixture.mjs';
import {actionDossier} from './helpers/research-action-fixture.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateMonitoringFollowup,monitoringResearchOrigin} from '../server/system-monitoring-revisions.mjs';
import {documentResearchOrigin} from '../server/system-document-revisions.mjs';
import {researchObservationSubjects} from '../server/research-observation-subjects.mjs';
import {digest} from '../server/codex-research.mjs';

const refreshes=f=>jobs(f).filter(j=>j.p.monitoringFollowup);
function holding(f,quantity='1'){
 const p=f.service.actualHoldings.preview({rows:[{account:'SYNTHETIC_PRIVATE_88421',symbol:'NVDA.US',quantity,unitCost:'117.43',price:'',asOf:'2026-10-08T00:00:00Z',source:'Synthetic snapshot',feeBasis:'included',reason:'Synthetic update'}]});
 assert(p.canApply);f.service.actualHoldings.apply({id:p.id,hash:p.hash});
}
function fixture({cause='deadline',runner,path,fetcher}={}){
 const f=make({mode:'normal',path,fetcher,researchRunner:p=>{
  if(runner&&p.input.monitoringReview)return runner(p);
  const r=actionDossier(p,{action:p.input.monitoringReview?'hold':'buy'}),a=r.companyAssessments.find(a=>a.symbol==='NVDA.US');
  a.recommendation.validUntil=new Date(Date.parse(p.generatedAt)+(cause==='deadline'?60000:3600000)).toISOString();
  if(cause==='price')a.monitoring.nextCheck={...a.monitoring.nextCheck,reason:'Revision '+p.input.topicVersion,conditions:[{type:'price',interval:'1m',operator:'lte',value:90}]};
  if(cause==='condition')a.monitoring.nextCheck={...a.monitoring.nextCheck,conditions:[{type:'at',at:'2026-10-08T00:01:00.000Z'}]};
  r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
 }});
 // This test isolates review scheduling. Public price preparation is separately
 // exercised with the existing adapter below; no real network or model is used.
 f.queue.configure({...f.queue.snapshot().settings,financialSources:false});return f;
}
async function ready(f){f.add(1);await f.until(()=>jobs(f).some(j=>j.status==='completed'));holding(f);}

test('an elapsed holding review deadline automatically saves a new research version without new news, an intermediate approval or ledger writes',async()=>{
 const f=fixture();try{
  await ready(f);const original=event(f),history=JSON.stringify(f.service.research.historyDetail(original.id,original.version)),news=f.store.news(),accounts=f.store.db.prepare('SELECT * FROM actual_holding_records').all();
  f.advance(60001);await f.until(()=>refreshes(f).some(j=>j.status==='completed'));
  const current=event(f);assert(current.version>original.version);assert.equal(current.dossier.companyAssessment.assessments[0].recommendation.action,'hold');assert.equal(f.calls.dossier,2);
  const log=f.service.activity({topic:current.id}).items.find(x=>x.action==='holdings-review-queued');assert(log);assert.equal(log.topicId,current.id);assert.match(activityText(log),/NVDA.US.*后台更新研判/);
  assert.deepEqual(f.store.news(),news);assert.deepEqual(f.store.db.prepare('SELECT * FROM actual_holding_records').all(),accounts);assert.equal(JSON.stringify(f.service.research.historyDetail(original.id,original.version)),history);
  const packet=f.packets.at(-1);assert(packet.input.monitoringReview);assert(!JSON.stringify(packet).includes('SYNTHETIC_PRIVATE_88421'));assert(!JSON.stringify(packet).includes('117.43'));assert.equal(f.service.marketSimulations.steady.holdingSymbols().length,0);
  await f.drive(24);assert.equal(f.calls.dossier,2);assert.equal(refreshes(f).length,1);
 }finally{await f.close();}
});

test('a checked time condition is consumed once across new model versions; missing, paused or stale checks cannot start review',async()=>{
 const f=fixture({cause:'condition'});try{
  await ready(f);f.advance(60001);await f.drive(12);assert.equal(refreshes(f).length,0);
  await f.service.runOperation('observations');f.service.controlOperation('observations','pause');await f.drive(12);assert.equal(refreshes(f).length,0);
  f.service.controlOperation('observations','resume');await f.service.runOperation('observations');f.advance(120001);await f.drive(12);assert.equal(refreshes(f).length,0);
  await f.service.runOperation('observations');await f.until(()=>refreshes(f).some(j=>j.status==='completed'));assert.equal(f.calls.dossier,2);
  await f.service.runOperation('observations');await f.drive(24);assert.equal(f.calls.dossier,2,'the unchanged true condition cannot consume another call after adoption');
 }finally{await f.close();}
});

test('quota wait persists one queued cause; disabling automatic research, closing the holding, or editing research cannot dispatch it',async()=>{
 for(const stop of ['resume','automatic','closed','edit']){
  const f=fixture();try{
   await ready(f);const calls=f.calls.dossier;f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});
   f.advance(60001);await f.until(()=>refreshes(f).length===1);await f.drive(10);assert.equal(f.calls.dossier,calls);assert.equal(refreshes(f)[0].status,'queued');
   if(stop==='automatic')f.queue.configure({...f.queue.snapshot().settings,automatic:false});
   if(stop==='closed')holding(f,'0');
   if(stop==='edit'){const t=event(f);f.service.research.update(t.id,{version:t.version,nextEvidence:'Synthetic human revision wins'});}
   f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.drive(24);
   assert.equal(f.calls.dossier,calls+(stop==='resume'?1:0),stop);
   if(['closed','edit'].includes(stop))assert.equal(refreshes(f)[0].status,'invalidated');
  }finally{await f.close();}
 }
});

test('restart preserves queued review and cause identity; completed provenance rejects tampering and bridges original attachment history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holdings-review-')),path=join(dir,'isolated.sqlite');let f=fixture({path});
 try{
  await ready(f);const before=event(f);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});f.advance(60001);await f.until(()=>refreshes(f).length===1);const queued=refreshes(f)[0],states=f.store.db.prepare('SELECT * FROM holdings_review_signals ORDER BY id').all();
  await f.close();f=fixture({path});f.advance(60001);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>refreshes(f).some(j=>j.status==='completed'));
  assert.equal(refreshes(f).length,1);assert.equal(refreshes(f)[0].id,queued.id);assert.deepEqual(f.store.db.prepare('SELECT * FROM holdings_review_signals ORDER BY id').all(),states);
  const current=f.service.research.get(event(f).id),row=refreshes(f)[0];assert.equal(validateMonitoringFollowup(f.store.db,current,row).version,before.version);assert.equal(monitoringResearchOrigin(f.store.db,current).version,before.version);assert.equal(documentResearchOrigin(f.store.db,current,before.version,before.dossier.sourceModelRun.id).version,before.version);
  assert.throws(()=>validateMonitoringFollowup(f.store.db,current,{...row,payload:JSON.stringify({...row.p,monitoringFollowup:{...row.p.monitoringFollowup,baseHash:'0'.repeat(64)}})}),/不连续/);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('write failure does not consume a cause or leave a prepared topic without its queue, while no holding leaves research unchanged',async()=>{
 const f=fixture();try{
  f.add(1);await f.until(()=>jobs(f).some(j=>j.status==='completed'));const before=event(f);f.advance(60001);await f.drive(12);assert.equal(refreshes(f).length,0);assert.deepEqual(event(f),before);
  holding(f);f.store.db.exec("CREATE TEMP TRIGGER fail_review BEFORE INSERT ON research_pipeline_event_jobs WHEN json_type(NEW.payload,'$.monitoringFollowup')='object' BEGIN SELECT RAISE(ABORT,'synthetic review write failure'); END");
  let failed=false;for(let i=0;i<12;i++){const result=await f.step();if(result.error){failed=true;break;}}assert(failed);assert.deepEqual(event(f),before);assert.equal(refreshes(f).length,0);assert(f.store.db.prepare('SELECT payload FROM holdings_review_signals').all().every(r=>JSON.parse(r.payload).consumed===0));
  f.store.db.exec('DROP TRIGGER fail_review');await f.until(()=>refreshes(f).some(j=>j.status==='completed'));assert.equal(f.calls.dossier,2);
 }finally{await f.close();}
});

function publicPrice(url,price){
 const interval=new URL(url).searchParams.get('interval');
 if(url.includes('eastmoney.com'))return Response.json({data:null});
 const stamp=Date.parse(interval==='1d'?'2026-10-07T13:30:00Z':'2026-10-07T19:59:00Z')/1000;
 return Response.json({chart:{result:[{meta:{symbol:'NVDA',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[stamp],indicators:{quote:[{close:[price],volume:[1000]}]}}]}});
}
test('a fresh price trigger refreshes the day and minute materials, preserves older prices as history and can rearm only after a checked recovery',async()=>{
 let price=100;const f=fixture({cause:'price',fetcher:async url=>publicPrice(url,price)});
 const quote=value=>{const q={symbol:'NVDA.US',currency:'USD',provider:'eastmoney-public',providerTimezone:'Asia/Shanghai',providerTime:'2026-10-08 08:00',points:[{time:'2026-10-08 08:00',close:value}]},at='2026-10-08T00:00:00.000Z';f.store.db.prepare('INSERT OR REPLACE INTO quotes VALUES(?,?,?)').run(q.symbol,JSON.stringify(q),at);f.store.status(q.symbol,{state:'ok',receivedAt:at});};
 try{
  f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});await ready(f);const before=event(f),old=before.researchPrices.map(p=>p.materialId);assert.equal(old.length,2);f.store.addWatch('NVDA.US');
  price=85;quote(price);await f.service.runOperation('observations');const c=f.service.snapshot().observationInbox.researchChecks.find(c=>c.group==='nextCheck');assert.equal(c.status,'true',c.reason);
  await f.until(()=>refreshes(f).some(j=>j.status==='completed'));const current=event(f);assert.equal(current.researchPrices.length,2);assert(current.researchPrices.every(p=>!old.includes(p.materialId)));assert(old.every(id=>current.evidence.some(e=>e.materialId===id)));assert.equal(current.monitoringReview.priorPrices.length,2);
  assert.equal(researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[current])[0].fresh,true);assert.equal(validateMonitoringFollowup(f.store.db,f.service.research.get(current.id),refreshes(f)[0]).version,before.version);
  await f.service.runOperation('observations');await f.drive(15);assert.equal(f.calls.dossier,2,'reason wording and the model version do not create another episode');
  quote(100);await f.service.runOperation('observations');await f.drive(10);quote(85);await f.service.runOperation('observations');await f.until(()=>refreshes(f).filter(j=>j.status==='completed').length===2);assert.equal(f.calls.dossier,3);
  assert.equal(f.service.marketSimulations.steady.snapshot().configured,false);
 }finally{await f.close();}
});

test('failed model calls use the original three-attempt bound; a consumed trigger never reopens the exhausted generation',async()=>{
 const f=fixture({runner:()=>{throw Error('synthetic model failure');}});try{
  await ready(f);f.advance(60001);await f.until(()=>refreshes(f)[0]?.p.retryAt);assert.equal(f.calls.dossier,2);await f.drive(8);assert.equal(f.calls.dossier,2);
  const firstRetry=refreshes(f)[0].p.retryAt;f.advance(60001);await f.until(()=>f.calls.dossier===3);await f.until(()=>refreshes(f)[0]?.p.retryAt>firstRetry);
  f.advance(120001);await f.until(()=>refreshes(f)[0]?.status==='observing');assert.equal(f.calls.dossier,4);const failures=f.store.db.prepare("SELECT payload FROM model_research_runs WHERE json_extract(payload,'$.status')='failed'").all();assert.equal(failures.length,3);
  f.advance(86400001);await f.drive(30);assert.equal(refreshes(f).length,1);assert.equal(f.calls.dossier,4);assert.deepEqual(f.store.db.prepare("SELECT payload FROM model_research_runs WHERE json_extract(payload,'$.status')='failed'").all(),failures);
 }finally{await f.close();}
});

test('a holding closed during price preparation cannot update the topic, call the model or change the original account snapshot',async()=>{
 let closeOnRead=false,f;f=fixture({fetcher:async url=>{if(closeOnRead){closeOnRead=false;holding(f,'0');}return publicPrice(url,85);}});
 try{
  await ready(f);f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});f.advance(60001);await f.until(()=>refreshes(f).length===1);const queued=f.service.research.get(event(f).id),calls=f.calls.dossier;closeOnRead=true;
  await f.drive(20);assert.equal(refreshes(f)[0].status,'invalidated');assert.equal(f.calls.dossier,calls);assert.deepEqual(f.service.research.get(queued.id),queued);assert.equal(f.service.actualHoldings.holdingSymbols().length,0);
 }finally{await f.close();}
});
