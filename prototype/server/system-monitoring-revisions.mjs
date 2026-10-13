import {validCapabilityReviewTrigger} from '../shared/research-capability.mjs';
import {businessFactTargets} from '../shared/business-facts.mjs';
import {validWatchReviewTrigger} from '../shared/research-watch.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
export const HOLDINGS_REVIEW_VERSION='holdings-trigger-review/1';
const parse=r=>r&&JSON.parse(r.payload),same=(a,b)=>digest(a)===digest(b);
const without=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const system=v=>v?.actor?.kind===SYSTEM_RESEARCH_ACTOR.kind&&v.actor.policy===SYSTEM_RESEARCH_ACTOR.policy;
export function monitoringPreparation(p,before,after,kind){return p.monitoringFollowup?{monitoringFollowup:{...p.monitoringFollowup,preparations:[...p.monitoringFollowup.preparations,{kind,beforeVersion:before.version,version:after.version,beforeHash:digest(before),hash:digest(after)}]}}:{};}
export function validateMonitoringFollowup(db,topic,row){
 const p=parse(row),f=p.monitoringFollowup,fail=()=>{throw Error('持仓复核版本或系统依据不连续');},history=v=>parse(db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(topic.id,v));
 if(!f||f.schema!==HOLDINGS_REVIEW_VERSION||!p.automatic||!['queued','running','completed','observing'].includes(row.status))fail();
 const before=history(f.baseVersion),first=history(f.baseVersion+1),parent=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(f.sourceJobId),pp=parse(parent),review=first?.monitoringReview;
 if(!before||!first||!same(history(topic.version),topic)||digest(before)!==f.baseHash||digest(first)!==f.preparedHash||parent?.status!=='completed'||parent.topic_id!==topic.id||parent.kind!=='dossier'||parent.run_id!==f.baseRunId||!pp.automatic||pp.adoptedVersion!==f.baseVersion||before.dossier?.sourceModelRun?.id!==f.baseRunId||!system(before.dossier))fail();
 const oldRun=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(f.baseRunId));
 if(oldRun?.status!=='adopted'||!system(oldRun)||oldRun.acceptedVersion!==before.version)fail();validateCandidate(oldRun.candidate,oldRun.packet,{model:oldRun.model,topicId:topic.id});
 if(review?.schema!==f.schema||review.sourceJobId!==f.sourceJobId||review.baseVersion!==f.baseVersion||review.baseRunId!==f.baseRunId||review.baseHash!==f.baseHash||!Array.isArray(review.triggers)||!review.triggers.length||!same(without(before,['version','updatedAt','monitoringReview','researchPrices']),without(first,['version','updatedAt','monitoringReview','researchPrices']))||!same(first.researchPrices||[],review.resetPrices?[]:before.researchPrices||[]))fail();
 if(!same(review.businessFacts||[],businessFactTargets(oldRun.candidate.companyAssessments)))fail();
 const prior=[...(before.monitoringReview?.priorPrices||[]),...(before.researchPrices||[])];
 if(!same(review.priorPrices,[...new Map(prior.map(x=>[digest(x),x])).values()]))fail();
 for(const trigger of review.triggers){
  const a=before.dossier.companyAssessment?.assessments.find(a=>a.symbol===trigger.symbol),n=Date.parse(review.preparedAt);
  if(!a||!Number.isFinite(n)||!Number.isSafeInteger(trigger.episode)||trigger.episode<1)fail();
  if(trigger.kind==='capability'){
   if(!validCapabilityReviewTrigger(trigger,a,oldRun.packet)||Date.parse(before.dossier.companyAssessment.preparedAt)>n)fail();
  }else if(trigger.kind==='deadline'){
   const value=trigger.group==='validUntil'?a.recommendation?.validUntil:trigger.group==='holdingHorizon'?a.recommendation?.holdingHorizon?.until:null;
   if(trigger.value!==value||!Number.isFinite(Date.parse(value))||Date.parse(value)>n)fail();
  }else if(trigger.kind==='observation'){
   if(!validWatchReviewTrigger(trigger,a,before.dossier.companyAssessment.preparedAt,review.preparedAt))fail();
  }else if(trigger.kind==='condition'){
   const c=trigger.check,age=n-Date.parse(c?.checkedAt);
   if(!['exitCondition','invalidation','nextCheck'].includes(trigger.group)||!same(trigger.definition,a.monitoring?.[trigger.group])||trigger.definition.status!=='defined'||!c?.current||c.status!=='true'||c.symbol!==a.symbol||c.group!==trigger.group||c.subject.id!==topic.id||c.subject.kind!=='research'||c.subject.runId!==f.baseRunId||c.subject.version!==before.version||!Number.isFinite(age)||age<0||age>120000)fail();
  }else fail();
 }
 let current=first;
 if(!Array.isArray(f.preparations))fail();
 for(const r of f.preparations){
  const next=history(r.version),key=r.kind==='prices'?'researchPrices':r.kind==='financial'?'financialSources':null,old=current[key]||[],added=next?.[key]?.at(-1);
  if(!key||r.beforeVersion!==current.version||r.version!==current.version+1||r.beforeHash!==digest(current)||!next||r.hash!==digest(next)||!same(without(current,['version','updatedAt','evidence',key]),without(next,['version','updatedAt','evidence',key]))||!added||!same(next[key].slice(0,-1),old)||!same(next.evidence.slice(0,current.evidence.length),current.evidence))fail();
  for(const e of next.evidence.slice(current.evidence.length)){const m=immutableMaterialSnapshot(db,{id:e.materialId,revision:e.materialRevision});if(!(key==='researchPrices'?['public-market']:['public-financial','public-filing']).includes(m.method))fail();}
  current=next;
 }
 if(current.version!==p.topicVersion)fail();
 if(topic.version===p.topicVersion){if(!same(topic,current))fail();}
 else{
  const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));
  if(run?.status!=='adopted'||!system(run)||run.acceptedVersion!==topic.version||run.topicId!==topic.id||run.packet.input.topicVersion!==p.topicVersion||topic.dossier?.sourceModelRun?.id!==run.id||!system(topic.dossier)||!same(without(topic,['version','updatedAt','dossier','researchUpdatedAt']),without(current,['version','updatedAt','dossier','researchUpdatedAt'])))fail();
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
  for(const key of ['sections','missingEvidence','sourceRequests'])if(!same(topic.dossier[key]||[],run.candidate[key]||[]))fail();
  if(!same(topic.dossier.companyAssessment?.assessments||[],run.candidate.companyAssessments||[]))fail();
 }
 return before;
}
export function monitoringResearchOrigin(db,topic){
 const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND json_type(payload,'$.monitoringFollowup')='object' ORDER BY rowid DESC").all(topic.id);
 const row=rows.find(r=>{const p=parse(r);return p.monitoringFollowup.baseVersion<topic.version&&(p.topicVersion===topic.version||p.topicVersion+1===topic.version&&r.run_id===topic.dossier?.sourceModelRun?.id);});
 return row?validateMonitoringFollowup(db,topic,row):null;
}
