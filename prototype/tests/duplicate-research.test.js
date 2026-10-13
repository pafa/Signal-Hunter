import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,quote,output} from './automatic-research-fixture.mjs';

const article=url=>({url,title:'Synthetic shared document',sourceName:'Synthetic publisher',body:quote+'Frozen synthetic workflow text. '.repeat(30),scope:'extracted-text'});
const add=(f,i,url=f.news(1).url)=>{f.store.ingest([{...f.news(i),url}],new Date().toISOString());f.service.research.process();};
const jobs=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='extract' ORDER BY rowid").all();
const aliases=f=>jobs(f).filter(r=>JSON.parse(r.payload).duplicateOf);
const events=f=>f.service.research.list().filter(t=>t.eventExtraction);
const waiting=f=>aliases(f).some(r=>r.status==='waiting-source');

test('two separately read identical documents share the full automatic workflow and retain both source records',async()=>{
 let reads=0;const f=fixture({sourceReader:url=>{reads++;return article(url);}});try{
  add(f,1);add(f,2);const original=f.store.db.prepare('SELECT * FROM news ORDER BY id').all(),paper=f.service.paper.snapshot();
  await f.until(()=>waiting(f));assert.equal(f.queue.snapshot().counts.completed||0,0,'reuse must wait for the full source result');
  await f.drive(30);assert.equal(reads,2,'each entry is read before asserting immutable equality');assert.equal(events(f).length,1);
  assert.deepEqual(f.calls,{extract:1,identity:1,dossier:1,semantic:0,semanticInvocations:0});assert.equal(f.queue.snapshot().callsInLast24Hours,3);
  assert.equal(f.queue.snapshot().counts.reused,1);assert.equal(f.queue.snapshot().counts.completed,1);assert.equal(aliases(f)[0].run_id,null);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM news ORDER BY id').all(),original);assert.deepEqual(f.service.paper.snapshot(),paper);
  const reuse=f.queue.snapshot().items.find(i=>i.status==='reused');assert(reuse.duplicateSource.topicId);assert.match(reuse.reason,/不重复创造机会/);
 }finally{await f.close();}
});
test('three identical entries reference one original, never a chain or a new independent event',async()=>{
 const f=fixture({sourceReader:article});try{add(f,1);add(f,2);add(f,3);await f.drive(50);assert.equal(aliases(f).length,2);assert.equal(new Set(aliases(f).map(r=>JSON.parse(r.payload).duplicateOf.jobId)).size,1);assert.equal(events(f).length,1);assert.equal(f.calls.extract,1);assert.equal(f.calls.dossier,1);}finally{await f.close();}
});
test('empty event result is shared as no-signal without inventing an event or a model invocation',async()=>{
 const f=fixture({sourceReader:article,extractionRunner:p=>output(p,'decomposition',{events:[],scopeNote:'Synthetic empty result',missingEvidence:['Independent evidence']})});try{add(f,1);add(f,2);await f.drive(20);assert.equal(f.queue.snapshot().counts['no-signal'],1);assert.equal(f.queue.snapshot().counts.reused,1);assert.equal(events(f).length,0);assert.equal(f.calls.extract,1);assert.equal(f.calls.identity,0);assert.match(f.queue.snapshot().items.find(i=>i.status==='reused').reason,/未发现具体事项/);}finally{await f.close();}
});
test('same text at another URL and a later changed body at the same URL are not silently reused',async()=>{
 let version=1;const f=fixture({sourceReader:url=>({...article(url),body:article(url).body+'version '+version})});try{
  add(f,1);await f.drive();add(f,2,f.news(2).url);await f.drive();assert.equal(f.calls.extract,2);assert.equal(aliases(f).length,0);
  version=2;add(f,3);await f.drive();assert.equal(f.calls.extract,3);assert.equal(aliases(f).length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_materials').get().n,3);
 }finally{await f.close();}
});
test('changed source configuration gets its own analysis even for the same material',async()=>{
 const f=fixture({sourceReader:article});try{add(f,1);await f.drive();f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:99,includeClues:false});add(f,2);await f.drive();assert.equal(f.calls.extract,2);assert.equal(aliases(f).length,0);}finally{await f.close();}
});
test('waiting duplicate survives service restart and resumes with original calls and records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'duplicate-research-')),path=join(dir,'isolated.sqlite');let f=fixture({path,sourceReader:article});
 try{add(f,1);add(f,2);await f.until(()=>waiting(f));const alias=aliases(f)[0],before=f.queue.snapshot().callsInLast24Hours;await f.close();f=fixture({path,sourceReader:article});await f.drive();assert.equal(aliases(f)[0].id,alias.id);assert.equal(aliases(f)[0].status,'reused');assert.equal(events(f).length,1);assert.equal(f.queue.snapshot().callsInLast24Hours,3);assert(before<=3);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('owner failures retain the three-call limit and duplicate observation instead of restarting through another entry',async()=>{
 const f=fixture({sourceReader:article,extractionRunner:()=>{throw Error('Synthetic persistent failure');}});try{
  add(f,1);add(f,2);await f.drive(12);f.advance(60001);await f.drive(12);f.advance(120001);await f.drive(18);
  assert.equal(f.calls.extract,3);assert.equal(f.queue.snapshot().callsInLast24Hours,3);assert.equal(aliases(f)[0].status,'observing');assert.equal(aliases(f)[0].run_id,null);assert.equal(events(f).length,0);assert.equal(f.queue.snapshot().counts.observing,2);
 }finally{await f.close();}
});
test('cancelling an active owner identity run does not restart it through the duplicate',{timeout:5000},async()=>{
 let entered;const started=new Promise(r=>entered=r),f=fixture({sourceReader:article,identityRunner:(p,c)=>new Promise((resolve,reject)=>{entered();c.signal.addEventListener('abort',()=>reject(Error('Synthetic cancelled')),{once:true});})});
 try{
  add(f,1);add(f,2);await f.until(()=>waiting(f));const pending=f.drive(8);await started;
  const row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='identity' AND status='running'").get();f.service.companyEntities.cancel(row.topic_id,row.run_id);await pending;await f.drive(15);
  assert.equal(f.calls.identity,1);assert.equal(f.calls.dossier,0);assert.equal(aliases(f)[0].status,'observing');assert.equal(aliases(f)[0].run_id,null);
 }finally{await f.close();}
});
test('changed owner source or a corrupted alias invalidates the reference without copying old output',async()=>{
 for(const change of ['source','cycle','material','scope']){const f=fixture({sourceReader:article});try{
  add(f,1);add(f,2);await f.until(()=>waiting(f));const alias=aliases(f)[0],p=JSON.parse(alias.payload);
  if(change==='source'){const n=f.store.newsById(p.duplicateOf.newsId);f.store.ingest([{...n,title:n.title+' corrected'}],new Date().toISOString());}
  else{if(change==='cycle')p.duplicateOf.jobId=alias.id;else if(change==='material')p.duplicateOf.materialId='wrong-material';else p.duplicateOf.scopeHash='wrong-scope';f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),alias.id);}
  await f.drive(20);assert.equal(jobs(f).find(r=>r.id===alias.id).status,'invalidated');assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(alias.id).n,0);
 }finally{await f.close();}}
});
test('reuse result and audit are atomic, and a failed write retries without another inference',async()=>{
 const f=fixture({sourceReader:article});try{
  add(f,1);add(f,2);await f.until(()=>waiting(f));
  f.store.db.exec("CREATE TRIGGER fail_reuse BEFORE UPDATE ON research_pipeline_event_jobs WHEN NEW.status='reused' BEGIN SELECT RAISE(ABORT,'Synthetic'); END");await f.drive(20);assert(waiting(f));assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='duplicate-source-reused'").get().n,0);
  f.store.db.exec('DROP TRIGGER fail_reuse');await f.drive();assert.equal(aliases(f)[0].status,'reused');assert.equal(f.queue.snapshot().callsInLast24Hours,3);
 }finally{await f.close();}
});
