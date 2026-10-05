import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {openResearchPipeline} from '../server/research-pipeline.mjs';
import {createHandler} from '../server/index.mjs';
import {createBackup} from '../server/backup.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {digest} from '../server/codex-research.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000},at='2026-10-03T00:00:00Z';
function dossier(p){const v={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成测试研判'],sourceIds:[]})),missingEvidence:['核验']},rawOutput=JSON.stringify(v);return {status:'candidate',reviewStatus:'unreviewed',...v,rawOutput,trace:{model:config.model,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,outputHash:digest(rawOutput)}};}
function comparison(p){const side=k=>({actor:'合成主体',action:'待核',object:'未知',eventTime:'未知',stage:'未知',quote:p.input[k].body.slice(0,80),quoteField:'body',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'}}),v={relation:'unrelated',left:side('left'),right:side('right'),reason:'合成未关联结果也应保留',missingEvidence:['人工核验']},rawOutput=JSON.stringify(v);return {status:'candidate',reviewStatus:'unreviewed',comparison:v,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};}
function fixture({path=':memory:',runner=async p=>comparison(p)}={}){
 let clock=Date.parse(at),models=0,comparisons=0;const store=openStore(path);assertDatabaseMode(store,'research');const service=createService(store,{mode:'research',modelConfig:config,now:()=>clock,modelRunner:async p=>{models++;return dossier(p);},semanticRunner:async p=>{comparisons++;return runner(p);},sourceReader:async url=>({url,title:'Synthetic Orion files for bankruptcy',sourceName:'合成来源',body:'新的合成报道材料，描述同名公司的待核变化。'.repeat(20),scope:'extracted-text'})});
 const research=service.research,queue=service.researchPipeline;
 const target=(i=0,body=true)=>{let t=research.create({title:`Synthetic Orion files for bankruptcy ${i}`,summary:'合成既有研究'});if(body)t=research.saveMaterial(t.id,{version:t.version,title:t.title,sourceName:'合成',url:`https://example.com/old-${i}`,body:`既有合成材料${i}，保留来源原文供核对。`.repeat(20),scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'合成'});return t;};
 const news={id:digest('relation-news'),title:'Synthetic Orion files for bankruptcy',url:'https://example.com/new',publisher:'合成',publishedAt:at};
 const add=()=>{store.ingest([news],at);research.process();};
 const step=()=>{service.controlOperation('discovery','resume');return service.runOperation('discovery');};
 const finish=async()=>{for(const i of queue.snapshot().items)if(i.runId)await service.modelResearch.wait(i.runId);for(const r of queue.snapshot().relations.items)if(r.runId)await service.semanticEvents.wait(r.runId);return queue.snapshot();};
 return {store,service,research,queue,target,news,add,step,finish,get models(){return models;},get comparisons(){return comparisons;},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}
test('discovery freezes at most three body comparisons, retains negative results and never rewrites prior research or decisions',async()=>{
 const f=fixture();try{for(let i=0;i<5;i++)f.target(i);const before=f.research.list(),book=f.service.paper.snapshot();f.add();await f.step();let s=await f.finish();assert.equal(s.relations.items.length,3);assert.equal(s.relations.counts.queued,3);assert.equal(s.callsInLast24Hours,1);assert.equal(s.items[0].relationCoverage.maximumComparisons,3);assert.equal(f.comparisons,0);
 for(let i=0;i<3;i++){await f.step();await f.finish();}s=f.queue.snapshot();assert.equal(s.callsInLast24Hours,4);assert.equal(f.models,1);assert.equal(f.comparisons,3);assert.equal(s.relations.counts.candidate,3);assert(s.relations.items.every(r=>r.comparison.relation==='unrelated'&&!r.stale));assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_decisions').get().n,0);for(const old of before)assert.deepEqual(f.research.list().find(t=>t.id===old.id),old);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(s.relations.items[0].packet,undefined);const run=f.service.semanticEvents.get(s.relations.items[0].runId);assert(run.packet.input.left.body);assert.equal(run.packet.input.right.contentScope,'excerpt');await f.step();assert.equal(f.comparisons,3);
 }finally{await f.close();}
});
test('missing body is recorded as skipped without using titles as full text',async()=>{
 const f=fixture();try{f.target(0,false);f.add();await f.step();await f.finish();const r=f.queue.snapshot().relations.items[0];assert.equal(r.status,'skipped');assert.match(r.reason,/正文/);await f.step();assert.equal(f.comparisons,0);}finally{await f.close();}
});
test('automatic dossier and relation retries share a rolling call ceiling',async()=>{
 let fail=true;const f=fixture({runner:async p=>{if(fail)throw Error('synthetic failure');return comparison(p);}});try{f.target();f.add();f.queue.configure({version:1,dailyCalls:2,includeClues:false});await f.step();await f.finish();await f.step();await f.finish();let r=f.queue.snapshot().relations.items[0];assert.equal(r.status,'failed');const first=r.runId;await f.step();assert.equal(f.comparisons,1);fail=false;f.queue.retryRelation(r.id);await f.step();assert.equal(f.comparisons,1);f.advance(86400001);await f.step();await f.finish();r=f.queue.snapshot().relations.items[0];assert.equal(r.status,'candidate');assert.equal(r.attempts.length,2);assert.equal(r.attempts[0].run_id,first);assert.equal(f.service.semanticEvents.get(first).status,'failed');assert.equal(f.queue.snapshot().callsInLast24Hours,1);
 }finally{await f.close();}
});
test('news or target material revisions invalidate only the frozen plan and preserve its original packet',async()=>{
 for(const change of ['news','material']){const f=fixture();try{const t=f.target();f.add();await f.step();await f.finish();const original=f.store.db.prepare('SELECT payload FROM research_pipeline_relations').get().payload;if(change==='news'){f.store.ingest([{...f.news,title:'Synthetic Orion revised bankruptcy'}],'2026-10-03T01:00:00Z');}else f.research.saveMaterial(t.id,{version:t.version,title:t.title,sourceName:'合成',url:'https://example.com/old-0',body:'新的修订正文，与原先不同。'.repeat(20),scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'修订'});await f.step();assert.equal(f.comparisons,0);const r=f.queue.snapshot().relations.items[0];assert.equal(r.status,'invalidated');assert(r.stale);assert.equal(f.store.db.prepare('SELECT payload FROM research_pipeline_relations').get().payload,original);assert.throws(()=>f.queue.retryRelation(r.id),/只有失败/);
 }finally{await f.close();}}
});
test('changed execution settings do not silently run a frozen relation with another model',async()=>{
 const f=fixture();try{f.target();f.add();await f.step();await f.finish();const queue=openResearchPipeline(f.store,f.research,f.service.modelResearch,{enabled:true,config:{...config,model:'different'},now:()=>Date.parse(at),semantic:f.service.semanticEvents,recall:()=>({items:[]})});await queue.step({assertActive(){}});assert.equal(queue.snapshot().relations.counts.invalidated,1);assert.equal(f.comparisons,0);}finally{await f.close();}
});
test('comparison, queue linkage, budget and lease commit atomically; failed storage leaves a retryable queued job',async()=>{
 const f=fixture();try{f.target();f.add();await f.step();await f.finish();f.store.db.exec("CREATE TRIGGER reject_relation_attempt BEFORE INSERT ON research_pipeline_attempts BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");await f.step();assert.equal(f.comparisons,0);assert.equal(f.queue.snapshot().relations.counts.queued,1);assert.equal(f.queue.snapshot().callsInLast24Hours,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);f.store.db.exec('DROP TRIGGER reject_relation_attempt');await f.step();await f.finish();assert.equal(f.comparisons,1);
 }finally{await f.close();}
});
test('initial relation plans roll back with the dossier start and are not duplicated by retry',async()=>{
 const f=fixture();try{f.target();f.add();f.store.db.exec("CREATE TRIGGER reject_initial_attempt BEFORE INSERT ON research_pipeline_attempts BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");await f.step();assert.equal(f.queue.snapshot().relations.items.length,0);assert.equal(f.models,0);const item=f.queue.snapshot().items[0];assert.equal(item.relationCoverage,null);f.store.db.exec('DROP TRIGGER reject_initial_attempt');f.queue.retry(item.id);await f.step();await f.finish();assert.equal(f.queue.snapshot().relations.items.length,1);assert.equal(f.models,1);
 }finally{await f.close();}
});
test('shared services, pause and reopen retain the same relation and only one model call',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-relations-')),path=join(dir,'fixture.sqlite');let finish;const f=fixture({path,runner:p=>new Promise(resolve=>{finish=()=>resolve(comparison(p));})});let other;
 try{f.target();f.add();await f.step();await f.finish();other=fixture({path});await f.step();await other.step();assert.equal(f.comparisons,1);assert.equal(other.comparisons,0);f.service.controlOperation('discovery','pause');finish();await f.finish();const before=f.queue.snapshot();await other.close();other=null;await f.close();other=fixture({path});assert.deepEqual(other.queue.snapshot(),before);assert(other.service.operations().tasks.discovery.paused);assert.equal(other.comparisons,0);
 }finally{finish?.();if(other)await other.close();else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('restore guard and expired calls retain inputs; retry endpoint enforces identity, origin and body',async()=>{
 const f=fixture();try{f.target();f.add();await f.step();await f.finish();await f.step();await f.finish();const r=f.queue.snapshot().relations.items[0],run=f.service.semanticEvents.get(r.runId);f.store.db.prepare("UPDATE semantic_runs SET status='running',expires_at=0,payload=? WHERE id=?").run(JSON.stringify({...run,status:'running',candidate:undefined}),run.id);assert.equal(f.queue.snapshot().relations.counts.interrupted,1);await f.step();assert.equal(f.comparisons,1);
 f.service.instance={id:'fixture-instance'};const handler=createHandler(f.store,f.service),url=`/api/research-pipeline/relations/${r.id}/retry`,call=async(headers={},body={})=>{let status;await handler({method:'POST',url,headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'fixture-instance',...headers},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}},{writeHead:n=>status=n,end(){}});return status;};assert.equal(await call({'x-signal-instance':'wrong'}),409);assert.equal(await call({origin:'https://example.com'}),403);assert.equal(await call({},{extra:true}),400);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal(await call(),409);await assert.rejects(()=>f.queue.step({assertActive(){}}),/恢复/);f.store.db.prepare("DELETE FROM settings WHERE key='restore_review_required'").run();assert.equal(await call(),200);assert.equal(f.queue.snapshot().relations.counts.queued,1);assert.equal(f.comparisons,1);
 }finally{await f.close();}
});
test('a recalled relationship dismissed before execution is invalidated without another model call',async()=>{
 const f=fixture();try{f.target();f.add();await f.step();await f.finish();const p=JSON.parse(f.store.db.prepare('SELECT payload FROM research_pipeline_relations').get().payload);f.service.decideEvent(p.candidateId,{state:'dismissed',version:0,note:'合成测试：明确排除此线索'});await f.step();assert.equal(f.comparisons,0);assert.equal(f.queue.snapshot().relations.counts.invalidated,1);}finally{await f.close();}
});
test('cancelled scheduler context before comparison commit rolls back the model and attempt together',async()=>{
 const f=fixture();try{f.target();f.add();await f.step();await f.finish();let count=0;await assert.rejects(()=>f.queue.step({assertActive(){if(++count===5)throw Error('cancelled context');}}),/cancelled context/);assert.equal(f.queue.snapshot().relations.counts.queued,1);assert.equal(f.queue.snapshot().callsInLast24Hours,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);assert.equal(f.comparisons,0);}finally{await f.close();}
});

test('backup and restore preserve queued plans, completed comparisons and shared attempt history without external work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-recovery-')),path=join(dir,'source.sqlite'),f=fixture({path});
 try{f.target(0);f.target(1);f.add();await f.step();await f.finish();await f.step();await f.finish();f.service.controlOperation('discovery','pause');const backup=await createBackup(path,join(dir,'backups')),report=await rehearseRecovery(backup.directory,join(dir,'recovery'));assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.original.tables.research_pipeline_relations.count,2);assert.equal(report.original.tables.research_pipeline_attempts.count,2);assert.equal(report.idle.identical,true);assert.equal(report.rollback.identical,true);assert.equal(report.networkAttempts,0);assert.equal(report.snapshotUnchanged,true);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
