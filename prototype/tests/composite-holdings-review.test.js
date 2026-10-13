import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {activityText} from '../shared/activity-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {make} from './helpers/financial-recovery-fixture.mjs';
import {two} from './automatic-research-fixture.mjs';
import {actionDossier} from './helpers/research-action-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
const rows=f=>f.store.db.prepare('SELECT * FROM event_cluster_research ORDER BY version').all().map(r=>({...r,p:JSON.parse(r.payload)}));
function fixture({cause='deadline',runner,...options}={}){
 const packets=[];const f=make({mode:'normal',...options,researchRunner:actionDossier,synthesisRunner:p=>{
  packets.push(p);if(p.input.monitoringReview&&runner)return runner(p);
  const r=actionDossier(p,{action:p.input.monitoringReview?'hold':'buy'}),a=r.companyAssessments.find(a=>a.symbol==='NVDA.US');
  a.recommendation.validUntil=cause==='deadline'?new Date(Date.parse(p.generatedAt)+60000).toISOString():'2026-11-01T14:00:00Z';
  if(cause==='condition')a.monitoring.nextCheck={...a.monitoring.nextCheck,reason:'version '+p.input.topicVersion,conditions:[{type:'at',at:'2026-10-08T00:01:00.000Z'}]};
  r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
 }});f.queue.configure({...f.queue.snapshot().settings,financialSources:false});return Object.assign(f,{packets});
}
function holding(f,quantity='1'){
 const p=f.service.actualHoldings.preview({rows:[{account:'SYNTHETIC_COMPOSITE_ONLY',symbol:'NVDA.US',quantity,unitCost:'117.43',price:'',asOf:'2026-10-08T00:00:00Z',source:'Synthetic snapshot',feeBasis:'included',reason:'Synthetic update'}]});assert(p.canApply);f.service.actualHoldings.apply({id:p.id,hash:p.hash});
}
async function ready(f){const c=await two(f);await f.until(()=>rows(f).some(r=>r.status==='completed'));holding(f);return c;}
test('an elapsed composite review deadline saves a new synthesis without new news, member rewrites or account changes',async()=>{
 const f=fixture();try{
  const c=await ready(f),original=f.queue.synthesis.detail(c.id).selected,topics=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),accounts=f.store.db.prepare('SELECT * FROM actual_holding_records').all(),news=f.store.news();
  f.advance(60001);await f.until(()=>rows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));
  const current=f.queue.synthesis.detail(c.id).selected;assert.equal(current.version,original.version+1);assert(current.current);assert.equal(current.run.candidate.companyAssessments[0].recommendation.action,'hold');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),topics);assert.deepEqual(f.store.db.prepare('SELECT * FROM actual_holding_records').all(),accounts);assert.deepEqual(f.store.news(),news);
  const old=f.queue.synthesis.detail(c.id,original.id).selected;assert.equal(old.current,false);assert.deepEqual(old.packet,original.packet);assert.deepEqual(old.run,original.run);
  assert(!JSON.stringify(f.packets.at(-1)).includes('SYNTHETIC_COMPOSITE_ONLY'));assert(!JSON.stringify(f.packets.at(-1)).includes('117.43'));
  await f.drive(24);assert.equal(f.synthesisCalls,2);
 }finally{await f.close();}
});

test('composite condition checks require freshness and resume, and unchanged true conditions do not loop across new versions',async()=>{
 const f=fixture({cause:'condition'});try{
  const c=await ready(f);f.advance(60001);await f.drive(12);assert.equal(rows(f).length,1);
  await f.service.runOperation('observations');f.service.controlOperation('observations','pause');await f.drive(12);assert.equal(rows(f).length,1);
  f.service.controlOperation('observations','resume');f.advance(120001);await f.drive(12);assert.equal(rows(f).length,1);
  await f.service.runOperation('observations');await f.until(()=>rows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));
  await f.service.runOperation('observations');await f.drive(24);assert.equal(f.synthesisCalls,2);assert(f.queue.synthesis.observationSubjects().find(s=>s.id===c.id).fresh);
  const log=f.service.activity({topic:'event-cluster:'+c.id}).items.find(i=>i.action==='synthesis-holdings-review-queued');assert(log);assert.equal(log.clusterId,c.id);assert.equal(log.synthesisId,rows(f).at(-1).id);assert.match(activityText(log),/NVDA.US.*后台更新事件综合/);
 }finally{await f.close();}
});

test('quota, automatic pause, cancellation, closed holdings and member edits cannot dispatch an obsolete composite review',async()=>{
 for(const change of ['resume','automatic','cancel','closed','member']){
  const f=fixture();try{
   const c=await ready(f);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});f.advance(60001);await f.until(()=>rows(f).length===2);const job=rows(f).at(-1);assert.equal(job.status,'queued');assert.equal(f.synthesisCalls,1);assert(!f.queue.synthesis.observationSubjects().find(s=>s.id===c.id).fresh);
   if(change==='automatic')f.queue.configure({...f.queue.snapshot().settings,automatic:false});
   if(change==='cancel')f.queue.synthesis.cancel(job.id);
   if(change==='closed')holding(f,'0');
   if(change==='member'){const t=f.service.research.get(c.members[0].id);f.service.research.update(t.id,{version:t.version,nextEvidence:'Synthetic human revision'});}
   f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.drive(20);
   const same=rows(f).find(r=>r.id===job.id);assert.equal(same.status,change==='resume'?'completed':change==='automatic'?'queued':change==='cancel'?'cancelled':'invalidated',change);
   if(change==='resume')assert.equal(f.synthesisCalls,2);else if(change!=='member')assert.equal(f.synthesisCalls,1);
   if(change==='member')assert(!same.run_id,'new member basis may create a separate normal synthesis, but cannot reuse the held-trigger generation');
  }finally{await f.close();}
 }
});

function publicPrice(url){
 const interval=new URL(url).searchParams.get('interval');if(url.includes('eastmoney.com'))return Response.json({data:null});
 const stamp=Date.parse(interval==='1d'?'2026-10-07T13:30:00Z':'2026-10-07T19:59:00Z')/1000;
 return Response.json({chart:{result:[{meta:{symbol:'NVDA',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[stamp],indicators:{quote:[{close:[90],volume:[1000]}]}}]}});
}
test('a composite review archives fresh day and minute prices, keeps member inputs unchanged and verifies immutable originals',async()=>{
 const f=fixture({fetcher:async url=>publicPrice(url)});try{
  const c=await ready(f),before=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all();f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});f.advance(60001);await f.until(()=>rows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));
  const latest=rows(f).at(-1),packet=f.packets.at(-1);assert.deepEqual(packet.input.researchPrices.map(r=>[r.symbol,r.interval,r.status]),[['NVDA.US','1d','saved'],['NVDA.US','1m','saved']]);assert.equal(packet.input.researchPrices[1].volumeComparison.schema,'research-volume-comparison/1');assert.equal(packet.input.evidence.filter(e=>e.reviewPrice).length,2);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),before);assert(f.queue.synthesis.observationSubjects().find(s=>s.id===c.id).fresh);assert.equal(f.synthesisCalls,2);
  const e=packet.input.evidence.find(e=>e.reviewPrice),row=f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(e.materialId);f.store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.payload),body:'tampered synthetic original'}),e.materialId);
  assert.equal(f.queue.synthesis.detail(c.id,latest.id).selected.current,false);assert.equal(f.queue.synthesis.observationSubjects().find(s=>s.id===c.id).ready,false);
 }finally{await f.close();}
});

test('failed composite review calls keep the shared three-attempt budget and never reopen the exhausted trigger',async()=>{
 const f=fixture({runner:()=>{throw Error('synthetic model failure');}});try{
  await ready(f);f.advance(60001);await f.until(()=>rows(f).at(-1).p.nextRetryAt);assert.equal(f.synthesisCalls,2);
  const first=rows(f).at(-1).p.nextRetryAt;f.advance(60001);await f.until(()=>f.synthesisCalls===3);await f.until(()=>rows(f).at(-1).p.nextRetryAt>first);
  f.advance(120001);await f.until(()=>rows(f).at(-1).status==='observing');assert.equal(f.synthesisCalls,4);assert.equal(rows(f).at(-1).p.attemptCount,3);
  const job=rows(f).at(-1),failed=f.service.activity({topic:'event-cluster:'+job.cluster_id}).items.filter(i=>i.kind==='model'&&i.action==='failed');assert.equal(failed.length,3);assert(failed.every(i=>i.clusterId===job.cluster_id&&i.synthesisId===job.id),'failed attempts still open their original synthesis after the active run pointer clears');
  f.advance(86400001);await f.drive(24);assert.equal(f.synthesisCalls,4);assert.equal(rows(f).length,2);
 }finally{await f.close();}
});

test('closing a holding during composite price preparation blocks saved input and model dispatch',async()=>{
 let f,closed=false;f=fixture({fetcher:async url=>{if(!closed){closed=true;holding(f,'0');}return publicPrice(url);}});try{
  await ready(f);f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});f.advance(60001);await f.until(()=>rows(f).length===2);const packet=rows(f).at(-1).p.packet;
  for(let i=0;i<16;i++)await f.step();assert(closed);assert.equal(f.synthesisCalls,1);assert.equal(rows(f).at(-1).status,'invalidated');assert.deepEqual(rows(f).at(-1).p.packet,packet);
 }finally{await f.close();}
});

test('restart resumes the same composite trigger once and closing afterwards leaves historical research inspectable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'composite-review-')),path=join(root,'isolated.sqlite');let f=fixture({path});try{
  const c=await ready(f);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});f.advance(60001);await f.until(()=>rows(f).length===2);const id=rows(f).at(-1).id,states=f.store.db.prepare('SELECT * FROM holdings_review_signals ORDER BY id').all();
  await f.close();f=fixture({path});f.advance(60001);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>rows(f).find(r=>r.id===id).status==='completed');assert.equal(rows(f).length,2);assert.equal(f.synthesisCalls,1);assert.deepEqual(f.store.db.prepare('SELECT * FROM holdings_review_signals ORDER BY id').all(),states);
  const current=f.queue.synthesis.detail(c.id,id).selected;holding(f,'0');await f.drive(12);assert.equal(f.queue.synthesis.detail(c.id,id).selected.current,true);assert.deepEqual(f.queue.synthesis.detail(c.id,id).selected.run,current.run);
  const row=rows(f).at(-1);f.store.db.prepare('UPDATE event_cluster_research SET payload=? WHERE id=?').run(JSON.stringify({...row.p,monitoringReview:{...row.p.monitoringReview,baseHash:'0'.repeat(64)}}),id);assert.equal(f.queue.synthesis.overview(c.id).current,false);
 }finally{await f.close();rmSync(root,{recursive:true,force:true});}
});

test('failed composite enqueue rolls back its queue and trigger consumption; no holdings cannot start review',async()=>{
 const f=fixture();try{
  const c=await two(f);f.advance(60001);await f.drive(12);assert.equal(rows(f).length,1);holding(f);
  f.store.db.exec("CREATE TEMP TRIGGER reject_review BEFORE INSERT ON event_cluster_research WHEN json_type(NEW.payload,'$.monitoringReview')='object' BEGIN SELECT RAISE(ABORT,'synthetic queue write failure'); END");
  let failed=false;for(let i=0;i<12;i++){const r=await f.step();if(r.error){failed=true;break;}}assert(failed);assert.equal(rows(f).length,1);assert(f.store.db.prepare('SELECT payload FROM holdings_review_signals').all().every(r=>JSON.parse(r.payload).consumed===0));
  f.store.db.exec('DROP TRIGGER reject_review');await f.until(()=>rows(f).at(-1).status==='completed'&&rows(f).length===2);assert(f.queue.synthesis.overview(c.id).current);
 }finally{await f.close();}
});

test('composite price failures stop after three attempts per interval and continue with explicit missing materials',async()=>{
 const f=fixture({fetcher:async()=>{throw Error('synthetic price failure');}});try{
  await ready(f);f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});f.advance(60001);await f.until(()=>rows(f).length===2);
  for(let i=0;i<80&&rows(f).at(-1).status!=='completed';i++){
   const row=rows(f).at(-1);if(row.p.nextRetryAt)f.advance(120001);await f.step();
  }
  const row=rows(f).at(-1);assert.equal(row.status,'completed');assert.equal(f.synthesisCalls,2);assert.deepEqual(row.p.prices.results.map(r=>r.status),['unavailable','unavailable']);
  for(const interval of ['1d','1m'])assert.equal(row.p.prices.attempts.filter(a=>a.interval===interval&&a.state==='started').length,3);
  assert.equal(f.packets.at(-1).input.evidence.filter(e=>e.reviewPrice).length,0);assert.match(row.p.prices.results[1].volumeComparison.reason,/缺失/);
 }finally{await f.close();}
});
