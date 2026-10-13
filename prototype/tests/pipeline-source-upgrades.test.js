import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {digest} from '../server/codex-research.mjs';
import {openMaterials} from '../server/research-materials.mjs';
import {pipelineExecutionBasis,initializePipelineSourceGenerations} from '../server/pipeline-source-upgrades.mjs';

const config={binary:'/test/codex',model:'test-model',effort:'medium',timeoutMs:1000},at='2026-10-11T09:00:00.000Z';
function fixture(){
 const store=openStore(':memory:');let reads=0,calls=0;
 const service=createService(store,{mode:'research',modelConfig:config,now:()=>Date.parse(at),fetcher:()=>{throw Error('No network');},sourceReader:async url=>{reads++;return {url,title:'Current synthetic source',body:'The company files for bankruptcy. Current reading only. '.repeat(15),sourceName:'Synthetic',scope:'extracted-text'};},materialEventRunner:async packet=>{calls++;const decomposition={events:[],scopeNote:'Synthetic no-event result',missingEvidence:[]},rawOutput=JSON.stringify(decomposition);return {status:'candidate',reviewStatus:'unreviewed',decomposition,rawOutput,trace:{model:config.model,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};}});
 const queue=service.researchPipeline;queue.configure({...queue.snapshot().settings,automatic:true,extractEvents:true,screenUnselected:true,financialSources:false,researchPrices:false,directoryMarkets:[],dailyCalls:10});
 const news={id:digest('upgrade-source'),title:'Company files for bankruptcy',url:'https://example.com/source-upgrade',publisher:'Synthetic',publishedAt:at};
 store.ingest([news],at);service.research.process();queue.scan({assertActive(){}});
 const original=()=>store.db.prepare('SELECT * FROM research_pipeline_items ORDER BY rowid LIMIT 1').get();
 const set=(values={})=>{const r=original(),p={...JSON.parse(r.payload),executionHash:digest(pipelineExecutionBasis(config,'public-article-10')),...values};store.db.prepare('UPDATE research_pipeline_items SET payload=? WHERE id=?').run(JSON.stringify(p),r.id);return original();};
 const step=async()=>{service.controlOperation('discovery','resume');const result=await service.runOperation('discovery');for(const r of store.db.prepare("SELECT run_id FROM research_pipeline_event_jobs WHERE kind='extract' AND run_id IS NOT NULL").all())await service.materialEvents.wait(r.run_id);return result;};
 return {store,service,queue,news,original,set,step,get reads(){return reads;},get calls(){return calls;},async close(){await service.close();store.close();}};
}

test('reader upgrade appends a new source task, preserves old intake/materials and rereads before inference',async()=>{
 const f=fixture();try{
  const materials=openMaterials(f.store.db,{clock:()=>at}),prepared=materials.prepare('old-intake',{url:f.news.url,title:'Old source',body:'Archived body under the earlier reader. '.repeat(20),sourceName:'Synthetic',scope:'extracted-text'},'public-web');prepared.persist();
  const old=f.set({intakeSource:{status:'ready',materialId:prepared.material.id,materialRevision:prepared.material.revision},intakeScreening:{decision:'research',runId:'prior-intake',reason:'Prior selection remains history'},selectionReason:'intake-screening'}),oldPayload=JSON.parse(old.payload),savedMaterials=f.store.db.prepare('SELECT * FROM research_materials ORDER BY rowid').all();
  await f.step();const rows=f.store.db.prepare('SELECT * FROM research_pipeline_items ORDER BY rowid').all();assert.equal(rows.length,2);assert.equal(rows[0].status,'superseded');assert.equal(rows[1].status,'queued');assert.equal(f.reads,0);assert.equal(f.calls,0);
  const {executionUpgrade,...kept}=JSON.parse(rows[0].payload);assert.deepEqual(kept,oldPayload);assert.equal(executionUpgrade.successorId,rows[1].id);
  const current=JSON.parse(rows[1].payload);assert.equal(current.executionHash,digest(pipelineExecutionBasis(config)));assert.equal(current.executionPredecessor.id,old.id);assert.equal(current.intakeSource,undefined);assert.equal(current.intakeScreening,undefined);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_materials ORDER BY rowid').all(),savedMaterials);
  for(let i=0;i<7;i++)await f.step();assert.equal(f.reads,1);assert.equal(f.calls,1);assert.equal(f.queue.snapshot().counts['no-signal'],1);assert.equal(f.queue.snapshot().counts.superseded,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_items').get().n,2);
  for(const r of savedMaterials)assert.deepEqual(f.store.db.prepare('SELECT * FROM research_materials WHERE id=? AND revision=?').get(r.id,r.revision),r);
  assert.equal(f.service.research.list().length,1);assert(f.service.research.packet(f.service.research.list()[0].id).input.evidence.some(e=>e.material?.body.includes('Current reading only')));
 }finally{await f.close();}
});

test('registered same-model program changes get a successor but different model/configuration and corrupt bases do not',async()=>{
 for(const kind of ['program','model','effort','timeoutMs','binary','corrupt','unknown']){
  const f=fixture();try{
   const old={...pipelineExecutionBasis(config),prompt:'older-frozen-prompt'};if(kind==='model')old.model='other';if(kind==='effort')old.effort='high';if(kind==='timeoutMs')old.timeoutMs=2000;if(kind==='binary')old.binary='/other/codex';
   const key=digest(old);f.set({executionHash:key});if(kind!=='unknown')f.store.db.prepare('INSERT INTO research_pipeline_execution_bases VALUES(?,?)').run(key,kind==='corrupt'?'{':JSON.stringify(old));
   await f.step();assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_items WHERE status='superseded'").get().n,kind==='program'?1:0,kind);assert.equal(f.reads,0);assert.equal(f.calls,0);
  }finally{await f.close();}
 }
});

test('reader 11 tasks without a registry use the exact known bridge and corrupt registered evidence is not guessed',async()=>{
 for(const corrupt of [false,true]){
  const f=fixture();try{
   const basis=pipelineExecutionBasis(config,'public-article-11'),key=digest(basis);
   const old=f.set({executionHash:key});
   if(corrupt)f.store.db.prepare('INSERT INTO research_pipeline_execution_bases VALUES(?,?)').run(key,'{');
   await f.step();
   assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_items WHERE status='superseded'").get().n,corrupt?0:1);
   if(!corrupt){const saved=JSON.parse(f.store.db.prepare('SELECT payload FROM research_pipeline_items WHERE id=?').get(old.id).payload);assert.equal(saved.executionUpgrade.fromExecutionHash,key);assert.equal(saved.executionUpgrade.toExecutionHash,digest(pipelineExecutionBasis(config)));}
   assert.equal(f.reads,0);assert.equal(f.calls,0);
  }finally{await f.close();}
 }
});

test('cancelled, exhausted, started, manually owned and completed-observation sources are never restarted',async()=>{
 for(const kind of ['cancelled','observing','failed','invalidated','prepareAttempts','manual','completed-observation','source-retry','existing-topic','attempted','batch-running']){
  const f=fixture();try{
   const old=f.set(),p=JSON.parse(old.payload);
   if(['cancelled','observing','failed','invalidated'].includes(kind))f.store.db.prepare('UPDATE research_pipeline_items SET status=? WHERE id=?').run(kind,old.id);
   if(kind==='prepareAttempts')f.set({prepareAttempts:1});
   if(kind==='manual')f.set({configuration:{...p.configuration,automatic:false}});
   if(kind==='completed-observation'){f.set({intakeScreening:{decision:'observe'}});f.store.db.prepare("UPDATE research_pipeline_items SET status='skipped' WHERE id=?").run(old.id);}
   if(kind==='source-retry')f.set({intakeSource:{status:'retrying',attempts:[{status:'failed'}]}});
   if(kind==='existing-topic')f.service.research.createFromNews({newsId:f.news.id,newsRevision:1});
   if(kind==='attempted')f.store.db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(old.id,'historical-attempt',at);
   if(kind==='batch-running'){f.store.db.prepare("INSERT INTO intake_screening_batches VALUES('old','running',?)").run(JSON.stringify({id:'old',status:'running',packet:{schema:'old'},executionHash:'old'}));f.store.db.prepare("INSERT INTO intake_screening_members VALUES(?,'old')").run(old.id);}
   // Test the upgrade hook through the public step, before later stage handling.
   await f.step();assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_items').get().n,1,kind);assert.equal(f.reads,0,kind);assert.equal(f.calls,0,kind);
  }finally{await f.close();}
 }
});

test('the successor and prior task update roll back together, and retry creates only one successor',async()=>{
 const f=fixture();try{
  const old=f.set();f.store.db.exec("CREATE TRIGGER reject_source_successor BEFORE INSERT ON research_pipeline_items BEGIN SELECT RAISE(ABORT,'synthetic successor failure'); END");await f.step();assert.deepEqual(f.original(),old);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_items').get().n,1);
  f.store.db.exec('DROP TRIGGER reject_source_successor');await f.step();assert.equal(f.queue.snapshot().counts.superseded,1);assert.equal(f.queue.snapshot().counts.queued,1);assert.equal(f.reads,0);
 }finally{await f.close();}
});

test('pause, changed news and global model quota still protect source upgrades and inference',async()=>{
 const f=fixture();try{
  f.set();assert.throws(()=>f.service.runOperation('discovery'),/暂停/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_items').get().n,1);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.store.db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run('other-prior-item','prior-call',at);
  await f.step();assert.equal(f.queue.snapshot().counts.superseded,1);for(let i=0;i<3;i++)await f.step();assert.equal(f.calls,0);assert.equal(f.reads,0);assert.equal(f.queue.snapshot().callsInLast24Hours,1);
 }finally{await f.close();}
 const changed=fixture();try{changed.set();changed.store.ingest([{...changed.news,title:'Company files for bankruptcy, revised'}],at);changed.service.research.process();await changed.step();assert.equal(changed.queue.snapshot().counts.superseded||0,0);assert.equal(changed.reads,0);}finally{await changed.close();}
});

function legacyDb(){const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE research_pipeline_items(id TEXT PRIMARY KEY,news_id TEXT NOT NULL,revision INTEGER NOT NULL,rules_hash TEXT NOT NULL,status TEXT NOT NULL,topic_id TEXT,run_id TEXT,payload TEXT NOT NULL,UNIQUE(news_id,revision,rules_hash)); INSERT INTO research_pipeline_items(rowid,id,news_id,revision,rules_hash,status,payload) VALUES(7,'old','news',1,'rules','queued','{}');");return db;}
test('legacy migration preserves bytes, rowids, custom indexes and triggers and keeps one current task',()=>{
 const db=legacyDb();try{
  db.exec('CREATE TABLE custom_audit(value TEXT); CREATE INDEX user_pipeline_status ON research_pipeline_items(status); CREATE TRIGGER user_pipeline_change AFTER UPDATE ON research_pipeline_items BEGIN INSERT INTO custom_audit VALUES(NEW.status); END');const before=db.prepare('SELECT rowid,* FROM research_pipeline_items').all();
  initializePipelineSourceGenerations(db);assert.deepEqual(db.prepare('SELECT rowid,* FROM research_pipeline_items').all(),before);
  assert.throws(()=>db.exec("INSERT INTO research_pipeline_items VALUES('duplicate','news',1,'rules','queued',NULL,NULL,'{}')"),/UNIQUE/);
  db.exec("UPDATE research_pipeline_items SET status='superseded' WHERE id='old'; INSERT INTO research_pipeline_items VALUES('new','news',1,'rules','queued',NULL,NULL,'{}')");assert.equal(db.prepare('SELECT value FROM custom_audit').get().value,'superseded');assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='user_pipeline_status'").get());
  const rows=db.prepare('SELECT rowid,* FROM research_pipeline_items').all();initializePipelineSourceGenerations(db);assert.deepEqual(db.prepare('SELECT rowid,* FROM research_pipeline_items').all(),rows);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
test('unsupported external foreign keys stop migration without cascading away user data',()=>{
 const db=legacyDb();try{db.exec("CREATE TABLE custom_child(parent TEXT REFERENCES research_pipeline_items(id) ON DELETE CASCADE); INSERT INTO custom_child VALUES('old')");assert.throws(()=>initializePipelineSourceGenerations(db),/额外外键/);assert.equal(db.prepare('SELECT count(*) n FROM custom_child').get().n,1);assert.equal(db.prepare('SELECT status FROM research_pipeline_items').get().status,'queued');assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='research_pipeline_items_generations'").get().n,0);}finally{db.close();}
});

test('pending unselected sources continue after protected observations without duplicating the history',async()=>{
 const f=fixture();try{
  f.store.ingest(Array.from({length:205},(_,i)=>({...f.news,id:digest('quiet-'+i),title:'Routine company update '+i,url:'https://example.com/quiet/'+i})),at);f.service.research.process();f.queue.scan({assertActive(){}});f.queue.scan({assertActive(){}});
  const all=f.store.db.prepare('SELECT * FROM research_pipeline_items ORDER BY rowid').all(),target=all.at(-1),key=digest(pipelineExecutionBasis(config,'public-article-10'));
  for(const row of all){const p=JSON.parse(row.payload);f.store.db.prepare("UPDATE research_pipeline_items SET status='skipped',payload=? WHERE id=?").run(JSON.stringify({...p,executionHash:key,...(row.id!==target.id?{intakeScreening:{decision:'observe',reason:'Completed earlier'}}:{})}),row.id);}
  const initialSources=f.queue.snapshot().intake.sources.total;const preserved=f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE id<>? ORDER BY rowid').all(target.id);await f.step();assert.equal(f.queue.snapshot().intake.sources.total,initialSources);const successor=f.store.db.prepare("SELECT * FROM research_pipeline_items WHERE status='skipped' AND json_extract(payload,'$.executionPredecessor.id')=?").get(target.id);
  assert(successor);assert.equal(f.queue.snapshot().counts.superseded,1);assert.equal(f.reads,0);assert.equal(f.calls,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE id NOT IN (?,?) ORDER BY rowid').all(target.id,successor.id),preserved);assert.equal(JSON.parse(successor.payload).intakeScreening,undefined);
 }finally{await f.close();}
});

test('an in-flight shared model call defers the upgrade without changing history',async()=>{
 const f=fixture();try{const old=f.set();f.store.db.prepare('INSERT INTO model_job_lease VALUES(1,?,?)').run('another-worker',Date.parse(at)+60000);await f.step();assert.deepEqual(f.original(),old);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_items').get().n,1);assert.equal(f.reads,0);assert.equal(f.calls,0);}finally{await f.close();}
});

test('migration refuses unknown columns instead of deleting their stored data',()=>{
 const db=legacyDb();try{db.exec("ALTER TABLE research_pipeline_items ADD COLUMN user_note TEXT; UPDATE research_pipeline_items SET user_note='Keep my note'");assert.throws(()=>initializePipelineSourceGenerations(db),/额外字段/);assert.equal(db.prepare('SELECT user_note FROM research_pipeline_items').get().user_note,'Keep my note');assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='research_pipeline_items_generations'").get().n,0);}finally{db.close();}
});
