import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,config,quote,dossier,extraction,output} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {pipelineExecutionBasis,pipelineReaderContinuation} from '../server/pipeline-source-upgrades.mjs';
import {extractPdf} from '../server/pdf-source.mjs';
import {pdfFixture} from './helpers/pdf-fixture.mjs';
import {LINKED_EVIDENCE_POLICY} from '../server/pipeline-linked-evidence.mjs';
const target='https://ir.acme.com/long-report.pdf';
const pdfQuote='Acme proposes to acquire Beta subject to approval.';
const readRoot=url=>({url,title:'Synthetic statement',sourceName:'Synthetic',body:quote.repeat(30),scope:'extracted-text',sourceLinks:{schema:'article-source-links/4',scope:'extracted-html-links',links:[{url:target,label:'Official PDF',context:'Read the linked report'}],inspected:1,omitted:0,truncated:false}});
const withRequest=p=>{const d=dossier(p),e=p.input.evidence.find(e=>e.material?.sourceLinks?.links.length),value={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests:e?[{evidenceId:e.id,url:target,reason:'Check the full report'}]:[]},rawOutput=JSON.stringify(value);return {...d,...value,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};};
const source=f=>f.store.db.prepare("SELECT p.* FROM research_pipeline_items p JOIN news n ON n.id=p.news_id WHERE json_extract(n.payload,'$.url')=? ORDER BY p.rowid DESC LIMIT 1").get(target);
const plans=f=>f.store.db.prepare("SELECT * FROM research_evidence_searches WHERE json_extract(payload,'$.policy')=? ORDER BY rowid").all(LINKED_EVIDENCE_POLICY);
function oldExecution(f,patch={}){
 const basis={...pipelineExecutionBasis(config,'public-article-11'),...patch},hash=digest(basis);
 f.store.db.prepare('INSERT OR REPLACE INTO research_pipeline_execution_bases VALUES(?,?)').run(hash,JSON.stringify(basis));
 for(const table of ['research_pipeline_items','research_evidence_searches'])for(const r of f.store.db.prepare('SELECT id,payload FROM '+table).all())f.store.db.prepare('UPDATE '+table+' SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(r.payload),executionHash:hash}),r.id);
 return hash;
}
function make({path=':memory:',mode='old-limit'}={}){
 let reads=0,behavior=mode;
 const f=fixture({path,sourceReader:async url=>{if(url!==target)return readRoot(url);reads++;if(behavior==='old-limit')throw Error('PDF超过8 MB，保留读取缺口');if(behavior==='new-limit')throw Error('PDF超过16 MB，保留读取缺口');return {url,...await extractPdf(pdfFixture([pdfQuote,'Synthetic supporting detail.']),url)};},extractionRunner:p=>p.input.material.extractionEvidence?.schema==='pdf-text-layer/1'?output(p,'decomposition',{events:[{title:'Acme acquisition',actor:'Acme',action:'proposes to acquire',object:'Beta',stage:'pending approval',eventTime:'未知',quote:pdfQuote,quoteField:'body',boundaryReason:'one matter',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'Synthetic PDF only',missingEvidence:['Independent facts']}):extraction(p),researchRunner:withRequest});
 return Object.assign(f,{getReads:()=>reads,setMode:value=>{behavior=value;}});
}
async function exhausted(f){
 f.add(1);await f.until(()=>!!source(f));
 for(let n=1;n<=3;n++){await f.until(()=>f.getReads()===n);if(n<3)f.advance(60001*2**(n-1));}
 const row=source(f);assert.equal(JSON.parse(row.payload).prepareAttempts,3);assert.equal(row.status,'failed');
 // Reproduce the old program's terminal observation checkpoint, before the
 // newly available reader capability can start a fourth request.
 f.store.db.prepare("UPDATE research_pipeline_items SET status='observing' WHERE id=?").run(row.id);
 for(const p of plans(f))f.store.db.prepare("UPDATE research_evidence_searches SET status='observing' WHERE id=?").run(p.id);
 oldExecution(f);return source(f);
}

test('continuation proves the same configuration, prompt and schema with only a known reader change; reads are pure',async()=>{
 const f=make();try{
  for(const patch of [{},{reader:'public-article-10'},{reader:'public-article-12'},{reader:'future-reader'},{model:'other'},{effort:'medium'},{timeoutMs:2000},{binary:'/other'},{prompt:'old-prompt'},{schema:{type:'object'}}]){
   const basis={...pipelineExecutionBasis(config,'public-article-11'),...patch},hash=digest(basis);f.store.db.prepare('INSERT OR REPLACE INTO research_pipeline_execution_bases VALUES(?,?)').run(hash,JSON.stringify(basis));const before=f.store.db.prepare('SELECT total_changes() n').get().n;
   assert.equal(!!pipelineReaderContinuation(f.store.db,config,hash),!Object.keys(patch).length||['public-article-10','public-article-12'].includes(patch.reader));assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
  }
  const old=pipelineExecutionBasis(config,'public-article-11'),key=digest(old);f.store.db.prepare('UPDATE research_pipeline_execution_bases SET payload=? WHERE hash=?').run('{',key);assert.equal(pipelineReaderContinuation(f.store.db,config,key),null);assert.equal(pipelineReaderContinuation(f.store.db,config,'unknown'),null);
 }finally{await f.close();}
});

test('started research and exact pending link plans continue across a reader upgrade without rewriting frozen input',async()=>{
 const f=make({mode:'success'});try{
  f.add(1);await f.until(()=>f.calls.extract===1);const saved=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs LIMIT 1').get().payload),old=oldExecution(f),paper=f.service.paper.snapshot();
  await f.drive(65);assert.equal(f.getReads(),1);assert.equal(source(f).status,'completed');assert.equal(f.calls.dossier,2);assert.equal(plans(f).length,1);assert.equal(f.queue.snapshot().evidence.items.find(p=>p.policy===LINKED_EVIDENCE_POLICY).current,true);
  const run=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs LIMIT 1').get().payload);assert.deepEqual(run.packet,saved.packet);assert.deepEqual(run.candidate,saved.candidate);
  const owner=f.store.db.prepare('SELECT payload FROM research_pipeline_items WHERE news_id=?').get(f.news(1).id);assert.equal(JSON.parse(owner.payload).executionHash,old);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='automatic-reader-continuation'").get().n,1);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});

test('a legacy exhausted PDF and observed link plan gain one bounded generation and finish automatically',async()=>{
 const f=make();try{
  const old=await exhausted(f),failures=f.store.db.prepare('SELECT * FROM research_source_attempts WHERE topic_id=?').all(old.topic_id),paper=f.service.paper.snapshot();f.setMode('success');
  await f.drive(70);const row=source(f),p=JSON.parse(row.payload);assert.equal(row.id,old.id);assert.equal(row.status,'completed');assert.equal(p.executionHash,JSON.parse(old.payload).executionHash);assert.equal(p.prepareAttempts,4);assert.equal(p.preparationRecovery.attemptBase,3);assert.equal(f.getReads(),4);assert.equal(f.calls.dossier,2);
  for(const r of failures)assert.deepEqual(f.store.db.prepare('SELECT * FROM research_source_attempts WHERE id=?').get(r.id),r);
  const record=JSON.parse(f.store.db.prepare("SELECT payload FROM research_pipeline_audit WHERE item_id=? AND action='automatic-source-capacity-recovery'").get(row.id).payload);assert.deepEqual(record.previous,{status:'observing',payload:JSON.parse(old.payload)});assert.equal(record.proof.toReader,'public-pdf-2');assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='linked-evidence-capacity-recovered'").get().n,1);assert.equal(f.queue.snapshot().evidence.items.find(s=>s.policy===LINKED_EVIDENCE_POLICY).current,true);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
 }finally{await f.close();}
});

test('the new generation has its own backoff and three-attempt bound, survives restart and never erases the first three',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reader-recovery-')),path=join(dir,'research.sqlite');let f=make({path});try{
  const old=await exhausted(f);f.setMode('new-limit');await f.until(()=>f.getReads()===4);await f.drive(5);assert.equal(f.getReads(),4);f.advance(60001);await f.until(()=>f.getReads()===5);await f.drive(5);assert.equal(f.getReads(),5);f.advance(120001);await f.until(()=>f.getReads()===6);f.advance(240001);await f.drive(10);
  assert.equal(source(f).status,'observing');assert.equal(JSON.parse(source(f).payload).prepareAttempts,6);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_attempts WHERE topic_id=?').get(old.topic_id).n,6);assert.equal(f.calls.dossier,1);
  await f.close();f=make({path,mode:'success'});await f.drive(20);assert.equal(f.getReads(),0);assert.equal(source(f).status,'observing');assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='automatic-source-capacity-recovery'").get().n,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('cancelled, edited, changed-request, incompatible and unproven failures cannot receive a recovery budget',async()=>{
 for(const kind of ['cancelled','edited','request-edited','configuration','corrupt-basis','unrelated-error','missing-attempt']){
  const f=make();try{
   const row=await exhausted(f);f.setMode('success');
   if(kind==='cancelled')f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE id=?").run(row.id);
   if(kind==='edited'){const t=f.service.research.get(row.topic_id);f.service.research.update(t.id,{version:t.version,nextEvidence:'User changed the research'});}
   if(kind==='request-edited'){const p=JSON.parse(plans(f)[0].payload),t=f.service.research.get(p.anchor.topicId);f.service.research.update(t.id,{version:t.version,nextEvidence:'User changed the source request'});}
   if(kind==='configuration')oldExecution(f,{model:'different-model'});
   if(kind==='corrupt-basis')f.store.db.prepare('UPDATE research_pipeline_execution_bases SET payload=? WHERE hash=?').run('{',JSON.parse(row.payload).executionHash);
   if(kind==='unrelated-error'){const r=f.store.db.prepare('SELECT * FROM research_source_attempts WHERE topic_id=? LIMIT 1').get(row.topic_id);f.store.db.prepare('UPDATE research_source_attempts SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(r.payload),error:'HTTP failure'}),r.id);}
   if(kind==='missing-attempt')f.store.db.prepare('DELETE FROM research_source_attempts WHERE id=(SELECT min(id) FROM research_source_attempts WHERE topic_id=?)').run(row.topic_id);
   await f.drive(8);assert.equal(f.getReads(),3,kind);assert.equal(JSON.parse(source(f).payload).preparationRecovery,undefined,kind);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='automatic-source-capacity-recovery'").get().n,0,kind);
  }finally{await f.close();}
 }
});

test('recovery and observed-plan revival roll back together; changed recovery proof cannot authorize a read',async()=>{
 const f=make();try{
  const old=await exhausted(f);f.setMode('success');await f.step();
  f.store.db.exec("CREATE TRIGGER reject_revive BEFORE UPDATE ON research_evidence_searches WHEN OLD.status='observing' AND NEW.status='pending' BEGIN SELECT RAISE(ABORT,'test rollback'); END");await f.step();assert.deepEqual(source(f),old);assert.equal(f.getReads(),3);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_audit WHERE action='automatic-source-capacity-recovery'").get().n,0);
  f.store.db.exec('DROP TRIGGER reject_revive');await f.step();const row=source(f),p=JSON.parse(row.payload);assert.equal(row.status,'ready');assert(p.preparationRecovery);p.preparationRecovery.attemptBase=0;f.store.db.prepare('UPDATE research_pipeline_items SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);await f.drive(10);assert.equal(f.getReads(),3);assert(['failed','invalidated','observing'].includes(source(f).status));
 }finally{await f.close();}
});
