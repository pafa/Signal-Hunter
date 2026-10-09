import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {validateCodexDraft,codexDraftSchema,digest} from '../server/codex-research.mjs';
import {validateCandidate,openModelResearchRuns} from '../server/model-research-runs.mjs';
import {companyResearch} from '../shared/company-view.mjs';
import {companyAssessmentTargets} from '../server/company-assessment.mjs';
import {unknownCompanyAssessments} from './helpers/company-assessment-fixture.mjs';
import {fixture as automatic,two,dossier,output,extraction,quote} from './automatic-research-fixture.mjs';
import {synthesisPacket} from '../server/event-synthesis.mjs';

const body='Synthetic NVIDIA proposes an order of USD 100 million, subject to approval. No revenue forecast is given.';
function setup(){
 const store=openStore(':memory:'),research=openResearch(store,{seed:false}),paper=openPaper(store,research,{seed:false});
 let topic=research.create({title:'合成公司影响',summary:'非真实事件，不证明投资表现'});
 topic=research.saveMaterial(topic.id,{version:topic.version,title:'Synthetic NVIDIA conditional order',sourceName:'合成公告',body,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'合成订单并非营业收入'});
 for(const symbol of ['NVDA.US','002594.SZ','01211.HK'])topic=research.addCompany(topic.id,{version:topic.version,symbol,note:'仅为证券隔离测试',analysis:{impactMechanism:'本人原有判断，不能覆盖'}});
 return {store,research,paper,topic,packet:research.packet(topic.id)};
}
function result(packet){const r=dossier(packet),e=packet.input.evidence.find(e=>e.material),a=r.companyAssessments.find(c=>c.symbol==='NVDA.US');
 if(a){a.direction='positive';a.analysis.impactMechanism={text:'合成假设：若订单获批可能增加需求，尚不能证明收入或股价上涨',basis:'inference',citations:[{evidenceId:e.id,field:'body',quote:body}]};a.analysis.businessExposure={text:'原文未给业务收入占比',basis:'unknown',citations:[]};}
 const raw={sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments};r.rawOutput=JSON.stringify(raw);r.trace.outputHash=digest(r.rawOutput);return r;
}
test('new packets freeze exact securities and require every company and dimension; A and H remain distinct',()=>{
 const f=setup();try{const p=f.packet,r=result(p);assert.deepEqual(p.input.companyAssessment,companyAssessmentTargets(p.input));assert.equal(p.inputHash,digest(p.input));
  assert.deepEqual(validateCodexDraft(JSON.parse(r.rawOutput),p).companyAssessments.map(c=>[c.symbol,c.direction]),[['NVDA.US','positive'],['002594.SZ','unclear'],['01211.HK','unclear']]);
  const s=codexDraftSchema(p);assert.deepEqual(s.properties.companyAssessments.items.properties.symbol.enum,['NVDA.US','002594.SZ','01211.HK']);assert(s.required.includes('companyAssessments'));assert.deepEqual(s.properties.companyAssessments.items.properties.analysis.properties.impactMechanism.properties.text,{type:'string'});assert.deepEqual(s.properties.companyAssessments.items.properties.analysis.properties.duration.properties.citations.items.properties.evidenceId.enum,[p.input.evidence[0].id]);
  for(const change of [r=>delete r.companyAssessments,r=>r.companyAssessments.pop(),r=>r.companyAssessments.push(r.companyAssessments[0]),r=>r.companyAssessments[1].symbol='BABA.US',r=>r.companyAssessments[1].symbol='NVDA.US',r=>delete r.companyAssessments[0].analysis.pricedIn,r=>r.companyAssessments[0].analysis.priceTarget=100,r=>r.companyAssessments[0].approved=true,r=>r.companyAssessments[0].direction='buy']){const o=JSON.parse(result(p).rawOutput);change(o);assert.throws(()=>validateCodexDraft(o,p),e=>e.code==='output');}
 }finally{f.store.close();}
});
test('exact material revision, literal quotation and cited inference are required; unknown is not an unsupported directional claim',()=>{
 const f=setup();try{for(const change of [a=>a.analysis.impactMechanism.citations[0].quote+=' forged',a=>a.analysis.impactMechanism.citations[0].evidenceId='material:foreign',a=>a.analysis.impactMechanism.citations[0].field='summary',a=>a.analysis.impactMechanism.citations=[],a=>a.analysis.impactMechanism.citations.push(a.analysis.impactMechanism.citations[0]),a=>a.analysis.impactMechanism.basis='confirmed',a=>a.analysis.impactMechanism.text='material:made-up',a=>a.analysis.impactMechanism.basis='unknown',a=>a.analysis.duration.text='',a=>a.analysis.duration.text='x'.repeat(1001)]){const o=JSON.parse(result(f.packet).rawOutput);change(o.companyAssessments[0]);assert.throws(()=>validateCodexDraft(o,f.packet),e=>e.code==='output');}
  const p=structuredClone(f.packet);p.input.evidence[0].material.revision++;assert.throws(()=>validateCodexDraft(JSON.parse(result(f.packet).rawOutput),p),e=>e.code==='output');
  const o=JSON.parse(result(f.packet).rawOutput);o.companyAssessments[0].analysis.magnitudeBasis={text:'没有营业收入基准，不能把订单额当收入增幅',basis:'unknown',citations:[]};assert.equal(validateCodexDraft(o,f.packet).companyAssessments[0].analysis.magnitudeBasis.basis,'unknown');
 }finally{f.store.close();}
});
test('frozen contract cannot omit a company and historical packets stay readable without invented assessments',()=>{
 const f=setup();try{const p=structuredClone(f.packet),r=JSON.parse(result(p).rawOutput);p.input.companyAssessment.targets.pop();p.inputHash=digest(p.input);assert.throws(()=>validateCodexDraft(r,p),e=>e.code==='output');
  delete p.input.companyAssessment;delete r.companyAssessments;p.inputHash=digest(p.input);assert.equal(validateCodexDraft(r,p).companyAssessments,undefined);assert.equal(codexDraftSchema(p).properties.companyAssessments.maxItems,0);
  const none=structuredClone(p);none.input.companies=[];none.input.companyAssessment=companyAssessmentTargets(none.input);assert.deepEqual(validateCodexDraft({...r,companyAssessments:[]},none).companyAssessments,[]);
 }finally{f.store.close();}
});
test('parsed candidate and raw output must agree for per-company judgments, including adoption of a stored candidate',async()=>{
 const f=setup(),runs=openModelResearchRuns(f.store,f.research,{enabled:true,config:{binary:'/test/codex',model:'test-model'},runner:async p=>result(p)});try{
  const r=result(f.packet);validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id});r.companyAssessments[0].analysis.impactMechanism.text='Replaced interpretation';assert.throws(()=>validateCandidate(r,f.packet,{model:'test-model',topicId:f.topic.id}),e=>e.code==='output');
  const started=runs.start(f.topic.id,{version:f.topic.version});await runs.wait(started.id);const saved=runs.get(f.topic.id,started.id);saved.candidate.companyAssessments[0].direction='negative';f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(saved),started.id);const before=f.research.get(f.topic.id);assert.throws(()=>runs.adopt(f.topic.id,started.id,{version:before.version}),e=>e.code==='output');assert.deepEqual(f.research.get(f.topic.id),before);
 }finally{await runs.close();f.store.close();}
});
test('adoption preserves manual values, all history and ledgers; later edits retain the old assessment with its original version',async()=>{
 const f=setup(),runs=openModelResearchRuns(f.store,f.research,{enabled:true,config:{binary:'/test/codex',model:'test-model'},runner:async p=>result(p)});try{
  const book=f.paper.snapshot(),companies=structuredClone(f.topic.companies),old=f.research.history(f.topic.id);const started=runs.start(f.topic.id,{version:f.topic.version});await runs.wait(started.id);let t=runs.adopt(f.topic.id,started.id,{version:f.topic.version});
  const saved=structuredClone(t.dossier.companyAssessment),view=companyResearch('NVDA.US',[t]).research[0];assert.equal(view.modelAssessment.researchChanged,false);assert.equal(view.modelAssessment.assessment.direction,'positive');assert.deepEqual(t.companies,companies);assert.equal(saved.inputTopicVersion,f.topic.version);assert.equal(saved.savedInResearchVersion,t.version);
  t=f.research.update(t.id,{version:t.version,dossier:{sections:t.dossier.sections,reviewStatus:'draft',revisionReason:'本人修订长文'}});assert.deepEqual(t.dossier.companyAssessment,saved);assert.equal(companyResearch('NVDA.US',[t]).research[0].modelAssessment.researchChanged,true);assert.deepEqual(t.companies,companies);assert.deepEqual(f.paper.snapshot(),book);assert.deepEqual(f.research.history(t.id).slice(2),old);assert.equal(companyResearch('002594.SZ',[t]).research[0].modelAssessment.assessment.direction,'unclear');
 }finally{await runs.close();f.store.close();}
});
test('automatic identity, per-company dossier and synthesis finish without intermediate approval or ledger writes',async()=>{
 const eventQuote='NVIDIA proposes an order subject to approval.';
 const f=automatic({sourceReader:async url=>({url,title:'Synthetic NVIDIA order',sourceName:'合成',body:eventQuote+body+'合成范围限制，不是投资事实。'.repeat(40),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);r.decomposition.events[0]={...r.decomposition.events[0],title:'NVIDIA 合成订单',actor:'NVIDIA',quote:eventQuote};r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:eventQuote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成身份匹配'}],scopeNote:'合成',missingEvidence:['核实身份']}),researchRunner:result,synthesisRunner:result});
 try{const book=f.service.paper.snapshot(),c=await two(f),d=f.queue.synthesis.detail(c.id);assert.equal(d.selected.current,true);assert.equal(d.selected.run.candidate.companyAssessments.length,1);assert.equal(d.selected.run.candidate.companyAssessments[0].symbol,'NVDA.US');
  for(const member of c.members){const t=f.service.research.get(member.id);assert.equal(t.dossier.companyAssessment.assessments[0].symbol,'NVDA.US');assert.equal(t.dossier.actor.kind,'system');assert.equal(t.companies[0].analysis.impactMechanism,'');}
  const p=d.selected.packet;for(const m of p.input.eventSynthesis.members){const a=m.priorJudgment.dossier.companyAssessment.assessments[0];assert(p.input.evidence.some(e=>e.id===a.analysis.impactMechanism.citations[0].evidenceId));}
  assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);assert.equal(f.synthesisCalls,1);
  const old=structuredClone(d.selected.run);f.revise(1);assert.equal(f.queue.synthesis.overview(c.id).current,false);assert.deepEqual(f.queue.synthesis.detail(c.id,d.selected.id).selected.run,old);
 }finally{await f.close();}
});
test('synthesis remaps nested citation ids while preserving original material ids and each member hypothesis',()=>{
 const f=setup();try{const r=result(f.packet),t={...f.topic,dossier:{companyAssessment:{assessments:r.companyAssessments},sourceRequests:[{evidenceId:f.packet.input.evidence[0].id,url:'https://example.com/kept'}]}};
  const p=synthesisPacket({id:'synthetic',version:1,title:'合成',snapshotHash:'hash'},[{topic:t,scope:{eventFocus:{quote}},packet:f.packet}],{version:1,generatedAt:new Date().toISOString()});const prior=p.input.eventSynthesis.members[0].priorJudgment.dossier;
  assert.equal(prior.companyAssessment.assessments[0].analysis.impactMechanism.citations[0].evidenceId,p.input.evidence[0].id);assert.equal(prior.sourceRequests[0].evidenceId,p.input.evidence[0].id);assert.equal(p.input.evidence[0].materialId,f.packet.input.evidence[0].materialId);assert.deepEqual(t.dossier.companyAssessment.assessments,r.companyAssessments);
 }finally{f.store.close();}
});
