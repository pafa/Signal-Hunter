import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {validateCodexDraft,digest} from '../server/codex-research.mjs';
import {validateCandidate,openModelResearchRuns} from '../server/model-research-runs.mjs';
const at='2026-10-04T00:00:00Z';
function fixture(body='Synthetic company 2025 annual revenue USD 100 million. Proposed 2026 order USD 120 million, not revenue. Target margin 10%–20%.'){
 const store=openStore(':memory:'),r=openResearch(store,{seed:false,clock:()=>at});let t=r.create({title:'合成财务口径冲突',summary:'非真实公司'});
 t=r.saveMaterial(t.id,{version:t.version,title:'合成年度收入及订单',sourceName:'合成来源',scope:'excerpt',body,stance:'unverified',family:'other',step:'fact',interpretation:'订单不是营业收入'});
 const e=t.evidence[0].id,datum=(value,kind='source')=>({value,kind,evidenceIds:kind==='source'?[e]:[]});
 t=r.addCompany(t.id,{version:t.version,symbol:'BA.US',note:'合成证券关系',materiality:[{id:'revenue',label:'营业收入',scope:'虚构公司',period:'2025全年',unit:'million USD',basis:'测试误填订单为收入',comparable:true,baseline:datum(100),observed:datum(120),expected:datum(110),affected:datum(20,'assumption')}]});
 return {store,r,t,packet:r.packet(t.id),e};
}
function output(f){return {sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成口径待核，订单不可作为收入。'],sourceIds:[f.e]})),missingEvidence:['未提供事前预期，原计算不证明业务增幅'],materialityReviews:f.packet.input.materialityReview.targets.map(target=>({targetId:target.id,verdict:target.valueKey==='baseline'?'consistent':target.valueKey==='observed'?'contradicted':target.valueKey==='affected'?'assumption':'unknown',reason:'合成诊断；原文数字须与期间和指标对应',citations:target.valueKey==='baseline'?[{evidenceId:f.e,field:'body',quote:'2025 annual revenue USD 100 million'}]:target.valueKey==='observed'?[{evidenceId:f.e,field:'body',quote:'Proposed 2026 order USD 120 million, not revenue'}]:[]}))};}
function candidate(f,changes={}){const o=output(f);return {status:'candidate',reviewStatus:'unreviewed',...o,...changes,rawOutput:JSON.stringify(o),trace:{topicId:f.t.id,topicVersion:f.t.version,inputHash:f.packet.inputHash,model:'synthetic',outputHash:digest(JSON.stringify(o))}};}
test('research packets freeze one semantic-review target for each entered amount without changing literal checks',()=>{
 const f=fixture();try{assert.equal(f.packet.input.materialityReview.targets.length,4);assert.equal(f.packet.input.companies[0].materiality.rows[0].observed.sourceCheck.status,'literal-match');assert.equal(validateCodexDraft(output(f),f.packet).materialityReviews.find(r=>r.targetId.endsWith(':observed')).verdict,'contradicted');assert.equal(f.packet.inputHash,digest(f.packet.input));}finally{f.store.close();}
});
test('missing, duplicate, unknown targets and unsupported labels cannot produce a complete candidate',()=>{
 const f=fixture();try{for(const change of [o=>delete o.materialityReviews,o=>o.materialityReviews.pop(),o=>o.materialityReviews[0]=o.materialityReviews[1],o=>o.materialityReviews[0].targetId='forged',o=>o.materialityReviews[0].verdict='verified',o=>o.materialityReviews[0].approved=true,o=>o.materialityReviews.find(r=>r.verdict==='assumption').verdict='consistent']){const o=output(f);change(o);assert.throws(()=>validateCodexDraft(o,f.packet),e=>e.code==='output');}}finally{f.store.close();}
});
test('consistent review requires exact selected-source quotation containing the qualified full-source amount',()=>{
 const f=fixture();try{
  for(const quote of ['Synthetic company','USD 999 million','100 million','2025 annual revenue USD 100 million forged']){const o=output(f);o.materialityReviews[0].citations[0].quote=quote;assert.throws(()=>validateCodexDraft(o,f.packet),e=>e.code==='output');}
  const o=output(f);o.materialityReviews[0].citations[0].evidenceId='another';assert.throws(()=>validateCodexDraft(o,f.packet),e=>e.code==='output');
  const p=structuredClone(f.packet);p.input.materialityReview.targets[0].value=999;p.inputHash=digest(p.input);assert.throws(()=>validateCodexDraft(output(f),p),e=>e.code==='output');
  const range=structuredClone(f.packet);range.input.companies[0].materiality.rows[0].unit='%';range.input.companies[0].materiality.rows[0].baseline.value=10;
  // Derive the actual packet target set after changing the test amount.
  const target=range.input.materialityReview.targets.find(t=>t.valueKey==='baseline');target.value=10;for(const t of range.input.materialityReview.targets)t.unit='%';
  const out=output(f);out.materialityReviews[0].citations[0].quote='10%–20%';assert.throws(()=>validateCodexDraft(out,range),e=>e.code==='output');out.materialityReviews[0].citations[0].quote='10%–';assert.throws(()=>validateCodexDraft(out,range),e=>e.code==='output');
 }finally{f.store.close();}
});
test('raw model output and persisted per-value review must agree before candidate acceptance',()=>{
 const f=fixture();try{const c=candidate(f);validateCandidate(c,f.packet,{model:'synthetic',topicId:f.t.id});c.materialityReviews[0].reason='Replaced reason';assert.throws(()=>validateCandidate(c,f.packet,{model:'synthetic',topicId:f.t.id}),e=>e.code==='output');}finally{f.store.close();}
});
test('adoption and manual dossier edits retain frozen model review without changing company inputs or literal checks',()=>{
 const f=fixture();try{
  const before=JSON.stringify(f.t.companies),old=JSON.stringify(f.r.history(f.t.id)),o=output(f);let t=f.r.adoptModelDraft(f.t.id,{version:f.t.version,runId:'synthetic'},candidate(f));
  const review=JSON.stringify(t.dossier.materialityReview);assert.equal(JSON.stringify(t.companies),before);assert.equal(t.dossier.materialityReview.topicVersion,f.t.version);assert.equal(t.dossier.materialityReview.inputHash,f.packet.inputHash);
  t=f.r.update(t.id,{version:t.version,dossier:{sections:o.sections,reviewStatus:'draft',revisionReason:'仅改人工研判文字'}});assert.equal(JSON.stringify(t.dossier.materialityReview),review);assert.equal(JSON.stringify(t.companies),before);assert.equal(JSON.stringify(f.r.history(t.id).slice(2)),old);
  assert.throws(()=>f.r.adoptModelDraft(t.id,{version:t.version},candidate(f)),/不匹配/);
 }finally{f.store.close();}
});
test('persistent model runs reject incomplete reviews, retain failure and allow only validated adoption',async()=>{
 const f=fixture();let bad=true;const runs=openModelResearchRuns(f.store,f.r,{enabled:true,config:{binary:'/opt/test/codex',model:'synthetic'},runner:async()=>{const c=candidate(f);if(bad){delete c.materialityReviews;const raw=output(f);delete raw.materialityReviews;c.rawOutput=JSON.stringify(raw);c.trace.outputHash=digest(c.rawOutput);}return c;}});
 try{const a=runs.start(f.t.id,{version:f.t.version});assert.equal((await runs.wait(a.id)).status,'failed');assert.equal(f.r.get(f.t.id).version,f.t.version);bad=false;const b=runs.start(f.t.id,{version:f.t.version});assert.equal((await runs.wait(b.id)).status,'candidate');runs.adopt(f.t.id,b.id,{version:f.t.version});assert.equal(runs.get(f.t.id,b.id).status,'adopted');assert.equal(f.r.get(f.t.id).dossier.materialityReview.checks.length,4);assert.equal(runs.get(f.t.id,a.id).status,'failed');}finally{await runs.close();f.store.close();}
});
test('older packets without review targets remain readable without inventing structured audit results',()=>{
 const f=fixture();try{const p=structuredClone(f.packet);delete p.input.materialityReview;const o=output(f);delete o.materialityReviews;assert.equal(validateCodexDraft(o,p).materialityReviews,undefined);const noRows=structuredClone(f.packet);noRows.input.companies=[];noRows.input.materialityReview.targets=[];o.materialityReviews=[];assert.deepEqual(validateCodexDraft(o,noRows).materialityReviews,[]);}finally{f.store.close();}
});

test('non-breaking monetary multipliers survive saved source checks and cannot be clipped by model quotations',()=>{
 const f=fixture('Synthetic company 2025 annual revenue USD 100\u00a0million. Proposed 2026 order USD 120 million, not revenue.');
 try{
  const source=f.t.companies[0].materiality.rows[0].baseline.sourceCheck;
  assert.equal(source.quantityVersion,'source-quantity-literals/2');assert.equal(source.status,'literal-match');assert.equal(source.references[0].matches[0].normalizedValue,'100000000');
  const o=output(f);o.materialityReviews[0].citations[0].quote='2025 annual revenue USD 100\u00a0million';assert.equal(validateCodexDraft(o,f.packet).materialityReviews[0].verdict,'consistent');
  const p=structuredClone(f.packet);p.input.companies[0].materiality.rows[0].unit='USD';p.input.companies[0].materiality.rows[0].baseline.value=100;for(const target of p.input.materialityReview.targets)target.unit='USD';
  o.materialityReviews[0].citations[0].quote='annual revenue USD 100';assert.throws(()=>validateCodexDraft(o,p),e=>e.code==='output');
 }finally{f.store.close();}
});
