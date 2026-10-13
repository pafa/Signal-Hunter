import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {watchFixture,watchDossier,watchReady,watchRefreshes,event,synthesisRows} from './helpers/watch-review-fixture.mjs';
import {financialFixture} from './helpers/research-financials-fixture.mjs';
import {actionDossier} from './helpers/research-action-fixture.mjs';
import {two,dossier,config} from './automatic-research-fixture.mjs';
import {validateCodexDraft,codexPrompt,codexDraftSchema,digest} from '../server/codex-research.mjs';
import {useStoredOutputContract} from '../server/research-output-contract.mjs';
import {WATCH_ACTION_VERSION,WATCH_REVIEW_INTERVAL_MS as day,watchReviewSchedule} from '../shared/research-watch.mjs';
import {researchActionReadiness} from '../shared/research-action.mjs';
import {validateMonitoringFollowup} from '../server/system-monitoring-revisions.mjs';
import {activityText} from '../shared/activity-view.mjs';

test('evidence-backed watch needs no invented action deadline, while legacy watch and every trade keep exact prior requirements',async()=>{
 const f=financialFixture();try{const r=JSON.parse(watchDossier(f.packet).rawOutput),a=validateCodexDraft(r,f.packet).companyAssessments[0];assert.equal(a.recommendation.version,WATCH_ACTION_VERSION);assert.equal(a.recommendation.validUntil,null);assert(codexDraftSchema(f.packet).properties.companyAssessments.items.properties.recommendation.anyOf);assert(codexPrompt(f.packet).includes('每24小时'));
 for(const change of [v=>v.action='buy',v=>v.validUntil='2026-12-01T00:00:00Z',v=>v.citations=[],v=>v.holdingHorizon={status:'defined',until:'2027-01-01T00:00:00Z',reason:'invented',citations:v.citations},v=>v.nextReviewAt='2026-10-09',v=>v.citations[0].quote='invented',v=>v.version='research-action/1']){const bad=structuredClone(r);change(bad.companyAssessments[0].recommendation);assert.throws(()=>validateCodexDraft(bad,f.packet));}
 const old=useStoredOutputContract(f.packet,{});assert.equal(old.watchReviewContract,undefined);assert.throws(()=>validateCodexDraft(r,old));assert(!codexPrompt(old).includes('watchReviewContract='));assert(!codexDraftSchema(old).properties.companyAssessments.items.properties.recommendation.anyOf);
 for(const action of ['buy','hold','reduce','exit']){const raw=JSON.parse(actionDossier(f.packet,{action}).rawOutput);assert.equal(validateCodexDraft(raw,f.packet).companyAssessments[0].recommendation.action,action);raw.companyAssessments[0].recommendation.validUntil=null;assert.throws(()=>validateCodexDraft(raw,f.packet));}
 }finally{await f.close();}
});

test('watch readiness reports the system cadence separately, never an executable plan or a fabricated sell date',async()=>{
 const f=financialFixture();try{const a=watchDossier(f.packet).companyAssessments[0],at=f.packet.generatedAt,subject={kind:'research',id:f.topic.id,version:1,runId:'synthetic',preparedAt:at,automaticReview:true,ready:true,fresh:true,changed:false,current:f.topic};
 const first=researchActionReadiness(a,{subject,at});assert.equal(first.state,'observing');assert.equal(first.executable,false);assert.equal(first.judgment.validUntil,null);assert.equal(first.judgment.holdingHorizon.status,'unknown');assert.equal(first.judgment.watchReview.nextReviewAt,new Date(Date.parse(at)+day).toISOString());
 const due=researchActionReadiness(a,{subject,at:new Date(Date.parse(at)+day).toISOString()});assert.equal(due.state,'observing');assert(due.judgment.watchReview.due);assert(due.reasons.some(r=>r.includes('等待接续')));subject.changed=true;assert.equal(researchActionReadiness(a,{subject,at}).state,'historical');assert.equal(watchReviewSchedule(a.recommendation,'bad',at),null);
 }finally{await f.close();}
});

test('unheld watch automatically refreshes once after each saved daily interval, retaining history and every account',async()=>{
 const f=watchFixture();try{const old=await watchReady(f),history=f.service.research.historyDetail(old.id,old.version),book=f.service.paper.snapshot();assert.equal(f.service.actualHoldings.holdingSymbols().length,0);f.advance(day-1);await f.drive(8);assert.equal(watchRefreshes(f).length,0);f.advance(1);await f.until(()=>watchRefreshes(f).some(j=>j.status==='completed'));assert.equal(f.calls.dossier,2);const current=f.service.research.get(event(f).id);assert(current.version>old.version);assert.equal(current.dossier.companyAssessment.assessments[0].recommendation.action,'watch');assert.equal(validateMonitoringFollowup(f.store.db,current,watchRefreshes(f)[0]).version,old.version);assert.deepEqual(f.service.research.historyDetail(old.id,old.version),history);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.marketSimulation.snapshot().configured,false);await f.drive(15);assert.equal(f.calls.dossier,2);f.advance(day);await f.until(()=>watchRefreshes(f).filter(j=>j.status==='completed').length===2);assert.equal(f.calls.dossier,3);
 const log=f.service.activity({topic:old.id}).items.find(i=>i.action==='observation-review-queued');assert(log);assert.match(activityText(log),/NVDA.US.*每日复核/);
 }finally{await f.close();}
});

test('quota waits on the same queued observation across restart and does not allocate a holding or new approval',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'watch-review-')),path=join(dir,'isolated.sqlite');let f=watchFixture({path});try{await watchReady(f);f.advance(day);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.store.db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run('synthetic-other','synthetic-other',new Date(Date.parse('2026-10-08T00:00:00Z')+day).toISOString());await f.until(()=>watchRefreshes(f).length===1);const id=watchRefreshes(f)[0].id;assert.equal(watchRefreshes(f)[0].status,'queued');assert.equal(f.calls.dossier,1);await f.close();f=watchFixture({path});f.advance(day);await f.drive(8);assert.equal(f.calls.dossier,0);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>watchRefreshes(f)[0].status==='completed');assert.equal(watchRefreshes(f)[0].id,id);assert.equal(f.calls.dossier,1);assert.equal(watchRefreshes(f).length,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('automatic or observations pause, edits, archive and cancellation preserve prior watch and cannot force a refresh',async()=>{
 for(const mode of ['automatic','observations','edit','archive','cancel']){const f=watchFixture();try{await watchReady(f);f.advance(day);const t=event(f);if(mode==='automatic')f.queue.configure({...f.queue.snapshot().settings,automatic:false});if(mode==='observations')f.service.controlOperation('observations','pause');if(mode==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'User changed research'});if(mode==='archive')f.service.research.update(t.id,{version:t.version,status:'archived'});if(mode==='cancel'){await f.until(()=>watchRefreshes(f).length===1);f.store.db.prepare("UPDATE research_pipeline_event_jobs SET status='cancelled' WHERE id=?").run(watchRefreshes(f)[0].id);}await f.drive(12);assert.equal(f.calls.dossier,1,mode);assert.equal(event(f).dossier.sourceModelRun.id,t.dossier.sourceModelRun.id);
 }finally{await f.close();}}
});

test('three failed observation attempts stop without reopening the exhausted generation on the next day',async()=>{
 const f=watchFixture({runner:p=>{if(p.input.monitoringReview)throw Error('synthetic watch failure');return watchDossier(p);}});try{await watchReady(f);f.advance(day);await f.until(()=>watchRefreshes(f)[0]?.p.retryAt);f.advance(60001);await f.until(()=>f.calls.dossier===3);await f.drive(4);f.advance(120001);await f.until(()=>watchRefreshes(f)[0]?.status==='observing');assert.equal(f.calls.dossier,4);f.advance(day*2);await f.drive(15);assert.equal(f.calls.dossier,4);assert.equal(watchRefreshes(f).length,1);
 }finally{await f.close();}
});

test('current composite owns watch cadence without holdings, duplicate member calls or member rewrites',async()=>{
 const f=watchFixture({composite:true,watchMembers:true});try{const c=await two(f);await f.until(()=>synthesisRows(f).some(r=>r.status==='completed'));const original=synthesisRows(f)[0],topics=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),calls=f.calls.dossier;f.advance(day);await f.until(()=>synthesisRows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));assert.equal(f.synthesisCalls,2);assert.equal(f.calls.dossier,calls);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),topics);assert.equal(f.queue.synthesis.detail(c.id).selected.current,true);assert.deepEqual(f.queue.synthesis.detail(c.id,original.id).selected.packet,original.p.packet);await f.drive(16);assert.equal(f.synthesisCalls,2);assert.equal(f.calls.dossier,calls);const log=f.service.activity({topic:'event-cluster:'+c.id}).items.find(i=>i.action==='synthesis-observation-review-queued');assert(log);assert.match(activityText(log),/NVDA.US.*每日复核/);
 }finally{await f.close();}
});

test('an observation queue write failure rolls back and a changed frozen cadence cannot be adopted',async()=>{
 const f=watchFixture();try{await watchReady(f);const original=event(f);f.advance(day);f.store.db.exec("CREATE TEMP TRIGGER block_watch BEFORE INSERT ON research_pipeline_event_jobs WHEN json_type(NEW.payload,'$.monitoringFollowup')='object' BEGIN SELECT RAISE(ABORT,'synthetic watch rollback'); END");let failed=false;for(let i=0;i<8;i++){const x=await f.step();if(x.error){failed=true;break;}}assert(failed);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(event(f),original);f.store.db.exec('DROP TRIGGER block_watch');await f.until(()=>watchRefreshes(f).some(j=>j.status==='completed'));const t=event(f),row=watchRefreshes(f)[0],version=row.p.monitoringFollowup.baseVersion+1,old=f.store.db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(t.id,version),v=JSON.parse(old.payload);v.monitoringReview.triggers[0].value='2026-10-08T00:00:00Z';f.store.db.prepare('UPDATE research_versions SET payload=? WHERE topic_id=? AND version=?').run(JSON.stringify(v),t.id,version);assert.throws(()=>validateMonitoringFollowup(f.store.db,t,row));
 }finally{await f.close();}
});

test('an in-flight observation cancellation cannot save a late result or reopen the generation',async()=>{
 let resolve;const f=watchFixture({runner:p=>p.input.monitoringReview?new Promise(r=>{resolve=()=>r(watchDossier(p));}):watchDossier(p)});try{await watchReady(f);f.advance(day);await f.until(()=>watchRefreshes(f).length===1);await f.service.runOperation('discovery');const job=watchRefreshes(f)[0],before=f.service.research.get(job.topic_id);assert.equal(job.status,'running');assert(resolve);f.service.modelResearch.cancel(job.topic_id,job.run_id);resolve();await f.service.modelResearch.wait(job.run_id);await f.drive(12);assert.equal(watchRefreshes(f)[0].status,'cancelled');assert.deepEqual(f.service.research.get(job.topic_id),before);f.advance(day);await f.drive(12);assert.equal(watchRefreshes(f).length,1);assert.equal(f.calls.dossier,2);
 }finally{resolve?.();await f.close();}
});

test('unheld composite observation uses the original failure bound and cancellation retains the previous completed result',async()=>{
 for(const mode of ['fail','cancel']){const f=watchFixture({composite:true,runner:p=>{if(mode==='fail'&&p.input.monitoringReview)throw Error('synthetic composite failure');return watchDossier(p);}});try{const c=await two(f);await f.until(()=>synthesisRows(f).some(r=>r.status==='completed'));const old=f.queue.synthesis.detail(c.id).selected;f.advance(day);await f.until(()=>synthesisRows(f).length===2);if(mode==='cancel'){f.queue.synthesis.cancel(synthesisRows(f)[1].id);await f.drive(10);assert.equal(synthesisRows(f)[1].status,'cancelled');assert.equal(f.synthesisCalls,1);}else{await f.until(()=>synthesisRows(f)[1].p.nextRetryAt);f.advance(60001);await f.until(()=>f.synthesisCalls===3);await f.drive(3);f.advance(120001);await f.until(()=>synthesisRows(f)[1].status==='observing');assert.equal(synthesisRows(f)[1].p.attemptCount,3);}const calls=f.synthesisCalls;f.advance(day);await f.drive(12);assert.equal(f.synthesisCalls,calls);assert.equal(synthesisRows(f).length,2);assert.deepEqual(f.queue.synthesis.detail(c.id,old.id).selected.run,old.run);assert.equal(f.queue.synthesis.detail(c.id).selected.current,false);
 }finally{await f.close();}}
});

test('a source revision or restore lock stops a pending observation before preparing a model call',async()=>{
 for(const mode of ['source','restore']){const f=watchFixture();try{await watchReady(f);const old=event(f);f.advance(day);if(mode==='source'){const news=f.store.news()[0];f.store.ingest([{...news,title:news.title+' changed'}],'2026-10-09T00:00:00Z');await f.drive(6);assert.equal(watchRefreshes(f).length,0);}else{f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();await assert.rejects(()=>f.step(),/恢复/);assert.equal(watchRefreshes(f).length,0);}assert.equal(f.service.research.historyDetail(old.id,old.version).topic.dossier.sourceModelRun.id,old.dossier.sourceModelRun.id);
 }finally{await f.close();}}
});

test('recorded holdings display observation cadence as a system policy while quantities, costs and sell window stay unchanged',async()=>{
 const f=watchFixture();try{const t=await watchReady(f),h=f.service.actualHoldings,p=h.preview({rows:[{account:'Synthetic cadence account',symbol:'NVDA.US',quantity:'10',unitCost:'100.1',price:'',feeBasis:'included',asOf:'2026-10-08T00:00:00Z',source:'Synthetic snapshot',topicId:t.id,topicVersion:t.version}]});assert(p.canApply);h.apply({id:p.id,hash:p.hash});const before=h.snapshot();const current=f.service.snapshot().overview.accounts.find(a=>a.kind==='actual').positions[0].actualResearch;assert.equal(current.reviewPolicy,'research-observation-review/1');assert.equal(current.reviewAt,'2026-10-09T00:00:00.000Z');assert.equal(current.horizonAt,null);assert.equal(current.exitAdvice.executable,false);assert.deepEqual(h.snapshot(),before);
 }finally{await f.close();}
});

test('legacy queued research retains its exact output protocol across restart rather than acquiring the new observation policy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-watch-')),path=join(dir,'isolated.sqlite');let f=watchFixture({path,runner:p=>p.watchReviewContract?watchDossier(p):dossier(p)});try{f.add(1);await f.until(()=>f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='queued'").get());const row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='queued'").get(),p=JSON.parse(row.payload);delete p.packet.watchReviewContract;const stable={...p.packet};delete stable.generatedAt;p.executionHash=digest({kind:'dossier',packet:stable,prompt:codexPrompt(stable),schema:codexDraftSchema(stable),configHash:digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs})});f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);await f.close();let actual;f=watchFixture({path,runner:q=>{actual=q;return q.watchReviewContract?watchDossier(q):dossier(q);}});await f.until(()=>f.store.db.prepare('SELECT status FROM research_pipeline_event_jobs WHERE id=?').get(row.id).status==='completed');assert.equal(actual.watchReviewContract,undefined);assert.equal(actual.inputHash,p.packet.inputHash);assert.equal(event(f).dossier.companyAssessment.assessments[0].recommendation.version,'research-action/1');assert.equal(event(f).dossier.companyAssessment.assessments[0].recommendation.action,'unknown');
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a manually adopted watch stays an observation and cannot falsely claim enrollment in the automatic cadence',async()=>{
 const f=financialFixture({runner:watchDossier});try{await f.save();const row=f.service.snapshot().observationInbox.researchActions[0];assert.equal(row.state,'observing');assert.equal(row.judgment.watchReview,undefined);assert(row.reasons.some(r=>r.includes('未纳入后台自动观察复核')));assert.equal(f.service.snapshot().overview.decisions.length,0);
 }finally{await f.close();}
});
