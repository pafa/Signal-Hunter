import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {fixture,extraction,output,comparison} from './automatic-research-fixture.mjs';
import {revisionSource,revisionComparisonPacket} from '../server/revision-comparison.mjs';
import {comparisonPrompt} from '../server/semantic-events.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
const jobs=f=>f.service.researchPipeline.snapshot().clusters.items.filter(j=>j.mode==='holding-revision');
const sources=f=>f.service.research.list().filter(t=>t.eventExtraction);
const links=(f,ids)=>f.service.researchPipeline.holdingSuccessions(ids);
const position=f=>f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0];
function record(f,t,extra={}){
 const h=f.service.actualHoldings,p=h.preview({rows:[{account:'Synthetic standalone source',symbol:'NVDA.US',quantity:'10',unitCost:'100',price:'100',feeBasis:'included',asOf:'2026-10-08T14:00:00Z',source:'Synthetic only',topicId:t.id,topicVersion:t.version,...extra}]});assert(p.canApply,JSON.stringify(p));return h.apply({id:p.id,hash:p.hash});
}
async function buy(f){
 f.enable();const c=f.sim.snapshot().researchCandidates.find(c=>c.eligible);assert(c);f.decide(c);f.tick();f.quote();f.sim.process();assert.equal(f.sim.snapshot().lots.length,1);return structuredClone(f.sim.snapshot().lots[0]);
}
test('standalone revised news automatically updates simulated and recorded holdings; opening costs and the final decision remain intact',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  const original=await buy(f),t=f.service.research.get(original.topicId);record(f,t);const actual=structuredClone(f.service.actualHoldings.snapshot()),book=structuredClone(f.sim.snapshot());
  f.setAction('exit');f.auto.revise(1);assert.equal(position(f).monitoringLink.status,'waiting');await f.auto.drive(55);f.quote();await f.observe();
  const p=position(f);assert.equal(p.monitoringLink.status,'current',JSON.stringify(jobs(f)));assert.equal(p.monitoringLink.relation.kind,'source-succession');assert.notEqual(p.currentBinding.id,original.topicId);assert.equal(p.currentBinding.kind,'research');assert.match(p.judgement,/退出/);assert.equal(f.service.eventClusters.list().total,0);
  const real=f.service.snapshot().overview.accounts.find(a=>a.kind==='actual').positions[0];assert.equal(real.actualResearch.link.status,'current');assert.match(real.judgement,/退出/);assert.equal(real.actualResearch.exitAdvice.executable,false);assert.deepEqual(f.service.actualHoldings.snapshot(),actual);
  const count=f.store.db.prepare('SELECT total_changes() n').get().n,c=f.sim.snapshot().researchCandidates.find(c=>c.action==='exit'&&c.eligible);assert(c);assert.deepEqual(c.order.targetLotIds,[original.id]);assert.deepEqual(f.sim.snapshot().lots,book.lots);assert.deepEqual(f.sim.snapshot().orders,book.orders);f.service.snapshot();assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,count);
  f.decide(c);f.tick();f.quote();const sold=f.sim.process();assert.equal(sold.lots.length,0);assert.equal(sold.fills.at(-1).allocations[0].lotId,original.id);assert.equal(sold.fills.at(-1).costCents,original.costCents);
 }finally{await f.close();}
});
test('a second revision invalidates an earlier approved exit and follows the original source directly to the newest research',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  const original=await buy(f);f.setAction('exit');f.auto.revise(1);await f.auto.drive(55);f.quote();await f.observe();const c=f.sim.snapshot().researchCandidates.find(c=>c.eligible&&c.action==='exit');assert(c);f.decide(c);
  f.tick();f.quote('100',{availableSell:40});f.sim.process();const before=structuredClone(f.sim.snapshot());assert.equal(before.orders.at(-1).status,'partial');
  f.auto.revise(1);assert.equal(position(f).monitoringLink.status,'waiting');f.tick();f.quote();f.sim.process();assert.equal(f.sim.snapshot().orders.at(-1).status,'invalidated');assert.deepEqual(f.sim.snapshot().fills,before.fills);assert.deepEqual(f.sim.snapshot().lots,before.lots);
  await f.auto.drive(60);f.quote();await f.observe();const p=position(f);assert.equal(p.monitoringLink.status,'current');assert.notEqual(p.currentBinding.id,c.researchBinding.id);assert.equal(p.topicId,original.topicId);assert.equal(jobs(f).filter(j=>j.status==='completed').length,2);
 }finally{await f.close();}
});
function multiple(p){const first=extraction(p).decomposition.events[0],second={...first,title:'第二个合成事项',action:'取消',object:'其他项目',quote:'虚构甲取消项目。'};return output(p,'decomposition',{events:p.input.material.revision>1?[second,first]:[first,second],scopeNote:'合成完整矩阵',missingEvidence:['独立质量']});}
const matrix=p=>comparison(p,p.input.left.eventFocus.object===p.input.right.eventFocus.object?'followup':'unrelated');
async function engine(options={}){const f=fixture(options);f.advance(14*3600000);f.add(1);await f.drive(40);const old=sources(f).map(t=>f.service.research.addCompany(t.id,{version:t.version,symbol:'NVDA.US',note:'Synthetic exact holding association'}));record(f,old[0]);return {f,old};}
test('reordered occurrences require the complete old-by-new matrix, including unheld alternatives; provenance and read links survive restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-revision-')),path=join(dir,'isolated.sqlite');let f;try{
  let old;({f,old}=await engine({path,extractionRunner:multiple,semanticRunner:matrix}));f.revise(1);await f.drive(90);const job=jobs(f)[0];assert.equal(job.status,'completed',JSON.stringify(job));const batch=f.service.semanticBatches.get(job.batchId);assert.equal(batch.pairCount,4);assert.equal(batch.revisionPreviousIds.length,2);
  const saved=links(f,old.map(t=>t.id));for(const t of old){assert.equal(saved[t.id].status,'current');assert.equal(f.service.research.get(saved[t.id].topicId).eventExtraction.event.object,t.eventExtraction.event.object);assert.deepEqual(f.service.research.get(t.id),t);}
  const input={inputs:batch.inputs.filter(m=>m.id!==old[1].id).map(m=>({kind:'event',id:m.id,revision:1}))};assert.throws(()=>f.service.semanticBatches.previewRevision(input,batch.revision,SYSTEM_RESEARCH_ACTOR));
  const packet=f.service.semanticEvents.get(batch.items[0].runId).packet;assert.match(comparisonPrompt(packet),/原文旧版/);assert.throws(()=>revisionComparisonPacket(f.store,{left:{kind:'event',id:packet.input.left.id,revision:1},right:{kind:'event',id:packet.input.right.id,revision:1},revision:{...batch.revision,sourceHash:'changed'}}));
  await f.close();f=fixture({path,extractionRunner:multiple,semanticRunner:matrix});f.advance(14*3600000);assert.deepEqual(links(f,old.map(t=>t.id)),saved);await f.drive(12);assert.equal(f.calls.semantic,0);assert.equal(jobs(f).length,1);
 }finally{if(f)await f.close();rmSync(dir,{recursive:true,force:true});}
});
for(const relation of ['followup','uncertain','related','unrelated'])test(`a ${relation} full matrix without a unique one-to-one mapping never redirects a holding or repeats exhausted work`,async()=>{
 const {f,old}=await engine({extractionRunner:multiple,semanticRunner:p=>comparison(p,relation)});try{const book=f.service.actualHoldings.snapshot();f.revise(1);await f.drive(85);assert.equal(jobs(f)[0].status,'observing');assert.equal(links(f,[old[0].id])[old[0].id].status,'waiting');const calls=f.calls.semantic;await f.drive(12);assert.equal(f.calls.semantic,calls);assert.deepEqual(f.service.actualHoldings.snapshot(),book);}finally{await f.close();}
});
test('the existing call budget, paused batch and cancellation govern standalone succession; another source still progresses',async()=>{
 const {f,old}=await engine({extractionRunner:multiple,semanticRunner:matrix});try{
  f.revise(1);await f.until(()=>jobs(f).some(j=>j.batchId));const job=jobs(f)[0];f.service.semanticBatches.control(job.batchId,{action:'pause'});const count=f.calls.semantic;await f.drive(10);assert.equal(f.calls.semantic,count);
  f.service.semanticBatches.control(job.batchId,{action:'resume'});const cfg=f.queue.snapshot().settings;f.queue.configure({...cfg,version:cfg.version,dailyCalls:1});await f.drive(10);assert.equal(f.calls.semantic,count);assert.equal(jobs(f)[0].status,'active');
  f.service.semanticBatches.control(job.batchId,{action:'cancel'});await f.drive(5);assert.equal(jobs(f)[0].status,'cancelled');const cfg2=f.queue.snapshot().settings;f.queue.configure({...cfg2,version:cfg2.version,dailyCalls:100});await f.drive(15);assert.equal(f.calls.semantic,count);assert.equal(links(f,[old[0].id])[old[0].id].status,'waiting');
  f.add(2);await f.drive(30);assert(f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsId')=?").get(f.news(2).id));assert.equal(jobs(f).filter(j=>j.batchId===job.batchId).length,1);
 }finally{await f.close();}
});
test('closed holdings and user-edited incoming dossiers do not start automatic historical comparisons',async()=>{
 for(const closed of [true,false]){const {f,old}=await engine();try{
  if(closed){f.advance(60000);record(f,old[0],{quantity:'0',asOf:'2026-10-08T14:01:00Z',reason:'Synthetic closed'});}
  f.revise(1);await f.until(()=>sources(f).some(t=>t.id!==old[0].id&&t.dossier?.sourceModelRun));if(!closed){const t=sources(f).find(t=>t.id!==old[0].id);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人保留的研究方向'});}
  await f.drive(25);assert.equal(f.calls.semantic,0);assert.equal(jobs(f).length,closed?0:1);if(!closed){assert.equal(jobs(f)[0].status,'observing');assert.match(jobs(f)[0].reason,/本人编辑/);}
 }finally{await f.close();}}
});
test('a saved source correspondence is invalidated when a comparison decision or original occurrence is changed',async()=>{
 const {f,old}=await engine();try{f.revise(1);await f.drive(50);const j=jobs(f)[0];assert.equal(j.status,'completed');assert.equal(links(f,[old[0].id])[old[0].id].status,'current');const b=f.service.semanticBatches.get(j.batchId),r=f.service.semanticEvents.get(b.items[0].runId);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'reject',note:'Synthetic reviewer rejects correspondence'});assert.equal(links(f,[old[0].id])[old[0].id].status,'waiting');f.service.research.update(old[0].id,{version:old[0].version,status:'archived'});assert.throws(()=>revisionSource(f.store,old[0].eventExtraction.runId));}finally{await f.close();}
});
test('the standalone successor can later join an event composite without losing the original holding or source mapping',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{const original=await buy(f);f.setAction('exit');f.auto.revise(1);await f.auto.drive(50);f.quote();await f.observe();assert.equal(position(f).monitoringLink.relation.kind,'source-succession');await f.addMember(2);f.quote();const p=position(f);assert.equal(p.monitoringLink.status,'current',p.monitoringLink.reason);assert.equal(p.currentBinding.kind,'event-cluster');assert.equal(p.monitoringLink.relation.sourceSuccession.openingTopicId,original.topicId);assert.deepEqual(f.sim.snapshot().lots,[original]);}finally{await f.close();}
});
test('failed source comparisons use three bounded attempts and preserve the waiting holding without blocking other research',async()=>{
 const {f,old}=await engine({semanticRunner:()=>{throw Error('Synthetic comparison failure');}});try{f.revise(1);await f.drive(35);assert.equal(f.calls.semantic,1);f.advance(60001);await f.drive(20);assert.equal(f.calls.semantic,2);f.advance(120001);await f.drive(20);assert.equal(f.calls.semantic,3);assert.equal(jobs(f)[0].status,'observing');const b=f.service.semanticBatches.get(jobs(f)[0].batchId);assert.equal(b.items[0].attempts.length,3);await f.drive(10);assert.equal(f.calls.semantic,3);assert.equal(links(f,[old[0].id])[old[0].id].status,'waiting');}finally{await f.close();}
});
test('saving a source mapping and its audit is atomic, and recovery reuses the completed comparison without another call',async()=>{
 const {f,old}=await engine();try{f.revise(1);await f.until(()=>jobs(f).some(j=>j.batchId));f.store.db.exec("CREATE TEMP TRIGGER fail_holding_mapping BEFORE INSERT ON research_pipeline_audit WHEN NEW.action='holding-succession-completed' BEGIN SELECT RAISE(ABORT,'Synthetic mapping write failure'); END");await f.drive(10);assert.notEqual(jobs(f)[0].status,'completed');assert.equal(links(f,[old[0].id])[old[0].id].status,'waiting');const calls=f.calls.semantic;f.store.db.exec('DROP TRIGGER fail_holding_mapping');await f.drive(10);assert.equal(jobs(f)[0].status,'completed');assert.equal(f.calls.semantic,calls);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='holding-succession-completed'").get().n,1);}finally{await f.close();}
});
test('restore lock blocks pending comparisons and a new source revision invalidates the previous batch before resuming',async()=>{
 const {f,old}=await engine({extractionRunner:multiple,semanticRunner:matrix});try{f.revise(1);await f.until(()=>jobs(f).some(j=>j.batchId));const first=jobs(f)[0];f.store.db.exec("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')");const count=f.calls.semantic;assert.throws(()=>f.service.controlOperation('discovery','resume'),/恢复副本/);await assert.rejects(()=>f.queue.step({assertActive(){}}),/恢复副本/);assert.equal(f.calls.semantic,count);f.store.db.exec("DELETE FROM settings WHERE key='restore_review_required'");f.revise(1);await f.drive(90);assert.equal(jobs(f).find(j=>j.id===first.id).status,'invalidated');assert.equal(links(f,[old[0].id])[old[0].id].status,'current');const next=f.service.research.get(links(f,[old[0].id])[old[0].id].topicId);assert.equal(next.evidence.find(e=>e.materialId).materialRevision,3);}finally{await f.close();}
});
