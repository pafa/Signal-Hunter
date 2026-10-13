import {dossier} from '../automatic-research-fixture.mjs';
import {digest} from '../../server/codex-research.mjs';
import {watchFixture} from './watch-review-fixture.mjs';
export const factClaim='NVIDIA 已实际执行本次授权内的普通股回购。';
export function factDossier(packet,{verdict='unknown',group='nextCheck'}={}){
 const r=dossier(packet),e=(verdict==='supported'?packet.input.evidence.find(e=>e.material?.body.includes('本期已实际执行')):null)||packet.input.evidence.find(e=>e.material&&e.material.method!=='public-market'),quote=e.material.body.slice(0,Math.min(300,e.material.body.length));
 for(const a of r.companyAssessments||[]){
  const targets=packet.input.monitoringReview?.businessFacts?.filter(t=>t.symbol===a.symbol)||[{symbol:a.symbol,group,claim:factClaim}];
  for(const t of targets){a.analysis[t.group]={text:'合成回购业务命题与本版资料比较，授权不等于实际执行；不验证真实证券。',basis:'inference',citations:[{evidenceId:e.id,field:'body',quote}]};a.monitoring[t.group]={status:'defined',reason:'合成测试保留原回购执行前提，资料不足时继续等待。',join:t.join||'all',conditions:[{type:'business-fact',claim:t.claim,verdict,reason:verdict==='unknown'?'合成资料只有授权，实际执行仍无依据。':'纯合成来源用于验证支持或反驳状态及原文链路，不证明真实执行。',citations:[{evidenceId:e.id,field:'body',quote}]}]};}
 }
 r.missingEvidence=[];
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}
export const factFixture=({verdict='unknown',runner,...options}={})=>watchFixture({...options,runner:runner||((p)=>factDossier(p,{verdict}))});
