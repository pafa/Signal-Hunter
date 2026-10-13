import {automaticResearchPacket} from './research-output-contract.mjs';
import {digest} from './codex-research.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {financialRecoveryCandidate,FINANCIAL_RECOVERY_VERSION} from './financial-recovery.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
const parse=r=>r&&JSON.parse(r.payload);
export function openFinancialFollowup(store,research,{sources,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid}){
 const db=store.db;
 return {step(context){
  if(!sources||!settings().automatic||!settings().financialSources||used()>=settings().dailyCalls)return null;
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j JOIN research_topics t ON t.id=j.topic_id WHERE j.kind='dossier' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(j.payload,'$.financialSources')=1 AND json_extract(t.payload,'$.version')=json_extract(j.payload,'$.adoptedVersion') AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs n WHERE n.topic_id=j.topic_id AND n.status IN ('queued','running')) ORDER BY j.rowid").all();
  for(const row of rows){
   const p=parse(row);let topic,proof;
   try{
    topic=research.get(row.topic_id);
    if(topic.status!=='active'||topic.dossier?.sourceModelRun?.id!==row.run_id||p.configHash!==configHash()||store.newsById(p.newsId)?.revision!==p.newsRevision||!['completed','observing'].includes(db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(row.item_id)?.status))continue;
    const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));
    if(run?.status!=='adopted'||run.actor?.kind!==SYSTEM_RESEARCH_ACTOR.kind||run.actor.policy!==SYSTEM_RESEARCH_ACTOR.policy||run.acceptedVersion!==topic.version)continue;
    validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
    for(const c of topic.companies){
     const candidate=financialRecoveryCandidate(db,topic,c.symbol);if(!candidate)continue;
     if(db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND json_extract(payload,'$.financialFollowup.proof.scopeHash')=?").get(topic.id,candidate.scopeHash))continue;
     proof=candidate;break;
    }
   }catch{continue;}
   if(!proof)continue;
   const id=digest({kind:FINANCIAL_RECOVERY_VERSION,topicId:topic.id,scopeHash:proof.scopeHash}),packet=automaticResearchPacket(research.packet(topic.id)),old=p.financial||{attempts:[],results:[]};
   const attempts=[...old.attempts],origin=parse(db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(proof.originJobId));
   for(const a of origin.financial.attempts.filter(x=>x.symbol===proof.symbol))if(!attempts.some(x=>digest(x)===digest(a)))attempts.push(a);
   const payload={...p,topicVersion:topic.version,packet,eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),executionHash:fingerprint('dossier',packet),createdAt:new Date(now()).toISOString(),retryAt:null,previousRunId:null,reason:'财务读取能力已修复，后台限次接续原补证；旧失败与研判保留',financial:{...old,results:old.results.filter(x=>x.symbol!==proof.symbol),attempts},financialFollowup:{schema:FINANCIAL_RECOVERY_VERSION,sourceJobId:row.id,baseVersion:topic.version,baseRunId:row.run_id,baseHash:digest(topic),proof,preparations:[]}};
   for(const key of ['monitoringFollowup','identityFollowup','documentFollowup','documentScopeChanged','documentPreparation','adoptedVersion','finishedAt','relationCoverage'])delete payload[key];
   const job={id,item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued'};
   transaction(()=>{context.assertActive();guard();if(!settings().automatic||!settings().financialSources||used()>=settings().dailyCalls||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload||digest(research.get(topic.id))!==payload.financialFollowup.baseHash)throw Error('财务恢复依据已变化');insert(job,payload);valid({...job,payload:JSON.stringify(payload)});audit(row.item_id,'financial-research-prepared',{jobId:id,sourceJobId:row.id,symbol:proof.symbol,capability:proof.capability,scopeHash:proof.scopeHash});});
   return {ok:true,financialResearchJobId:id};
  }
  return null;
 }};
}
