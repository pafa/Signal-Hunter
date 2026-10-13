import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parentFixture,parentMention,parentJobs,parentFinished,oldParentIdentity,parentBody} from './helpers/parent-identity-fixture.mjs';
import {attachmentEvent} from './helpers/attachment-identity-fixture.mjs';
import {companyEntitiesPrompt,companyEntitiesSchema,validateCompanyEntities} from '../server/company-entities.mjs';
import {automaticIdentityDecision} from '../server/pipeline-event-automation.mjs';
import {validateSavedCandidate} from '../server/company-entity-runs.mjs';
import {OWNERSHIP_CONNECTION_VERSION} from '../server/company-ownership.mjs';
import {digest} from '../server/codex-research.mjs';
import {output} from './automatic-research-fixture.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {eventIdentityContext} from '../server/company-event-context.mjs';

async function packetFixture(){const f=parentFixture();f.add(1);await parentFinished(f);const row=parentJobs(f)[0],run=f.service.companyEntities.get(row.topic_id,row.run_id);return {f,row,run,p:run.packet,raw:run.candidate.resolution};}

test('explicit parent evidence automatically reaches new company research and preserves the direct event and account',async()=>{
 const f=parentFixture();try{const book=f.service.paper.snapshot();f.add(1);await parentFinished(f);const t=attachmentEvent(f),c=t.companies[0],m=c.entityResolution.mention;
 assert.equal(c.symbol,'NVDA.US');assert.equal(c.kind,'parent');assert.equal(c.relationStatus,'pending');assert.equal(c.direction,'unclear');assert.equal(c.identityReviewed,false);assert.equal(m.eventConnection.relation,'parent');assert.equal(m.eventConnection.ownership.subjectName,'Synthetic Subsidiary One');assert.equal(t.eventExtraction.event.actor,'国家项目甲');assert.equal(f.packets.at(-1).input.companies[0].kind,'parent');assert.equal(f.packets.at(-1).input.companyAssessment.targets[0].symbol,'NVDA.US');assert.equal(t.dossier.companyAssessment.assessments[0].recommendation.action,'unknown');assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.marketSimulation.snapshot().configured,false);const calls={...f.calls};await f.drive(8);assert.deepEqual(f.calls,calls);
 }finally{await f.close();}
});

test('parent connection requires literal ownership, direct subject and action chain, bounded to frozen material',async()=>{
 const {f,p,raw}=await packetFixture();try{assert.equal(p.input.identityConnectionVersion,OWNERSHIP_CONNECTION_VERSION);assert(companyEntitiesPrompt(p).includes('少数持股'));assert(companyEntitiesSchema(p).properties.mentions.items.properties.eventConnection.anyOf);assert.deepEqual(validateCompanyEntities(raw,p),raw);
 for(const mutate of [m=>delete m.eventConnection.ownership,m=>m.eventConnection.ownership.extra='invented',m=>m.eventConnection.anchorQuote='',m=>m.eventConnection.anchorQuote='another event',m=>m.eventConnection.ownership.subjectName='Another Subsidiary',m=>m.eventConnection.ownership.subjectReference='Other Bank',m=>m.eventConnection.ownership.ownershipQuote='NVIDIA owns Another Subsidiary.',m=>m.eventConnection.ownership.actionQuote='Bank made an invented announcement.',m=>m.eventConnection.ownership.subjectQuote=m.eventConnection.ownership.actionQuote.replace('Synthetic Subsidiary One','Other'),m=>m.eventConnection.ownership.subjectName='NVIDIA',m=>m.eventConnection.reason='',m=>m.eventConnection.relation='supplier']){const bad=structuredClone(raw);mutate(bad.mentions[0]);assert.throws(()=>validateCompanyEntities(bad,p));assert.equal(automaticIdentityDecision(bad.mentions[0],p.input.directory,p.input.directorySnapshot,p).symbol,null);}
 const noContract=structuredClone(p);delete noContract.input.identityConnectionVersion;assert.throws(()=>validateCompanyEntities(raw,noContract));assert.equal(automaticIdentityDecision(raw.mentions[0],p.input.directory).symbol,null);
 }finally{await f.close();}
});

test('legacy candidate schemas remain readable and cannot smuggle a new parent relationship into old context',async()=>{
 const f=parentFixture();try{const old=await oldParentIdentity(f),run=f.service.companyEntities.get(old.topic_id,old.run_id);assert.equal(run.packet.schema,'company-attachment-entities-1');assert.equal(run.stale,false);validateSavedCandidate(run);assert(!companyEntitiesPrompt(run.packet).includes('ownershipQuote'));assert(!companyEntitiesSchema(run.packet).properties.mentions.items.properties.eventConnection.anyOf);const changed=structuredClone(run.candidate.resolution);changed.mentions=[parentMention()];assert.throws(()=>validateCompanyEntities(changed,run.packet));assert.equal(automaticIdentityDecision(changed.mentions[0],run.packet.input.directory,{},run.packet).symbol,null);
 }finally{await f.close();}
});

test('one new protocol followup resumes old background output across restart without rewriting prior records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'parent-identity-')),path=join(dir,'fixture.sqlite');let f=parentFixture({path});try{const old=await oldParentIdentity(f),oldRun=f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(old.run_id).payload,topic=attachmentEvent(f),history=f.service.research.historyDetail(topic.id,topic.version),book=f.service.paper.snapshot();await f.close();f=parentFixture({path});await parentFinished(f);const newer=parentJobs(f)[1];assert.equal(newer.p.identityFollowup.trigger,'ownership-contract');assert.equal(newer.p.identityFollowup.connectionVersion,OWNERSHIP_CONNECTION_VERSION);assert.equal(parentJobs(f)[0].payload,old.payload);assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(old.run_id).payload,oldRun);assert.deepEqual(f.service.research.historyDetail(topic.id,topic.version),history);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.calls.identity,1);const calls={...f.calls};await f.drive(15);assert.equal(parentJobs(f).length,2);assert.deepEqual(f.calls,calls);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('fresh contract can still conclude context and does not keep reopening the same scope',async()=>{
 const f=parentFixture({identity:(p,m)=>{m.eventConnection={relation:'context',anchorQuote:p.input.eventFocus.quote,reason:'Synthetic source does not establish control semantically'};return output(p,'resolution',{mentions:[m],scopeNote:'No indirect relation',missingEvidence:['Control']});}});try{const old=await oldParentIdentity(f);await f.until(()=>parentJobs(f).length===2&&parentJobs(f)[1].status==='completed');assert.equal(attachmentEvent(f).companies.length,0);await f.drive(15);assert.equal(parentJobs(f).length,2);assert.equal(parentJobs(f)[0].payload,old.payload);assert.equal(parentJobs(f)[1].p.identityOutcome,'unresolved');
 }finally{await f.close();}
});

test('parent relationship does not bypass market ambiguity, subsidiary identity or other-event separation',async()=>{
 for(const mode of ['ambiguous','subsidiary','unrelated']){const f=parentFixture({identity:(p,m)=>{if(mode==='ambiguous'){m.resolution='ambiguous';m.symbols=['NVDA.US','AAPL.US'];}if(mode==='subsidiary'){m.entityType='subsidiary';m.resolution='unresolved';m.symbols=[];}if(mode==='unrelated')m.eventConnection={relation:'unrelated',anchorQuote:p.input.eventFocus.quote,reason:'Another event'};return output(p,'resolution',{mentions:[m],scopeNote:'Unresolved identity',missingEvidence:['Correct event/security']});}});try{f.add(1);await f.until(()=>parentJobs(f).some(j=>j.status==='completed'));assert.equal(attachmentEvent(f).companies.length,0);const job=parentJobs(f)[0],run=f.service.companyEntities.get(job.topic_id,job.run_id);assert.equal(automaticIdentityDecision(run.candidate.resolution.mentions[0],run.packet.input.directory,{},run.packet).symbol,null);if(mode==='ambiguous')assert.throws(()=>f.service.companyEntities.decide(job.topic_id,job.run_id,{action:'link',mentionIndex:0,version:0,topicVersion:attachmentEvent(f).version,symbol:'NVDA.US',note:'No internal bypass'},SYSTEM_RESEARCH_ACTOR),/不能自动关联/);
 }finally{await f.close();}}
});

test('quota, personal edits, restore lock, pause and cancellation preserve old research during ownership followup',async()=>{
 for(const gate of ['quota','edit','restore','pause','cancel']){const f=parentFixture();try{await oldParentIdentity(f);const t=attachmentEvent(f),calls=f.calls.identity;if(gate==='quota')f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});if(gate==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'Personal change'});if(gate==='restore')f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();if(gate==='pause')f.service.controlOperation('discovery','pause');if(gate==='cancel'){await f.until(()=>parentJobs(f).length===2);const j=parentJobs(f)[1];assert.equal(j.status,'queued');f.store.db.prepare("UPDATE research_pipeline_event_jobs SET status='cancelled' WHERE id=?").run(j.id);}
 if(gate==='restore')await assert.rejects(()=>f.step(),/恢复/);else if(gate==='pause'){assert.throws(()=>f.service.runOperation('discovery'),/暂停/);}else await f.drive(8);assert.equal(f.calls.identity,calls);assert.equal(attachmentEvent(f).companies.length,0);if(gate==='edit')assert.equal(attachmentEvent(f).nextEvidence,'Personal change');
 }finally{await f.close();}}
});

test('three failed new-contract attempts retain the old result and cannot buy a fresh retry budget',async()=>{
 let fail=false;const f=parentFixture({identity:(p,m)=>{if(fail)throw Error('Synthetic new-contract failure');return output(p,'resolution',{mentions:[m],scopeNote:'Synthetic',missingEvidence:[]});}});try{const old=await oldParentIdentity(f);fail=true;await f.until(()=>parentJobs(f).length===2);for(let i=0;i<5&&parentJobs(f)[1].status!=='completed';i++){await f.drive(8);f.advance(120001);}assert.equal(parentJobs(f)[1].status,'completed');assert.equal(parentJobs(f)[1].p.identityOutcome,'unavailable');assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(parentJobs(f)[1].id).n,3);const calls={...f.calls};await f.drive(15);assert.deepEqual(f.calls,calls);assert.equal(parentJobs(f)[0].payload,old.payload);assert.equal(attachmentEvent(f).companies.length,0);
 }finally{await f.close();}
});

test('same-paragraph parent evidence cannot borrow ownership from another paragraph',async()=>{
 const {f,p,raw}=await packetFixture();try{const q=structuredClone(p);delete q.input.identityAttachment;q.schema='company-event-context-2';q.input.material.body=parentBody;q.input.eventFocus={...q.input.eventFocus,actor:'NVIDIA',quote:'These are synthetic names and relations, not facts about any company.',quoteField:'body'};q.input.identityEventContext=eventIdentityContext(q.input.material,q.input.eventFocus);q.inputHash=digest(q.input);assert(q.input.identityEventContext);const r=structuredClone(raw);r.mentions[0].eventConnection.anchorQuote=q.input.eventFocus.quote;assert.deepEqual(validateCompanyEntities(r,q),r);
 q.input.material.body=q.input.material.body.replace(' NVIDIA owns','\n\nNVIDIA owns');q.input.identityEventContext=eventIdentityContext(q.input.material,q.input.eventFocus);q.inputHash=digest(q.input);assert(q.input.identityEventContext);assert.throws(()=>validateCompanyEntities(r,q));
 }finally{await f.close();}
});

test('cancelling an in-flight ownership recheck preserves the prior context and stops its scope',async()=>{
 let resolveRun;const f=parentFixture({identity:(p,m)=>p.schema==='company-attachment-entities-2'?new Promise(resolve=>{resolveRun=()=>resolve(output(p,'resolution',{mentions:[m],scopeNote:'Synthetic',missingEvidence:[]}));}):output(p,'resolution',{mentions:[m],scopeNote:'Legacy synthetic context',missingEvidence:[]})});
 try{await oldParentIdentity(f);await f.until(()=>parentJobs(f).length===2);await f.service.runOperation('discovery');const running=parentJobs(f)[1];assert.equal(running.status,'running');assert(resolveRun);f.service.companyEntities.cancel(running.topic_id,running.run_id);resolveRun();await f.service.companyEntities.wait(running.run_id);await f.drive(10);assert.equal(parentJobs(f)[1].status,'cancelled');assert.equal(f.service.companyEntities.get(running.topic_id,running.run_id).status,'cancelled');assert.equal(attachmentEvent(f).companies.length,0);assert.equal(parentJobs(f).length,2);
 }finally{resolveRun?.();await f.close();}
});

test('ownership followup insertion rolls back on failure and retries only the uncommitted queue entry',async()=>{
 const f=parentFixture();try{const old=await oldParentIdentity(f),topic=attachmentEvent(f);f.store.db.exec("CREATE TRIGGER block_parent_followup BEFORE INSERT ON research_pipeline_event_jobs WHEN json_extract(NEW.payload,'$.identityFollowup.trigger')='ownership-contract' BEGIN SELECT RAISE(ABORT,'Synthetic insertion failure'); END;");const result=await f.step();assert.match(result.error,/Synthetic insertion failure/);assert.equal(parentJobs(f).length,1);assert.deepEqual(attachmentEvent(f),topic);assert.equal(parentJobs(f)[0].payload,old.payload);f.store.db.exec('DROP TRIGGER block_parent_followup');await parentFinished(f);assert.equal(parentJobs(f).length,2);
 }finally{await f.close();}
});
