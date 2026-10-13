import {digest} from './codex-research.mjs';
import {companyEntitiesPacket} from './company-entities.mjs';
import {identityDirectoryScope} from './pipeline-identity-followup.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
const parse=row=>row&&JSON.parse(row.payload);

// Reuse the existing identity and dossier lanes, retry budgets and history.
// One archived body is a scope; completed or exhausted scopes are not reset.
export function openAttachmentIdentities(store,research,{entities,directories,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid}){
 const db=store.db;
 return {step(context){
  if(!entities||!directories||!settings().automatic||used()>=settings().dailyCalls)return null;
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j JOIN research_topics t ON t.id=j.topic_id WHERE j.kind='dossier' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(j.payload,'$.adoptedVersion')=json_extract(t.payload,'$.version') AND json_type(t.payload,'$.documentContext')='object' AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs n WHERE n.topic_id=j.topic_id AND n.status IN ('queued','running')) ORDER BY j.rowid").all();
  for(const source of rows){
   const base=parse(source);let topic;
   try{
    topic=research.get(source.topic_id);
    if(topic.status!=='active'||topic.dossier?.sourceModelRun?.id!==source.run_id||base.configHash!==configHash()||store.newsById(base.newsId)?.revision!==base.newsRevision||!['completed','observing'].includes(db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(source.item_id)?.status))continue;
    const decisions=db.prepare('SELECT d.payload FROM company_entity_decisions d JOIN company_entity_runs r ON r.id=d.run_id WHERE r.topic_id=?').all(topic.id).map(parse);
    if(decisions.some(d=>d.actor?.kind!==SYSTEM_RESEARCH_ACTOR.kind||d.actor?.policy!==SYSTEM_RESEARCH_ACTOR.policy))continue;
    const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(source.run_id));if(run?.status!=='adopted'||run.actor?.policy!==SYSTEM_RESEARCH_ACTOR.policy||run.acceptedVersion!==topic.version)continue;validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
   }catch{continue;}
   for(const e of topic.evidence.filter(e=>e.documentRole==='linked-attachment')){
    if(db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='identity' AND json_extract(payload,'$.request.materialId')=? AND json_extract(payload,'$.request.revision')=?").get(topic.id,e.materialId,e.materialRevision))continue;
    let packet;const request={version:topic.version,materialId:e.materialId,revision:e.materialRevision,directoryBasis:directories.freezeBasis()};
    try{packet=companyEntitiesPacket(store,research,topic.id,request);}catch{continue;}
    const scopeHash=identityDirectoryScope(packet),id=digest({kind:'attachment-identity/1',topicId:topic.id,scopeHash}),payload={researchPrices:!!base.researchPrices,financialSources:!!base.financialSources,automatic:true,newsId:base.newsId,newsRevision:base.newsRevision,title:topic.title,topicVersion:topic.version,parentJobId:source.id,request,packet,configHash:configHash(),executionHash:fingerprint('identity',packet),createdAt:new Date(now()).toISOString(),reason:'已读附件进入主体核对，先判断与原事项的关系，再核对证券',identityFollowup:{schema:'identity-research/1',trigger:'attachment-body',scopeHash,previousIdentityJobId:null,sourceJobId:source.id,baseVersion:topic.version,baseRunId:source.run_id,baseHash:digest(topic)}};
    const row={id,item_id:source.item_id,topic_id:topic.id,kind:'identity',status:'queued'};
    transaction(()=>{context.assertActive();guard();if(!settings().automatic||used()>=settings().dailyCalls||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(source.id)?.payload!==source.payload||digest(research.get(topic.id))!==payload.identityFollowup.baseHash)throw Error('附件身份接续依据已变化');valid({...row,payload:JSON.stringify(payload)});insert(row,payload);audit(source.item_id,'attachment-identity-prepared',{jobId:id,sourceJobId:source.id,topicId:topic.id,materialId:e.materialId,revision:e.materialRevision});});
    return {ok:true,attachmentIdentityJobId:id};
   }
  }
  return null;
 }};
}
