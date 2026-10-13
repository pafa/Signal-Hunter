import {financialDossier} from './research-financials-fixture.mjs';
import {digest} from '../../server/codex-research.mjs';
export function actionDossier(packet,{action='buy'}={}){
 const r=financialDossier(packet),a=r.companyAssessments?.find(a=>a.symbol==='NVDA.US'),e=packet.input.evidence.find(e=>e.material);
 if(a?.recommendation&&e){
  const citations=[{evidenceId:e.id,field:'body',quote:e.material.body.slice(0,Math.min(400,e.material.body.length))}];
  for(const key of ['impactMechanism','businessExposure','magnitudeBasis','pricedIn','duration','countercase'])a.analysis[key]={text:'纯合成研究假设；本夹具只验证流程，不证明原文支持真实经济含义。',basis:'inference',citations};
  a.recommendation={version:'research-action/1',action,reason:'仅为合成流程中的研究倾向，需满足原条件并核对反证；不代表真实买点或账户许可。',citations,validUntil:'2026-11-01T14:00:00Z',holdingHorizon:{status:'defined',until:'2027-01-08T14:00:00Z',reason:'合成事件兑现复核窗口；不是确定卖出日。',citations}};
 }
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}
