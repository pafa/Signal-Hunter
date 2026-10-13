import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachmentIdentityFixture as make,attachmentJobs,attachmentEvent,finishAttachments,attachmentUrl,parentQuote} from './helpers/attachment-identity-fixture.mjs';
import {output} from './automatic-research-fixture.mjs';
import {companyEntitiesPacket,validateCompanyEntities,companyEntitiesSchema,companyEntitiesPrompt,COMPANY_ENTITIES_SCHEMA} from '../server/company-entities.mjs';
import {currentDocumentResearch} from '../server/research-document-context.mjs';
import {documentResearchOrigin} from '../server/system-document-revisions.mjs';
import {automaticIdentity} from '../server/pipeline-event-automation.mjs';
import {DIRECTORY_SOURCES} from '../server/security-directory.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';

test('new companies in two archived attachments automatically receive same-event research, retaining frozen original results',async()=>{
 const f=make();try{const book=f.service.paper.snapshot();f.add(1);await finishAttachments(f);const t=attachmentEvent(f),jobs=attachmentJobs(f),first=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' ORDER BY rowid LIMIT 1").get(t.id),p=JSON.parse(first.payload);
  assert.deepEqual(t.companies.map(c=>c.symbol).sort(),['AAPL.US','NVDA.US']);assert.equal(f.identityPackets.length,3);assert.equal(jobs.length,2);assert(jobs.every(j=>j.p.identityFollowup.trigger==='attachment-body'));assert(f.packets.some(p=>p.input.companyAssessment.targets.length===2));assert(t.companies.every(c=>c.entityResolution.attachmentContext&&c.entityResolution.mention.eventConnection.relation==='direct'));assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(t.id)),true);
  const old=documentResearchOrigin(f.store.db,f.service.research.get(t.id),p.adoptedVersion,first.run_id);assert.equal(old.companies.length,0);assert.equal(old.documentContext,undefined);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
  const calls={...f.calls},hash=f.service.research.packet(t.id).inputHash;await f.drive(12);assert.deepEqual(f.calls,calls);assert.equal(f.service.research.packet(t.id).inputHash,hash);assert.equal(f.requests.length,3);
 }finally{await f.close();}
});

test('attachment scope requires parent evidence and strict connection fields while original identity contracts stay unchanged',async()=>{
 const f=make({count:1});try{f.add(1);await finishAttachments(f,1);const p=f.identityPackets.find(p=>p.input.identityAttachment),run=JSON.parse(f.store.db.prepare("SELECT payload FROM company_entity_runs WHERE json_extract(payload,'$.packet.schema')='company-attachment-entities-2'").get().payload),raw=run.candidate.resolution;
  assert.equal(p.schema,'company-attachment-entities-2');assert.equal(p.input.identityAttachment.originMaterial.quote,parentQuote);assert(companyEntitiesPrompt(p).includes('共同提到一个行业'));assert.deepEqual(validateCompanyEntities(raw,p),raw);assert(companyEntitiesSchema(p).properties.mentions.items.required.includes('eventConnection'));
  for(const mutate of [m=>delete m.eventConnection,m=>m.eventConnection.anchorQuote='',m=>m.eventConnection.anchorQuote='not in originating event',m=>m.eventConnection.relation='beneficiary',m=>m.quote=parentQuote]){const bad=structuredClone(raw);mutate(bad.mentions[0]);assert.throws(()=>validateCompanyEntities(bad,p));}
  const original=f.identityPackets.find(p=>!p.input.identityAttachment);assert.equal(original.schema,'company-entities-3');assert.deepEqual(companyEntitiesSchema(original),COMPANY_ENTITIES_SCHEMA);assert(!companyEntitiesPrompt(original).includes('本次是原事项明确附件'));assert.throws(()=>companyEntitiesPacket(f.store,f.service.research,attachmentEvent(f).id,{version:attachmentEvent(f).version,materialId:'unrelated',revision:1}));
 }finally{await f.close();}
});

test('background, unrelated, uncertain, subsidiary and multiple-market mentions cannot automatically become event securities',async()=>{
 for(const type of ['context','unrelated','unclear','subsidiary','ambiguous']){const f=make({count:1,identity:(p,m)=>{if(['context','unrelated','unclear'].includes(type))m.eventConnection.relation=type;else if(type==='subsidiary'){m.entityType='subsidiary';m.resolution='unresolved';m.symbols=[];}else{m.resolution='ambiguous';m.symbols=['NVDA.US','AAPL.US'];}return output(p,'resolution',{mentions:[m],scopeNote:'合成歧义，不增加关联',missingEvidence:['关系未知']});}});try{f.add(1);await finishAttachments(f,1);assert.equal(attachmentEvent(f).companies.length,0,type);assert.equal(attachmentJobs(f)[0].p.unresolved.length,1);assert.equal(f.packets.filter(p=>p.input.companyAssessment?.targets.length).length,0);assert.equal(automaticIdentity(f.service.companyEntities.get(attachmentEvent(f).id,attachmentJobs(f)[0].run_id).candidate.resolution.mentions[0],f.identityPackets.at(-1).input.directory),null);}finally{await f.close();}}
});

test('a shared attachment does not project one event company onto another event from the same notice',async()=>{
 const f=make({count:1,secondEvent:true});try{f.add(1);await finishAttachments(f,2);assert.deepEqual(attachmentEvent(f).companies.map(c=>c.symbol),['NVDA.US']);assert.equal(attachmentEvent(f,'国家项目乙').companies.length,0);assert.equal(attachmentJobs(f).length,2);assert.equal(f.requests.length,2);}finally{await f.close();}
});

test('internal system capability cannot link background attachment mentions even outside the queue',async()=>{
 const f=make({count:1,identity:(p,m)=>{m.eventConnection.relation='context';return output(p,'resolution',{mentions:[m],scopeNote:'背景公司不接入原事项',missingEvidence:['直接关联依据']});}});
 try{f.add(1);await finishAttachments(f,1);const t=attachmentEvent(f),job=attachmentJobs(f)[0],before=f.service.research.get(t.id);assert.equal(job.p.unresolved[0].eventConnection.relation,'context');assert.match(job.p.unresolved[0].reason,/未与原事项建立直接关系/);assert.throws(()=>f.service.companyEntities.decide(t.id,job.run_id,{action:'link',mentionIndex:0,version:0,topicVersion:t.version,symbol:'NVDA.US',note:'不应建立自动关联'},SYSTEM_RESEARCH_ACTOR),/不能自动关联/);assert.deepEqual(f.service.research.get(t.id),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM company_entity_decisions WHERE run_id=?').get(job.run_id).n,0);}finally{await f.close();}
});

test('attachment cancellation before inference stops that scope, updates the document gap and makes no identity call',async()=>{
 const f=make({count:1});try{f.add(1);await f.until(()=>attachmentJobs(f).some(j=>j.status==='queued'));const job=attachmentJobs(f)[0],n=f.store.news().find(n=>n.url===attachmentUrl(1)),calls=f.calls.identity;f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE news_id=?").run(n.id);await f.until(()=>attachmentJobs(f)[0].status==='invalidated');await f.until(()=>{const t=attachmentEvent(f);return t.documentContext.entries.every(e=>e.status==='unread')&&t.dossier.basedOnResearchVersion===t.version;});assert.equal(f.calls.identity,calls);assert.equal(attachmentEvent(f).companies.length,0);assert.equal(attachmentJobs(f)[0].id,job.id);}finally{await f.close();}
});

test('restart and three failed attachment calls retain original research and do not require an intermediate decision',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'attachment-identities-')),path=join(dir,'test.sqlite');let f=make({path,count:1});
 try{f.add(1);await f.until(()=>attachmentJobs(f).some(j=>j.status==='queued'));const before=f.service.research.get(attachmentEvent(f).id),job=attachmentJobs(f)[0];await f.close();f=make({path,count:1,identity:()=>{throw Error('Synthetic failure');}});for(let i=0;i<4&&attachmentJobs(f)[0].status!=='completed';i++){await f.drive(8);f.advance(120001);}assert.equal(attachmentJobs(f)[0].status,'completed');assert.equal(attachmentJobs(f)[0].p.identityOutcome,'unavailable');assert.equal(f.calls.identity,3);assert.deepEqual(f.service.research.get(before.id),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(job.id).n,3);await f.drive(8);assert.equal(f.calls.identity,3);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('each new attachment security receives frozen prices once, preserving earlier security inputs',async()=>{
 const urls=[],f=make({prices:true,fetcher:async url=>{urls.push(url);if(url.includes('eastmoney'))return Response.json({data:null});const u=new URL(url),interval=u.searchParams.get('interval'),symbol=u.pathname.split('/').at(-1);return Response.json({chart:{result:[{meta:{symbol,currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[Date.parse('2026-10-07T19:59Z')/1000],indicators:{quote:[{close:[100],volume:[1000]}]}}]}});}});
 try{f.add(1);await finishAttachments(f);const t=attachmentEvent(f);assert.equal(t.researchPrices.length,4);assert(t.researchPrices.every(x=>x.status==='saved'));assert.equal(urls.filter(u=>u.includes('yahoo')).length,4);const packets=f.packets.filter(p=>p.input.companyAssessment.targets.length),first=packets[0].input.researchPrices;assert.equal(first.length,2);for(const p of first)assert(t.researchPrices.some(r=>r.materialId===p.materialId));assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(t.id)),true);}finally{await f.close();}
});

test('unknown attachment identity can use later directory evidence without rewriting the original body or call',async()=>{
 let online=false;const f=make({count:1,directoryMarkets:['US'],fetcher:async url=>{if(!online)throw Error('Synthetic outage');const s=DIRECTORY_SOURCES.find(s=>s.url===url);assert(s);return new Response([s.header,...(s.id==='nasdaq'?['NVDA|NVIDIA - Common Stock|Q|N|N|100|N|N']:['AXP|American Express Company Common Stock|N|AXP|N|100|N|AXP']),'File Creation Time: 1007202618:01'+'|'.repeat(s.id==='other'?6:7)].join('\n'));},identity:(p,m)=>{if(!p.input.directoryCoverage.coveredMarkets.includes('US')){m.resolution='unresolved';m.symbols=[];}return output(p,'resolution',{mentions:[m],scopeNote:'Only frozen scope',missingEvidence:['Tradeability']});}});
 try{f.add(1);await finishAttachments(f,1);const old=attachmentJobs(f)[0],run=JSON.stringify(f.service.companyEntities.get(attachmentEvent(f).id,old.run_id).candidate);assert.equal(attachmentEvent(f).companies.length,0);online=true;f.advance(60001);await f.until(()=>attachmentEvent(f).companies.length===1&&attachmentEvent(f).dossier.basedOnResearchVersion===attachmentEvent(f).version);assert.equal(attachmentJobs(f).length,2);assert.equal(attachmentJobs(f)[0].payload,old.payload);assert.equal(JSON.stringify(f.service.companyEntities.get(attachmentEvent(f).id,old.run_id).candidate),run);assert.equal(f.requests.length,2);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(attachmentEvent(f).id)),true);}finally{await f.close();}
});

test('manual edits, exhausted shared budget and restore review do not let new attachment scope mutate research',async()=>{
 for(const gate of ['edit','quota','restore']){const f=make({count:1});try{f.add(1);await f.until(()=>attachmentJobs(f).some(r=>r.status==='queued'));const t=attachmentEvent(f),calls=f.calls.identity;if(gate==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'Personal note'});if(gate==='quota')f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});if(gate==='restore')f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();if(gate==='restore')await assert.rejects(()=>f.step(),/恢复/);else await f.drive(8);assert.equal(f.calls.identity,calls);assert.equal(attachmentEvent(f).companies.length,0);if(gate==='edit')assert.equal(attachmentEvent(f).nextEvidence,'Personal note');}finally{await f.close();}}
});
