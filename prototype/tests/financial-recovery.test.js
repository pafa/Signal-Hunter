import {AUTOMATIC_RESEARCH_WORKFLOW} from '../server/research-output-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {make,legacy,event,jobs,recoveries} from './helpers/financial-recovery-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {financialRecoveryCandidate} from '../server/financial-recovery.mjs';
import {documentResearchOrigin} from '../server/system-document-revisions.mjs';
import {secSubmissionsUrl} from '../server/financial-filing-material.mjs';

const settled=f=>recoveries(f).some(j=>j.status==='completed');
test('a proven legacy financial failure automatically prepares a new dossier with cumulative attempts and unchanged old history',async()=>{
 const f=make();try{
  await legacy(f);const t=f.service.research.get(event(f).id),old=jobs(f)[0],versions=f.store.db.prepare('SELECT payload FROM research_versions').all().map(x=>x.payload),paper=f.service.paper.snapshot(),proof=financialRecoveryCandidate(f.store.db,t,'NVDA.US');assert.equal(proof.capability,'sec-issuer-ascii-case/1');f.advance(86400001);f.setMode('current');const beforeCalls=f.calls.dossier,requestCount=f.requests.length;
  await f.until(()=>recoveries(f).length===1);assert.equal(f.calls.dossier,beforeCalls);assert.equal(event(f).version,t.version);assert.deepEqual(recoveries(f)[0].p.financial.attempts,old.p.financial.attempts);
  await f.until(()=>settled(f));const next=f.service.research.get(t.id),job=recoveries(f)[0],fin=next.financialSources[0];assert.equal(fin.status,'saved');assert.equal(fin.recovery.outcome,'saved');assert.equal(fin.recovery.previousResultHash,digest(t.financialSources[0]));assert.equal(fin.attempt,4);assert.equal(job.p.financial.attempts.filter(x=>x.state==='started').length,4);assert.equal(job.p.financial.attempts.at(-1).generationAttempt,1);assert.equal(f.calls.dossier,2);assert.equal(f.requests.length-requestCount,2);assert.equal(f.packets[1].researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(job.p.packet.researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert(f.packets[1].input.evidence.some(e=>e.material?.financialSource?.schema==='sec-companyfacts-selection/3'));assert(f.packets[1].input.evidence.some(e=>e.material?.filingSource?.schema==='sec-filing-excerpts/5'));
  assert.deepEqual(documentResearchOrigin(f.store.db,next,t.version,old.run_id),t);assert.equal(jobs(f)[0].payload,old.payload);for(const x of versions)assert(f.store.db.prepare('SELECT 1 FROM research_versions WHERE payload=?').get(x));assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
  await f.drive(8);assert.equal(recoveries(f).length,1);assert.equal(f.calls.dossier,2);
 }finally{await f.close();}
});

test('one recovery generation has three new preparation attempts, preserves previous failures and does not reopen after exhaustion',async()=>{
 const f=make();try{await legacy(f);const old=f.service.research.get(event(f).id),oldResult=old.financialSources[0];f.setMode('fail');await f.until(()=>recoveries(f).some(j=>j.p.financial.attempts.some(a=>a.generationAttempt===1&&a.state==='failed')));assert.equal(recoveries(f)[0].p.retryAt,Date.parse('2026-10-08T00:04:00.002Z'));f.advance(60001);await f.until(()=>recoveries(f)[0].p.financial.attempts.some(a=>a.generationAttempt===2&&a.state==='failed'));f.advance(120001);await f.until(()=>settled(f));
  const t=event(f),entry=t.financialSources[0],{recovery,...preserved}=entry;assert.deepEqual(preserved,oldResult);assert.equal(recovery.outcome,'unavailable');assert.equal(recovery.attempt,3);assert.equal(recoveries(f)[0].p.financial.attempts.filter(a=>a.state==='started').length,6);assert.equal(recoveries(f)[0].p.financial.attempts.at(-1).attempt,6);const calls=f.calls.dossier,requests=f.requests.length;f.setMode('current');f.advance(86400000);await f.drive(10);assert.equal(recoveries(f).length,1);assert.equal(f.calls.dossier,calls);assert.equal(f.requests.length,requests);
 }finally{await f.close();}
});

test('restart keeps recovery backoff and frozen original response receipts instead of granting another budget',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-recovery-')),path=join(dir,'test.sqlite');let f=make({path});try{await legacy(f);f.setMode('fail');await f.until(()=>recoveries(f).some(j=>j.p.financial.attempts.some(a=>a.generationAttempt===1&&a.state==='failed')));const old=recoveries(f)[0],receipts=old.p.financialFollowup.proof.sources;await f.close();f=make({path,mode:'current'});f.advance(180002);await f.drive(3);assert.equal(f.requests.length,0);assert.equal(recoveries(f)[0].p.financial.attempts.filter(a=>a.state==='started').length,4);f.advance(86400001);await f.until(()=>settled(f));assert.equal(recoveries(f).length,1);assert.equal(recoveries(f)[0].p.financial.attempts.filter(a=>a.state==='started').length,5);assert.deepEqual(recoveries(f)[0].p.financialFollowup.proof.sources,receipts);assert.equal(f.requests.length,2);assert.equal(f.requests[0],secSubmissionsUrl('0001045810'));
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('human edits, cancelled owners, disabled financial sources and exhausted call quotas cannot start recovery',async()=>{
 for(const gate of ['edit','owner-cancelled','disabled','quota']){const f=make();try{await legacy(f);const t=event(f),v=t.version,calls=f.calls.dossier;f.setMode('current');
  if(gate==='edit')f.service.research.update(t.id,{version:v,nextEvidence:'本人修改保留'});
  if(gate==='owner-cancelled')f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE id=?").run(jobs(f)[0].item_id);
  if(gate==='disabled')f.queue.configure({...f.queue.snapshot().settings,financialSources:false});
  if(gate==='quota'){const s=f.queue.snapshot();f.queue.configure({...s.settings,dailyCalls:s.callsInLast24Hours});}
  await f.drive(6);assert.equal(recoveries(f).length,0,gate);assert.equal(f.calls.dossier,calls,gate);assert.equal(event(f).version,v+(gate==='edit'?1:0));
 }finally{await f.close();}}
});

test('an edit after recovery preparation invalidates the queued work without modifying the edited research',async()=>{
 const f=make();try{await legacy(f);f.setMode('current');await f.until(()=>recoveries(f).length===1);const t=event(f),calls=f.calls.dossier,requests=f.requests.length;f.service.research.update(t.id,{version:t.version,nextEvidence:'本人优先'});await f.drive(8);assert.equal(recoveries(f)[0].status,'invalidated');assert.equal(event(f).nextEvidence,'本人优先');assert.equal(f.calls.dossier,calls);assert.equal(f.requests.length,requests);
 }finally{await f.close();}
});

test('tampered raw receipts or recovery proof cannot authorize resumed reads or bridge old source requests',async()=>{
 for(const kind of ['raw','proof']){const f=make();try{await legacy(f);f.setMode('current');await f.until(()=>recoveries(f).length===1);const j=recoveries(f)[0],t=event(f),calls=f.calls.dossier,requests=f.requests.length;
  if(kind==='raw')f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('tampered'),j.p.financialFollowup.proof.sources[1].sha256);
  else{j.p.financialFollowup.proof.capability='unrestricted-retry';f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(j.p),j.id);}
  await f.drive(8);assert.equal(recoveries(f)[0].status,'invalidated');assert.equal(event(f).version,t.version);assert.equal(f.calls.dossier,calls);assert.equal(f.requests.length,requests);
 }finally{await f.close();}}
});

test('a genuine old table-budget rejection recovers the original filing while preserving previously saved facts',async()=>{
 const f=make({capability:'cells'});try{await legacy(f);const before=f.service.research.get(event(f).id),facts=before.evidence.find(x=>x.family==='earnings'),proof=financialRecoveryCandidate(f.store.db,before,'NVDA.US');assert.equal(proof.capability,'sec-filing-cell-budget/2');assert.equal(proof.sources.length,4);f.setMode('current');await f.until(()=>settled(f));const next=event(f),entry=next.financialSources[0];assert.equal(entry.filings[0].status,'saved');assert.equal(entry.materialId,facts.materialId);assert(next.evidence.some(e=>e.materialId===facts.materialId));const filing=f.packets.at(-1).input.evidence.find(e=>e.material?.filingSource);assert.match(filing.material.body,/Cash flow USD 987/);assert.equal(entry.recovery.outcome,'saved');assert.equal(jobs(f)[0].p.financial.results[0].filings[0].status,'unavailable');
 }finally{await f.close();}
});

test('exhausted filing recovery preserves the already saved financial facts and original coverage',async()=>{
 const f=make({capability:'cells'});try{await legacy(f);const old=event(f).financialSources[0];f.setMode('fail');await f.until(()=>recoveries(f).some(j=>j.p.financial.attempts.some(x=>x.generationAttempt===1&&x.state==='failed')));f.advance(60001);await f.until(()=>recoveries(f)[0].p.financial.attempts.some(x=>x.generationAttempt===2&&x.state==='failed'));f.advance(120001);await f.until(()=>settled(f));const {recovery,...current}=event(f).financialSources[0];assert.deepEqual(current,old);assert.equal(recovery.outcome,'unavailable');assert(f.packets.at(-1).input.evidence.some(e=>e.material?.id===old.materialId));
 }finally{await f.close();}
});

test('recovering preparation rolls back evidence, coverage and queue together after a write failure',async()=>{
 const f=make();try{await legacy(f);f.setMode('current');await f.until(()=>recoveries(f).length===1);const before=f.service.research.get(event(f).id),count=f.store.db.prepare('SELECT count(*) n FROM research_materials').get().n;
 f.store.db.exec("CREATE TRIGGER fail_financial_save BEFORE UPDATE ON research_pipeline_event_jobs WHEN json_array_length(NEW.payload,'$.financialFollowup.preparations')>0 BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;");
 let result;for(let i=0;i<20;i++){result=await f.step();if(result.error)break;}assert(result.error);assert.deepEqual(f.service.research.get(before.id),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_materials').get().n,count);assert.equal(recoveries(f)[0].p.financial.attempts.filter(x=>x.state==='started').length,4);
 f.store.db.exec('DROP TRIGGER fail_financial_save');await f.until(()=>settled(f));assert.equal(event(f).financialSources[0].attempt,5);assert.equal(event(f).financialSources[0].recovery.attempt,2);
 }finally{await f.close();}
});

test('financial recovery audit labels expose the security and cumulative attempt without a new intermediate approval',async()=>{
 const {activityText}=await import('../shared/activity-view.mjs');assert.match(activityText({kind:'pipeline',lane:'discovery',action:'financial-source-started',detail:{symbol:'NVDA.US',attempt:4,generationAttempt:1}}),/NVDA.US.*累计第 4 次.*恢复 1\/3/);assert.match(activityText({kind:'pipeline',lane:'discovery',action:'financial-research-prepared',detail:{symbol:'NVDA.US'}}),/接续官方财务补证/);
});

test('a cancelled recovery model is retained and cannot grant another generation',async()=>{
 const {dossier}=await import('./automatic-research-fixture.mjs');let release,started;const began=new Promise(r=>started=r),f=make({researchRunner:p=>{if(!p.input.financialSources?.some(x=>x.recovery))return dossier(p);started();return new Promise(r=>release=()=>r(dossier(p)));}});
 try{await legacy(f);const original=event(f).dossier;f.setMode('current');await f.until(()=>recoveries(f).length===1);const tick=(async()=>{for(let i=0;i<30&&!release;i++)await f.step();})();await began;const job=recoveries(f)[0];f.service.modelResearch.cancel(job.topic_id,job.run_id);release();await tick;await f.drive(8);assert.equal(recoveries(f).length,1);assert.equal(recoveries(f)[0].status,'cancelled');assert.deepEqual(event(f).dossier,original);assert.equal(f.calls.dossier,2);assert.throws(()=>documentResearchOrigin(f.store.db,f.service.research.get(event(f).id),job.p.financialFollowup.baseVersion,job.p.financialFollowup.baseRunId));
 }finally{release?.();await f.close();}
});

test('generic failed reads and restore-review state do not obtain a capability recovery budget',async()=>{
 const f=make({mode:'fail'});try{await legacy(f);const version=event(f).version,calls=f.calls.dossier;f.setMode('current');await f.drive(8);assert.equal(recoveries(f).length,0);assert.equal(event(f).version,version);assert.equal(f.calls.dossier,calls);}finally{await f.close();}
 const g=make();try{await legacy(g);g.setMode('current');g.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();await assert.rejects(()=>g.step(),/恢复/);assert.equal(recoveries(g).length,0);}finally{await g.close();}
});

for(const delayedAttachment of [false,true])test('financial and attachment generations preserve the original request chain; delayed='+delayedAttachment,async()=>{
 const {dossier,output}=await import('./automatic-research-fixture.mjs'),{extractArticle}=await import('../server/source-reader.mjs'),{sourceRequestAvailable}=await import('../server/source-links.mjs'),{currentDocumentResearch,linkedDocumentContext}=await import('../server/research-document-context.mjs');
 let allowAnnex=!delayedAttachment;const quote='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。',annex='https://example.com/recovery-annex.html';
 const f=make({sourceReader:async url=>{if(url===annex&&!allowAnnex)throw Error('synthetic attachment retry');return {url,...extractArticle(`<html><body><article><h1>合成恢复公告</h1><p>${quote.repeat(30)}</p>${url===annex?'ANNEX-RECOVERY-CHECK':'<a href="'+annex+'">附件：恢复核对</a>'}</article></body></html>`,url)};},extractionRunner:p=>output(p,'decomposition',{events:p.input.material.url===annex?[]:[{title:'合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['证据']}),researchRunner:p=>{const d=dossier(p),sourceRequests=p.input.evidence.flatMap(e=>(e.material?.sourceLinks?.links||[]).filter(l=>l.url===annex&&sourceRequestAvailable(p,e.id,l.url)).map(l=>({evidenceId:e.id,url:l.url,reason:'核对明确附件'}))),value={...d,sourceRequests};value.rawOutput=JSON.stringify({sections:d.sections,companyAssessments:d.companyAssessments,missingEvidence:d.missingEvidence,sourceRequests});value.trace={...d.trace,outputHash:digest(value.rawOutput)};return value;}});
 try{await legacy(f);assert.equal(f.packets[0].input.evidence[0].material.extractionEvidence.attachments.length,1);const initial=f.service.research.get(event(f).id),run=jobs(f)[0].run_id;f.setMode('current');if(delayedAttachment){await f.until(()=>recoveries(f).length===1);allowAnnex=true;f.advance(60001);f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('research_pipeline_next_lane','sources')").run();await f.until(()=>linkedDocumentContext(f.store,f.service.research,[{topic:f.service.research.get(initial.id),packet:f.service.research.packet(initial.id)}])?.documents.length===1);assert.equal(recoveries(f)[0].status,'queued');}await f.until(()=>{const t=event(f);return recoveries(f).some(j=>j.status==='completed'||j.status==='observing'&&j.p.documentScopeChanged)&&t.documentContext?.entries.some(e=>e.status==='available')&&t.dossier.basedOnResearchVersion===t.version&&jobs(f).every(j=>!['queued','running'].includes(j.status));});const current=f.service.research.get(initial.id);assert.equal(currentDocumentResearch(f.store,f.service.research,current),true);assert.deepEqual(documentResearchOrigin(f.store.db,current,initial.version,run),initial);assert(f.packets.at(-1).input.evidence.some(e=>e.material?.body.includes('ANNEX-RECOVERY-CHECK')));assert(f.packets.at(-1).input.evidence.some(e=>e.material?.financialSource));assert.equal(recoveries(f).length,1);assert(jobs(f).every(j=>j.status!=='invalidated'));
 }finally{await f.close();}
});
