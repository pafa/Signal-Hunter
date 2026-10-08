import {digest} from './codex-research.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {validateComparisonCandidate} from './semantic-events.mjs';
const ref=m=>({kind:'event',id:m.id,revision:1});
const same=new Set(['repeat','followup','reversal']);

// A source revision may retire a scoped occurrence, never its research history.
// All revised alternatives are compared with the retained members before one
// unambiguous successor is chosen for each old occurrence.
export function openPipelineSuccession({store,research,semantic,batches,clusters,now,guard,transaction,audit}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 const assigned=id=>db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${id}`)?.cluster_id||null;
 function originalBasis(c){
  const {history,health,snapshotHash,...record}=c;if(snapshotHash!==digest(record))throw Error('原事件簇快照已变化');
  if(c.status!=='active')throw Error('事件簇已归档');
  for(const pair of c.pairs){
   const r=semantic.get(pair.basis.runId);validateComparisonCandidate(r.candidate,r.packet,r.model);
   const basis={runId:r.id,inputHash:r.packet.inputHash,outputHash:r.candidate.trace.outputHash,model:r.model,promptVersion:r.candidate.trace.promptVersion,decisionVersion:r.decisionVersion,comparison:r.candidate.comparison};
   if(r.status!=='candidate'||!same.has(r.candidate.comparison.relation)||r.decision&&(r.decision.runId!==r.id||r.decision.action!=='accept')||digest(basis)!==digest(pair.basis))throw Error('原归组决定或比较已变化');
  }
 }
 function source(id){
  const row=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE id=? AND kind='extract'").get(id),p=row&&JSON.parse(row.payload);
  if(!row||!p.automatic||row.status!=='completed'||store.newsById(p.newsId)?.revision!==p.newsRevision)throw Error('修订来源尚未完成或已经变化');
  const run=JSON.parse(db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(row.run_id)?.payload||'null');
  if(!run||run.status!=='candidate')throw Error('事项拆分不可用');
  const latest=new Map();for(const r of db.prepare('SELECT event_index,payload FROM material_event_decisions WHERE run_id=? ORDER BY version').all(row.run_id))latest.set(r.event_index,JSON.parse(r.payload));
  const topics=[];
  for(let i=0;i<run.candidate.decomposition.events.length;i++){
   const d=latest.get(i);if(d?.action!=='create'||d.actor?.kind!=='system')throw Error('新版事项尚未自动完成或已有本人决定');
   const job=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier'").get(d.topicId),j=job&&JSON.parse(job.payload),t=research.get(d.topicId);
   if(!job||job.status!=='completed'||!j.automatic||t.version!==j.adoptedVersion||t.dossier?.sourceModelRun?.id!==job.run_id)throw Error('新版研究尚未完成或已经编辑');
   const m=eventComparisonSnapshot(db,ref(t));
   if(m.documentId!==p.packet.input.material.documentId||m.materialRevision!==p.packet.input.material.revision)throw Error('新版事项来源不匹配');
   topics.push({id:t.id,version:t.version,title:t.title,eventHash:digest(m),assigned:assigned(t.id)});
  }
  return {jobId:row.id,itemId:row.item_id,newsId:p.newsId,newsRevision:p.newsRevision,documentId:p.packet.input.material.documentId,materialRevision:p.packet.input.material.revision,topics};
 }
 function valid(p){
  const c=clusters.get(p.clusterId);originalBasis(c);
  if(c.snapshotHash!==p.clusterHash)throw Error('事件簇已有新版本');
  for(const s of p.sources)if(digest(source(s.jobId))!==digest(s))throw Error('修订输入或研究版本已变化');
  for(const m of p.retained)if(digest(eventComparisonSnapshot(db,ref(m)))!==m.eventHash)throw Error('保留成员依据已有变化');
  return c;
 }
 function scan(context){
  // Serialize running plans; a paused plan protects its own cluster without
  // preventing unrelated events from continuing in the background.
  if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs j JOIN semantic_batches b ON b.id=j.batch_id WHERE j.status='active' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(b.payload,'$.state')='active'").get())return;
  const latest=new Map();
  for(const r of db.prepare("SELECT id,payload FROM research_pipeline_event_jobs WHERE kind='extract' AND status='completed' AND json_extract(payload,'$.automatic')=1 ORDER BY rowid").all()){
   const p=JSON.parse(r.payload),m=p.packet.input.material,old=latest.get(m.documentId);
   if(!old||m.revision>old.revision)latest.set(m.documentId,{id:r.id,revision:m.revision});
  }
  for(const row of db.prepare("SELECT id,payload FROM event_clusters WHERE status='active' ORDER BY rowid").all()){
   context.assertActive();guard();const record=JSON.parse(row.payload);
   if(record.members.some(m=>m.kind!=='event'))continue;
   const replaced=record.members.filter(m=>latest.get(m.documentId)?.revision>m.materialRevision);if(!replaced.length)continue;
   if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE status='active' AND json_extract(payload,'$.clusterId')=?").get(row.id))continue;
   const c=clusters.get(row.id);
   const ids=[...new Set(replaced.map(m=>latest.get(m.documentId).id))].sort(),id=digest({kind:'automatic-succession-1',cluster:c.snapshotHash,sources:ids});
   if(db.prepare('SELECT 1 FROM research_pipeline_cluster_jobs WHERE id=?').get(id))continue;
   let sources;try{sources=ids.map(source);}catch{continue;} // Other lanes still finish these dossiers.
   const p={automatic:true,mode:'replace',clusterId:c.id,clusterVersion:c.version,clusterHash:c.snapshotHash,clusterTitle:c.title,sourceId:sources[0].topics[0]?.id||replaced[0].id,sourceTitle:'来源修订 · '+c.title,newsId:sources[0].newsId,newsRevision:sources[0].newsRevision,sources,replaced:replaced.map(m=>({id:m.id,documentId:m.documentId,materialRevision:m.materialRevision})),retained:[],createdAt:at()};
   let inputs,plan,reason='原归组决定、当前材料或成员分配已有变化';
   try{
    originalBasis(c);
    p.retained=c.members.filter(m=>!replaced.some(r=>r.id===m.id)).map(m=>({id:m.id,eventHash:digest(eventComparisonSnapshot(db,ref(m)))}));
    reason='原成员均有修订，尚无可用的保留事项核对事件延续；旧历史保留';if(!p.retained.length)throw Error();
    reason='同一文档在旧簇中有多个事项，对应关系无法唯一确定';if(new Set(p.replaced.map(m=>m.documentId)).size!==p.replaced.length)throw Error();
    // Match the original new-source-first comparison direction so valid runs reuse their decisions.
    inputs=[...sources.flatMap(s=>s.topics.map(ref)),...p.retained.map(ref)];
    reason='修订后没有完整事项，或完整比较超过10份输入；保留观察，不截断候选';if(inputs.length<2||inputs.length>10||sources.some(s=>!s.topics.length))throw Error();
    reason='新旧材料或成员依据已经变化';valid(p);plan=batches.preview({inputs});
   }catch{
    transaction(()=>{context.assertActive();guard();db.prepare('INSERT OR IGNORE INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,id,'observing',JSON.stringify({...p,reason}));audit(id,'automatic-succession-observing',{clusterId:c.id,reason});});continue;
   }
   const existing=db.prepare("SELECT run_id FROM research_pipeline_relations WHERE run_id IS NOT NULL AND json_extract(payload,'$.source.id') IN (SELECT value FROM json_each(?))").all(JSON.stringify(sources.flatMap(s=>s.topics.map(t=>t.id)))).map(r=>r.run_id);
   batches.create({inputs,planHash:plan.planHash,requestId:id},{owner:'research-pipeline',reuseRunIds:[...new Set([...existing,...c.pairs.map(pair=>pair.basis.runId)])],beforeCommit:batch=>{
    context.assertActive();guard();valid(p);db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,?,?)').run(id,id,'active',batch.id,JSON.stringify(p));audit(id,'automatic-succession-planned',{clusterId:c.id,batchId:batch.id,sourceRevisions:sources.map(s=>({documentId:s.documentId,revision:s.materialRevision}))});
   }});return;
  }
 }
 function replacement(p,batch){
  const preview=clusters.preview(batch.id),retained=new Set(p.retained.map(m=>m.id));
  const choices=preview.groups.filter(g=>g.state==='ready'&&[...retained].every(id=>g.members.some(m=>m.id===id))).flatMap(group=>{
   const replacements=[];
   for(const old of p.replaced){const candidates=group.members.filter(m=>!retained.has(m.id)&&m.documentId===old.documentId&&m.materialRevision>old.materialRevision);if(candidates.length!==1)return [];replacements.push({beforeId:old.id,afterId:candidates[0].id});}
   if(group.members.length!==retained.size+replacements.length)return [];
   try{const input={batchId:batch.id,groupId:group.id,version:p.clusterVersion,replacements};return [{...input,previewHash:clusters.replacementPreview(p.clusterId,input).previewHash}];}catch{return [];}
  });
  return choices.length===1?choices[0]:null;
 }
 return {scan,valid,replacement};
}
