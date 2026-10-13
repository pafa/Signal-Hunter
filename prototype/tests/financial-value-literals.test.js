import test from 'node:test';
import assert from 'node:assert/strict';
import {FINANCIAL_VALUE_RULES,financialQuantities,researchFinancialLiteralMatches} from '../shared/financial-value-literals.mjs';
import {financialLiteralMatches,valuationResult,financialMetricResult} from '../shared/research-financials.mjs';
import {validatePacket,validateCodexDraft,codexPrompt,digest} from '../server/codex-research.mjs';
import {researchOutputFeedback} from '../server/research-output-feedback.mjs';
import {financialFixture,financialDossier} from './helpers/research-financials-fixture.mjs';
import {validateCandidate} from '../server/model-research-runs.mjs';
import {synthesisPacket} from '../server/event-synthesis.mjs';

const matches=(body,unit,value,quote=body,perShare=false)=>researchFinancialLiteralMatches({value,citations:[{quote}]},unit,()=>body,{version:FINANCIAL_VALUE_RULES,perShare});
const parsed=p=>JSON.parse(financialDossier(p).rawOutput);
const revised=(p,body)=>{const out=structuredClone(p);out.input.evidence[0].material.body+='\n'+body;out.inputHash=digest(out.input);return out;};
const epsLine='Synthetic issuer: diluted EPS | USD/shares 2.5 | period FY2027 | filing TEST. This is fictional.';
function withPerShare(packet){
 const r=parsed(packet),a=r.companyAssessments[0],id=packet.input.evidence[0].id;
 const citations=[{evidenceId:id,field:'body',quote:epsLine}];
 a.financials.metrics=[{...a.financials.metrics[0],label:'背景：合成每股收益',unit:'USD/shares',basis:'独立合成每股口径；不年化、不等于事件增量',baseline:{value:2.5,kind:'source',reason:'原文每股单位',citations},affected:null,expected:null,observed:null}];
 for(const s of a.financials.valuation.scenarios){s.perShare.citations=citations;s.multiple.citations=citations;}
 return r;
}
test('explicit financial dimensions preserve complete source offsets, exact values and currency separation',()=>{
 for(const currency of ['USD','CNY','HKD'])for(const phrase of [`${currency}/shares 2.50`,`${currency}/share 2.50`,`2.50 ${currency}/shares`,`${currency} 2.50 per share`]){
  const body='Prefix 🙂 | '+phrase+' | End',q=financialQuantities(body)[0];
  assert.equal(q.raw,phrase);assert.equal(body.slice(q.start,q.end),phrase);assert.equal(q.unit,currency+'/shares');assert.equal(q.normalizedValue,'2.5');
  assert(matches(body,currency+'/shares',2.5));assert(matches(body,currency,2.5,phrase,true));assert(!matches(body,currency,2.5));
  assert(!matches(body,(currency==='USD'?'HKD':'USD')+'/shares',2.5));
 }
 for(const phrase of ['shares 1,000','1,000 shares','1 million shares'])assert(matches(phrase,'shares',phrase.includes('million')?1000000:1000));
 assert(!matches('1,000 shares','USD',1000));assert(!matches('USD 1000','shares',1000));
 assert(matches('USD 2.5 cash','USD',2.5));assert(!matches('USD 2.5 cash','USD',2.5,undefined,true));
 assert(matches('USD 100 million','USD million',100));assert(matches('12.5%','percent',12.5));
 for(const phrase of ['USD 2.5 shares','2.5 shares USD','USD shares 2.5','USD/shares 2.5 USD','USD USD/shares 2.5','USD 2.5 per share USD']){
  assert(!matches(phrase,'shares',2.5),phrase);assert(!matches(phrase,'USD/shares',2.5),phrase);assert(!matches(phrase,'USD',2.5),phrase);
 }
});
test('per-share quotes cannot drop denominators, signs, ranges, compound units or borrow an identical amount elsewhere',()=>{
 for(const [body,quote]of [
  ['USD 2.5 per share','USD 2.5'],['2.5 USD/shares','2.5 USD'],['USD/shares 2.5','shares 2.5'],
  ['(USD 2.5 per share)','USD 2.5 per share'],['-USD/shares 2.5','USD/shares 2.5'],
  ['USD/shares 2.5–3.5','USD/shares 2.5'],['USD 2.5 per share–3.5 per share','USD 2.5 per share'],
  ['USD/shares 2.5 per share','USD/shares 2.5 per share'],['USD/shares 2.5/year','USD/shares 2.5'],
  ['USD 2.5 per share; Cash USD 2.5','Cash USD 2.5'],['USD/shares 2.5. Other: (USD/shares 2.5)','Other: (USD/shares 2.5'],
  ['USD/shares 2.5 HKD','USD/shares 2.5'],['$2.5 per share','$2.5 per share'],['USD/shares 2.5e4','USD/shares 2.5']
 ])assert(!matches(body,'USD/shares',2.5,quote),body+' | '+quote);
 assert(matches('USD/shares -2.5','USD/shares',-2.5));assert(!matches('USD/shares -2.5','USD/shares',2.5));
});
test('old packets retain their original literal semantics while new packets explicitly bind new financial rules',async()=>{
 const f=financialFixture();try{
  assert.equal(f.packet.input.financialValueRules,FINANCIAL_VALUE_RULES);
  const legacy=structuredClone(f.packet);delete legacy.input.financialValueRules;legacy.inputHash=digest(legacy.input);
  const body='Synthetic cash USD 2.50; no per-share unit is asserted.',datum={value:2.5,citations:[{quote:body}]};
  assert.equal(researchFinancialLiteralMatches(datum,'USD',()=>body),financialLiteralMatches(datum,'USD',()=>body));
  assert(!researchFinancialLiteralMatches(datum,'USD',()=>body,{version:FINANCIAL_VALUE_RULES,perShare:true}));
  assert(!researchFinancialLiteralMatches(datum,'USD',()=>body,{version:'future'}));
  assert.equal(validatePacket(legacy),legacy);assert(codexPrompt(f.packet).includes('本包财务字面校验采用financial-value-literals/2'));assert(!codexPrompt(legacy).includes('本包财务字面校验采用financial-value-literals/2'));
  for(const marker of [null,'future',{},undefined]){const p=structuredClone(f.packet);p.input.financialValueRules=marker;p.inputHash=digest(p.input);assert.throws(()=>validatePacket(p),e=>e.code==='packet');}
  assert.equal(valuationResult(validateCodexDraft(parsed(legacy),legacy).companyAssessments[0].financials).base,62.5);
 }finally{await f.close();}
});
test('full research accepts explicit per-share background and valuation without treating it as an ordinary amount',async()=>{
 const f=financialFixture();try{
  const p=revised(f.packet,epsLine),raw=withPerShare(p),a=validateCodexDraft(raw,p).companyAssessments[0];
  assert.equal(a.financials.metrics[0].unit,'USD/shares');assert.equal(financialMetricResult(a.financials.metrics[0],p.input.evidence).delta,null);
  assert.deepEqual(valuationResult(a.financials).scenarios.map(s=>s.price),[24,62.5,90]);assert.equal(valuationResult(a.financials).executable,false);
  const old=structuredClone(p);delete old.input.financialValueRules;old.inputHash=digest(old.input);assert.throws(()=>validateCodexDraft(raw,old),e=>e.code==='output');
  for(const change of [a=>a.financials.metrics[0].unit='USD',a=>a.financials.metrics[0].baseline.value=2.51,a=>a.financials.valuation.currency='CNY']){const r=structuredClone(raw);change(r.companyAssessments[0]);assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');}
  const cash=epsLine.replace('USD/shares','USD'),p2=revised(f.packet,cash),r2=withPerShare(p2);r2.companyAssessments[0].financials.metrics=[];
  for(const s of r2.companyAssessments[0].financials.valuation.scenarios){s.perShare.citations[0].quote=cash;s.multiple.citations[0].quote=cash;}
  assert.throws(()=>validateCodexDraft(r2,p2),e=>e.code==='output');
 }finally{await f.close();}
});
test('new financial feedback follows the same per-share rules and preserves the rejected answer',async()=>{
 const f=financialFixture();try{
  const p=revised(f.packet,epsLine),r=withPerShare(p),diagnostic=rawOutput=>({stage:'schema',rawOutput,outputHash:digest(rawOutput)});
  assert.equal(researchOutputFeedback(diagnostic(JSON.stringify(r)),p),null);
  r.companyAssessments[0].financials.valuation.scenarios[1].perShare.value=2.51;
  const d=diagnostic(JSON.stringify(r)),before=structuredClone(d),feedback=researchOutputFeedback(d,p);
  assert.deepEqual(feedback.issues,[{code:'financial-source-literal-mismatch',path:'companyAssessments[0].financials.valuation.scenarios[1].perShare',value:2.51,unit:'USD',unsupportedCitationIndexes:[0]}]);assert.deepEqual(d,before);
  const unknown=structuredClone(p);unknown.input.financialValueRules='future';assert.equal(researchOutputFeedback(d,unknown),null);
 }finally{await f.close();}
});
test('saved research, composite input and previous versions retain the dimensional contract without ledger changes',async()=>{
 const f=financialFixture();try{
  const paper=f.service.paper.snapshot(),t=await f.save(),saved=structuredClone(t.dossier.companyAssessment);
  const run=f.service.modelResearch.get(t.id,f.service.modelResearch.list(t.id)[0].id);assert.equal(run.packet.input.financialValueRules,FINANCIAL_VALUE_RULES);
  validateCandidate(run.candidate,run.packet,{model:'test-model',topicId:t.id});
  const packet=synthesisPacket({id:'synthetic',version:1,title:'合成每股研究',snapshotHash:'hash'},[{topic:t,scope:{eventFocus:{quote:'Synthetic'}},packet:f.service.research.packet(t.id)}],{version:1,generatedAt:f.packet.generatedAt});
  assert.equal(packet.input.financialValueRules,FINANCIAL_VALUE_RULES);assert.equal(valuationResult(validateCodexDraft(parsed(packet),packet).companyAssessments[0].financials).base,62.5);
  assert.deepEqual(t.dossier.companyAssessment,saved);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});
