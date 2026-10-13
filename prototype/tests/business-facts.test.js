import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {factDossier,factFixture,factClaim} from './helpers/business-facts-fixture.mjs';
import {watchReady,watchRefreshes,event,synthesisRows} from './helpers/watch-review-fixture.mjs';
import {financialFixture} from './helpers/research-financials-fixture.mjs';
import {validateCodexDraft,codexDraftSchema,codexPrompt,digest} from '../server/codex-research.mjs';
import {useStoredOutputContract} from '../server/research-output-contract.mjs';
import {evaluateResearchCondition} from '../server/research-observations.mjs';
import {reviewSignalId} from '../server/holdings-review-signals.mjs';
import {BUSINESS_FACT_CONTRACT,BUSINESS_FACT_INTERVAL_MS as day,businessFactTargets} from '../shared/business-facts.mjs';
import {two,at} from './automatic-research-fixture.mjs';
const aOf=f=>f.service.research.get(event(f).id).dossier.companyAssessment.assessments[0];
const fact=a=>a.monitoring.nextCheck.conditions[0];

test('shared citation wire preserves business evidence and schema bounds without mutating source references',async()=>{
 const f=financialFixture();try{
  const expanded={...JSON.parse(factDossier(f.packet).rawOutput),materialityReviews:[],sourceRequests:[]},pool=[],ids=new Map();
  const visit=v=>Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='citations'?x.map(c=>{const key=JSON.stringify(c);if(!ids.has(key)){const id='q'+(ids.size+1);ids.set(key,id);pool.push({id,...c});}return ids.get(key);}):visit(x)])):v;
  const content=visit(expanded),wire={wireFormat:'research-citations/1',citationPool:pool,...content},before=JSON.stringify(wire);
  assert.deepEqual(validateCodexDraft(wire,f.packet),validateCodexDraft(expanded,f.packet));assert.equal(JSON.stringify(wire),before);
  const c=codexDraftSchema(f.packet).properties.companyAssessments.items.properties.monitoring.properties.nextCheck.properties.conditions.items.anyOf.find(x=>x.properties.type.enum.includes('business-fact'));
  assert.equal(c.properties.citations.maxItems,3);assert.equal(c.properties.citations.items.type,'string');
  const wrong=structuredClone(wire);wrong.companyAssessments[0].monitoring.nextCheck.conditions[0].citations=['missing'];assert.throws(()=>validateCodexDraft(wrong,f.packet));
 }finally{await f.close();}
});

test('business fact protocol retains exact legacy schema while requiring body citations, available material and an explicit three-state verdict',async()=>{
 const f=financialFixture();try{const raw=JSON.parse(factDossier(f.packet).rawOutput);assert.equal(validateCodexDraft(raw,f.packet).companyAssessments[0].monitoring.nextCheck.conditions[0].verdict,'unknown');
 const legacy=useStoredOutputContract(f.packet,{});assert.equal(legacy.businessFactContract,undefined);assert.throws(()=>validateCodexDraft(raw,legacy));const old=codexDraftSchema(legacy).properties.companyAssessments.items.properties.monitoring,next=codexDraftSchema(f.packet).properties.companyAssessments.items.properties.monitoring;assert.equal(old.properties.nextCheck.properties.conditions.items.anyOf.length,3);for(const group of Object.values(next.properties))assert.equal(group.properties.conditions.items.anyOf.length,4);assert.deepEqual(codexDraftSchema(f.packet).properties.companyAssessments.items.properties.monitoring,next);assert.deepEqual(codexDraftSchema(legacy).properties.companyAssessments.items.properties.monitoring,old);assert(codexPrompt(f.packet).includes('授权回购不等于实际回购'));assert(!codexPrompt(legacy).includes('businessFactContract='));
 for(const change of [c=>c.verdict='true',c=>c.claim='',c=>c.claim='x'.repeat(401),c=>c.extra='approve',c=>c.citations[0].field='title',c=>c.citations[0].quote='invented quotation',c=>c.citations[0].evidenceId='foreign',c=>{c.verdict='supported';c.citations=[];},c=>{c.verdict='contradicted';c.citations=[];}]){const x=structuredClone(raw);change(x.companyAssessments[0].monitoring.nextCheck.conditions[0]);assert.throws(()=>validateCodexDraft(x,f.packet));}
 const unknown=structuredClone(raw);unknown.companyAssessments[0].monitoring.nextCheck.conditions[0].citations=[];assert.equal(validateCodexDraft(unknown,f.packet).companyAssessments[0].monitoring.nextCheck.conditions[0].verdict,'unknown');
 const future=structuredClone(f.packet);future.input.evidence[0].material.availableAt='2099-01-01T00:00:00Z';future.inputHash=digest(future.input);assert.throws(()=>validateCodexDraft(raw,future));
 const duplicate=structuredClone(raw);duplicate.companyAssessments[0].monitoring.nextCheck.conditions.push({...fact(duplicate.companyAssessments[0]),verdict:'supported',reason:'another rendering'});assert.throws(()=>validateCodexDraft(duplicate,f.packet));
 }finally{await f.close();}
});

test('supported, contradicted and absent evidence map to three-valued monitoring and expire without becoming a trade or a fabricated fact',async()=>{
 const f=financialFixture();try{const a=factDossier(f.packet).companyAssessments[0],at=f.packet.generatedAt,s={ready:true,fresh:true,changed:false,preparedAt:at,baseline:f.topic,current:f.topic,businessFactContract:BUSINESS_FACT_CONTRACT};const run=t=>evaluateResearchCondition(s,a,'nextCheck',{at:t||at});
 for(const [v,state] of [['unknown','unknown'],['supported','true'],['contradicted','false']]){fact(a).verdict=v;const r=run();assert.equal(r.state,state);assert.equal(r.results[0].input.businessFact.semanticVerified,false);assert.equal(r.results[0].input.executable,false);}
 fact(a).verdict='supported';assert.equal(run(new Date(Date.parse(at)+day).toISOString()).state,'unknown');s.fresh=false;assert.equal(run().state,'unknown');s.fresh=true;s.current={...f.topic,status:'archived'};assert.equal(run().state,'unknown');
 }finally{await f.close();}
});

test('unknown business prerequisites enter original evidence followup even when the model omitted missingEvidence and no position exists',async()=>{
 const f=factFixture();try{const t=await watchReady(f);await f.drive(4);assert.equal(aOf(f).recommendation.action,'unknown');assert.equal(f.service.actualHoldings.holdingSymbols().length,0);const searches=f.queue.snapshot().evidence.items;assert(searches.some(s=>s.anchor.topicId===t.id&&s.anchor.missing.some(v=>v.includes(factClaim))));await f.service.runOperation('observations');const c=f.service.snapshot().observationInbox.researchChecks.find(c=>c.group==='nextCheck');assert(c.current);assert.equal(c.status,'unknown');assert.equal(f.service.snapshot().overview.decisions.length,0);
 const action=f.service.snapshot().observationInbox.researchActions[0];assert.equal(action.judgment.businessReview.policy,BUSINESS_FACT_CONTRACT);assert.equal(action.judgment.watchReview,undefined);
 }finally{await f.close();}
});

test('daily business review retains frozen prerequisites and the original queue, with no holding, watch recommendation or intermediate approval',async()=>{
 const f=factFixture();try{const t=await watchReady(f),old=f.service.research.historyDetail(t.id,t.version),account=f.service.paper.snapshot();f.advance(day-1);await f.drive(3);assert.equal(watchRefreshes(f).length,0);f.advance(1);await f.until(()=>watchRefreshes(f).some(j=>j.status==='completed'));const j=watchRefreshes(f)[0];assert.equal(j.p.packet.input.monitoringReview.businessFacts[0].claim,factClaim);assert.equal(j.p.packet.input.monitoringReview.triggers[0].policy,BUSINESS_FACT_CONTRACT);assert.equal(f.calls.dossier,2);assert.deepEqual(f.service.research.historyDetail(t.id,t.version),old);assert.deepEqual(f.service.paper.snapshot(),account);await f.drive(12);assert.equal(f.calls.dossier,2);f.advance(day);await f.until(()=>watchRefreshes(f).filter(j=>j.status==='completed').length===2);assert.equal(f.calls.dossier,3);
 }finally{await f.close();}
});

test('a refresh cannot remove, move or rename an original business prerequisite and stale old quotes cannot masquerade as a new check',async()=>{
 const f=factFixture();try{await watchReady(f);f.advance(day);await f.until(()=>watchRefreshes(f).some(j=>j.status==='completed'));const p=watchRefreshes(f)[0].p.packet,r=JSON.parse(factDossier(p).rawOutput);
 for(const change of [a=>a.monitoring.nextCheck.join='any',a=>a.monitoring.nextCheck.conditions[0].claim='Another easier claim',a=>a.monitoring.nextCheck={status:'unknown',reason:'omitted',join:'all',conditions:[]},a=>{a.monitoring.exitCondition=a.monitoring.nextCheck;a.monitoring.nextCheck={status:'unknown',reason:'moved',join:'all',conditions:[]};}]){const bad=structuredClone(r);change(bad.companyAssessments[0]);assert.throws(()=>validateCodexDraft(bad,p));}
 const topic=event(f);await f.service.runOperation('observations');f.advance(day);const before=f.store.db.prepare('SELECT total_changes() n').get().n,view=f.service.snapshot().observationInbox.researchChecks;assert(view.find(c=>c.group==='nextCheck').reason.includes('复核已到期'));assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(topic.dossier.companyAssessment.assessments[0].monitoring.nextCheck.conditions[0].verdict,'unknown');
 }finally{await f.close();}
});

test('fact evidence wording and changing verdict do not create fresh trigger identities or repeat successful conditions in a loop',()=>{
 const c={type:'business-fact',claim:factClaim,verdict:'supported',reason:'first',citations:[]},t={kind:'condition',symbol:'NVDA.US',group:'nextCheck',definition:{join:'all',conditions:[c]}};
 const id=reviewSignalId('owner',t);t.definition.conditions[0]={...c,verdict:'unknown',reason:'new explanation',citations:[{evidenceId:'x',field:'body',quote:'new evidence'}]};assert.equal(reviewSignalId('owner',t),id);t.definition.conditions[0].claim='Different prerequisite';assert.notEqual(reviewSignalId('owner',t),id);
});

test('fact review quota and restart use the same persisted job and never alter an account or reopen a cancelled generation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'business-facts-')),path=join(dir,'test.sqlite');let f=factFixture({path});try{await watchReady(f);f.advance(day);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.store.db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run('synthetic-budget','synthetic-budget','2026-10-09T00:00:00Z');await f.until(()=>watchRefreshes(f).length===1);const id=watchRefreshes(f)[0].id;await f.close();f=factFixture({path});f.advance(day);await f.drive(3);assert.equal(f.calls.dossier,0);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>watchRefreshes(f)[0].status==='completed');assert.equal(watchRefreshes(f)[0].id,id);f.advance(day);await f.until(()=>watchRefreshes(f).length===2);const queued=watchRefreshes(f)[1];f.store.db.prepare("UPDATE research_pipeline_event_jobs SET status='cancelled' WHERE id=?").run(queued.id);await f.drive(10);assert.equal(f.calls.dossier,1);assert.equal(watchRefreshes(f).length,2);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('composite business review owns member cadence and preserves every original condition and completed member version',async()=>{
 const f=factFixture({composite:true,watchMembers:true});try{const c=await two(f);await f.until(()=>synthesisRows(f).some(r=>r.status==='completed'));const before=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),calls=f.calls.dossier;f.advance(day);await f.until(()=>synthesisRows(f).some(r=>r.p.monitoringReview&&r.status==='completed'));assert.equal(f.synthesisCalls,2);assert.equal(f.calls.dossier,calls);assert.equal(watchRefreshes(f).length,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),before);const current=f.queue.synthesis.detail(c.id).selected;assert(current.current);assert.equal(current.run.candidate.companyAssessments[0].monitoring.nextCheck.conditions[0].claim,factClaim);
 }finally{await f.close();}
});

test('body acquisition, event comparison and synthesis carry an unknown business question to supporting new evidence without user intervention',async()=>{
 const seen=[];const f=factFixture({composite:true,watchMembers:true,runner:p=>{seen.push(p);const hasNew=p.input.evidence.some(e=>e.material?.body.includes('本期已实际执行'));return factDossier(p,{verdict:hasNew?'supported':'unknown'});},sourceReader:async url=>({url,title:'Synthetic NVIDIA followup',sourceName:'合成',body:'NVIDIA 拟回购普通股，授权规模不等于实际执行金额。'+(url.endsWith('-2')?'合成报告：本期已实际执行普通股回购。':'授权后实际执行情况仍未提供。')+'全部为合成流程证据。'.repeat(50),scope:'extracted-text'})});
 try{const t=await watchReady(f);await f.drive(4);f.store.ingest([{...f.news(2),title:'NVIDIA 普通股回购事项进展'}],at);f.service.research.process();await f.drive(55);assert(seen.some(p=>p.input.eventSynthesis&&p.input.evidence.some(e=>e.material?.body.includes('本期已实际执行'))));const current=synthesisRows(f).find(r=>r.status==='completed');assert(current);const detail=f.queue.synthesis.detail(current.cluster_id).selected;assert.equal(detail.run.candidate.companyAssessments[0].monitoring.nextCheck.conditions[0].verdict,'supported');assert(detail.run.candidate.companyAssessments[0].monitoring.nextCheck.conditions[0].citations[0].quote.includes('本期已实际执行'));assert.equal(f.service.research.historyDetail(t.id,t.version).topic.dossier.companyAssessment.assessments[0].monitoring.nextCheck.conditions[0].verdict,'unknown');assert.equal(f.service.snapshot().overview.decisions.length,0);assert(f.queue.snapshot().evidence.items.some(s=>s.candidates.some(c=>c.newsId===f.news(2).id)));
 }finally{await f.close();}
});

test('source failure does not convert missing business evidence to false and other incoming evidence continues',async()=>{
 let reads=0;const f=factFixture({sourceReader:async url=>{if(url.endsWith('-2')){reads++;throw Error('synthetic business source unavailable');}return {url,title:'Synthetic NVIDIA',sourceName:'合成',body:'NVIDIA 拟回购普通股，授权规模不等于实际执行金额。'+'业务证据合成测试。'.repeat(60),scope:'extracted-text'};}});
 try{await watchReady(f);f.store.ingest([{...f.news(2),title:'NVIDIA 普通股回购事项进展'}],at);f.service.research.process();await f.drive(8);f.advance(60001);await f.drive(8);f.advance(120001);await f.drive(8);f.advance(240001);await f.drive(6);assert.equal(reads,3);assert.equal(fact(aOf(f)).verdict,'unknown');const n=f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE news_id=?').get(f.news(2).id);assert.equal(n.status,'observing');f.add(3);await f.drive(25);assert(f.store.db.prepare("SELECT 1 FROM research_pipeline_items WHERE news_id=? AND status='completed'").get(f.news(3).id));assert.equal(reads,3);
 }finally{await f.close();}
});

test('invalid refreshed business prerequisites use three attempts, then retain observation instead of resetting every day',async()=>{
 const f=factFixture({runner:p=>{const r=factDossier(p);if(p.input.monitoringReview){r.companyAssessments[0].monitoring.nextCheck.conditions[0].claim='silently omitted prerequisite';r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);}return r;}});
 try{await watchReady(f);f.advance(day);await f.until(()=>watchRefreshes(f)[0]?.p.retryAt);f.advance(60001);await f.until(()=>f.calls.dossier===3);await f.drive(3);f.advance(120001);await f.until(()=>watchRefreshes(f)[0]?.status==='observing');assert.equal(f.calls.dossier,4);f.advance(day*2);await f.drive(8);assert.equal(f.calls.dossier,4);assert.equal(fact(aOf(f)).claim,factClaim);
 }finally{await f.close();}
});

test('paused observations, restore lock, source revisions and user changes cannot turn business monitoring into a fresh model call',async()=>{
 for(const mode of ['pause','restore','source','edit']){const f=factFixture();try{const t=await watchReady(f);f.advance(day);if(mode==='pause')f.service.controlOperation('observations','pause');if(mode==='restore')f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();if(mode==='source')f.revise(1);if(mode==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'User retained their own condition'});if(mode==='restore')await assert.rejects(()=>f.step(),/恢复/);else if(mode==='source')await f.step();else await f.drive(8);assert.equal(watchRefreshes(f).length,0,mode);assert.equal(f.service.research.historyDetail(t.id,t.version).topic.dossier.companyAssessment.assessments[0].monitoring.nextCheck.conditions[0].claim,factClaim);
 }finally{await f.close();}}
});

test('manual business records expose their cited judgment but never promise an automatic review without enrollment',async()=>{
 const f=financialFixture({runner:factDossier});try{await f.save();await f.service.runOperation('observations');const s=f.service.snapshot();assert.equal(s.observationInbox.researchActions[0].judgment.businessReview,undefined);assert.equal(s.observationInbox.researchChecks.find(c=>c.group==='nextCheck').status,'unknown');assert.equal(s.overview.decisions.length,0);
 }finally{await f.close();}
});
