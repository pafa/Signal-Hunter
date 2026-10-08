import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {digest} from '../server/codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000},at='2026-10-08T00:00:00Z';
const quote='虚构甲公司拟收购虚构乙公司，仍需批准。';
function output(packet,key,value){const rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',[key]:value,rawOutput,trace:{model:config.model,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};}
function extraction(p){return output(p,'decomposition',{events:[{title:'虚构甲收购事项',actor:'虚构甲',action:'拟收购',object:'虚构乙',stage:'待核',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一具体事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成材料',missingEvidence:['核验公告']});}
function identity(p){return output(p,'resolution',{mentions:[],scopeNote:'未有确定证券身份',missingEvidence:['上市公司身份']});}
function dossier(p){const value={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['冻结的合成流程测试材料；未核实事实'],sourceIds:[]})),missingEvidence:['独立事实核验']},rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',...value,rawOutput,trace:{model:config.model,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,outputHash:digest(rawOutput)}};}
function comparison(p,relation='followup'){const event=side=>({actor:p.input[side].eventFocus.actor,action:p.input[side].eventFocus.action,object:p.input[side].eventFocus.object,eventTime:'未知',stage:p.input[side].eventFocus.stage,quote:p.input[side].eventFocus.quote,quoteField:'body',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'}});return output(p,'comparison',{relation,left:event('left'),right:event('right'),reason:'仅为引擎流程测试，两侧均引用冻结事项；不证明模型质量',missingEvidence:['真实公告与事实']});}
function fixture({path=':memory:',semanticRunner=comparison,extractionRunner=extraction}={}){
 let clock=Date.parse(at);const store=openStore(path);assertDatabaseMode(store,'research');const calls={extract:0,identity:0,dossier:0,semantic:0};
 const service=createService(store,{mode:'research',modelConfig:config,now:()=>clock,sourceReader:async url=>({url,title:'合成公告',sourceName:'合成',body:quote+'虚构甲取消项目。'+'这些文字是合成测试材料，不证明事实与投资表现。'.repeat(30)+'材料版本 '+(store.newsById(digest('automatic-cluster-'+url.split('-').at(-1)))?.revision||1),scope:'extracted-text'}),materialEventRunner:async p=>{calls.extract++;return extractionRunner(p);},companyEntityRunner:async p=>{calls.identity++;return identity(p);},modelRunner:async p=>{calls.dossier++;return dossier(p);},semanticRunner:async p=>{calls.semantic++;return semanticRunner(p);}});
 const queue=service.researchPipeline;if(queue.snapshot().settings.version===1)queue.configure({version:1,dailyCalls:100,includeClues:false,extractEvents:true,automatic:true});
 const news=i=>({id:digest('automatic-cluster-'+i),title:`Synthetic acquisition bankruptcy report ${i}`,url:`https://example.com/synthetic-${i}`,publisher:'合成',publishedAt:at});
 const add=i=>{store.ingest([news(i)],new Date(clock).toISOString());service.research.process();};
 const finish=async()=>{for(const row of store.db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE run_id IS NOT NULL').all())await (row.kind==='extract'?service.materialEvents:row.kind==='identity'?service.companyEntities:service.modelResearch).wait(row.run_id);for(const row of store.db.prepare('SELECT id FROM semantic_runs').all())await service.semanticEvents.wait(row.id);};
 const step=async()=>{service.controlOperation('discovery','resume');const result=await service.runOperation('discovery');await finish();return result;};
 const drive=async(n=24)=>{for(let i=0;i<n;i++)await step();return queue.snapshot();};
 const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;const result=await step();if(result.error)assert.fail(JSON.stringify(result));}assert.fail('automatic pipeline did not reach expected state');};
 return {store,service,queue,calls,news,add,step,drive,finish,until,revise(i){const n=store.newsById(news(i).id);store.ingest([{...news(i),title:n.title+' revised'}],new Date(clock).toISOString());service.research.process();},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}
const allClusters=f=>f.service.eventClusters.list().items;
const cluster=f=>f.service.eventClusters.get(allClusters(f)[0].id);
const relationRows=f=>f.queue.snapshot().relations.items;
const candidateRelation=f=>relationRows(f).find(r=>r.status==='candidate');
async function two(f){f.add(1);await f.drive();f.add(2);await f.drive();return cluster(f);}

test('automatic first cluster and expansion preserve identity, complete pair evidence and no intermediate human tasks or orders',async()=>{
 const f=fixture();try{
  const book=f.service.paper.snapshot(),first=await two(f);assert.equal(first.actor.kind,'system');assert.equal(first.method,'system-model-pair-cluster');assert.equal(first.version,1);assert.equal(first.members.length,2);assert.equal(first.pairs.length,1);assert(first.health.current);assert.equal(f.calls.semantic,1);
  f.add(3);await f.drive();const next=cluster(f);assert.equal(next.id,first.id);assert.equal(next.version,2);assert.equal(next.members.length,3);assert.equal(next.pairs.length,3);assert.equal(next.history.length,2);assert.deepEqual(next.history[1],first.history[0]);assert(next.health.current);assert.equal(f.calls.semantic,3);
  for(const kind of ['relation','cluster','model'])assert.equal(f.service.workbenchQueue({kind}).total,0);assert.deepEqual(f.service.paper.snapshot(),book);
  const activities=f.service.activity({limit:200}).items.filter(i=>i.kind==='semantic-model');assert(activities.length);assert(activities.every(i=>i.detail.automatic));assert(relationRows(f).every(r=>r.automatic&&r.status==='completed'));assert(f.store.db.prepare('SELECT payload FROM semantic_decisions').all().every(r=>JSON.parse(r.payload).actor.kind==='system'));
 }finally{await f.close();}
});
for(const kind of ['uncertain','related','unrelated'])test(`automatic ${kind} result does not require a human task or enter a same-event cluster`,async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,kind)});try{f.add(1);await f.drive();f.add(2);await f.drive();assert.equal(allClusters(f).length,0);assert.equal(f.calls.semantic,1);assert.equal(relationRows(f)[0].status,kind==='uncertain'?'observing':'completed');assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});
test('a conflicting triangle cannot extend an existing cluster by transitivity',async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,p.input.left.url.endsWith('-3')&&p.input.right.url.endsWith('-1')?'unrelated':'followup')});try{const before=await two(f);f.add(3);await f.drive(40);assert.deepEqual(cluster(f),before);assert(f.queue.snapshot().clusters.items.some(j=>j.status==='observing'));assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});
test('new evidence can group multiple previously unclustered events with a reversed trigger',async()=>{
 let unknown=true;const f=fixture({semanticRunner:p=>comparison(p,unknown?'uncertain':'followup')});try{f.add(1);await f.drive();f.add(2);await f.drive();assert.equal(allClusters(f).length,0);unknown=false;f.add(3);await f.drive(60);const c=cluster(f);assert.equal(c.members.length,3,JSON.stringify(f.queue.snapshot().clusters));assert.equal(c.pairs.length,3);assert.equal(allClusters(f).length,1);assert(c.health.current);}finally{await f.close();}
});
test('relation retries have bounded backoff, retain failures and continue later sources',async()=>{
 const f=fixture({semanticRunner:()=>{throw Error('synthetic');}});try{
  f.add(1);await f.drive();f.add(2);await f.drive();assert.equal(f.calls.semantic,1);assert.equal(relationRows(f)[0].status,'queued');await f.drive();assert.equal(f.calls.semantic,1);f.advance(60001);await f.drive();assert.equal(f.calls.semantic,2);f.advance(120001);await f.drive();assert.equal(f.calls.semantic,3);assert.equal(relationRows(f)[0].status,'observing');assert.equal(relationRows(f)[0].attempts.length,3);await f.drive();assert.equal(f.calls.semantic,3);
  f.add(3);await f.drive();assert.equal(f.calls.dossier,3);assert.equal(f.store.db.prepare("SELECT count(*) n FROM semantic_runs WHERE status='failed'").get().n,5);assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);
 }finally{await f.close();}
});
test('automatic processing preserves an intervening human relationship rejection',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));const r=candidateRelation(f);f.service.semanticEvents.decide(r.runId,{version:0,action:'reject',note:'本人明确不同意同一事件判断'});await f.drive();assert.equal(f.service.semanticEvents.get(r.runId).history.length,1);assert.equal(relationRows(f)[0].status,'observing');assert.equal(allClusters(f).length,0);}finally{await f.close();}
});
test('changed research invalidates an unaccepted comparison and preserves the user edit',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));const r=candidateRelation(f),t=f.service.research.get(r.target.id);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人保留的新核验方向'});await f.drive();assert.equal(relationRows(f)[0].status,'invalidated');assert.equal(f.service.research.get(t.id).nextEvidence,'本人保留的新核验方向');assert.equal(allClusters(f).length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_decisions').get().n,0);}finally{await f.close();}
});
test('semantic decision and relation completion roll back together on storage failure',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));const r=candidateRelation(f);f.store.db.exec("CREATE TRIGGER fail_relation_commit BEFORE UPDATE ON research_pipeline_relations WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic-write'); END");await f.step();assert.equal(f.service.semanticEvents.get(r.runId).history.length,0);assert.equal(candidateRelation(f).id,r.id);f.store.db.exec('DROP TRIGGER fail_relation_commit');await f.drive();assert.equal(cluster(f).members.length,2);assert.equal(f.calls.semantic,1);assert.equal(f.service.semanticEvents.get(r.runId).history.length,1);}finally{await f.close();}
});
test('cluster, members, job and command roll back together and recover without duplicate calls',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));f.store.db.exec("CREATE TRIGGER fail_cluster_commit BEFORE INSERT ON event_cluster_versions BEGIN SELECT RAISE(ABORT,'synthetic-cluster'); END");await f.drive(4);assert.equal(allClusters(f).length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM event_cluster_members').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM event_cluster_commands').get().n,0);assert(f.queue.snapshot().clusters.items.some(j=>j.status==='processing'));f.store.db.exec('DROP TRIGGER fail_cluster_commit');await f.drive();assert.equal(cluster(f).version,1);assert.equal(f.calls.semantic,1);assert.equal(f.queue.snapshot().clusters.items[0].status,'completed');}finally{await f.close();}
});
test('an exhausted budget cannot block saving a completed comparison or cluster',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});f.add(3);await f.drive();assert.equal(cluster(f).members.length,2);assert.equal(f.calls.dossier,2);assert.equal(f.calls.semantic,1);}finally{await f.close();}
});
test('system clusters survive restart without duplicate decisions, versions or calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'automatic-cluster-')),path=join(dir,'test.sqlite');let f=fixture({path});try{const saved=await two(f);f.service.controlOperation('discovery','pause');await f.close();f=fixture({path});assert(f.service.operations().tasks.discovery.paused);await f.drive();assert.deepEqual(cluster(f),saved);assert.deepEqual(f.calls,{extract:0,identity:0,dossier:0,semantic:0});assert.equal(f.queue.snapshot().clusters.items[0].status,'completed');}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('serialized system actor and mutations on a restore-locked copy are rejected',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>!!candidateRelation(f));const r=candidateRelation(f),input={version:0,action:'accept',note:'test'};assert.throws(()=>f.service.semanticEvents.decide(r.runId,input,{...SYSTEM_RESEARCH_ACTOR}),/来源无效/);assert.throws(()=>f.service.eventClusters.save({}, {...SYSTEM_RESEARCH_ACTOR}),/来源无效/);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.service.semanticEvents.decide(r.runId,input,SYSTEM_RESEARCH_ACTOR),/恢复副本/);assert.equal(f.service.semanticEvents.get(r.runId).history.length,0);}finally{await f.close();}
});

async function missingPairFixture(){
 let f;f=fixture({semanticRunner:p=>{if(f.calls.semantic>=10)throw Error('synthetic missing pair failure');return comparison(p);}});
 for(let i=1;i<=4;i++){f.add(i);await f.drive();}assert.equal(cluster(f).members.length,4);assert.equal(f.calls.semantic,6);
 const before=cluster(f);f.add(5);await f.drive();assert.equal(f.calls.semantic,10);const job=f.queue.snapshot().clusters.items.find(j=>j.counts?.failed);assert(job);return {f,before,job};
}
test('missing complete-pair work retries under the shared budget and stops after three failures without shrinking the old cluster',async()=>{
 const {f,before,job}=await missingPairFixture();try{
  await f.drive();assert.equal(f.calls.semantic,10);const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});f.advance(60001);await f.drive();assert.equal(f.calls.semantic,10,'retry cannot bypass rolling quota');
  f.queue.configure({version:s.settings.version+1,dailyCalls:100,includeClues:false});await f.drive();assert.equal(f.calls.semantic,11);f.advance(120001);await f.drive();assert.equal(f.calls.semantic,12);await f.drive();assert.equal(f.calls.semantic,12);
  assert.deepEqual(cluster(f),before);const saved=f.queue.snapshot().clusters.items.find(j=>j.id===job.id);assert.equal(saved.status,'observing');assert.equal(f.service.semanticBatches.get(job.batchId).items.find(i=>i.status==='failed').attempts.length,3);
  assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);
 }finally{await f.close();}
});
for(const action of ['pause','cancel'])test(`automatic cluster ${action} is respected across the retry deadline`,async()=>{
 const {f,before,job}=await missingPairFixture();try{
  f.service.semanticBatches.control(job.batchId,{action});f.advance(180001);await f.drive(40);assert.equal(f.calls.semantic,10);assert.deepEqual(cluster(f),before);const saved=f.queue.snapshot().clusters.items.find(j=>j.id===job.id);assert.equal(saved.status,action==='pause'?'paused':'cancelled');
 }finally{await f.close();}
});
test('automatic batch retry and audit remain atomic after a storage failure',async()=>{
 const {f,job}=await missingPairFixture();try{
  f.advance(60001);f.store.db.exec("CREATE TRIGGER fail_batch_retry BEFORE INSERT ON research_pipeline_audit WHEN NEW.action='automatic-cluster-retry' BEGIN SELECT RAISE(ABORT,'synthetic'); END");await f.step();assert.equal(f.service.semanticBatches.get(job.batchId).counts.failed,1);assert.equal(f.calls.semantic,10);
  f.store.db.exec('DROP TRIGGER fail_batch_retry');await f.drive();assert.equal(f.calls.semantic,11);
 }finally{await f.close();}
});

test('workbench projects actual scoped cluster identity read-only and invalidates grouping after a relationship withdrawal',async()=>{
 const f=fixture();try{
  const first=await two(f);f.add(3);await f.drive();const c=cluster(f),writes=f.store.db.prepare('SELECT total_changes() n').get().n;
  const snapshot=f.service.snapshot(),projection=snapshot.overview.eventClusters;
  assert.equal(projection.length,1);assert.equal(projection[0].id,first.id);assert.equal(projection[0].version,2);assert.equal(projection[0].health.current,true);
  assert.deepEqual(new Set(projection[0].topicIds),new Set(c.members.map(m=>m.id)));assert.equal(projection[0].actor.kind,'system');
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,writes);
  const run=f.service.semanticEvents.get(c.pairs[0].basis.runId);
  f.service.semanticEvents.decide(run.id,{version:run.decisionVersion,action:'withdraw',note:'本人撤销，首页不能继续把各份研究合并显示'});
  assert.equal(f.service.snapshot().overview.eventClusters[0].health.current,false);
  f.service.eventClusters.archive(c.id,{version:c.version,note:'归档保留研究与历史',requestId:'workbench-archive-test-1'});
  assert.equal(f.service.snapshot().overview.eventClusters.length,0);assert.equal(f.service.eventClusters.get(c.id).history.length,3);
  for(const id of projection[0].topicIds)assert.equal(f.service.research.get(id).status,'active');
 }finally{await f.close();}
});


test('automatic source revision retains the cluster ID, replaces only its old occurrence and preserves all research and history',async()=>{
 const f=fixture();try{
  const first=await two(f),old=f.service.research.get(first.members.find(m=>m.url.endsWith('-1')).id),book=f.service.paper.snapshot();
  f.revise(1);await f.drive(60);const next=cluster(f);
  assert.equal(next.id,first.id);assert.equal(next.version,2,JSON.stringify({jobs:f.queue.snapshot().clusters.items.map(j=>({mode:j.mode,status:j.status,reason:j.reason}))}));assert.equal(next.actor.kind,'system');assert.equal(next.method,'system-model-event-succession');assert(next.health.current);
  assert.equal(f.calls.semantic,2,'reuse the existing comparison in its original direction');assert.equal(next.replacement.mappings.length,1);assert.equal(next.replacement.mappings[0].before.id,old.id);assert.equal(next.replacement.mappings[0].after.materialRevision,2);
  assert.deepEqual(next.history[1],first.history[0]);assert.deepEqual(f.service.research.get(old.id),old);assert.deepEqual(f.service.paper.snapshot(),book);
  assert.deepEqual(f.service.research.related(old.id).eventClusters[0].historicalVersions,[1]);assert.equal(f.service.research.related(old.id).eventClusters[0].bindingCurrent,false);
  const job=f.queue.snapshot().clusters.items.find(j=>j.mode==='replace');assert.equal(job.status,'completed');assert.equal(job.confirmedVersion,2);assert.equal(job.stale,false);
  assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);
  f.revise(1);await f.drive(60);const third=cluster(f);assert.equal(third.id,first.id);assert.equal(third.version,3);assert.equal(third.replacement.mappings[0].after.materialRevision,3);assert.deepEqual(third.history.slice(1),next.history);
 }finally{await f.close();}
});

function revisedAlternatives(p){
 const first=extraction(p).decomposition.events[0],events=p.input.material.revision>1?[{...first,title:'另一独立事项',action:'取消',object:'其他项目',quote:'虚构甲取消项目。'},first]:[first];
 return output(p,'decomposition',{events,scopeNote:'合成多个事项',missingEvidence:['真实依据']});
}
test('automatic revision compares every new alternative and continues only the unique matching occurrence',async()=>{
 const f=fixture({extractionRunner:revisedAlternatives,semanticRunner:p=>comparison(p,p.input.left.eventFocus.object===p.input.right.eventFocus.object?'followup':'unrelated')});try{
  const before=await two(f);f.revise(1);await f.drive(80);const next=cluster(f);assert.equal(next.id,before.id);assert.equal(next.version,2);assert.equal(next.members.length,2);assert.equal(next.replacement.mappings[0].after.eventFocus.object,'虚构乙');
  const job=f.queue.snapshot().clusters.items.find(j=>j.mode==='replace'),batch=f.service.semanticBatches.get(job.batchId);assert.equal(batch.inputCount,3);assert.equal(batch.items.length,3);assert.equal(job.confirmedVersion,2);assert.equal(job.stale,false);
  assert(f.service.research.list().some(t=>t.title==='另一独立事项'));assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);
 }finally{await f.close();}
});
for(const relation of ['uncertain','unrelated','reversal'])test(`source revision ${relation} keeps its proper continuity outcome without erasing history`,async()=>{
 let revised=false;const f=fixture({semanticRunner:p=>comparison(p,revised?relation:'followup')});try{const before=await two(f);revised=true;f.revise(1);await f.drive(60);const after=cluster(f);assert.equal(after.version,relation==='reversal'?2:1);assert.deepEqual(after.history.at(-1),before.history[0]);if(relation!=='reversal')assert(f.queue.snapshot().clusters.items.some(j=>j.mode==='replace'&&j.status==='observing'));assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});
test('two plausible revised occurrences cannot choose an arbitrary successor',async()=>{
 const f=fixture({extractionRunner:revisedAlternatives});try{const before=await two(f);f.revise(1);await f.drive(80);assert.equal(cluster(f).version,1);assert.deepEqual(cluster(f).history,before.history);assert(f.queue.snapshot().clusters.items.some(j=>j.mode==='replace'&&j.status==='observing'));}finally{await f.close();}
});
test('a withdrawal of original grouping evidence cannot be bypassed by a source revision',async()=>{
 const f=fixture();try{const before=await two(f),r=f.service.semanticEvents.get(before.pairs[0].basis.runId);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'withdraw',note:'本人撤回原同事件判断'});f.revise(1);await f.drive(60);assert.equal(cluster(f).version,1);assert(f.queue.snapshot().clusters.items.some(j=>j.mode==='replace'&&j.status==='observing'));assert.equal(f.service.semanticEvents.get(r.id).decision.action,'withdraw');}finally{await f.close();}
});

const currentSuccession=f=>f.queue.snapshot().clusters.items.find(j=>j.mode==='replace');
async function pendingSuccession(f){
 const before=await two(f);f.revise(1);
 await f.until(()=>!!f.store.db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE status='active' AND json_extract(payload,'$.mode')='replace'").get());
 return {before,job:currentSuccession(f)};
}
const alternativeOptions={extractionRunner:revisedAlternatives,semanticRunner:p=>comparison(p,p.input.left.eventFocus.object===p.input.right.eventFocus.object?'followup':'unrelated')};
for(const mode of ['source','user-edit','original-decision','archive'])test(`pending automatic succession respects ${mode} changes`,async()=>{
 const f=fixture(alternativeOptions);try{const {before,job}=await pendingSuccession(f);
  if(mode==='source')f.revise(1);
  if(mode==='user-edit'){const t=f.service.research.get(job.sources[0].topics[0].id);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人新的核验方向'});}
  if(mode==='original-decision'){const r=f.service.semanticEvents.get(before.pairs[0].basis.runId);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'withdraw',note:'本人撤回原关系'});}
  if(mode==='archive')f.service.eventClusters.archive(before.id,{version:before.version,note:'本人归档',requestId:'archive-during-auto-succession'});
  await f.step();assert.equal(currentSuccession(f).status,'invalidated');assert.equal(f.service.eventClusters.get(before.id).version,mode==='archive'?2:1);assert.equal(f.store.db.prepare('SELECT 1 FROM event_cluster_commands WHERE request_id=?').get(job.id),undefined);
 }finally{await f.close();}
});
for(const action of ['pause','cancel'])test(`automatic succession ${action} does not restart or affect other research`,async()=>{
 const f=fixture(alternativeOptions);try{const {before,job}=await pendingSuccession(f),calls=f.calls.semantic;f.service.semanticBatches.control(job.batchId,{action});f.advance(180001);await f.drive(10);assert.equal(cluster(f).version,before.version);assert.equal(f.calls.semantic,calls);assert.equal(currentSuccession(f).status,action==='pause'?'paused':'cancelled');f.add(3);await f.drive(40);assert(f.service.research.list().some(t=>t.sourceNewsId===f.news(3).id));}finally{await f.close();}
});
test('succession membership, history, command and completion roll back together, then resume without another call',async()=>{
 const f=fixture(alternativeOptions);try{const {before,job}=await pendingSuccession(f),members=f.store.db.prepare('SELECT * FROM event_cluster_members ORDER BY member_key').all(),calls=f.calls.semantic,pending=f.service.semanticBatches.get(job.batchId).counts.queued;
  f.store.db.exec("CREATE TRIGGER fail_succession_save BEFORE INSERT ON event_cluster_versions WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'synthetic-succession'); END");await f.drive(6);
  assert.equal(cluster(f).version,1);assert.deepEqual(cluster(f).history,before.history);assert.deepEqual(f.store.db.prepare('SELECT * FROM event_cluster_members ORDER BY member_key').all(),members);assert.equal(f.store.db.prepare('SELECT 1 FROM event_cluster_commands WHERE request_id=?').get(job.id),undefined);assert.equal(currentSuccession(f).status,'processing');assert.equal(f.calls.semantic,calls+pending);
  f.store.db.exec('DROP TRIGGER fail_succession_save');await f.drive();assert.equal(cluster(f).version,2);assert.equal(currentSuccession(f).status,'completed');assert.equal(f.calls.semantic,calls+pending);assert.equal(cluster(f).actor.kind,'system');
  assert.throws(()=>f.service.eventClusters.replace(before.id,{}, {...SYSTEM_RESEARCH_ACTOR}),/来源无效/);
 }finally{await f.close();}
});
test('pending succession resumes after restart without duplicate comparisons or replacing old records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'automatic-succession-')),path=join(dir,'test.sqlite');let f=fixture({path,...alternativeOptions});try{const {before,job}=await pendingSuccession(f),batch=f.service.semanticBatches.get(job.batchId),pending=batch.counts.queued,completed=batch.items.filter(i=>i.runId).map(i=>({ordinal:i.ordinal,runId:i.runId,attempts:i.attempts}));assert.equal(pending,1);f.service.controlOperation('discovery','pause');await f.close();f=fixture({path,...alternativeOptions});assert(f.service.operations().tasks.discovery.paused);await f.drive();const saved=cluster(f);assert.equal(saved.id,before.id);assert.equal(saved.version,2);assert.deepEqual(saved.history[1],before.history[0]);assert.deepEqual(f.calls,{extract:0,identity:0,dossier:0,semantic:pending});for(const item of completed){const restored=f.service.semanticBatches.get(job.batchId).items.find(i=>i.ordinal===item.ordinal);assert.equal(restored.runId,item.runId);assert.deepEqual(restored.attempts,item.attempts);}await f.drive();assert.deepEqual(cluster(f),saved);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('queued revisions of both sources continue serially through retained members without losing identity',async()=>{
 const f=fixture();try{const before=await two(f);f.revise(1);f.revise(2);await f.drive(80);const after=cluster(f);assert.equal(after.id,before.id);assert.equal(after.version,3);assert.equal(after.history.length,3);assert.deepEqual(after.history.at(-1),before.history[0]);assert(after.members.every(m=>m.materialRevision===2));assert(after.health.current);assert.equal(f.queue.snapshot().clusters.items.filter(j=>j.mode==='replace'&&j.status==='completed').length,2);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});

test('a revised source with no new occurrence records one observation and leaves other sources running',async()=>{
 const f=fixture({extractionRunner:p=>p.input.material.revision>1?output(p,'decomposition',{events:[],scopeNote:'新版没有具体事项',missingEvidence:['需要后续材料']}):extraction(p)});try{const before=await two(f);f.revise(1);await f.drive(60);const job=currentSuccession(f);assert.equal(job.status,'observing');assert.equal(job.batchId,null);assert.match(job.reason,/未识别出具体事项/);assert.equal(cluster(f).version,before.version);const count=f.store.db.prepare("SELECT count(*) n FROM research_pipeline_cluster_jobs WHERE json_extract(payload,'$.mode')='replace'").get().n;await f.drive();assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_cluster_jobs WHERE json_extract(payload,'$.mode')='replace'").get().n,count);f.add(3);await f.drive();const next=f.store.db.prepare("SELECT topic_id,run_id FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsId')=?").get(f.news(3).id);assert(next);assert.equal(f.service.research.get(next.topic_id).dossier.sourceModelRun.id,next.run_id);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});
test('a user edit before revision planning becomes an explicit observation instead of indefinite waiting',async()=>{
 const f=fixture();try{const before=await two(f);f.revise(1);await f.until(()=>!!f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsRevision')=2").get());const row=f.store.db.prepare("SELECT topic_id FROM research_pipeline_event_jobs WHERE kind='dossier' AND json_extract(payload,'$.newsRevision')=2").get(),topic=f.service.research.get(row.topic_id);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'本人保留的新方向'});await f.drive();const job=currentSuccession(f);assert.equal(job.status,'observing');assert.equal(job.batchId,null);assert.match(job.reason,/本人编辑/);assert.equal(f.service.research.get(topic.id).nextEvidence,'本人保留的新方向');assert.equal(cluster(f).version,before.version);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});


function multipleOccurrences(p){
 const first=extraction(p).decomposition.events[0],second={...first,title:'第二个合成事项',action:'取消',object:'其他项目',quote:'虚构甲取消项目。'};
 return output(p,'decomposition',{events:p.input.material.revision>1?[second,first]:[first,second],scopeNote:'两个合成事项，只验证接续引擎',missingEvidence:['真实独立质量']});
}
const matrixComparison=p=>comparison(p,p.schema==='event-revision-pair-1'&&p.input.left.eventFocus.object!==p.input.right.eventFocus.object?'unrelated':'followup');
async function sameDocumentCluster(f){
 f.add(1);await f.drive(40);const topics=f.service.research.list().filter(t=>t.eventExtraction);assert.equal(topics.length,2);
 if(allClusters(f).length)return cluster(f);
 const inputs=topics.map(t=>({kind:'event',id:t.id,revision:1})),plan=f.service.semanticBatches.preview({inputs});
 const b=f.service.semanticBatches.create({inputs,planHash:plan.planHash,requestId:'seed-two-original-occurrences'});
 for(let i=0;i<4;i++){const r=f.service.semanticBatches.step({assertActive(){}},{actor:SYSTEM_RESEARCH_ACTOR});if(r.runId)await f.service.semanticEvents.wait(r.runId);}
 for(const item of f.service.semanticBatches.get(b.id).items){const r=f.service.semanticEvents.get(item.runId);if(!r.decision)f.service.semanticEvents.decide(r.id,{version:0,action:'accept',note:'冻结初始系统测试依据'},SYSTEM_RESEARCH_ACTOR);}
 const group=f.service.eventClusters.preview(b.id).groups.find(g=>g.state==='ready');assert(group);
 const saved=f.service.eventClusters.save({batchId:b.id,groupId:group.id,previewHash:group.hash,clusterId:'',version:0,title:'合成多事项原簇',note:'冻结原始测试归组，不代表真实语义正确',requestId:'seed-original-cluster-mapping'},SYSTEM_RESEARCH_ACTOR);
 return f.service.eventClusters.get(saved.id);
}
test('same-document multi-occurrence revision compares the complete old-by-new matrix and preserves one-to-one history without an anchor',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{
  const before=await sameDocumentCluster(f),old=before.members.map(m=>f.service.research.get(m.id)),book=f.service.paper.snapshot();f.revise(1);await f.drive(100);const after=cluster(f);
  assert.equal(after.id,before.id);assert.equal(after.version,2,JSON.stringify(f.queue.snapshot().clusters));assert(after.health.current);assert.equal(after.replacement.mappings.length,2);
  assert(after.replacement.mappings.every(m=>m.before.eventFocus.object===m.after.eventFocus.object&&m.after.materialRevision===2));
  assert.equal(after.replacement.correspondence.pairs.length,4);assert.deepEqual(after.history.at(-1),before.history[0]);assert.deepEqual(old.map(t=>f.service.research.get(t.id)),old);assert.deepEqual(f.service.paper.snapshot(),book);
  const job=currentSuccession(f),batch=f.service.semanticBatches.get(job.correspondenceBatchId);assert.equal(batch.pairCount,4);assert.equal(batch.revision.clusterHash,before.snapshotHash);assert.equal(job.status,'completed');assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);assert.throws(()=>f.service.eventClusters.preview(batch.id),/不能直接/);
  assert(f.service.snapshot().overview.eventClusters[0].history.every(h=>h.currentTopicId!==h.topicId));
 }finally{await f.close();}
});
for(const outcome of ['ambiguous','uncertain','unrelated','related'])test(`a ${outcome} revision matrix does not choose by order or shrink the old cluster`,async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:p=>comparison(p,p.schema==='event-revision-pair-1'?(outcome==='ambiguous'?'followup':outcome):'followup')});try{
  const before=await sameDocumentCluster(f);f.revise(1);await f.drive(100);assert.equal(cluster(f).snapshotHash,before.snapshotHash);assert.deepEqual(cluster(f).history,before.history);assert.equal(cluster(f).health.current,false);assert.equal(currentSuccession(f).status,'observing');assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);
 }finally{await f.close();}
});

async function pendingMatrix(f){const before=await sameDocumentCluster(f);f.revise(1);await f.until(()=>currentSuccession(f)?.phase==='correspondence'&&currentSuccession(f).batchId);return {before,job:currentSuccession(f)};}
for(const action of ['pause','cancel'])test(`revision correspondence ${action} remains authoritative while other sources continue`,async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {before,job}=await pendingMatrix(f),calls=f.calls.semantic;f.service.semanticBatches.control(job.batchId,{action});f.advance(180001);await f.drive(15);assert.equal(f.calls.semantic,calls);assert.equal(currentSuccession(f).status,action==='pause'?'paused':'cancelled');assert.equal(cluster(f).snapshotHash,before.snapshotHash);f.add(2);await f.drive(60);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.newsId')=?").get(f.news(2).id).n,2);}finally{await f.close();}
});
for(const mode of ['source','edit','withdraw','archive'])test(`revision correspondence rejects changed ${mode} before advancing`,async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {before,job}=await pendingMatrix(f);
  if(mode==='source')f.revise(1);
  if(mode==='edit'){const t=f.service.research.get(job.sources[0].topics[0].id);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人保留的新方向'});}
  if(mode==='withdraw'){const r=f.service.semanticEvents.get(before.pairs[0].basis.runId);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'withdraw',note:'撤销原归组'});}
  if(mode==='archive')f.service.eventClusters.archive(before.id,{version:before.version,note:'归档测试',requestId:'archive-mapping-original-cluster'});
  await f.step();assert.equal(f.queue.snapshot().clusters.items.find(j=>j.id===job.id).status,'invalidated');assert.equal(f.store.db.prepare('SELECT count(*) n FROM event_cluster_versions WHERE cluster_id=?').get(before.id).n,mode==='archive'?2:1);
 }finally{await f.close();}
});
test('revision correspondence shares quota and resumes completed pairs without a second call',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {job}=await pendingMatrix(f),calls=f.calls.semantic,s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});await f.drive(20);assert.equal(f.calls.semantic,calls);assert.equal(currentSuccession(f).phase,'correspondence');assert.equal(f.service.semanticBatches.get(job.batchId).counts.candidate,1);
 f.queue.configure({version:s.settings.version+1,dailyCalls:100,includeClues:false});await f.drive(80);assert.equal(currentSuccession(f).status,'completed');assert.equal(f.service.semanticBatches.get(job.batchId).items.flatMap(i=>i.attempts).length,4);assert.equal(f.calls.semantic-calls,4);
 }finally{await f.close();}
});
test('failed revision correspondence retries three times, retains attempts and does not claim a mapping',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:p=>{if(p.schema==='event-revision-pair-1')throw Error('synthetic revision failure');return comparison(p);}});try{const {before,job}=await pendingMatrix(f);await f.drive(20);f.advance(60001);await f.drive(20);f.advance(120001);await f.drive(40);const batch=f.service.semanticBatches.get(job.batchId);assert.equal(currentSuccession(f).status,'observing');assert(batch.items.some(i=>i.attempts.length===3));assert(batch.items.every(i=>i.attempts.length<=3));assert.equal(cluster(f).snapshotHash,before.snapshotHash);const calls=f.calls.semantic;await f.drive(10);assert.equal(f.calls.semantic,calls);}finally{await f.close();}
});
test('revision mapping and its next batch transition are atomic and recover without repeating model work',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {job}=await pendingMatrix(f);f.store.db.exec("CREATE TRIGGER fail_mapping_transition BEFORE INSERT ON research_pipeline_audit WHEN NEW.action='automatic-succession-mapped' BEGIN SELECT RAISE(ABORT,'synthetic-transition'); END");await f.drive(25);const completed=f.service.semanticBatches.get(job.batchId);assert.equal(completed.counts.candidate,4);assert.equal(currentSuccession(f).phase,'correspondence');assert.equal(f.store.db.prepare("SELECT count(*) n FROM semantic_batches WHERE json_extract(payload,'$.requestId')=?").get(digest({job:job.id,phase:'current'})).n,0);
 f.store.db.exec('DROP TRIGGER fail_mapping_transition');const calls=f.calls.semantic;await f.drive(40);assert.equal(currentSuccession(f).status,'completed');assert.equal(f.calls.semantic-calls,1);assert.equal(f.service.semanticBatches.get(job.batchId).items.flatMap(i=>i.attempts).length,4);
 }finally{await f.close();}
});
test('a saved mapping survives restart and only its unfinished current comparison resumes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'revision-matrix-restart-')),path=join(dir,'test.sqlite');let f=fixture({path,extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {before}=await pendingMatrix(f);await f.until(()=>currentSuccession(f)?.phase==='current');const job=currentSuccession(f),mapping=f.service.semanticBatches.get(job.correspondenceBatchId);f.service.controlOperation('discovery','pause');await f.close();f=fixture({path,extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});await f.drive(40);assert.equal(cluster(f).id,before.id);assert.equal(cluster(f).version,2);assert.equal(f.calls.semantic,1);assert.deepEqual(f.service.semanticBatches.get(job.correspondenceBatchId).items.map(i=>i.attempts),mapping.items.map(i=>i.attempts));assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('a many-to-one mapping is ambiguous and a missing matrix pair never proves uniqueness',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:p=>comparison(p,p.schema==='event-revision-pair-1'&&p.input.right.eventFocus.object!=='虚构乙'?'unrelated':'followup')});try{const {before}=await pendingMatrix(f);await f.drive(60);assert.equal(currentSuccession(f).status,'observing');assert.equal(cluster(f).version,before.version);}finally{await f.close();}
 const g=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {job}=await pendingMatrix(g);g.store.db.prepare('DELETE FROM semantic_batch_items WHERE batch_id=? AND ordinal=3').run(job.batchId);await g.drive(60);assert.equal(currentSuccession(g).status,'observing');assert.equal(cluster(g).version,1);}finally{await g.close();}
});
test('withdrawing saved revision evidence invalidates current grouping without rewriting the saved lineage',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{await pendingMatrix(f);await f.drive(70);const saved=cluster(f),pair=saved.replacement.correspondence.pairs[0],r=f.service.semanticEvents.get(pair.basis.runId);assert(saved.health.current);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'withdraw',note:'本人撤销修订对应依据'});assert.equal(cluster(f).health.current,false);assert.equal(cluster(f).snapshotHash,saved.snapshotHash);assert.deepEqual(cluster(f).history,saved.history);assert.equal(f.service.snapshot().overview.eventClusters[0].health.current,false);}finally{await f.close();}
});
test('historical input remains unavailable to ordinary comparisons and serialized actors cannot create revision calls',async()=>{
 const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:matrixComparison});try{const {before,job}=await pendingMatrix(f),left={kind:'event',id:before.members[0].id,revision:1},right={kind:'event',id:job.sources[0].topics[0].id,revision:1};assert.throws(()=>f.service.semanticEvents.start({left,right}),/已变化|修订/);assert.throws(()=>f.service.semanticEvents.startRevision({left,right,revision:job.revision},()=>{},{...SYSTEM_RESEARCH_ACTOR}),/仅由/);const call=f.service.semanticBatches.get(job.batchId).items.find(i=>i.runId),run=f.service.semanticEvents.get(call.runId);assert.equal(run.packet.schema,'event-revision-pair-1');assert.equal(run.packet.input.left.materialRevision,1);assert.equal(run.packet.input.right.materialRevision,2);assert(run.packet.input.left.body);assert(run.packet.input.right.body);}finally{await f.close();}
});
test('a unique revision mapping still cannot save inconsistent current members',async()=>{
 let revised=false;const f=fixture({extractionRunner:multipleOccurrences,semanticRunner:p=>p.schema==='event-revision-pair-1'?matrixComparison(p):comparison(p,revised?'unrelated':'followup')});try{const before=await sameDocumentCluster(f);revised=true;f.revise(1);await f.drive(100);assert.equal(currentSuccession(f).status,'observing');assert(currentSuccession(f).correspondenceBatchId);assert.equal(cluster(f).snapshotHash,before.snapshotHash);assert.equal(f.service.workbenchQueue({kind:'cluster'}).total,0);}finally{await f.close();}
});
