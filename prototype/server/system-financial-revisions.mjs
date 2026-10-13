import {HOLDINGS_FINANCIAL_VERSION,holdingsFinancialProof,storedHoldingsFinancialBasis} from './holdings-financial-basis.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {financialRecoveryCandidate,FINANCIAL_RECOVERY_VERSION} from './financial-recovery.mjs';
const parse=r=>r&&JSON.parse(r.payload),same=(a,b)=>digest(a)===digest(b);
const without=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const system=x=>x?.actor?.kind===SYSTEM_RESEARCH_ACTOR.kind&&x.actor.policy===SYSTEM_RESEARCH_ACTOR.policy;

export function financialPreparation(p,before,after){
 if(!p.financialFollowup)return {};
 return {financialFollowup:{...p.financialFollowup,preparations:[...(p.financialFollowup.preparations||[]),{beforeVersion:before.version,version:after.version,beforeHash:digest(before),hash:digest(after)}]}};
}
export function validateFinancialFollowup(db,topic,row){
 const p=parse(row),f=p.financialFollowup,fail=()=>{throw Error('财务接续版本或系统依据不连续');},history=v=>parse(db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(topic.id,v));
 if(!f||![FINANCIAL_RECOVERY_VERSION,HOLDINGS_FINANCIAL_VERSION].includes(f.schema)||!p.automatic||!['queued','running','completed','observing'].includes(row.status))fail();
 const before=history(f.baseVersion),prepared=history(p.topicVersion),parent=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(f.sourceJobId),pp=parse(parent);
 if(!before||!prepared||!same(history(topic.version),topic)||digest(before)!==f.baseHash||parent?.status!=='completed'||parent.kind!=='dossier'||parent.topic_id!==topic.id||parent.run_id!==f.baseRunId||!pp.automatic||pp.adoptedVersion!==f.baseVersion||before.dossier?.sourceModelRun?.id!==f.baseRunId||!system(before.dossier))fail();
 const refresh=f.schema===HOLDINGS_FINANCIAL_VERSION,proof=refresh?holdingsFinancialProof(before,f.proof.symbol,f.proof.nextBasis):financialRecoveryCandidate(db,before,f.proof.symbol);if(!proof||!same(proof,f.proof))fail();
 const parentRun=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(parent.run_id));
 if(!parentRun||parentRun.status!=='adopted'||!system(parentRun)||parentRun.topicId!==topic.id||parentRun.acceptedVersion!==before.version)fail();
 validateCandidate(parentRun.candidate,parentRun.packet,{model:parentRun.model,topicId:topic.id});
 let current=before;
 if(!Array.isArray(f.preparations)||f.preparations.length>1||refresh&&f.preparations.length!==1)fail();
 for(const r of f.preparations){
  const next=history(r.version),old=current.financialSources.find(x=>x.symbol===proof.symbol),updated=next?.financialSources?.find(x=>x.symbol===proof.symbol);
  if(r.beforeVersion!==current.version||r.version!==current.version+1||digest(current)!==r.beforeHash||!next||digest(next)!==r.hash||!same(without(current,['version','updatedAt','evidence','financialSources']),without(next,['version','updatedAt','evidence','financialSources']))||!same(next.evidence.slice(0,current.evidence.length),current.evidence))fail();
  if(!updated||next.financialSources.length!==current.financialSources.length||!same(next.financialSources.filter(x=>x.symbol!==proof.symbol),current.financialSources.filter(x=>x.symbol!==proof.symbol))||updated.recovery?.schema!==f.schema||updated.recovery.scopeHash!==proof.scopeHash||updated.recovery.previousResultHash!==digest(old)||updated.recovery.sourceJobId!==f.sourceJobId||!['saved','unavailable'].includes(updated.recovery.outcome)||![1,2,3].includes(updated.recovery.attempt))fail();
  if(updated.recovery.outcome==='unavailable'&&!same(without(updated,['recovery']),old))fail();
  for(const e of next.evidence.slice(current.evidence.length)){const m=immutableMaterialSnapshot(db,{id:e.materialId,revision:e.materialRevision});if(!['public-financial','public-filing'].includes(m.method)||(m.financialSource||m.filingSource)?.issuer.symbol!==proof.symbol)fail();}
  if(refresh&&(updated.status!=='saved'||storedHoldingsFinancialBasis(db,updated)!==proof.nextBasis||storedHoldingsFinancialBasis(db,old)===proof.nextBasis))fail();
  current=next;
 }
 if(current.version!==p.topicVersion||!same(current,prepared))fail();
 const run=row.run_id&&parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));if(run?.status==='cancelled')fail();
 if(topic.version===p.topicVersion){if(!same(topic,prepared))fail();}
 else{
  if(!run||run.status!=='adopted'||!system(run)||run.acceptedVersion!==topic.version||run.topicId!==topic.id||run.packet.input.topicVersion!==p.topicVersion||!system(topic.dossier)||topic.dossier.sourceModelRun?.id!==run.id||!same(without(topic,['version','updatedAt','dossier','researchUpdatedAt']),without(prepared,['version','updatedAt','dossier','researchUpdatedAt'])))fail();
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
  for(const k of ['sections','sourceRequests','missingEvidence'])if(!same(topic.dossier[k]||[],run.candidate[k]||[]))fail();
  if(!same(topic.dossier.companyAssessment?.assessments||[],run.candidate.companyAssessments||[]))fail();
 }
 return before;
}
export function financialResearchOrigin(db,topic){
 const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND json_type(payload,'$.financialFollowup')='object' ORDER BY rowid DESC").all(topic.id);
 const row=rows.find(r=>{const p=parse(r);return p.financialFollowup.baseVersion<topic.version&&(p.topicVersion===topic.version||p.topicVersion+1===topic.version&&r.run_id===topic.dossier?.sourceModelRun?.id);});
 return row?validateFinancialFollowup(db,topic,row):null;
}
