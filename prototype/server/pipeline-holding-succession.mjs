import {digest} from './codex-research.mjs';
import {revisionSource,revisionMembers,revisionMappingResult} from './revision-comparison.mjs';
import {pipelineRevisionSource} from './pipeline-revision-source.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {readSnapshotCache} from './read-snapshot-cache.mjs';
const ref=m=>({kind:'event',id:m.id,revision:1});
// Standalone research uses the same durable batch, lease, retry, pause and quota
// as cluster succession. The result is a monitoring link, never a one-item
// cluster or a mutation of a holding, opening research, order or cost.
export function openHoldingSuccession({store,research,batches,semantic,clusters,holdingReferences,now,guard,transaction,audit}){
 const db=store.db,at=()=>new Date(now()).toISOString(),memo=readSnapshotCache(db,{limit:32,maxBytes:1024*1024});
 const held=()=>new Set(holdingReferences().map(r=>r.topicId));
 const source=id=>pipelineRevisionSource(store,research,id);
 const clustered=t=>clusters.forResearch(t).some(c=>c.status==='active');
 function valid(p){
  const members=revisionMembers(store,p.revision),ids=held();
  if(!members.some(m=>ids.has(m.id)&&!clustered(research.get(m.id))))throw Error('原事项已无待接续持仓，或已进入事件簇');
  if(digest(source(p.source.jobId))!==digest(p.source))throw Error('新版来源或研究版本已变化');
 }
 function observe(context,id,p,reason){
  transaction(()=>{context.assertActive();guard();db.prepare('INSERT OR IGNORE INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,id,'observing',JSON.stringify({...p,reason}));audit(id,'holding-succession-observing',{reason,title:p.sourceTitle});});
 }
 function scan(context){
  if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs j JOIN semantic_batches b ON b.id=j.batch_id WHERE j.status='active' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(b.payload,'$.state')='active'").get())return;
  const origins=new Set();
  for(const id of held()){
   let t;try{t=research.get(id);}catch{continue;}
   if(t.eventExtraction?.actor?.kind==='system'&&t.status==='active'&&!clustered(t))origins.add(t.eventExtraction.runId);
  }
  for(const sourceRunId of origins){
   context.assertActive();guard();
   if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE status='active' AND json_extract(payload,'$.mode')='holding-revision' AND json_extract(payload,'$.revision.sourceRunId')=?").get(sourceRunId))continue;
   let before;try{before=revisionSource(store,sourceRunId);}catch{continue;}
   const row=db.prepare("SELECT id FROM research_pipeline_event_jobs WHERE kind='extract' AND json_extract(payload,'$.automatic')=1 AND json_extract(payload,'$.packet.input.material.documentId')=? AND json_extract(payload,'$.packet.input.material.revision')>? ORDER BY json_extract(payload,'$.packet.input.material.revision') DESC,rowid DESC LIMIT 1").get(before.members[0].documentId,before.members[0].materialRevision);
   if(!row)continue;
   const revision={sourceRunId,sourceHash:before.sourceHash},id=digest({kind:'holding-source-revision-1',revision,newSourceJobId:row.id});
   if(db.prepare('SELECT 1 FROM research_pipeline_cluster_jobs WHERE id=?').get(id))continue;
   const p={automatic:true,mode:'holding-revision',revision,previousIds:before.members.map(m=>m.id),sourceId:before.members[0].id,sourceTitle:'持仓来源修订 · '+before.members[0].title,createdAt:at()};
   try{p.source=source(row.id);}catch(error){if(!error.pending)observe(context,id,p,error.message);continue;}
   if(!p.source.topics.length){observe(context,id,p,'新版没有完整具体事项，原持仓保留观察');continue;}
   Object.assign(p,{newsId:p.source.newsId,newsRevision:p.source.newsRevision});
   const inputs=[...before.members.map(ref),...p.source.topics.map(ref)];let plan;
   try{valid(p);plan=batches.previewRevision({inputs},revision,SYSTEM_RESEARCH_ACTOR);}catch{observe(context,id,p,'新旧完整事项或来源依据无法核对，原持仓保留观察');continue;}
   batches.create({inputs,planHash:plan.planHash,requestId:id},{owner:'research-pipeline',actor:SYSTEM_RESEARCH_ACTOR,revision,beforeCommit:batch=>{
    context.assertActive();guard();valid(p);db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,?,?)').run(id,id,'active',batch.id,JSON.stringify(p));audit(id,'holding-succession-planned',{batchId:batch.id,title:p.sourceTitle,oldCount:before.members.length,newCount:p.source.topics.length});
   }});return;
  }
 }
 function complete(row,p,batch,beforeCommit){
  const evidence=revisionMappingResult(batch,semantic);if(!evidence)return false;
  transaction(()=>{beforeCommit();if(digest(revisionMappingResult(batches.get(batch.id),semantic))!==digest(evidence))throw Error('新旧事项对应依据已变化');db.prepare("UPDATE research_pipeline_cluster_jobs SET status='completed',payload=? WHERE id=?").run(JSON.stringify({...p,evidenceHash:digest(evidence),mappings:evidence.mappings,reason:'新旧事项完整且唯一对应，持仓监控自动接续；建仓依据保留'}),row.id);audit(row.id,'holding-succession-completed',{batchId:batch.id,title:p.sourceTitle,mappings:evidence.mappings});});return true;
 }
 function links(ids){
  const wanted=[...new Set(ids)].sort();if(!wanted.length)return {};
  return memo(JSON.stringify(wanted),()=>{
   const result={},choices=new Map();
   for(const row of db.prepare("SELECT * FROM research_pipeline_cluster_jobs WHERE json_extract(payload,'$.mode')='holding-revision' ORDER BY rowid").all()){
    const p=JSON.parse(row.payload),origins=p.previousIds.filter(id=>wanted.includes(id));if(!origins.length)continue;
    let evidence;try{if(row.status==='completed'){evidence=revisionMappingResult(batches.get(row.batch_id),semantic);if(!evidence||digest(evidence)!==p.evidenceHash)throw Error();}}catch{evidence=null;}
    for(const id of origins){
     if(evidence){const matches=evidence.mappings.filter(m=>m.beforeId===id);if(matches.length===1){const values=choices.get(id)||[];values.push({status:'current',topicId:matches[0].afterId,jobId:row.id,batchId:row.batch_id,sourceHash:p.revision.sourceHash});choices.set(id,values);}}
     result[id]={status:'waiting',jobId:row.id,batchId:row.batch_id,reason:row.status==='completed'?'新旧事项对应依据已变化，等待后台重新核对':p.reason||'后台正在比较新旧事项，原持仓与价格风险继续跟踪'};
    }
   }
   for(const [id,values] of choices)result[id]=values.length===1?values[0]:{status:'waiting',reason:'新旧事项存在多个有效接续，不能唯一判断'};
   return result;
  });
 }
 return {scan,valid,complete,links};
}
