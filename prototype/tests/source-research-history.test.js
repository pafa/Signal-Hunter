import test from 'node:test';
import assert from 'node:assert/strict';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {groupEventResearch} from '../shared/workbench-events.mjs';
const jobs=f=>f.service.researchPipeline.snapshot().clusters.items.filter(j=>j.mode==='holding-revision');
const history=f=>f.service.snapshot().overview.sourceHistory;
async function setup(){
 const f=await marketResearchFixture({composite:true,initialMembers:1});
 f.enable();f.decide(f.sim.snapshot().researchCandidates.find(c=>c.eligible));f.tick();f.quote();f.sim.process();
 const original=structuredClone(f.sim.snapshot().lots[0]);f.setAction('exit');
 return {f,original};
}
async function revise(f){f.auto.revise(1);await f.auto.drive(60);f.quote();await f.observe();}
test('saved source correspondence folds old research without changing lots, decisions or database rows on reads',async()=>{
 const {f,original}=await setup();try{
  assert.deepEqual(history(f),{groups:[],warnings:[]});await revise(f);
  const n=f.store.db.prepare('SELECT total_changes() n').get().n,s=f.service.snapshot(),h=s.overview.sourceHistory;
  assert.equal(h.groups.length,1);assert.equal(h.groups[0].history[0].topicId,original.topicId);assert.notEqual(h.groups[0].currentTopicId,original.topicId);
  const rows=groupEventResearch(s.research.topics,s.overview),row=rows.find(r=>r.sourceHistory);assert(row);assert.equal(row.cluster,null);assert.equal(row.topics.length,1);assert.equal(row.historicalTopics.length,1);assert.equal(row.topics[0].id,h.groups[0].currentTopicId);
  h.groups.length=0;assert.equal(history(f).groups.length,1,'cached results cannot be mutated by callers');
  assert.deepEqual(f.sim.snapshot().lots,[original]);assert.equal(f.sim.snapshot().orders.length,1);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,n);
 }finally{await f.close();}
});
test('multiple proven revisions retain all history while stale comparisons never become current holding authority',async()=>{
 const {f,original}=await setup();try{
  await revise(f);const first=history(f).groups[0],b=f.service.semanticBatches.get(jobs(f)[0].batchId),runId=b.items[0].runId;
  f.auto.revise(1);assert.equal(history(f).groups.length,0,'a newer unprocessed source cannot be hidden behind the old correspondence');assert(history(f).warnings.includes(original.topicId));
  assert.equal(f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0].monitoringLink.status,'waiting');
  await f.auto.drive(60);f.quote();await f.observe();const h=history(f).groups[0];assert.equal(h.id,first.id);assert.equal(h.materialRevision,3);assert.equal(h.history.length,2);assert.deepEqual(new Set(h.history.map(m=>m.topicId)),new Set([original.topicId,first.currentTopicId]));
  assert.equal(f.service.semanticEvents.get(runId).stale,true,'history projection must not modify normal comparison validity');assert.deepEqual(f.sim.snapshot().lots,[original]);
 }finally{await f.close();}
});
test('withdrawn correspondence immediately restores separate research; old source archival cannot retain a hidden row',async()=>{
 const {f,original}=await setup();try{
  await revise(f);const b=f.service.semanticBatches.get(jobs(f)[0].batchId),r=f.service.semanticEvents.get(b.items[0].runId);
  f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'reject',note:'Synthetic rejected correspondence'});
  const s=f.service.snapshot();assert.equal(s.overview.sourceHistory.groups.length,0);assert(s.overview.sourceHistory.warnings.includes(original.topicId));assert.equal(groupEventResearch(s.research.topics,s.overview).filter(x=>x.allTopics.some(t=>t.eventExtraction)).length,2);
  const old=f.service.research.get(original.topicId);f.service.research.update(old.id,{version:old.version,status:'archived'});assert.equal(history(f).groups.length,0);
 }finally{await f.close();}
});
test('a changed saved matrix fingerprint cannot conceal original research',async()=>{
 const {f,original}=await setup();try{
  await revise(f);const j=jobs(f)[0];assert.equal(history(f).groups.length,1);
  f.store.db.prepare("UPDATE research_pipeline_cluster_jobs SET payload=json_set(payload,'$.evidenceHash','changed') WHERE id=?").run(j.id);
  assert.equal(history(f).groups.length,0);assert(history(f).warnings.includes(original.topicId));
 }finally{await f.close();}
});
test('source history remains available after the holding is closed and follows a later current event cluster',async()=>{
 const {f,original}=await setup();try{
  await revise(f);await f.addMember(2);f.quote();await f.observe();const s=f.service.snapshot(),rows=groupEventResearch(s.research.topics,s.overview),row=rows.find(r=>r.historicalTopics.some(t=>t.id===original.topicId));
  assert(row?.cluster);assert.equal(row.topics.length,2);assert.equal(row.history.find(h=>h.topicId===original.topicId).kind,'source-succession');
  const c=f.sim.snapshot().researchCandidates.find(c=>c.eligible&&c.action==='exit');assert(c);f.decide(c);f.tick();f.quote();f.sim.process();assert.equal(f.sim.snapshot().lots.length,0);assert.equal(history(f).groups.length,1);
 }finally{await f.close();}
});
