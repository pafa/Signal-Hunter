import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFixture,financialDossier,financialBody} from './helpers/research-financials-fixture.mjs';
import {codexDraftSchema,validateCodexDraft,codexPrompt,digest} from '../server/codex-research.mjs';
import {validateCandidate} from '../server/model-research-runs.mjs';
import {financialMetricResult,valuationResult,financialLiteralMatches} from '../shared/research-financials.mjs';
import {validateResearchFinancials} from '../server/research-financials.mjs';
import {synthesisPacket} from '../server/event-synthesis.mjs';
import {fixture as automatic,two,output,extraction} from './automatic-research-fixture.mjs';
const parsed=p=>JSON.parse(financialDossier(p).rawOutput);

test('financial inputs reuse materiality arithmetic, retain source versus assumption, and calculate three scenario prices',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0],r=valuationResult(a.financials),m=financialMetricResult(a.financials.metrics[0],f.packet.input.evidence);
  assert.deepEqual([r.low,r.base,r.high],[24,62.5,90]);assert.equal(r.semanticVerified,false);assert.equal(r.executable,false);
  assert.equal(m.delta,20);assert.equal(m.relativeChange,20);assert.equal(m.exposure,20);assert.equal(m.expectationDelta,10);assert.equal(m.expectationBasis,'pre-event-source-available');assert.equal(m.prospectiveValidated,false);
  assert.equal(a.financials.valuation.scenarios[0].perShare.kind,'assumption');assert.equal(a.financials.valuation.scenarios[1].perShare.kind,'source');assert(codexPrompt(f.packet).includes('不把收入或订单额当每股收益'));
 }finally{await f.close();}
});
test('a currency or magnitude mismatch, missing literal, ambiguous dollar and forged citation cannot pass as sourced financial input',async()=>{
 const f=financialFixture();try{for(const mutate of [v=>v.metrics[0].unit='CNY million',v=>v.metrics[0].unit='USD',v=>v.metrics[0].baseline.value=101,v=>v.metrics[0].baseline.citations=[],v=>v.metrics[0].baseline.citations[0].quote='not provided',v=>v.metrics[0].baseline.citations[0].evidenceId='material:other',v=>v.valuation.scenarios[1].perShare.value=2.51,v=>v.metrics[0].baseline.kind='confirmed']){const r=parsed(f.packet);mutate(r.companyAssessments[0].financials);assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');}
  assert.equal(financialLiteralMatches({value:2.5,citations:[{quote:'USD 2.50 per share'}]},'USD'),true);
  for(const quote of ['$2.50','USD 2.50–3.50','(USD 2.50)','USD 2.50 HKD','USD 2.50e4'])assert.equal(financialLiteralMatches({value:2.5,citations:[{quote}]},'USD'),false,quote);
 }finally{await f.close();}
});
test('financial schema refuses invented execution fields, incomplete comparable rows and unknown valuation with numeric leftovers',async()=>{
 const f=financialFixture();try{for(const mutate of [a=>delete a.financials,a=>a.financials.approved=true,a=>a.financials.metrics[0].comparable=false,a=>delete a.financials.metrics[0].baseline,a=>a.financials.metrics[0].period='',a=>a.financials.metrics.push(structuredClone(a.financials.metrics[0])),a=>a.financials.valuation.price=100,a=>a.financials.valuation.status='unknown',a=>a.financials.valuation.scenarios[0].multiple.kind='verified',a=>a.financials.metrics[0].baseline.reason='material:other',a=>a.financials.metrics[0].observed.value=Infinity]){const r=parsed(f.packet);mutate(r.companyAssessments[0]);assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');}
  const r=parsed(f.packet),v=r.companyAssessments[0].financials;v.metrics=[];v.valuation={status:'unknown',reason:'缺同口径每股财务依据'};assert.equal(valuationResult(validateCodexDraft(r,f.packet).companyAssessments[0].financials),null);
 }finally{await f.close();}
});
test('valuation enforces the security currency, positive applicable inputs, scenario ordering, horizons and available evidence',async()=>{
 const f=financialFixture();try{for(const mutate of [v=>v.currency='HKD',v=>v.subject='',v=>v.shareBasis='',v=>v.metricPeriod='',v=>v.method='DCF',v=>v.basisAt='2026-10-09T14:00:00Z',v=>v.basisAt='2026-10-07T14:00:00Z',v=>v.basisAt='2026-02-30T14:00:00Z',v=>v.horizonAt='2026-10-08T14:00:00Z',v=>v.horizonAt='2027-01-01',v=>v.scenarios[0].perShare.value=0,v=>v.scenarios[0].perShare.value=-2,v=>v.scenarios[0].perShare.value=1e-12,v=>v.scenarios[0].perShare.value=1e12,v=>v.scenarios[0].multiple.value=1001,v=>v.scenarios[0].multiple.citations=[],v=>v.scenarios[0].multiple.value=200,v=>v.scenarios.reverse(),v=>v.scenarios.pop()]){const r=parsed(f.packet);mutate(r.companyAssessments[0].financials.valuation);assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');}
  const p=structuredClone(f.packet);delete p.input.evidence[0].material.availableAt;p.inputHash=digest(p.input);assert.throws(()=>validateCodexDraft(parsed(p),p),e=>e.code==='output');
 }finally{await f.close();}
});
test('old v1/v2 packets keep their original schema and output with no invented valuation or monitoring upgrade',async()=>{
 const f=financialFixture();try{for(const version of ['company-assessment/1','company-assessment/2']){const p=structuredClone(f.packet);p.input.companyAssessment.version=version;p.inputHash=digest(p.input);const r=parsed(p),out=validateCodexDraft(r,p),schema=codexDraftSchema(p).properties.companyAssessments.items;
   assert.equal(out.companyAssessments[0].financials,undefined);assert.equal(schema.properties.financials,undefined);assert.equal(!!out.companyAssessments[0].monitoring,version.endsWith('/2'));
   r.companyAssessments[0].financials=parsed(f.packet).companyAssessments[0].financials;assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
  }
  const schema=codexDraftSchema(f.packet).properties.companyAssessments.items.properties.financials;assert.deepEqual(codexDraftSchema(f.packet).properties.citationPool.items.properties.evidenceId.enum,f.packet.input.evidence.map(e=>e.id));
 }finally{await f.close();}
});
test('saving and editing financial research preserve the original run, manual metrics, historical arithmetic and all ledgers',async()=>{
 const f=financialFixture();try{const paper=f.service.paper.snapshot(),companies=structuredClone(f.topic.companies),r=financialDossier(f.packet);validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id});r.companyAssessments[0].financials.valuation.scenarios[0].multiple.value=19;assert.throws(()=>validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id}),e=>e.code==='output');
  const t=await f.save(),saved=structuredClone(t.dossier.companyAssessment);assert.deepEqual(t.companies,companies);assert.equal(valuationResult(saved.assessments[0].financials).base,62.5);
  const revised=f.service.research.update(t.id,{version:t.version,dossier:{sections:t.dossier.sections,reviewStatus:'draft',revisionReason:'修订不刷新财务基线'}});assert.deepEqual(revised.dossier.companyAssessment,saved);assert.deepEqual(f.service.research.historyDetail(t.id,t.version).topic.dossier.companyAssessment,saved);assert.deepEqual(f.service.paper.snapshot(),paper);
  assert.equal(f.service.marketSimulation.snapshot().configured,false);
 }finally{await f.close();}
});
test('financial result and research history cannot be half-saved on a transaction failure',async()=>{
 const f=financialFixture();try{const before=f.service.research.get(f.topic.id),history=f.service.research.history(f.topic.id);f.store.db.exec("CREATE TEMP TRIGGER fail_financial_history BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>f.service.research.adoptModelDraft(f.topic.id,{version:before.version,runId:'synthetic'},financialDossier(f.packet)));assert.deepEqual(f.service.research.get(f.topic.id),before);assert.deepEqual(f.service.research.history(f.topic.id),history);
 }finally{await f.close();}
});
test('composite packets remap each numeric and valuation citation while retaining material identity and previous results',async()=>{
 const f=financialFixture();try{const t=await f.save(),before=structuredClone(t.dossier.companyAssessment),p=synthesisPacket({id:'synthetic',version:1,title:'合成财务',snapshotHash:'hash'},[{topic:t,scope:{eventFocus:{quote:'Synthetic'}},packet:f.service.research.packet(t.id)}],{version:1,generatedAt:f.packet.generatedAt}),a=p.input.eventSynthesis.members[0].priorJudgment.dossier.companyAssessment.assessments[0];
  for(const citations of [a.financials.metrics[0].baseline.citations,a.financials.valuation.scenarios[0].perShare.citations,a.financials.valuation.scenarios[0].multiple.citations])assert(p.input.evidence.some(e=>e.id===citations[0].evidenceId));
  assert.deepEqual(t.dossier.companyAssessment,before);assert.equal(validateCodexDraft(parsed(p),p).companyAssessments[0].financials.valuation.status,'defined');
 }finally{await f.close();}
});
test('automatic single and composite research save financial scenarios with existing calls and retain unknown companies',async()=>{
 const q='NVIDIA proposes an order subject to approval.';
 const f=automatic({sourceReader:async url=>({url,title:'Synthetic NVIDIA financials',sourceName:'合成',body:q+financialBody+'合成财务范围限制。'.repeat(45),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);Object.assign(r.decomposition.events[0],{title:'NVIDIA 合成财务',actor:'NVIDIA',quote:q});r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:q,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成匹配'}],scopeNote:'合成',missingEvidence:['核实']}),researchRunner:financialDossier,synthesisRunner:financialDossier});
 try{const c=await two(f),d=f.queue.synthesis.detail(c.id);assert.equal(d.selected.current,true);assert.equal(valuationResult(d.selected.run.candidate.companyAssessments[0].financials).base,62.5);
  for(const m of c.members){const t=f.service.research.get(m.id);assert.equal(t.dossier.actor.kind,'system');assert.equal(valuationResult(t.dossier.companyAssessment.assessments[0].financials).base,62.5);}
  assert.equal(f.calls.dossier,2);assert.equal(f.synthesisCalls,1);assert.equal(f.service.paper.snapshot().orders.length,0);await f.service.runOperation('observations');assert(f.service.snapshot().observationInbox.researchChecks.length>=12);
 }finally{await f.close();}
});


test('source financial numbers must match the full material context, not a cropped numeric fragment',async()=>{
 const f=financialFixture();try{
  for(const body of ['(USD 100 million)','USD 100 million–200 million','USD 100 million HKD','-USD 100 million','USD 100 million. Other: (USD 100 million)']){
   const p=structuredClone(f.packet),e=p.input.evidence[0];e.material.body=body;p.inputHash=digest(p.input);
   const financials=parsed(f.packet).companyAssessments[0].financials;
   financials.metrics=[{...financials.metrics[0],baseline:{value:100,kind:'source',reason:'合成来源字面值',citations:[{evidenceId:e.id,field:'body',quote:body.startsWith('USD 100 million. Other:')?'Other: (USD 100 million':'USD 100 million'}]},affected:null,expected:null,observed:null}];
   financials.valuation={status:'unknown',reason:'没有估值输入'};
   assert.throws(()=>validateResearchFinancials(financials,{symbol:'NVDA.US',packet:p,validateCitations:c=>c}),undefined,body);
  }
 }finally{await f.close();}
});

test('automatic financial background does not require a manual row or fabricate event impact arithmetic',async()=>{
 const f=financialFixture();try{
  assert.equal(f.packet.input.materialityReview.targets.length,0);
  const r=parsed(f.packet),v=r.companyAssessments[0].financials;
  v.metrics=[{...v.metrics[0],label:'背景：已披露收入',basis:'背景数值，不能视为本次事件新增影响',affected:null,expected:null,observed:null}];v.valuation={status:'unknown',reason:'缺未来每股口径与估值依据'};
  const out=validateCodexDraft(r,f.packet),calc=financialMetricResult(out.companyAssessments[0].financials.metrics[0],f.packet.input.evidence);
  for(const key of ['delta','relativeChange','exposure','expectationDelta','expectationGap'])assert.equal(calc[key],null,key);
  assert.equal(out.companyAssessments[0].financials.metrics[0].baseline.value,100);
  const prompt=codexPrompt(f.packet);assert(prompt.includes('不以人工量级表或materialityReview.targets存在为前提'));assert(prompt.includes('背景：'));assert(prompt.includes('不以已有人工目标为空推断财务量级必须为空'));
 }finally{await f.close();}
});
