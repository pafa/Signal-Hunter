import {randomUUID} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
import {actionDossier} from './research-action-fixture.mjs';
import {financialBody} from './research-financials-fixture.mjs';
import {digest} from '../../server/codex-research.mjs';
import {fixture as automatic,two,output,extraction} from '../automatic-research-fixture.mjs';
export function readyActionDossier(p,action='buy'){
 const r=actionDossier(p,{action}),a=r.companyAssessments?.find(a=>a.symbol==='NVDA.US');
 if(a?.recommendation){for(const s of a.financials.valuation.scenarios){s.multiple.value*=2;s.multiple.reason='合成倍数假设：用于低于估值情景的买入闭环测试，不是投资依据';}a.recommendation.validUntil='2026-10-08T19:00:00Z';a.recommendation.holdingHorizon.until='2026-10-09T14:00:00Z';a.monitoring.entryCondition.conditions=[{type:'at',at:new Date(Date.parse(p.generatedAt)-1000).toISOString()}];if(['reduce','exit'].includes(action))a.monitoring.exitCondition.conditions=[{type:'at',at:new Date(Date.parse(p.generatedAt)-1000).toISOString()}];}
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}
export async function marketResearchFixture({path=':memory:',composite=false,initialMembers=2,transformDossier=r=>r}={}){
 let now=Date.parse('2026-10-08T14:00:00Z'),quotes={},action='buy',auto=null,topic=null,cluster=null;
 const fetcher=async()=>{throw Error('No external network in synthetic market research fixture');},marketInputs=()=>({quotes,reason:'合成方案闭环检查；不证明真实交易'});
 let store,service;
 if(composite){const phrase='NVIDIA proposes an order subject to approval.';auto=automatic({path,marketInputs,fetcher,sourceReader:async url=>({url,title:'Synthetic NVIDIA financials',sourceName:'合成',body:phrase+financialBody+'合成研究范围。'.repeat(45)+'材料版本 '+(auto?.store.newsById(digest('automatic-cluster-'+url.split('-').at(-1)))?.revision||1),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);Object.assign(r.decomposition.events[0],{title:'NVIDIA 合成研究',actor:'NVIDIA',quote:phrase});r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:phrase,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成匹配'}],scopeNote:'合成',missingEvidence:['核实']}),researchRunner:p=>transformDossier(readyActionDossier(p,action),p),synthesisRunner:p=>transformDossier(readyActionDossier(p,action),p)});auto.advance(14*3600000);store=auto.store;service=auto.service;if(initialMembers===1){auto.add(1);await auto.drive();}else cluster=await two(auto);
 }else{store=openStore(path);service=createService(store,{mode:'research',now:()=>now,modelConfig:{binary:'/test/codex',model:'test-model'},modelRunner:async p=>transformDossier(readyActionDossier(p,action),p),marketInputs,fetcher});topic=service.research.create({title:'NVDA 合成研究方案',summary:'只检查自动方案完整闭环，不证明交易效果'});topic=service.research.saveMaterial(topic.id,{version:topic.version,title:'Synthetic financial input',sourceName:'合成',body:financialBody,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'纯测试输入'});topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'NVDA.US',note:'合成关联'});}
 for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,name==='observations'?'resume':'pause');
 const sim=service.marketSimulations.steady,command=data=>({requestId:randomUUID(),version:sim.snapshot().version,...data});
 sim.initialize(command({initialUSD:500000,config:strategyProfiles.steady.suggestedConfig,confirmSimulation:true}));
 const f={store,service,sim,auto,get cluster(){return cluster;},setAction:next=>action=next,async addMember(i){auto.add(i);await auto.drive();cluster=service.eventClusters.get(service.eventClusters.list().items[0].id);await f.observe();},get topic(){return topic;},at:()=>new Date(now).toISOString(),command,quotes:()=>quotes,
  setQuotes:q=>quotes=q,tick(ms=1000){now+=ms;auto?.advance(ms);},
  quote(price='100',extra={}){const at=f.at(),q={id:randomUUID(),symbol:'NVDA.US',kind:'market-simulation-input',verified:true,source:'synthetic-research-fixture-only',rulesVersion:'fixture-rules/1',issuerId:'fixture-NVDA',currency:'USD',asOf:at,receivedAt:at,validUntil:'2026-10-08T20:00:00Z',bid:price,ask:price,mark:price,fx:{id:'fixture-fx',source:'synthetic-research-fixture-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-08T20:00:00Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-08T13:30:00Z',sessionClose:'2026-10-08T20:00:00Z',sellableAt:at,settlesAt:at,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:1000,availableSell:1000,...extra};quotes={'NVDA.US':q};return q;},
  async observe(){await service.runOperation('observations');},
  async save(nextAction='buy'){action=nextAction;if(composite)throw Error('Use automatic pipeline to update composite');topic=service.research.get(topic.id);const run=service.modelResearch.start(topic.id,{version:topic.version});await service.modelResearch.wait(run.id);topic=service.modelResearch.adopt(topic.id,run.id,{version:topic.version});await f.observe();return topic;},
  enable(policy={enabled:true,targetIssuerPct:5,reducePct:50}){return sim.autoPolicy(command({policy,note:'合成分配配置由测试显式指定',confirmSimulation:true}));},
  candidate(){return sim.snapshot().researchCandidates.find(c=>c.researchBinding.kind===(composite?'event-cluster':'research'));},
  decide(c,action='approve',extra={}){return sim.decideResearch(c.id,command({action,fingerprint:c.fingerprint,note:'合成本人最后决定',confirmSimulation:true,...extra}));},
  async close(){if(auto)await auto.close();else{await service.close();store.close();}}
 };
 if(!composite)await f.save();else await f.observe();f.quote();return f;
}
