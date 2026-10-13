import {digest} from './codex-research.mjs';
import {automaticResearchPacket} from './research-output-contract.mjs';
import {linkedDocumentContext,documentScope} from './research-document-context.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';

// Append another generation to the existing dossier queue. No new model lane,
// approval inbox or mutable copy of the public source is introduced.
export function openDocumentFollowup(store,research,{now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid}){
 const db=store.db,parse=row=>JSON.parse(row.payload);
 return {step(context){
  if(!settings().automatic||used()>=settings().dailyCalls)return null;
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j JOIN research_topics t ON t.id=j.topic_id WHERE j.kind='dossier' AND (j.status='completed' OR j.status='observing' AND json_extract(j.payload,'$.documentScopeChanged')=1) AND json_extract(j.payload,'$.automatic')=1 AND json_extract(t.payload,'$.version')=CASE WHEN j.status='completed' THEN json_extract(j.payload,'$.adoptedVersion') ELSE json_extract(j.payload,'$.topicVersion') END AND EXISTS(SELECT 1 FROM json_each(j.payload,'$.packet.input.evidence') e WHERE json_array_length(json_extract(e.value,'$.material.extractionEvidence.attachments'))>0) ORDER BY j.rowid").all();
  for(const row of rows){
   const p=parse(row);let topic,packet,documents;
   try{
    topic=research.get(row.topic_id);
    // Identity linking and financial recovery own their next topic versions.
    // Importing documents here would invalidate that pending preparation.
    if(db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND status IN ('queued','running') AND ((kind='identity' AND json_type(payload,'$.identityFollowup')='object') OR (kind='dossier' AND (json_type(payload,'$.financialFollowup')='object' OR json_type(payload,'$.monitoringFollowup')='object')))").get(topic.id))continue;
    if(topic.status!=='active'||topic.version!==(row.status==='completed'?p.adoptedVersion:p.topicVersion)||topic.dossier?.sourceModelRun?.id!==(row.status==='completed'?row.run_id:(p.documentFollowup||p.identityFollowup||p.financialFollowup||p.monitoringFollowup)?.baseRunId)||p.configHash!==configHash()||store.newsById(p.newsId)?.revision!==p.newsRevision)continue;
    if(!topic.evidence.some(e=>e.materialId))continue;
    const owner=db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(row.item_id);if(!['completed','observing'].includes(owner?.status))continue;
    packet=research.packet(topic.id);
    if(!packet.input.evidence.some(e=>e.material?.extractionEvidence?.attachments?.length))continue;
    documents=linkedDocumentContext(store,research,[{topic,packet}]);
    if(!documents||!topic.documentContext&&!documents.documents.length)continue;
    // A new body is a concrete reason to reanalyse. Unread/error wording alone
    // cannot repeatedly consume calls or restart an exhausted generation.
    if(topic.documentContext&&digest(documentScope(topic.documentContext))===digest(documentScope(documents)))continue;
   }catch{continue;}
   const id=digest({kind:'document-research/1',topicId:topic.id,version:topic.version,context:documents});
   if(db.prepare('SELECT 1 FROM research_pipeline_event_jobs WHERE id=?').get(id))continue;
   const scopeHash=digest(documents),prior=p.documentPreparation?.scopeHash===scopeHash?p.documentPreparation:null;
   if(prior&&(prior.attempts>=3||prior.retryAt>now()))continue;
   const baseVersion=topic.version,baseHash=digest(topic),baseRunId=topic.dossier.sourceModelRun.id;
   try{
    research.prepareDocumentResearch(topic.id,{version:baseVersion,context:documents,sourceJobId:row.id,baseRunId},SYSTEM_RESEARCH_ACTOR,()=>{
     context.assertActive();guard();if(!settings().automatic||used()>=settings().dailyCalls||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload||digest(linkedDocumentContext(store,research,[{topic:research.get(topic.id),packet:research.packet(topic.id)}]))!==digest(documents))throw Error('附件准备依据已变化');
    },prepared=>{
     const packet=automaticResearchPacket(research.packet(topic.id)),payload={...p,topicVersion:prepared.version,packet,executionHash:fingerprint('dossier',packet),eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),createdAt:new Date(now()).toISOString(),reason:'已读附件进入原事项，后台自动更新研判',documentFollowup:{schema:'document-research/1',sourceJobId:row.id,baseVersion,baseRunId,baseHash,preparedHash:digest(prepared)},retryAt:null,previousRunId:null};
     delete payload.identityFollowup;delete payload.financialFollowup;delete payload.monitoringFollowup;delete payload.documentScopeChanged;delete payload.documentPreparation;delete payload.adoptedVersion;delete payload.finishedAt;delete payload.relationCoverage;
     const job={id,item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued',payload};insert(job,payload);valid({...job,payload:JSON.stringify(payload)});audit(row.item_id,'document-research-prepared',{jobId:id,sourceJobId:row.id,topicId:topic.id,version:prepared.version,documents:documents.documents.length});
    });
   }catch(error){
    // The preparation and new queue row commit together; no partial material
    // import can leave the old dossier silently current after a failed write.
    transaction(()=>{context.assertActive();guard();if(db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload)return;const attempts=(prior?.attempts||0)+1,reason=attempts>=3?'附件接续准备已达3次尝试，保留缺口；其他研究继续':'附件接续准备未完成，后台限次重试；原研究保留';db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify({...p,documentPreparation:{scopeHash,attempts,retryAt:now()+60000*2**(attempts-1),reason}}),row.id);audit(row.item_id,'document-research-unavailable',{sourceJobId:row.id,reason,attempts});});
    return {skipped:'document-preparation-unavailable'};
   }
   return {ok:true,documentResearchJobId:id};
  }
  return null;
 }};
}
