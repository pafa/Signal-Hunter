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
function comparison(p,relation='followup'){const event=side=>({actor:'虚构甲',action:'拟收购',object:'虚构乙',eventTime:'未知',stage:'待核',quote:p.input[side].eventFocus.quote,quoteField:'body',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'}});return output(p,'comparison',{relation,left:event('left'),right:event('right'),reason:'仅为引擎流程测试，两侧均引用冻结事项；不证明模型质量',missingEvidence:['真实公告与事实']});}
function fixture({path=':memory:',semanticRunner=comparison}={}){
 let clock=Date.parse(at);const store=openStore(path);assertDatabaseMode(store,'research');const calls={extract:0,identity:0,dossier:0,semantic:0};
 const service=createService(store,{mode:'research',modelConfig:config,now:()=>clock,sourceReader:async url=>({url,title:'合成公告',sourceName:'合成',body:quote+'这些文字是合成测试材料，不证明事实与投资表现。'.repeat(30),scope:'extracted-text'}),materialEventRunner:async p=>{calls.extract++;return extraction(p);},companyEntityRunner:async p=>{calls.identity++;return identity(p);},modelRunner:async p=>{calls.dossier++;return dossier(p);},semanticRunner:async p=>{calls.semantic++;return semanticRunner(p);}});
 const queue=service.researchPipeline;if(queue.snapshot().settings.version===1)queue.configure({version:1,dailyCalls:100,includeClues:false,extractEvents:true,automatic:true});
 const news=i=>({id:digest('automatic-cluster-'+i),title:`Synthetic acquisition bankruptcy report ${i}`,url:`https://example.com/synthetic-${i}`,publisher:'合成',publishedAt:at});
 const add=i=>{store.ingest([news(i)],new Date(clock).toISOString());service.research.process();};
 const finish=async()=>{for(const row of store.db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE run_id IS NOT NULL').all())await (row.kind==='extract'?service.materialEvents:row.kind==='identity'?service.companyEntities:service.modelResearch).wait(row.run_id);for(const row of store.db.prepare('SELECT id FROM semantic_runs').all())await service.semanticEvents.wait(row.id);};
 const step=async()=>{service.controlOperation('discovery','resume');const result=await service.runOperation('discovery');await finish();return result;};
 const drive=async(n=24)=>{for(let i=0;i<n;i++)await step();return queue.snapshot();};
 const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;const result=await step();if(result.error)assert.fail(JSON.stringify(result));}assert.fail('automatic pipeline did not reach expected state');};
 return {store,service,queue,calls,news,add,step,drive,finish,until,advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
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
