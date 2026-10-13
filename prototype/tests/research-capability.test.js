import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capabilityFixture,legacyBusinessDossier,legacySynthesis,legacyReady} from './helpers/research-capability-fixture.mjs';
import {watchRefreshes,event,synthesisRows} from './helpers/watch-review-fixture.mjs';
import {factDossier} from './helpers/business-facts-fixture.mjs';
import {financialFixture} from './helpers/research-financials-fixture.mjs';
import {researchCapabilityReview,validCapabilityReviewTrigger} from '../shared/research-capability.mjs';
import {BUSINESS_FACT_CONTRACT} from '../shared/business-facts.mjs';
import {validateMonitoringFollowup} from '../server/system-monitoring-revisions.mjs';
import {activityText} from '../shared/activity-view.mjs';
import {two} from './automatic-research-fixture.mjs';
import {researchObservationSubjects} from '../server/research-observation-subjects.mjs';
import {randomUUID} from 'node:crypto';

test('only a missing business protocol with a cited unknown prerequisite supplies a capability cause; new or evidence-free unknowns do not',async()=>{
 const f=financialFixture();try{const a=legacyBusinessDossier(f.packet).companyAssessments[0],proof=researchCapabilityReview(a,{});assert.equal(proof.conditions.length,1);assert.equal(proof.to,BUSINESS_FACT_CONTRACT);assert.equal(researchCapabilityReview(a,f.packet),null);assert.equal(researchCapabilityReview(legacyBusinessDossier(f.packet,{cited:false}).companyAssessments[0],{}),null);const t={kind:'capability',group:'businessRepresentation',symbol:a.symbol,policy:proof.policy,proof};assert(validCapabilityReviewTrigger(t,a,{}));t.proof={...proof,conditions:[]};assert(!validCapabilityReviewTrigger(t,a,{}));
 }finally{await f.close();}
});

test('an old automatic saved judgement gets one new business-capable review without holdings, changing its history or requesting user acceptance',async()=>{
 const f=capabilityFixture();try{const old=await legacyReady(f),history=f.service.research.historyDetail(old.id,old.version),book=f.service.paper.snapshot();assert.equal(old.dossier.companyAssessment.assessments[0].recommendation.action,'unknown');await f.until(()=>watchRefreshes(f).some(j=>j.status==='completed'));const row=watchRefreshes(f)[0],t=row.p.packet.input.monitoringReview.triggers[0];assert.equal(t.kind,'capability');assert.equal(row.p.packet.businessFactContract,BUSINESS_FACT_CONTRACT);assert.equal(t.proof.conditions[0].analysis.text,old.dossier.companyAssessment.assessments[0].analysis.nextCheck.text);assert.equal(validateMonitoringFollowup(f.store.db,f.service.research.get(event(f).id),row).version,old.version);assert.equal(f.calls.dossier,2);await f.drive(20);assert.equal(f.calls.dossier,2);assert.deepEqual(f.service.research.historyDetail(old.id,old.version),history);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.snapshot().overview.decisions.length,0);const log=f.service.activity({topic:old.id}).items.find(i=>i.action==='research-capability-review-queued');assert(log);assert.match(activityText(log),/NVDA.US.*新版/);
 }finally{await f.close();}
});

test('legacy capability refresh remains in the original persisted quota queue across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-capability-')),path=join(dir,'isolated.sqlite');let f=capabilityFixture({path});try{await legacyReady(f);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});await f.until(()=>watchRefreshes(f).length===1);const id=watchRefreshes(f)[0].id;await f.drive(4);assert.equal(f.calls.dossier,1);await f.close();f=capabilityFixture({path});await f.drive(6);assert.equal(f.calls.dossier,0);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>watchRefreshes(f)[0].status==='completed');assert.equal(watchRefreshes(f)[0].id,id);assert.equal(f.calls.dossier,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('new packets with unknown prerequisites and unbound manual history never receive a capability refresh',async()=>{
 const f=capabilityFixture({runner:legacyBusinessDossier});try{f.add(1);await f.until(()=>f.calls.dossier===1);await f.drive(25);assert.equal(watchRefreshes(f).length,0);assert.equal(f.calls.dossier,1);}finally{await f.close();}
 const manual=financialFixture({runner:legacyBusinessDossier});try{await manual.save();const row=manual.service.snapshot().observationInbox.researchActions[0];assert.equal(row.judgment.businessReview,undefined);assert.equal(manual.service.snapshot().overview.decisions.length,0);}finally{await manual.close();}
});

test('pause, edit, source revision, restore and explicit cancellation preserve the old judgement without forcing protocol migration',async()=>{
 for(const mode of ['pause','edit','source','restore','cancel','automatic']){const f=capabilityFixture();try{const t=await legacyReady(f);if(mode==='pause')f.service.controlOperation('observations','pause');if(mode==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'User kept their own research'});if(mode==='source')f.revise(1);if(mode==='restore')f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();if(mode==='automatic')f.queue.configure({...f.queue.snapshot().settings,automatic:false});if(mode==='cancel'){await f.until(()=>watchRefreshes(f).length===1);f.store.db.prepare("UPDATE research_pipeline_event_jobs SET status='cancelled' WHERE id=?").run(watchRefreshes(f)[0].id);}if(mode==='restore')await assert.rejects(()=>f.step(),/恢复/);else if(mode==='source')await f.step();else await f.drive(12);assert.equal(f.calls.dossier,1,mode);assert.equal(f.service.research.historyDetail(t.id,t.version).topic.dossier.sourceModelRun.id,t.dossier.sourceModelRun.id);
 }finally{await f.close();}}
});

test('three failed capability calls stop permanently for that cause instead of reopening the old unknown on a later day',async()=>{
 const f=capabilityFixture({runner:p=>{if(p.input.monitoringReview)throw Error('synthetic capability failure');return legacyBusinessDossier(p);}});try{await legacyReady(f);await f.until(()=>watchRefreshes(f)[0]?.p.retryAt);f.advance(60001);await f.until(()=>f.calls.dossier===3);await f.drive(3);f.advance(120001);await f.until(()=>watchRefreshes(f)[0]?.status==='observing');assert.equal(f.calls.dossier,4);f.advance(86400000*3);await f.drive(20);assert.equal(f.calls.dossier,4);assert.equal(watchRefreshes(f).length,1);
 }finally{await f.close();}
});

test('a composite owns the capability review and preserves its completed members and original synthesis',async()=>{
 const f=capabilityFixture({composite:true,runner:legacyBusinessDossier});try{const c=await two(f);await f.until(()=>synthesisRows(f).some(r=>r.status==='completed'));legacySynthesis(f,synthesisRows(f)[0]);const old=f.queue.synthesis.detail(c.id).selected;assert(old.current);const topics=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),calls=f.calls.dossier;await f.until(()=>synthesisRows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));assert.equal(f.synthesisCalls,2);assert.equal(f.calls.dossier,calls);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),topics);assert.deepEqual(f.queue.synthesis.detail(c.id,old.id).selected.run,old.run);await f.drive(20);assert.equal(f.synthesisCalls,2);assert.equal(f.queue.synthesis.detail(c.id).selected.current,true);
 }finally{await f.close();}
});

test('queue insertion rollback preserves the old version and retries once, while tampering with the frozen cause invalidates adoption',async()=>{
 const f=capabilityFixture();try{const original=await legacyReady(f);f.store.db.exec("CREATE TEMP TRIGGER block_capability BEFORE INSERT ON research_pipeline_event_jobs WHEN json_type(NEW.payload,'$.monitoringFollowup')='object' BEGIN SELECT RAISE(ABORT,'synthetic capability rollback'); END");let failed=false;for(let i=0;i<10;i++){const r=await f.step();if(r.error){failed=true;break;}}assert(failed);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(event(f),original);f.store.db.exec('DROP TRIGGER block_capability');await f.until(()=>watchRefreshes(f)[0]?.status==='completed');const row=watchRefreshes(f)[0],version=row.p.monitoringFollowup.baseVersion+1,old=f.store.db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(original.id,version),v=JSON.parse(old.payload);v.monitoringReview.triggers[0].proof.conditions=[];f.store.db.prepare('UPDATE research_versions SET payload=? WHERE topic_id=? AND version=?').run(JSON.stringify(v),original.id,version);assert.throws(()=>validateMonitoringFollowup(f.store.db,f.service.research.get(event(f).id),row));
 }finally{await f.close();}
});

test('cancelling an in-flight capability refresh discards late output and cannot make the prior research current again',async()=>{
 let resolve;const f=capabilityFixture({runner:p=>p.input.monitoringReview?new Promise(r=>{resolve=()=>r(factDossier(p));}):legacyBusinessDossier(p)});try{await legacyReady(f);await f.until(()=>watchRefreshes(f).length===1);await f.service.runOperation('discovery');const j=watchRefreshes(f)[0],before=event(f);assert.equal(j.status,'running');f.service.modelResearch.cancel(j.topic_id,j.run_id);resolve();await f.service.modelResearch.wait(j.run_id);await f.drive(15);assert.equal(watchRefreshes(f)[0].status,'cancelled');assert.deepEqual(event(f),before);assert.equal(f.calls.dossier,2);
 }finally{resolve?.();await f.close();}
});

test('a manually adopted legacy packet remains outside automatic capability enrollment',async()=>{
 const f=financialFixture({runner:legacyBusinessDossier});try{const p=structuredClone(f.packet);delete p.businessFactContract;delete p.watchReviewContract;const run=f.service.modelResearch.start(f.topic.id,{version:f.topic.version},()=>{},p);await f.service.modelResearch.wait(run.id);const topic=f.service.modelResearch.adopt(f.topic.id,run.id,{version:f.topic.version});const [subject]=researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[topic]);assert(subject.ready);assert(subject.fresh);assert(researchCapabilityReview(subject.assessments[0],subject));assert.equal(subject.automaticReview,false);
 }finally{await f.close();}
});

test('a later cancelled or exhausted dossier is not reopened through legacy capability enrollment',async()=>{
 for(const status of ['cancelled','observing']){const f=capabilityFixture();try{const old=await legacyReady(f),row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed'").get(),p=JSON.parse(row.payload);p.topicVersion=old.version;delete p.adoptedVersion;f.store.db.prepare('INSERT INTO research_pipeline_event_jobs(id,item_id,topic_id,kind,status,run_id,payload) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.item_id,row.topic_id,row.kind,status,null,JSON.stringify(p));await f.drive(20);assert.equal(watchRefreshes(f).length,0,status);assert.equal(f.calls.dossier,1,status);assert.deepEqual(event(f),old);
 }finally{await f.close();}}
});

test('a failed composite capability review stops after three attempts without creating member refreshes',async()=>{
 const f=capabilityFixture({composite:true,runner:p=>{if(p.input.monitoringReview)throw Error('synthetic composite capability failure');return legacyBusinessDossier(p);}});try{const c=await two(f);await f.until(()=>synthesisRows(f).some(r=>r.status==='completed'));legacySynthesis(f,synthesisRows(f)[0]);const old=f.queue.synthesis.detail(c.id).selected,calls=f.calls.dossier;await f.until(()=>synthesisRows(f).some(r=>r.p.monitoringReview&&r.p.nextRetryAt));f.advance(60001);await f.until(()=>f.synthesisCalls===3);await f.drive(3);f.advance(120001);await f.until(()=>synthesisRows(f).some(r=>r.p.monitoringReview&&r.status==='observing'));f.advance(86400000*3);await f.drive(20);assert.equal(f.synthesisCalls,4);assert.equal(f.calls.dossier,calls);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(f.queue.synthesis.detail(c.id,old.id).selected.run,old.run);
 }finally{await f.close();}
});
