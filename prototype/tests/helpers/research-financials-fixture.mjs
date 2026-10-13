import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {assertDatabaseMode} from '../../server/runtime.mjs';
import {digest} from '../../server/codex-research.mjs';
import {conditionalDossier} from './research-conditions-fixture.mjs';

export const financialBody='Synthetic NVIDIA financial test only. FY2027 diluted earnings per share guidance is USD 2.50 per share. Synthetic FY2026 revenue is USD 100 million; affected contract is USD 20 million; expected revenue USD 110 million; scenario revenue USD 120 million. These are fictional inputs, not investment facts.';
export function financialDossier(packet){
 const result=conditionalDossier(packet),a=result.companyAssessments?.find(a=>a.symbol==='NVDA.US'),e=packet.input.evidence.find(e=>e.material?.body.includes(financialBody));
 if(a?.financials&&e){
  const citations=[{evidenceId:e.id,field:'body',quote:financialBody}],datum=(value,kind='source')=>({value,kind,reason:kind==='source'?'合成材料声明的数值，财务语义待核实':'基于合成材料的情景假设，未核实',citations});
  a.financials={version:'research-financials/1',reason:'独立合成财务输入，不是当前市场结论',metrics:[{id:'revenue',label:'收入量级',scope:'NVIDIA 合成测试业务',period:'FY2026',unit:'USD million',basis:'仅演示同口径比较，合同额不等于收入确认',comparable:true,eventAt:'2026-10-09T14:00:00Z',expectationAt:packet.generatedAt,baseline:datum(100),affected:datum(20),expected:datum(110),observed:datum(120)}],valuation:{status:'defined',reason:'倍数法合成情景；不证明估值方法适用',method:'eps-pe',currency:'USD',subject:'NVDA.US 合成研究',shareBasis:'本证券普通股、摊薄每股、合成口径；未验证真实股本',metricPeriod:'FY2027',basisAt:packet.generatedAt,horizonAt:'2027-10-09T14:00:00Z',scenarios:[['low',1.2,20],['base',2.5,25],['high',3,30]].map(([id,eps,multiple])=>({id,perShare:datum(eps,id==='base'?'source':'assumption'),multiple:{value:multiple,reason:'合成倍数假设；独立估值依据仍待核验',citations}}))}};
 }
 result.rawOutput=JSON.stringify({sections:result.sections,missingEvidence:result.missingEvidence,companyAssessments:result.companyAssessments});result.trace.outputHash=digest(result.rawOutput);return result;
}
export function financialFixture({path=':memory:',runner=financialDossier}={}){
 const store=openStore(path);assertDatabaseMode(store,'research');
 const service=createService(store,{mode:'research',now:()=>Date.parse('2026-10-08T14:00:00Z'),modelConfig:{binary:'/test/codex',model:'test-model'},modelRunner:async (p,c)=>runner(p,c),fetcher:async()=>{throw Error('synthetic fixture never accesses network');}});
 let topic=service.research.create({title:'财务输入与估值 · 合成检查',summary:'仅检查字段、来源、复算与版本，不代表实际投资判断'});
 topic=service.research.saveMaterial(topic.id,{version:topic.version,title:'Synthetic financial research',sourceName:'合成材料',body:financialBody,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'纯合成输入，只用于测试'});
 topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'NVDA.US',note:'合成证券引用'});
 return {store,service,topic,packet:service.research.packet(topic.id),async save(){const run=service.modelResearch.start(topic.id,{version:topic.version});await service.modelResearch.wait(run.id);topic=service.modelResearch.adopt(topic.id,run.id,{version:topic.version});return topic;},async close(){await service.close();store.close();}};
}
