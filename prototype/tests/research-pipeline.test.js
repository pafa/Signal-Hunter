import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {digest} from '../server/codex-research.mjs';
import {openResearchPipeline} from '../server/research-pipeline.mjs';
import {createHandler} from '../server/index.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {createBackup} from '../server/backup.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000};
const at='2026-10-03T00:00:00Z';
function output(p){const value={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成流程测试，事实仍需核对。'],sourceIds:[]})),missingEvidence:['独立核验']},rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',...value,rawOutput,trace:{model:config.model,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,outputHash:digest(rawOutput)}};}
function fixture({path=':memory:',runner=async p=>output(p),reader,mode='research',modelConfig=config}={}){
 let clock=Date.parse(at),calls=0,reads=0;const store=openStore(path);if(mode==='research')assertDatabaseMode(store,'research');
 const service=createService(store,{mode,modelConfig,now:()=>clock,modelRunner:async(...args)=>{calls++;return runner(...args);},sourceReader:async url=>{reads++;return reader?reader(url):{url,title:'合成原文',sourceName:'合成来源',body:'这是完整性和任务调度的合成材料。'.repeat(30),scope:'extracted-text',publishedAt:'2026-10-02',datePrecision:'day',method:'test-reader'};}});
 const add=(id='one',title='Company files for bankruptcy')=>{const n={id:digest(id),title,url:'https://example.com/'+id,publisher:'合成',publishedAt:at};store.ingest([n],new Date(clock).toISOString());service.research.process();return n;};
 const step=()=>{service.controlOperation('discovery','resume');return service.runOperation('discovery');};
 const finish=async()=>{for(const i of service.researchPipeline.snapshot().items)if(i.runId)await service.modelResearch.wait(i.runId);return service.researchPipeline.snapshot();};
 return {store,service,queue:service.researchPipeline,add,step,finish,get calls(){return calls;},get reads(){return reads;},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}
test('automatic research is initially paused; full source precedes a versioned candidate and never adopts or orders',async()=>{
 const f=fixture();try{f.add();const book=f.service.paper.snapshot();assert(f.service.operations().tasks.discovery.paused);assert.throws(()=>f.service.runOperation('discovery'),/暂停/);await f.step();const s=await f.finish();assert.equal(s.counts.candidate,1);assert.equal(f.calls,1);assert.equal(f.reads,1);const i=s.items[0],t=f.service.research.get(i.topicId),r=f.service.modelResearch.get(i.topicId,i.runId);assert.equal(t.version,2);assert(t.evidence.some(e=>e.materialId));assert.equal(t.dossier,undefined);assert(r.packet.input.evidence.some(e=>e.materialId));assert.deepEqual(f.service.paper.snapshot(),book);await f.step();assert.equal(f.calls,1);assert.equal(s.callsInLast24Hours,1);
 }finally{await f.close();}
});
test('all screening outcomes remain recorded; new revisions never overwrite existing research',async()=>{
 const f=fixture();try{const n=f.add();f.add('quiet','A routine daily update');await f.step();await f.finish();let s=f.queue.snapshot();assert.equal(s.counts.skipped,1);const topic=f.service.research.get(s.items.find(i=>i.topicId).topicId);f.advance(1000);f.store.ingest([{...n,title:'Company files for bankruptcy under revised terms'}],new Date(Date.parse(at)+1000).toISOString());f.service.research.process();await f.step();s=await f.finish();assert.equal(s.items.length,3);assert.equal(s.counts.candidate,2);assert.deepEqual(f.service.research.get(topic.id),topic);assert.equal(f.calls,2);assert.equal(f.service.research.list().length,2);assert.deepEqual(f.service.research.list().find(t=>t.id!==topic.id).sourceRevisionOf,{topicId:topic.id,topicVersion:topic.version,newsRevision:1});
 }finally{await f.close();}
});
test('rolling call ceiling includes failures and explicit retries and only replenishes after 24 hours',async()=>{
 const f=fixture();try{f.queue.configure({version:1,dailyCalls:1,includeClues:false});f.add('one');f.add('two');await f.step();await f.finish();assert.equal((await f.step()).outcome,'skipped');assert.equal(f.calls,1);assert.equal(f.reads,1);f.advance(86400001);await f.step();await f.finish();assert.equal(f.calls,2);assert.equal(f.queue.snapshot().callsInLast24Hours,1);assert.throws(()=>f.queue.configure({version:1,dailyCalls:2,includeClues:false}),/已变化/);assert.throws(()=>f.queue.configure({version:2,dailyCalls:0,includeClues:false}),/无效/);
 }finally{await f.close();}
});
test('failed source reads stay failed without calling a model; explicit retry retains attempt history',async()=>{
 let fail=true;const f=fixture({reader:async url=>{if(fail)throw Error('private upstream failure');return {url,title:'合成原文',sourceName:'合成',body:'合成来源正文'.repeat(50),scope:'extracted-text'};}});try{f.add();await f.step();let i=f.queue.snapshot().items[0];assert.equal(i.status,'failed');assert.equal(f.calls,0);assert.doesNotMatch(i.reason,/private/);await f.step();assert.equal(f.reads,1);fail=false;f.queue.retry(i.id);await f.step();await f.finish();assert.equal(f.calls,1);assert.equal(f.service.research.list().length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_attempts').get().n,2);
 }finally{await f.close();}
});
test('failed models require retry and keep the previous immutable run',async()=>{
 let fail=true;const f=fixture({runner:async p=>{if(fail)throw Error('fixture failure');return output(p);}});try{f.add();await f.step();await f.finish();let i=f.queue.snapshot().items[0];assert.equal(i.status,'failed');await f.step();assert.equal(f.calls,1);fail=false;f.queue.retry(i.id);await f.step();await f.finish();const next=f.queue.snapshot().items[0];assert.equal(next.attempts.length,2);assert.equal(next.status,'candidate');assert.equal(f.service.modelResearch.get(i.topicId,i.runId).status,'failed');assert.equal(f.reads,1);
 }finally{await f.close();}
});
test('three unreadable articles do not block the next readable item or consume model allowance',async()=>{
 const f=fixture({reader:async url=>{if(!url.endsWith('/readable'))throw Error('Synthetic source cannot be read');return {url,title:'Readable synthetic article',sourceName:'Synthetic',body:'完整合成材料。'.repeat(100),scope:'extracted-text'};}});
 try{
  for(const id of ['bad-1','bad-2','bad-3','readable'])f.add(id);f.service.controlOperation('discovery','resume');
  for(let n=0;n<3;n++){assert.equal((await f.service.runOperation('discovery')).outcome,'skipped');assert.equal(f.service.operations().tasks.discovery.blocked,false);}
  assert.equal(f.calls,0);assert.equal(f.queue.snapshot().counts.failed,3);assert.equal(f.queue.snapshot().callsInLast24Hours,0);
  await f.service.runOperation('discovery');await f.finish();assert.equal(f.calls,1);assert.equal(f.queue.snapshot().counts.candidate,1);assert.equal(f.queue.snapshot().counts.failed,3);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_source_attempts WHERE json_extract(payload,'$.state')='failed'").get().n,3);
 }finally{await f.close();}
});
test('pause during source reading prevents late material and model writes, leaving an explicit interrupted item',async()=>{
 let release;const f=fixture({reader:url=>new Promise(resolve=>{release=()=>resolve({url,title:'合成',sourceName:'合成',body:'合成来源正文'.repeat(50),scope:'extracted-text'});})});try{f.add();const step=f.step();for(let n=0;!release&&n<50;n++)await new Promise(r=>setImmediate(r));assert(release,'source reader reached');f.service.controlOperation('discovery','pause');release();await step;const i=f.queue.snapshot().items[0];assert.equal(i.status,'interrupted');assert.equal(f.calls,0);assert.equal(f.service.research.materialList(i.topicId).materials.length,0);
 }finally{release?.();await f.close();}
});
test('news revision during source reading prevents stale material and model publication',async()=>{
 let release;const f=fixture({reader:url=>new Promise(resolve=>{release=()=>resolve({url,title:'合成',sourceName:'合成',body:'合成来源正文'.repeat(50),scope:'extracted-text'});})});try{const n=f.add();const step=f.step();for(let n=0;!release&&n<50;n++)await new Promise(r=>setImmediate(r));assert(release,'source reader reached');f.store.ingest([{...n,title:'Company bankruptcy revised'}],'2026-10-03T01:00:00Z');release();await step;const i=f.queue.snapshot().items[0];assert.equal(i.status,'failed');assert.equal(f.calls,0);assert.equal(f.service.research.materialList(i.topicId).materials.length,0);assert.throws(()=>f.queue.retry(i.id),/新修订/);
 }finally{release?.();await f.close();}
});
test('run linkage, attempt counting and model lease roll back together on storage failure',async()=>{
 const f=fixture();try{f.add();f.store.db.exec("CREATE TRIGGER reject_pipeline_attempt BEFORE INSERT ON research_pipeline_attempts BEGIN SELECT RAISE(ABORT,'fixture write failure'); END");await f.step();assert.equal(f.calls,0);assert.equal(f.queue.snapshot().callsInLast24Hours,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_runs').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);f.store.db.exec('DROP TRIGGER reject_pipeline_attempt');f.queue.retry(f.queue.snapshot().items[0].id);await f.step();await f.finish();assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('restart preserves completed outputs and paused queue without making another call',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-pipeline-')),path=join(dir,'fixture.sqlite');let f=fixture({path});try{f.add();await f.step();await f.finish();f.service.controlOperation('discovery','pause');const before=f.queue.snapshot();await f.close();f=fixture({path});assert.deepEqual(f.queue.snapshot(),before);assert.equal(f.calls,0);assert(f.service.operations().tasks.discovery.paused);await f.step();assert.equal(f.calls,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('offline, missing model and restore gates prevent automatic preparation',async()=>{
 for(const options of [{mode:'demo'},{modelConfig:null},{}]){const f=fixture(options);try{f.add();if(!Object.keys(options).length)f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();if(options.mode==='demo')assert.throws(()=>f.service.runOperation('discovery'),/离线/);else if(!Object.keys(options).length)assert.throws(()=>f.step(),/恢复副本/);else await f.step();assert.equal(f.calls,0);assert.equal(f.reads,0);assert.equal(f.queue.snapshot().items.length,0);}finally{await f.close();}}
});
test('changed model configuration invalidates queued preparation without silently using a new model',async()=>{
 const f=fixture();try{f.add();f.queue.scan({assertActive(){}});const changed=openResearchPipeline(f.store,f.service.research,f.service.modelResearch,{enabled:true,config:{...config,model:'other'},now:()=>Date.parse(at)});await changed.step({assertActive(){}});assert.equal(changed.snapshot().counts.failed,1);assert.equal(f.reads,0);assert.equal(f.calls,0);assert.throws(()=>changed.retry(changed.snapshot().items[0].id),/已变化/);
 }finally{await f.close();}
});
test('shared model lease defers queued preparation and is not consumed twice across services',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-shared-')),path=join(dir,'fixture.sqlite');let release;const f=fixture({path,runner:p=>new Promise(resolve=>{release=()=>resolve(output(p));})}),other=fixture({path});try{f.add('one');f.add('two');await f.step();assert.equal(f.calls,1);await other.step();assert.equal(other.calls,0);assert.equal(other.reads,0);assert.equal(other.queue.snapshot().callsInLast24Hours,1);release();await f.finish();await other.step();await other.finish();assert.equal(other.calls,1);assert.equal(other.queue.snapshot().callsInLast24Hours,2);
 }finally{release?.();await other.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('pipeline HTTP controls enforce origin, instance, schema and restore gates',async()=>{
 const f=fixture();f.service.instance={id:'fixture-instance'};const handler=createHandler(f.store,f.service);
 const call=async(method,url,body,headers={})=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'fixture-instance',...headers},async *[Symbol.asyncIterator](){if(body)yield JSON.stringify(body);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const input={version:1,dailyCalls:3,includeClues:true};assert.equal((await call('GET','/api/research-pipeline')).status,200);assert.equal((await call('PATCH','/api/research-pipeline',input,{'x-signal-instance':'other'})).status,409);assert.equal((await call('PATCH','/api/research-pipeline',input,{origin:'https://example.com'})).status,403);assert.equal((await call('PATCH','/api/research-pipeline',{...input,extra:true})).status,400);assert.equal((await call('PATCH','/api/research-pipeline',input)).result.researchPipeline.settings.dailyCalls,3);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('PATCH','/api/research-pipeline',{...input,version:2})).status,409);assert.equal((await call('GET','/api/research-pipeline')).status,200);
 }finally{await f.close();}
});
test('a tracked source revision remains selected even when the new headline no longer triggers major-event rules',async()=>{
 const f=fixture();try{const n=f.add();await f.step();await f.finish();const old=f.service.research.get(f.queue.snapshot().items[0].topicId);f.advance(1000);f.store.ingest([{...n,title:'A routine daily update'}],'2026-10-03T00:00:01Z');f.service.research.process();await f.step();await f.finish();const current=f.queue.snapshot().items.find(i=>i.revision===2);assert.equal(current.selectionReason,'source-revision');assert.equal(current.status,'candidate');assert.equal(f.calls,2);assert.deepEqual(f.service.research.get(old.id),old);assert.equal(f.service.research.get(current.topicId).sourceRevisionOf.topicId,old.id);}finally{await f.close();}
});
test('revision drafts include frozen older material and judgment while ordinary comparisons still reject obsolete material',async()=>{
 let body='旧版本合成正文，拟议事项仍待批准。'.repeat(20);const f=fixture({reader:async url=>({url,title:'同一来源合成正文',sourceName:'合成',body,scope:'extracted-text'})});try{const n=f.add();await f.step();await f.finish();let old=f.service.research.get(f.queue.snapshot().items[0].topicId),firstRun=f.queue.snapshot().items[0].runId;f.service.modelResearch.adopt(old.id,firstRun,{version:old.version});old=f.service.research.get(old.id);const history=f.service.research.history(old.id),oldMaterial=old.evidence.find(e=>e.materialId),book=f.service.paper.snapshot();body='新版本合成正文，前述事项宣布取消。'.repeat(20);f.advance(1000);f.store.ingest([{...n,title:'Company bankruptcy terms revised'}],'2026-10-03T00:00:01Z');f.service.research.process();await f.step();await f.finish();const item=f.queue.snapshot().items.find(i=>i.revision===2),topic=f.service.research.get(item.topicId),packet=f.service.research.packet(topic.id);assert.equal(packet.input.sourceRevision.topicId,old.id);assert.equal(packet.input.sourceRevision.topicVersion,old.version);assert.deepEqual(packet.input.sourceRevision.dossier,old.dossier);assert.match(packet.input.sourceRevision.evidence.find(e=>e.material).material.body,/旧版本/);assert.match(packet.input.evidence.find(e=>e.material).material.body,/新版本/);assert.deepEqual(f.service.research.history(old.id),history);assert.deepEqual(f.service.paper.snapshot(),book);const {materialComparisonSnapshot}=await import('../server/semantic-materials.mjs');assert.throws(()=>materialComparisonSnapshot(f.store.db,{id:oldMaterial.materialId,revision:oldMaterial.materialRevision}));const frozen=packet.input.sourceRevision;f.service.research.update(old.id,{version:old.version,nextEvidence:'后来新增的人工核对说明'});assert.deepEqual(f.service.research.packet(topic.id).input.sourceRevision,frozen);assert.equal(f.service.modelResearch.get(topic.id,item.runId).packet.inputHash,packet.inputHash);
 }finally{await f.close();}
});
test('successive revisions retain the direct predecessor and same-revision existing research is never replaced',async()=>{
 const f=fixture();try{const n=f.add();await f.step();await f.finish();let previous=f.service.research.get(f.queue.snapshot().items[0].topicId);const ids=[previous.id];for(const revision of [2,3]){f.advance(1000);f.store.ingest([{...n,title:`Company files for bankruptcy update ${revision}`}],new Date(Date.parse(at)+revision*1000).toISOString());f.service.research.process();await f.step();await f.finish();const item=f.queue.snapshot().items.find(i=>i.revision===revision),topic=f.service.research.get(item.topicId);assert.equal(topic.sourceRevisionOf.topicId,previous.id);assert.equal(topic.sourceRevisionOf.newsRevision,revision-1);ids.push(topic.id);previous=topic;}assert.equal(new Set(ids).size,3);assert.equal(f.calls,3);assert.equal(f.store.revisions(n.id).length,3);
 const other=f.add('manual');const manual=f.service.research.createFromNews({newsId:other.id,newsRevision:1});await f.step();assert.equal(f.queue.snapshot().items.find(i=>i.newsId===other.id).status,'needs-review');assert.deepEqual(f.service.research.get(manual.id),manual);assert.equal(f.calls,3);
 }finally{await f.close();}
});
test('queue-topic linkage is atomic with source research creation and a failed write creates no orphan',async()=>{
 const f=fixture();try{f.add();f.store.db.exec("CREATE TRIGGER reject_topic_link BEFORE UPDATE OF topic_id ON research_pipeline_items BEGIN SELECT RAISE(ABORT,'synthetic topic link failure'); END");await f.step();assert.equal(f.service.research.list().length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_versions').get().n,0);assert.equal(f.calls,0);const i=f.queue.snapshot().items[0];assert.equal(i.status,'failed');assert.equal(i.topicId,null);f.store.db.exec('DROP TRIGGER reject_topic_link');f.queue.retry(i.id);await f.step();await f.finish();assert.equal(f.service.research.list().length,1);assert.equal(f.calls,1);}finally{await f.close();}
});
test('mismatched predecessor and corrupt archived material cannot enter a revision model packet',async()=>{
 const f=fixture();try{const n=f.add();await f.step();await f.finish();const old=f.service.research.get(f.queue.snapshot().items[0].topicId);assert.throws(()=>f.service.research.createFromNews({newsId:n.id,newsRevision:1},{revisionOf:{topicId:old.id,topicVersion:old.version}}),/不匹配/);f.advance(1000);f.store.ingest([{...n,title:'Company bankruptcy revision'}],'2026-10-03T00:00:01Z');assert.throws(()=>f.service.research.createFromNews({newsId:n.id,newsRevision:2},{revisionOf:{topicId:old.id,topicVersion:1}}),/不匹配/);f.service.research.process();const m=old.evidence.find(e=>e.materialId),saved=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(m.materialId).payload);saved.body='损坏的历史正文';f.store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify(saved),m.materialId);await f.step();assert.equal(f.queue.snapshot().items.find(i=>i.revision===2).status,'failed');assert.equal(f.calls,1);assert.equal(f.service.research.get(old.id).version,old.version);}finally{await f.close();}
});
test('manual creation for a revised news item opens that revision and automatic discovery preserves the manual candidate',async()=>{
 const f=fixture();try{const n=f.add();await f.step();await f.finish();const old=f.service.research.get(f.queue.snapshot().items[0].topicId);f.advance(1000);f.store.ingest([{...n,title:'Company files for bankruptcy revised statement'}],'2026-10-03T00:00:01Z');f.service.research.process();const revised=f.service.research.createFromNews({newsId:n.id,newsRevision:2});assert.notEqual(revised.id,old.id);assert.equal(revised.sourceNewsRevision,2);assert.deepEqual(revised.sourceRevisionOf,{topicId:old.id,topicVersion:old.version,newsRevision:1});assert.deepEqual(f.service.research.createFromNews({newsId:n.id,newsRevision:2}),revised);await f.step();assert.equal(f.queue.snapshot().items.find(i=>i.revision===2).status,'needs-review');assert.equal(f.calls,1);assert.deepEqual(f.service.research.get(revised.id),revised);assert.deepEqual(f.service.research.get(old.id),old);}finally{await f.close();}
});

test('reopening and restoring a revision chain preserve both research versions, raw material revisions and frozen context',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-revision-recovery-')),path=join(dir,'source.sqlite');let f=fixture({path,reader:async url=>({url,title:'原版材料',sourceName:'合成',body:'第一版正文内容。'.repeat(50),scope:'extracted-text'})});
 try{const n=f.add();await f.step();await f.finish();await f.close();f=fixture({path,reader:async url=>({url,title:'修订材料',sourceName:'合成',body:'第二版正文内容。'.repeat(50),scope:'extracted-text'})});f.advance(1000);f.store.ingest([{...n,title:'Company files for bankruptcy revised terms'}],'2026-10-03T00:00:01Z');f.service.research.process();await f.step();await f.finish();f.service.controlOperation('discovery','pause');const topicId=f.queue.snapshot().items.find(i=>i.revision===2).topicId,input=f.service.research.packet(topicId).input,b=await createBackup(path,join(dir,'backups')),report=await rehearseRecovery(b.directory,join(dir,'recovery'));assert(report.passed,JSON.stringify(report));assert.equal(report.original.tables.research_topics.count,2);assert.equal(report.original.tables.research_versions.count,4);assert.equal(report.original.tables.research_materials.count,2);assert(report.idle.identical&&report.rollback.identical&&report.snapshotUnchanged);assert.equal(report.networkAttempts,0);await f.close();f=fixture({path});assert.deepEqual(f.service.research.packet(topicId).input,input);assert.equal(f.calls,0);assert(f.service.operations().tasks.discovery.paused);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
