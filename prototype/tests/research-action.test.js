import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFixture,financialBody} from './helpers/research-financials-fixture.mjs';
import {actionDossier} from './helpers/research-action-fixture.mjs';
import {codexDraftSchema,validateCodexDraft,codexPrompt,digest} from '../server/codex-research.mjs';
import {validateCandidate} from '../server/model-research-runs.mjs';
import {researchActionReadiness} from '../shared/research-action.mjs';
import {fixture as automatic,two,output,extraction} from './automatic-research-fixture.mjs';

const at='2026-10-08T14:00:00.000Z',parsed=p=>JSON.parse(actionDossier(p).rawOutput);
function ready(a){
 const subject={kind:'research',id:'topic',runId:'run',version:7,preparedAt:at,current:{status:'active',companies:[{symbol:a.symbol}]},ready:true,fresh:true,changed:false,reason:'Synthetic current inputs'};
 const checks=Object.keys(a.monitoring).map(group=>({subject:{kind:subject.kind,id:subject.id,runId:subject.runId,version:subject.version},symbol:a.symbol,group,checkedAt:at,current:true,status:group==='entryCondition'?'true':'false'}));
 return {subject,checks,at};
}
function readyDossier(p){
 const r=actionDossier(p),a=r.companyAssessments?.find(a=>a.symbol==='NVDA.US');
 if(a?.recommendation)a.monitoring.entryCondition.conditions=[{type:'at',at:new Date(Date.parse(p.generatedAt)-1000).toISOString()}];
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}

test('research intent is explicit and independent of impact, with cited expiry and holding review assumptions',async()=>{
 const f=financialFixture();try{const r=parsed(f.packet),a=validateCodexDraft(r,f.packet).companyAssessments[0];assert.equal(a.direction,'unclear');assert.equal(a.recommendation.action,'buy');assert.equal(a.recommendation.holdingHorizon.status,'defined');assert(codexPrompt(f.packet).includes('利好不必买'));
  const b=r.companyAssessments[0];b.direction='positive';b.analysis.impactMechanism=b.analysis.entryCondition;b.recommendation={version:'research-action/1',action:'unknown',reason:'材料不足',citations:[],validUntil:null,holdingHorizon:{status:'unknown',reason:'没有期限依据'}};assert.equal(validateCodexDraft(r,f.packet).companyAssessments[0].recommendation.action,'unknown');
 }finally{await f.close();}
});
test('intent schema rejects invented permissions, missing fields, shorting, bad references and invalid temporal assumptions',async()=>{
 const f=financialFixture();try{for(const mutate of [v=>v.account='steady',v=>v.quantity=100,v=>v.approved=true,v=>v.action='short',v=>v.version='research-action/2',v=>v.reason='',v=>v.reason='material:other',v=>v.citations=[],v=>v.validUntil=null,v=>v.validUntil=at,v=>v.validUntil='2026-02-30T14:00:00Z',v=>v.validUntil='2027-01-01',v=>v.holdingHorizon.until=at,v=>v.holdingHorizon.until='2026-10-09T14:00:00Z',v=>v.holdingHorizon.citations=[],v=>v.holdingHorizon.expectedProfit=50,v=>v.holdingHorizon.reason='material:other',v=>{v.action='unknown';v.validUntil=null;},v=>delete v.validUntil]){
   const r=parsed(f.packet);mutate(r.companyAssessments[0].recommendation);assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');
  }
  const r=parsed(f.packet);r.companyAssessments[0].recommendation.holdingHorizon={status:'unknown',reason:'无法可靠指定持有窗口'};assert.equal(validateCodexDraft(r,f.packet).companyAssessments[0].recommendation.action,'buy');
 }finally{await f.close();}
});
test('action citations must come from original material available by the frozen generation time',async()=>{
 const f=financialFixture();try{for(const change of [p=>p.input.evidence[0].material.availableAt='2026-10-09T00:00:00Z',p=>delete p.input.evidence[0].material.availableAt]){
  const p=structuredClone(f.packet);change(p);p.inputHash=digest(p.input);const r=parsed(p);r.companyAssessments[0].financials.valuation={status:'unknown',reason:'本测试单独检查行动时间'};r.companyAssessments[0].financials.metrics=[];assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
 }
 const r=parsed(f.packet);r.companyAssessments[0].recommendation.citations[0].quote='not in provided material';assert.throws(()=>validateCodexDraft(r,f.packet),e=>e.code==='output');
 }finally{await f.close();}
});
test('v1 through v3 remain readable with their exact historical schema and no fabricated action intent',async()=>{
 const f=financialFixture();try{for(const version of ['company-assessment/1','company-assessment/2','company-assessment/3']){
  const p=structuredClone(f.packet);p.input.companyAssessment.version=version;p.inputHash=digest(p.input);const r=parsed(p),a=validateCodexDraft(r,p).companyAssessments[0],s=codexDraftSchema(p).properties.companyAssessments.items;assert.equal(a.recommendation,undefined);assert.equal(s.properties.recommendation,undefined);assert.equal(!!a.financials,version.endsWith('/3'));
  r.companyAssessments[0].recommendation=parsed(f.packet).companyAssessments[0].recommendation;assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
 }
 const schema=codexDraftSchema(f.packet).properties.companyAssessments.items.properties.recommendation;assert.deepEqual(codexDraftSchema(f.packet).properties.citationPool.items.properties.evidenceId.enum,f.packet.input.evidence.map(e=>e.id));assert.deepEqual(codexDraftSchema(f.packet).properties.citationPool.items.properties.evidenceId.enum,f.packet.input.evidence.map(e=>e.id));
 }finally{await f.close();}
});
test('complete buy research conditions still have no execution permission or invented account sizing',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0],r=researchActionReadiness(a,ready(a));assert.equal(r.state,'conditional');assert.equal(r.executable,false);assert.equal(r.semanticVerified,false);assert.equal(r.quantity,undefined);assert.equal(r.account,undefined);
  for(const change of [a=>a.financials.valuation.status='unknown',a=>a.financials.valuation.horizonAt=at,a=>a.recommendation.holdingHorizon.status='unknown',a=>a.recommendation.holdingHorizon.until=at,a=>a.monitoring.invalidation.status='unknown']){const b=structuredClone(a);change(b);assert.equal(researchActionReadiness(b,ready(b)).state,'waiting');}
  for(const [group,status] of [['entryCondition','false'],['invalidation','true'],['exitCondition','true'],['nextCheck','true']]){const c=ready(a);c.checks.find(c=>c.group===group).status=status;assert.equal(researchActionReadiness(a,c).state,'waiting');}
 }finally{await f.close();}
});
test('a price hit and model buy label cannot conceal unknown business, valuation context or countercase',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0];
  for(const action of ['buy','hold'])for(const key of ['impactMechanism','businessExposure','magnitudeBasis','pricedIn','duration','countercase']){
   const b=structuredClone(a);b.recommendation.action=action;b.analysis[key]={text:'未知',basis:'unknown',citations:[]};const r=researchActionReadiness(b,ready(b));assert.equal(r.state,'waiting');assert(r.reasons.some(s=>s.includes('仍缺少有引用的判断')));
  }
 }finally{await f.close();}
});
test('observation and holding never become a new buy or exit simply because a condition is hit',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0];
  for(const [action,state] of [['unknown','unknown'],['watch','observing'],['hold','holding']]){a.recommendation.action=action;const c=ready(a);assert.equal(researchActionReadiness(a,c).state,state);assert.equal(researchActionReadiness(a,c).action,action);}
  a.recommendation.holdingHorizon.until=at;assert.equal(researchActionReadiness(a,ready(a)).state,'waiting');
  delete a.recommendation;a.direction='positive';assert.equal(researchActionReadiness(a,ready(a)).state,'unknown');
 }finally{await f.close();}
});
test('reduce and exit require explicit intent and an exit hit, and do not require an entry valuation',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0];a.financials.valuation={status:'unknown',reason:'不以估值缺失阻止研究层退出判断'};
  for(const action of ['reduce','exit']){a.recommendation.action=action;const c=ready(a);c.checks.find(c=>c.group==='invalidation').status='true';assert.equal(researchActionReadiness(a,c).state,'waiting');c.checks.find(c=>c.group==='exitCondition').status='true';assert.equal(researchActionReadiness(a,c).state,'conditional');assert.equal(researchActionReadiness(a,c).executable,false);c.checks.find(c=>c.group==='nextCheck').status='true';assert.equal(researchActionReadiness(a,c).state,'waiting');}
 }finally{await f.close();}
});
test('checks cannot be borrowed across research, composite, run, version or security, or repeated to forge readiness',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0];
  for(const change of [c=>c.subject.kind='event-cluster',c=>c.subject.id='other',c=>c.subject.runId='new-run',c=>c.subject.version++,c=>c.symbol='AAPL.US',c=>c.current=false,c=>c.status='unknown',c=>c.checkedAt='2026-10-08T13:57:00Z',c=>c.checkedAt='2026-10-08T14:01:00Z']){const context=ready(a);change(context.checks[0]);assert.equal(researchActionReadiness(a,context).state,'waiting');}
  const c=ready(a);c.checks.push(structuredClone(c.checks[0]));assert.equal(researchActionReadiness(a,c).state,'waiting');
 }finally{await f.close();}
});
test('changed, unavailable, archived, future or expired research cannot present a current action',async()=>{
 const f=financialFixture();try{const a=validateCodexDraft(parsed(f.packet),f.packet).companyAssessments[0];
  for(const change of [s=>s.fresh=false,s=>s.ready=false,s=>s.changed=true,s=>s.current.status='archived',s=>s.current.companies=[],s=>s.preparedAt='2026-10-08T14:01:00Z']){const c=ready(a);change(c.subject);assert.equal(researchActionReadiness(a,c).state,'historical');}
  const c=ready(a);c.at=a.recommendation.validUntil;assert.equal(researchActionReadiness(a,c).state,'historical');
 }finally{await f.close();}
});
test('saved research action projects through current observations without writes, preserves history, and never alters any ledger',async()=>{
 const f=financialFixture({runner:readyDossier});try{for(const name of Object.keys(f.service.operations().tasks).filter(n=>n!=='observations'))f.service.controlOperation(name,'pause');
  const book=f.service.paper.snapshot();assert.equal(f.service.snapshot().observationInbox.researchActions.length,0);const t=await f.save(),saved=structuredClone(t.dossier.companyAssessment);await f.service.runOperation('observations');const changes=f.store.db.prepare('SELECT total_changes() n').get().n;
  let a=f.service.snapshot().observationInbox.researchActions;assert.equal(a[0].state,'conditional');assert.equal(a[0].subject.runId,saved.sourceModelRunId);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
  f.service.controlOperation('observations','pause');assert.equal(f.service.snapshot().observationInbox.researchActions[0].state,'waiting');
  f.service.research.update(t.id,{version:t.version,nextEvidence:'原判断需修订'});assert.equal(f.service.snapshot().observationInbox.researchActions[0].state,'historical');assert.deepEqual(f.service.research.historyDetail(t.id,t.version).topic.dossier.companyAssessment,saved);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.marketSimulation.snapshot().configured,false);
 }finally{await f.close();}
});
test('tampered model intent fails original-output validation and incomplete research history rolls back atomically',async()=>{
 const f=financialFixture({runner:readyDossier});try{const r=readyDossier(f.packet);r.companyAssessments[0].recommendation.action='exit';assert.throws(()=>validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id}),e=>e.code==='output');
  const before=f.service.research.get(f.topic.id),history=f.service.research.history(f.topic.id);f.store.db.exec("CREATE TEMP TRIGGER fail_action_history BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>f.service.research.adoptModelDraft(f.topic.id,{version:before.version,runId:'synthetic'},readyDossier(f.packet)));assert.deepEqual(f.service.research.get(f.topic.id),before);assert.deepEqual(f.service.research.history(f.topic.id),history);
 }finally{await f.close();}
});
test('automatic single and composite reuse existing calls, remap intent citations and invalidate on source change',async()=>{
 const q='NVIDIA proposes an order subject to approval.';
 const f=automatic({sourceReader:async url=>({url,title:'Synthetic NVIDIA financials',sourceName:'合成',body:q+financialBody+'合成研究范围。'.repeat(45),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);Object.assign(r.decomposition.events[0],{title:'NVIDIA 合成研究',actor:'NVIDIA',quote:q});r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:q,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成匹配'}],scopeNote:'合成',missingEvidence:['核实']}),researchRunner:readyDossier,synthesisRunner:readyDossier});
 try{const c=await two(f),d=f.queue.synthesis.detail(c.id);await f.service.runOperation('observations');const actions=f.service.snapshot().observationInbox.researchActions;assert.equal(actions.length,3);assert(actions.every(a=>a.state==='conditional'));assert.equal(actions.find(a=>a.subject.kind==='event-cluster').subject.version,d.selected.version);
  for(const m of d.selected.packet.input.eventSynthesis.members){const a=m.priorJudgment.dossier.companyAssessment.assessments[0];for(const refs of [a.recommendation.citations,a.recommendation.holdingHorizon.citations])assert(d.selected.packet.input.evidence.some(e=>e.id===refs[0].evidenceId));}
  assert.equal(f.calls.dossier,2);assert.equal(f.synthesisCalls,1);assert.equal(f.service.paper.snapshot().orders.length,0);
  f.revise(1);assert.equal(f.service.snapshot().observationInbox.researchActions.find(a=>a.subject.kind==='event-cluster').state,'historical');assert.equal(f.queue.synthesis.detail(c.id,d.selected.id).selected.run.candidate.companyAssessments[0].recommendation.action,'buy');
 }finally{await f.close();}
});
