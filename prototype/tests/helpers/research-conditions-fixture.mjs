import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {assertDatabaseMode} from '../../server/runtime.mjs';
import {digest} from '../../server/codex-research.mjs';
import {dossier} from '../automatic-research-fixture.mjs';

export const conditionBody='Synthetic NVIDIA research example only: observe a USD 75 price threshold and review at 2026-11-01T14:00:00Z. Check revised research and new counterevidence. These are fictional test conditions, not investment advice.';
export function conditionalDossier(packet){
 const result=dossier(packet),e=packet.input.evidence.find(e=>e.material),a=result.companyAssessments?.find(a=>a.symbol==='NVDA.US');
 if(a?.monitoring&&e){
  const specifications={entryCondition:{type:'price',interval:'1m',operator:'lte',value:75},exitCondition:{type:'at',at:'2026-11-01T14:00:00Z'},invalidation:{type:'counterevidence'},nextCheck:{type:'research-change'}};
  for(const [key,c] of Object.entries(specifications)){
   a.analysis[key]={text:'合成条件，仅用于验证结构化定义的保存与历史，不证明投资判断或真实监控',basis:'inference',citations:[{evidenceId:e.id,field:'body',quote:e.material.body.slice(0,Math.min(400,e.material.body.length))}]};
   a.monitoring[key]={status:'defined',reason:'合成流程条件，尚未核验业务语义；不是买卖建议或检查结果',join:'all',conditions:[c]};
  }
 }
 result.rawOutput=JSON.stringify({sections:result.sections,missingEvidence:result.missingEvidence,companyAssessments:result.companyAssessments});result.trace.outputHash=digest(result.rawOutput);return result;
}
export function conditionFixture({path=':memory:'}={}){
 const store=openStore(path);assertDatabaseMode(store,'research');
 const service=createService(store,{mode:'research',now:()=>Date.parse('2026-10-08T14:00:00Z'),modelConfig:{binary:'/test/codex',model:'test-model'},modelRunner:async p=>conditionalDossier(p),fetcher:async()=>{throw Error('synthetic fixture never accesses network');}});
 let topic=service.research.create({title:'结构化观察条件 · 合成检查',summary:'验证条件定义、未知与历史；不代表真实行情和投资判断'});
 topic=service.research.saveMaterial(topic.id,{version:topic.version,title:'Synthetic conditional research',sourceName:'合成材料',body:conditionBody,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'纯合成输入，只用于测试'});
 topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'NVDA.US',note:'合成证券引用'});
 return {store,service,topic,packet:service.research.packet(topic.id),async save(){const run=service.modelResearch.start(topic.id,{version:topic.version});await service.modelResearch.wait(run.id);topic=service.modelResearch.adopt(topic.id,run.id,{version:topic.version});return topic;},async close(){await service.close();store.close();}};
}
