import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../server/codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {fixture,extraction,output,comparison,cluster} from './automatic-research-fixture.mjs';

const context={assertActive(){}};
const options=(count,semanticRunner=p=>comparison(p))=>({semanticRunner,extractionRunner:p=>{
 const base=extraction(p),events=p.input.material.url.endsWith('-1')?Array.from({length:count},(_,i)=>({...base.decomposition.events[0],title:`合成范围 ${i+1}`,object:`范围 ${i+1}`})):base.decomposition.events;
 return output(p,'decomposition',{...base.decomposition,events});
}});
// Seed a complete, explicit system cluster as pre-existing state. Its generated
// labels exercise capacity and persistence, never independent semantic quality.
async function seed(f,count){
 f.add(1);await f.until(()=>f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed'").get().n===count);
 const inputs=f.service.research.list().filter(t=>t.eventExtraction).map(t=>({kind:'event',id:t.id,revision:1})),batches=f.service.semanticBatches;
 assert.equal(inputs.length,count);
 const plan=batches.preview({inputs},SYSTEM_RESEARCH_ACTOR),b=batches.create({inputs,planHash:plan.planHash,requestId:'large-test-seed-cluster'},{owner:'research-pipeline',actor:SYSTEM_RESEARCH_ACTOR});
 for(let i=0;i<plan.maximumCalls;i++){const r=batches.step(context,{batchId:b.id,actor:SYSTEM_RESEARCH_ACTOR});await f.service.semanticEvents.wait(r.runId);f.service.semanticEvents.decide(r.runId,{version:0,action:'accept',note:'合成预存完整比较'},SYSTEM_RESEARCH_ACTOR);}
 const group=f.service.eventClusters.preview(b.id).groups[0];assert(group.canSave);
 const saved=f.service.eventClusters.save({batchId:b.id,groupId:group.id,previewHash:group.hash,clusterId:'',version:0,title:'合成容量检验事件',note:'仅检验完整成员与恢复',requestId:'large-test-save-cluster'},SYSTEM_RESEARCH_ACTOR);
 return f.service.eventClusters.get(saved.id);
}
const expansion=f=>f.queue.snapshot().clusters.items.find(j=>j.batchId&&j.mode!=='replace');
const succession=f=>f.queue.snapshot().clusters.items.find(j=>j.batchId&&j.mode==='replace');

test('automatic eleven-member expansion keeps all 55 pairs and resumes only pending work across quota and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'large-cluster-')),path=join(dir,'research.sqlite'),opts=options(10);let f=fixture({path,...opts});
 try{
  const before=await seed(f,10),book=f.service.paper.snapshot();f.add(2);await f.until(()=>!!f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsId')=?").get(f.news(2).id));
  // Seed a lexical miss so complete pairing, rather than the recall queue,
  // owns seven unfinished comparisons for this quota/restart regression.
  const scan=f.store.db.prepare('SELECT * FROM research_relation_scans ORDER BY rowid DESC LIMIT 1').get(),scope=JSON.parse(scan.payload);scope.candidates=scope.candidates.slice(0,3);f.store.db.prepare("UPDATE research_relation_scans SET status='scheduled',payload=? WHERE id=?").run(JSON.stringify(scope),scan.id);
  await f.until(()=>!!expansion(f));const job=expansion(f),batch=f.service.semanticBatches.get(job.batchId);
  assert.equal(batch.inputCount,11);assert.equal(batch.pairCount,55);assert.equal(batch.items.filter(i=>i.reusedRunId&&before.pairs.some(p=>p.basis.runId===i.runId)).length,45);
  assert(batch.counts.queued>0);const settings=f.queue.snapshot().settings;f.queue.configure({...settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});
  await f.drive(3);const paused=f.service.semanticBatches.get(batch.id),runs=paused.items.filter(i=>i.runId).map(i=>({ordinal:i.ordinal,runId:i.runId,attempts:i.attempts})),calls=f.calls.semantic;
  await f.drive(2);assert.equal(f.calls.semantic,calls);assert.equal(cluster(f).snapshotHash,before.snapshotHash);assert(paused.counts.queued>0);
  f.service.controlOperation('discovery','pause');await f.close();f=fixture({path,...opts});assert(f.service.operations().tasks.discovery.paused);assert.equal(f.calls.semantic,0);f.advance(86400001);
  await f.until(()=>cluster(f).version===2);const after=cluster(f);assert.equal(after.id,before.id);assert.equal(after.members.length,11);assert.equal(after.pairs.length,55);assert(after.health.current);assert.deepEqual(after.history[1],before.history[0]);
  for(const done of runs){const item=f.service.semanticBatches.get(batch.id).items[done.ordinal];assert.equal(item.runId,done.runId);assert.deepEqual(item.attempts,done.attempts);}
  assert.equal(f.calls.semantic,paused.counts.queued);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a late conflicting pair beyond the manual input limit preserves the complete original cluster',async()=>{
 const f=fixture(options(10,p=>comparison(p,p.input.left.url.endsWith('-2')&&p.input.right.eventFocus.object==='范围 10'?'unrelated':'followup')));
 try{const before=await seed(f,10);f.add(2);await f.until(()=>expansion(f)?.status==='observing');assert.equal(cluster(f).snapshotHash,before.snapshotHash);assert.deepEqual(cluster(f).history,before.history);const b=f.service.semanticBatches.get(expansion(f).batchId);assert.equal(b.inputCount,11);assert.equal(b.pairCount,55);assert(b.items.some(i=>i.relation==='unrelated'));assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}
 finally{await f.close();}
});

test('automatic revision supports 22 old/new inputs, all 121 correspondence pairs and all 55 current pairs',async()=>{
 const f=fixture(options(11,p=>comparison(p,p.schema==='event-revision-pair-1'&&p.input.left.eventFocus.object!==p.input.right.eventFocus.object?'unrelated':'followup')));
 try{
  const before=await seed(f,11),inputs=before.members.map(m=>({kind:'event',id:m.id,revision:1})),batches=f.service.semanticBatches;
  assert.throws(()=>batches.preview({inputs}),/2至10/);assert.throws(()=>batches.preview({inputs},{...SYSTEM_RESEARCH_ACTOR}),/来源无效/);
  const p=batches.preview({inputs},SYSTEM_RESEARCH_ACTOR);assert.throws(()=>batches.create({inputs,planHash:p.planHash,requestId:'owner-is-not-capability'},{owner:'research-pipeline'}),/2至10/);
  assert.throws(()=>batches.create({inputs,planHash:p.planHash,requestId:'actor-without-owner'},{actor:SYSTEM_RESEARCH_ACTOR}),/操作/);
  f.revise(1);await f.until(()=>f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsRevision')=2").get().n===11);
  const extract=f.store.db.prepare("SELECT id FROM research_pipeline_event_jobs WHERE kind='extract' AND json_extract(payload,'$.newsRevision')=2").get(),legacyId=digest({kind:'automatic-succession-1',cluster:before.snapshotHash,sources:[extract.id]}),legacy=JSON.stringify({automatic:true,mode:'replace',clusterId:before.id,reason:'修订后没有完整事项，或完整比较超过10份输入；保留观察，不截断候选'});
  f.store.db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(legacyId,legacyId,'observing',legacy);
  for(let i=0;i<450&&cluster(f).version===1;i++){if(f.queue.snapshot().callsInLast24Hours>=100)f.advance(86400001);await f.step();}
  const after=cluster(f),job=succession(f);assert.equal(after.version,2);assert.equal(after.id,before.id);assert.equal(after.members.length,11);assert.equal(after.pairs.length,55);assert.equal(after.replacement.mappings.length,11);assert(after.health.current);assert.deepEqual(after.history[1],before.history[0]);
  const mapping=batches.get(job.correspondenceBatchId);assert.equal(mapping.inputCount,22);assert.equal(mapping.pairCount,121);assert.equal(mapping.counts.candidate,121);assert.equal(batches.get(job.batchId).pairCount,55);assert.equal(job.resumedJobId,legacyId);assert.equal(f.store.db.prepare('SELECT payload FROM research_pipeline_cluster_jobs WHERE id=?').get(legacyId).payload,legacy);
  const calls=f.calls.semantic;await f.drive(2);assert.equal(f.calls.semantic,calls);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);
 }finally{await f.close();}
});

test('only an old automatic size skip is retried once and its original record remains unchanged',async()=>{
 const f=fixture(options(10));try{
  const before=await seed(f,10);f.add(2);await f.until(()=>f.queue.snapshot().relations.items.some(r=>r.status==='completed'));
  const relation=f.queue.snapshot().relations.items.find(r=>r.status==='completed'),id=digest({relation:relation.id,kind:'cluster-expansion'}),payload=JSON.stringify({automatic:true,sourceId:relation.source.id,sourceVersion:relation.source.version,sourceTitle:relation.source.title,clusterId:before.id,reason:'扩展后超过10份输入，保留原簇全部成员，不截断'});
  f.store.db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,relation.id,'skipped',payload);
  await f.until(()=>cluster(f).version===2);const resumed=f.queue.snapshot().clusters.items.find(j=>j.resumedJobId===id);assert.equal(resumed.status,'completed');assert.equal(f.store.db.prepare('SELECT payload FROM research_pipeline_cluster_jobs WHERE id=?').get(id).payload,payload);
  await f.drive(2);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_cluster_jobs WHERE json_extract(payload,'$.resumedJobId')=?").get(id).n,1);assert.equal(cluster(f).members.length,11);
 }finally{await f.close();}
});
