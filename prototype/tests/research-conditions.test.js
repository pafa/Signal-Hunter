import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionFixture,conditionalDossier} from './helpers/research-conditions-fixture.mjs';
import {codexDraftSchema,validateCodexDraft,digest,codexPrompt} from '../server/codex-research.mjs';
import {validateCandidate} from '../server/model-research-runs.mjs';
import {unknownCompanyAssessments} from './helpers/company-assessment-fixture.mjs';
import {COMPANY_ASSESSMENT_SCHEMA} from '../server/company-assessment.mjs';
import {synthesisPacket} from '../server/event-synthesis.mjs';
import {fixture as automatic,two,output,extraction} from './automatic-research-fixture.mjs';

const parsed=p=>JSON.parse(conditionalDossier(p).rawOutput);
test('structured conditions bind to the exact security and analysis evidence, while unknown is explicit and does not create a task',async()=>{
 const f=conditionFixture();try{
  assert.equal(f.packet.input.companyAssessment.version,'company-assessment/4');
  const r=validateCodexDraft(parsed(f.packet),f.packet),groups=r.companyAssessments[0].monitoring;
  assert.deepEqual(groups.entryCondition.conditions,[{type:'price',interval:'1m',operator:'lte',value:75}]);
  const unknown=parsed(f.packet);unknown.companyAssessments=unknownCompanyAssessments(f.packet);assert.equal(validateCodexDraft(unknown,f.packet).companyAssessments[0].monitoring.entryCondition.status,'unknown');
  assert.equal(f.service.observations.rules.list().length,0);assert.equal(f.service.marketSimulation.snapshot().configured,false);assert.equal(f.service.paper.snapshot().orders.length,0);
  assert(codexPrompt(f.packet).includes('整组写unknown'));assert(codexPrompt(f.packet).includes('不能以这些辅助条件替代业务兑现检查'));
 }finally{await f.close();}
});
test('missing or forged definitions cannot silently degrade into partial monitoring, inferred approval, or another security',async()=>{
 const f=conditionFixture();try{
  const changes=[a=>delete a.monitoring,a=>delete a.monitoring.entryCondition,a=>a.monitoring.approved=true,a=>a.monitoring.entryCondition.status='matched',a=>a.monitoring.entryCondition.conditions=[],a=>a.monitoring.entryCondition.status='unknown',a=>a.monitoring.entryCondition.reason='',a=>a.monitoring.entryCondition.reason='x'.repeat(601),a=>a.monitoring.entryCondition.reason='material:foreign',a=>a.analysis.entryCondition.basis='unknown',a=>a.analysis.entryCondition.citations=[],a=>a.analysis.entryCondition.citations[0].quote='not in any source',a=>a.monitoring.entryCondition.join='or',a=>a.monitoring.entryCondition.conditions[0].symbol='01211.HK',a=>a.monitoring.entryCondition.conditions[0].currency='HKD',a=>a.monitoring.entryCondition.conditions[0].qty=100,a=>a.monitoring.entryCondition.conditions[0].type='buy',a=>a.monitoring.entryCondition.conditions[0].interval='tick',a=>a.monitoring.entryCondition.conditions[0].value='75',a=>a.monitoring.entryCondition.conditions[0].value=0,a=>a.monitoring.entryCondition.conditions[0].value=1e13,a=>a.monitoring.entryCondition.conditions[0].value=NaN,a=>a.monitoring.entryCondition.conditions=Array(5).fill({type:'counterevidence'}),a=>a.monitoring.exitCondition.conditions[0].at='2026-11-01',a=>a.monitoring.exitCondition.conditions[0].at='2026-02-30T14:00:00Z',a=>a.monitoring.exitCondition.conditions[0].at='next quarter'];
  for(const mutate of changes){const r=parsed(f.packet);mutate(r.companyAssessments[0]);assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');}
  const unknown=parsed(f.packet);unknown.companyAssessments=unknownCompanyAssessments(f.packet);unknown.companyAssessments[0].monitoring.nextCheck.join='any';assert.throws(()=>validateCodexDraft(unknown,f.packet),e=>e.code==='output');
 }finally{await f.close();}
});
test('duplicate conditions are rejected across property ordering and equivalent timezone representations',async()=>{
 const f=conditionFixture();try{
  const r=parsed(f.packet);r.companyAssessments[0].monitoring.entryCondition.conditions.push({value:75,operator:'lte',interval:'1m',type:'price'});assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');
  const t=parsed(f.packet);t.companyAssessments[0].monitoring.exitCondition.conditions.push({at:'2026-11-01T22:00:00+08:00',type:'at'});assert.throws(()=>validateCodexDraft(t,f.packet),e=>e.code==='output');
 }finally{await f.close();}
});
test('historical v1 packets validate without new fields and cannot acquire conditions by schema downgrade',async()=>{
 const f=conditionFixture();try{
  const p=structuredClone(f.packet);p.input.companyAssessment.version='company-assessment/1';p.inputHash=digest(p.input);const r=parsed(p);assert.equal(r.companyAssessments[0].monitoring,undefined);
  assert.equal(validateCodexDraft(r,p).companyAssessments[0].monitoring,undefined);const oldSchema=codexDraftSchema(p);assert(!oldSchema.properties.companyAssessments.items.required.includes('monitoring'));assert(!oldSchema.properties.companyAssessments.items.properties.monitoring);
  const newSchema=codexDraftSchema(f.packet);assert(newSchema.properties.companyAssessments.items.required.includes('monitoring'));assert(COMPANY_ASSESSMENT_SCHEMA.items.required.includes('monitoring'));
  r.companyAssessments[0].monitoring=parsed(f.packet).companyAssessments[0].monitoring;assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
  p.input.companyAssessment.version='company-assessment/999';p.inputHash=digest(p.input);assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
 }finally{await f.close();}
});
test('raw model output must agree with saved conditions; adoption preserves ledgers and later manual edits do not refresh the old binding',async()=>{
 const f=conditionFixture();try{
  const r=conditionalDossier(f.packet);validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id});r.companyAssessments[0].monitoring.entryCondition.conditions[0].value=70;assert.throws(()=>validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id}),e=>e.code==='output');
  const book=f.service.paper.snapshot(),t=await f.save(),saved=structuredClone(t.dossier.companyAssessment);assert.equal(saved.assessments[0].monitoring.entryCondition.conditions[0].value,75);assert.equal(saved.savedInResearchVersion,t.version);
  const next=f.service.research.update(t.id,{version:t.version,dossier:{sections:t.dossier.sections,reviewStatus:'draft',revisionReason:'编辑长文不得刷新条件基线'}});assert.deepEqual(next.dossier.companyAssessment,saved);assert.notEqual(saved.savedInResearchVersion,next.version);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.observations.rules.list().length,0);
 }finally{await f.close();}
});
test('condition and research history are atomic when the research write fails',async()=>{
 const f=conditionFixture();try{
  const before=f.service.research.get(f.topic.id),candidate=conditionalDossier(f.packet),history=f.service.research.history(f.topic.id);
  f.store.db.exec("CREATE TEMP TRIGGER fail_condition_history BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>f.service.research.adoptModelDraft(f.topic.id,{version:before.version,runId:'synthetic'},candidate));
  assert.deepEqual(f.service.research.get(f.topic.id),before);assert.deepEqual(f.service.research.history(f.topic.id),history);assert.equal(f.service.observations.rules.list().length,0);
 }finally{await f.close();}
});
test('synthesis retains the original condition definition and remaps its analysis evidence to the exact composite inputs',async()=>{
 const f=conditionFixture();try{
  const t=await f.save(),p=synthesisPacket({id:'synthetic',version:1,title:'合成',snapshotHash:'hash'},[{topic:t,scope:{eventFocus:{quote:'Synthetic'}},packet:f.service.research.packet(t.id)}],{version:1,generatedAt:'2026-10-08T14:00:00Z'});
  const old=p.input.eventSynthesis.members[0].priorJudgment.dossier.companyAssessment.assessments[0];assert.deepEqual(old.monitoring,t.dossier.companyAssessment.assessments[0].monitoring);assert(p.input.evidence.some(e=>e.id===old.analysis.entryCondition.citations[0].evidenceId));
  const fresh=validateCodexDraft(parsed(p),p);assert.equal(fresh.companyAssessments[0].monitoring.exitCondition.conditions[0].at,'2026-11-01T14:00:00Z');assert.equal(p.input.topicId,'event-cluster:synthetic');
 }finally{await f.close();}
});
test('automatic single-event and composite research both save structured conditions without an extra model call or manual acceptance',async()=>{
 const q='NVIDIA proposes an order subject to approval.';
 const f=automatic({sourceReader:async url=>({url,title:'Synthetic NVIDIA',sourceName:'合成',body:q+'合成规则和条件范围，仅为流程测试。'.repeat(45),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);Object.assign(r.decomposition.events[0],{title:'NVIDIA 合成条件',actor:'NVIDIA',quote:q});r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:q,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成匹配'}],scopeNote:'合成',missingEvidence:['核实']}),researchRunner:conditionalDossier,synthesisRunner:conditionalDossier});
 try{const c=await two(f),d=f.queue.synthesis.detail(c.id);assert.equal(d.selected.current,true);assert.equal(d.selected.run.candidate.companyAssessments[0].monitoring.entryCondition.status,'defined');for(const m of c.members){const t=f.service.research.get(m.id);assert.equal(t.dossier.actor.kind,'system');assert.equal(t.dossier.companyAssessment.assessments[0].monitoring.nextCheck.conditions[0].type,'research-change');}assert.equal(f.calls.dossier,2);assert.equal(f.synthesisCalls,1);assert.equal(f.service.paper.snapshot().orders.length,0);
 }finally{await f.close();}
});
