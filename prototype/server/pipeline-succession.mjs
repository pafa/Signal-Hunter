import {pipelineRevisionSource} from './pipeline-revision-source.mjs';
import {revisionMappingResult} from './revision-comparison.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {digest} from './codex-research.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {validateComparisonCandidate} from './semantic-events.mjs';
const ref=m=>({kind:'event',id:m.id,revision:1});
const same=new Set(['repeat','followup','reversal']);

// A source revision may retire a scoped occurrence, never its research history.
// A retained-member comparison or full historical correspondence matrix must
// establish unique successors before current members pass complete pairing.
export function openPipelineSuccession({store,research,semantic,batches,clusters,now,guard,transaction,audit}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 function originalBasis(c){
  const {history,health,snapshotHash,...record}=c;if(snapshotHash!==digest(record))throw Error('原事件簇快照已变化');
  if(c.status!=='active')throw Error('事件簇已归档');
  for(const pair of [...c.pairs,...(c.replacement?.correspondence?.pairs||[])]){
   const r=semantic.get(pair.basis.runId);validateComparisonCandidate(r.candidate,r.packet,r.model);
   const basis={runId:r.id,inputHash:r.packet.inputHash,outputHash:r.candidate.trace.outputHash,model:r.model,promptVersion:r.candidate.trace.promptVersion,decisionVersion:r.decisionVersion,comparison:r.candidate.comparison};
   if(r.status!=='candidate'||c.pairs.includes(pair)&&!same.has(r.candidate.comparison.relation)||r.decision&&(r.decision.runId!==r.id||r.decision.action!=='accept')||digest(basis)!==digest(pair.basis))throw Error('原归组决定或比较已变化');
  }
 }
 const source=id=>pipelineRevisionSource(store,research,id);
 function observe(context,id,p,reason){
  transaction(()=>{context.assertActive();guard();db.prepare('INSERT OR IGNORE INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,id,'observing',JSON.stringify({...p,reason}));audit(id,'automatic-succession-observing',{clusterId:p.clusterId,reason});});
 }
 function valid(p){
  const c=clusters.get(p.clusterId);originalBasis(c);
  if(c.snapshotHash!==p.clusterHash)throw Error('事件簇已有新版本');
  for(const s of p.sources)if(digest(source(s.jobId))!==digest(s))throw Error('修订输入或研究版本已变化');
  for(const m of p.retained)if(digest(eventComparisonSnapshot(db,ref(m)))!==m.eventHash)throw Error('保留成员依据已有变化');
  if(p.correspondenceBatchId&&digest(revisionMappingResult(batches.get(p.correspondenceBatchId),semantic))!==p.correspondenceHash)throw Error('新旧对应依据或决定已有变化');
  return c;
 }
 function scan(context){
  // Serialize running plans; a paused plan protects its own cluster without
  // preventing unrelated events from continuing in the background.
  if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs j JOIN semantic_batches b ON b.id=j.batch_id WHERE j.status='active' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(b.payload,'$.state')='active'").get())return;
  const latest=new Map();
  for(const r of db.prepare("SELECT id,payload FROM research_pipeline_event_jobs WHERE kind='extract' AND status IN ('completed','no-signal','observing','cancelled','invalidated') AND json_extract(payload,'$.automatic')=1 ORDER BY rowid").all()){
   const p=JSON.parse(r.payload),m=p.packet.input.material,old=latest.get(m.documentId);
   if(!old||m.revision>old.revision)latest.set(m.documentId,{id:r.id,revision:m.revision});
  }
  for(const row of db.prepare("SELECT id,payload FROM event_clusters WHERE status='active' ORDER BY rowid").all()){
   context.assertActive();guard();const record=JSON.parse(row.payload);
   if(record.members.some(m=>m.kind!=='event'))continue;
   const replaced=record.members.filter(m=>latest.get(m.documentId)?.revision>m.materialRevision);if(!replaced.length)continue;
   if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE status='active' AND json_extract(payload,'$.clusterId')=?").get(row.id))continue;
   const c=clusters.get(row.id);
   const ids=[...new Set(replaced.map(m=>latest.get(m.documentId).id))].sort(),originalId=digest({kind:'automatic-succession-1',cluster:c.snapshotHash,sources:ids});
   const prior=db.prepare('SELECT status,payload FROM research_pipeline_cluster_jobs WHERE id=?').get(originalId),resuming=prior?.status==='observing'&&JSON.parse(prior.payload).automatic===true&&JSON.parse(prior.payload).reason==='修订后没有完整事项，或完整比较超过10份输入；保留观察，不截断候选';
   const id=resuming?digest({previous:originalId,kind:'large-pair-resume'}):originalId;
   if(db.prepare('SELECT 1 FROM research_pipeline_cluster_jobs WHERE id=?').get(id))continue;
   let sources;try{sources=ids.map(source);}catch(error){
    if(!error.pending)observe(context,id,{automatic:true,mode:'replace',clusterId:c.id,clusterVersion:c.version,clusterHash:c.snapshotHash,clusterTitle:c.title,sourceId:replaced[0].id,sourceTitle:'来源修订 · '+c.title,sourceJobIds:ids,createdAt:at()},error.message);
    continue;
   }
   const sourceIds=JSON.stringify(sources.flatMap(s=>s.topics.map(t=>t.id)));
   if(db.prepare("SELECT 1 FROM research_pipeline_relations WHERE json_extract(payload,'$.source.id') IN (SELECT value FROM json_each(?)) AND status IN ('queued','running')").get(sourceIds)||db.prepare("SELECT 1 FROM research_relation_scans WHERE json_extract(payload,'$.source.id') IN (SELECT value FROM json_each(?)) AND status='pending'").get(sourceIds))continue;
   const p={automatic:true,...(resuming?{resumedJobId:originalId}:{}),mode:'replace',clusterId:c.id,clusterVersion:c.version,clusterHash:c.snapshotHash,clusterTitle:c.title,sourceId:sources[0].topics[0]?.id||replaced[0].id,sourceTitle:'来源修订 · '+c.title,newsId:sources[0].newsId,newsRevision:sources[0].newsRevision,sources,replaced:replaced.map(m=>({id:m.id,documentId:m.documentId,materialRevision:m.materialRevision})),retained:[],createdAt:at()};
   let inputs,plan,reason='原归组决定、当前材料或成员分配已有变化';
   try{
    originalBasis(c);
    p.retained=c.members.filter(m=>!replaced.some(r=>r.id===m.id)).map(m=>({id:m.id,eventHash:digest(eventComparisonSnapshot(db,ref(m)))}));
    p.phase=!p.retained.length||new Set(p.replaced.map(m=>m.documentId)).size!==p.replaced.length?'correspondence':'current';
    // Match the original new-source-first comparison direction so valid runs reuse their decisions.
    const newInputs=sources.flatMap(s=>s.topics.map(ref)),order=new Map(db.prepare("SELECT json_extract(payload,'$.source.id') topic_id,rowid FROM research_relation_scans ORDER BY rowid").all().map(r=>[r.topic_id,r.rowid]));
    newInputs.sort((a,b)=>(order.get(b.id)||0)-(order.get(a.id)||0)||a.id.localeCompare(b.id));
    inputs=[...newInputs,...p.retained.map(ref)];
    reason='修订后没有完整事项，保留观察，不截断候选';if(inputs.length<2||sources.some(s=>!s.topics.length))throw Error();
    reason='新旧材料或成员依据已经变化';valid(p);
    if(p.phase==='correspondence'){p.currentInputs=inputs;p.revision={clusterId:c.id,clusterVersion:c.version,clusterHash:c.snapshotHash};inputs=[...p.replaced.map(ref),...sources.flatMap(s=>s.topics.map(ref))];plan=batches.previewRevision({inputs},p.revision,SYSTEM_RESEARCH_ACTOR);}
    else plan=batches.preview({inputs},SYSTEM_RESEARCH_ACTOR);
   }catch{
    observe(context,id,p,reason);continue;
   }
   const existing=db.prepare("SELECT run_id FROM research_pipeline_relations WHERE run_id IS NOT NULL AND json_extract(payload,'$.source.id') IN (SELECT value FROM json_each(?))").all(JSON.stringify(sources.flatMap(s=>s.topics.map(t=>t.id)))).map(r=>r.run_id);
   batches.create({inputs,planHash:plan.planHash,requestId:id},{owner:'research-pipeline',actor:SYSTEM_RESEARCH_ACTOR,revision:p.phase==='correspondence'?p.revision:null,reuseRunIds:[...new Set([...existing,...c.pairs.map(pair=>pair.basis.runId)])],beforeCommit:batch=>{
    context.assertActive();guard();valid(p);db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,?,?)').run(id,id,'active',batch.id,JSON.stringify(p));audit(id,'automatic-succession-planned',{clusterId:c.id,batchId:batch.id,sourceRevisions:sources.map(s=>({documentId:s.documentId,revision:s.materialRevision}))});
   }});return;
  }
 }
 function advanceMapping(context,row,p,batch,beforeCommit){
  const evidence=revisionMappingResult(batch,semantic);if(!evidence)return null;
  const next={...p,phase:'current',correspondenceBatchId:batch.id,correspondenceHash:digest(evidence),mappings:evidence.mappings},plan=batches.preview({inputs:p.currentInputs},SYSTEM_RESEARCH_ACTOR);
  const ids=JSON.stringify(p.currentInputs.map(r=>r.id)),reuseRunIds=db.prepare("SELECT run_id FROM research_pipeline_relations WHERE run_id IS NOT NULL AND json_extract(payload,'$.source.id') IN (SELECT value FROM json_each(?)) AND json_extract(payload,'$.target.id') IN (SELECT value FROM json_each(?)) ORDER BY rowid DESC").all(ids,ids).map(r=>r.run_id);
  return batches.create({inputs:p.currentInputs,planHash:plan.planHash,requestId:digest({job:row.id,phase:'current'})},{owner:'research-pipeline',actor:SYSTEM_RESEARCH_ACTOR,reuseRunIds,beforeCommit:current=>{
   beforeCommit();valid(next);db.prepare('UPDATE research_pipeline_cluster_jobs SET batch_id=?,payload=? WHERE id=?').run(current.id,JSON.stringify(next),row.id);audit(row.id,'automatic-succession-mapped',{clusterId:p.clusterId,mappingBatchId:batch.id,batchId:current.id,mappings:evidence.mappings});
  }});
 }
 function replacement(p,batch){
  const preview=clusters.preview(batch.id),retained=new Set(p.retained.map(m=>m.id));
  const choices=preview.groups.filter(g=>g.state==='ready'&&[...retained].every(id=>g.members.some(m=>m.id===id))).flatMap(group=>{
   const replacements=[];
   for(const old of p.replaced){const candidates=group.members.filter(m=>!retained.has(m.id)&&m.documentId===old.documentId&&m.materialRevision>old.materialRevision&&(!p.mappings||p.mappings.some(link=>link.beforeId===old.id&&link.afterId===m.id)));if(candidates.length!==1)return [];replacements.push({beforeId:old.id,afterId:candidates[0].id});}
   if(group.members.length!==retained.size+replacements.length)return [];
   try{const input={...(p.correspondenceBatchId?{correspondenceBatchId:p.correspondenceBatchId}:{}),batchId:batch.id,groupId:group.id,version:p.clusterVersion,replacements};return [{...input,previewHash:clusters.replacementPreview(p.clusterId,input).previewHash}];}catch{return [];}
  });
  return choices.length===1?choices[0]:null;
 }
 return {scan,valid,replacement,advanceMapping};
}
