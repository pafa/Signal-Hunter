import {digest} from './codex-research.mjs';
const same=new Set(['repeat','followup','reversal']);
const ref=m=>({id:m.id,revision:m.revision,...(m.kind?{kind:m.kind}:{})});
// Builds reviewable complete-pair batches; never confirms or changes a cluster.
export function openPipelineClusters(store,research,semantic,batches,clusters,{now,guard,transaction,audit,used,settings}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_cluster_jobs(id TEXT PRIMARY KEY,relation_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,batch_id TEXT,payload TEXT NOT NULL);`);
 const read=id=>db.prepare('SELECT * FROM research_pipeline_cluster_jobs WHERE id=?').get(id);
 const candidate=id=>{const r=semantic.get(id);if(r.status!=='candidate'||r.stale||!same.has(r.candidate.comparison.relation)||r.decision&&(r.decision.runId!==r.id||r.decision.action!=='accept'))throw Error('比较依据已失效或不支持同一事件');return r;};
 function valid(p){
  const c=clusters.get(p.clusterId),t=research.get(p.sourceId),r=candidate(p.runId);
  if(c.status!=='active'||!c.health.current||c.snapshotHash!==p.clusterHash||t.status!=='active'||t.version!==p.sourceVersion||store.newsById(p.newsId)?.revision!==p.newsRevision||digest({input:r.packet.inputHash,output:r.candidate.trace.outputHash,decision:r.decision})!==p.triggerHash)throw Error('事件簇、来源或比较决定已变化');
  const assigned=db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${t.id}`);if(assigned)throw Error('新事项已分配事件簇');
 }
 function scan(context){
  const rows=db.prepare(`SELECT r.* FROM research_pipeline_relations r JOIN semantic_runs s ON s.id=r.run_id WHERE s.status='candidate' AND json_extract(r.payload,'$.clusterExpansion')='reviewed-increment-1' AND NOT EXISTS(SELECT 1 FROM research_pipeline_cluster_jobs j WHERE j.relation_id=r.id) ORDER BY r.rowid LIMIT 20`).all();
  for(const row of rows){
   context.assertActive();guard();const source=JSON.parse(row.payload),p={sourceId:source.source.id,sourceVersion:source.source.version,sourceTitle:source.source.title,newsId:source.newsId,newsRevision:source.newsRevision,runId:row.run_id,createdAt:at()},id=digest({relation:row.id,kind:'cluster-expansion'});
   let cluster,run,plan,input,reason='比较依据失效或不支持同一事件';
   try{
    run=candidate(row.run_id);if(run.packet.input.left.kind!=='event'||run.packet.input.right.kind!=='event'||run.packet.input.left.id!==p.sourceId||run.packet.input.right.id!==source.target.id)throw Error();
    reason='目标事项尚不属于已确认事件簇';
    const membership=db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${source.target.id}`);if(!membership)throw Error();
    cluster=clusters.get(membership.cluster_id);Object.assign(p,{clusterId:cluster.id,clusterVersion:cluster.version,clusterTitle:cluster.title,clusterHash:cluster.snapshotHash,triggerHash:digest({input:run.packet.inputHash,output:run.candidate.trace.outputHash,decision:run.decision})});
    reason='事件簇或来源依据变化，或新事项已经归簇';valid(p);reason='扩展后超过10份输入，保留原簇全部成员，不截断';if(cluster.members.length>=10)throw Error();
    reason='此事项针对同一事件簇版本已有扩展计划';
    if(db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE batch_id IS NOT NULL AND json_extract(payload,'$.sourceId')=? AND json_extract(payload,'$.clusterHash')=?").get(p.sourceId,p.clusterHash))throw Error();
    reason='完整成员的配对输入已失效，需重新核对';input=[ref(run.packet.input.left),...cluster.members.map(ref)];plan=batches.preview({inputs:input});
   }catch{
    transaction(()=>{context.assertActive();db.prepare('INSERT OR IGNORE INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,row.id,'skipped',JSON.stringify({...p,reason}));});continue;
   }
   const relatedRuns=db.prepare("SELECT run_id FROM research_pipeline_relations WHERE run_id IS NOT NULL AND json_extract(payload,'$.source.id')=? ORDER BY rowid DESC LIMIT 3").all(p.sourceId).map(r=>r.run_id);
   const reuseRunIds=[...new Set([row.run_id,...cluster.pairs.map(pair=>pair.basis.runId),...relatedRuns])];
   batches.create({inputs:input,planHash:plan.planHash,requestId:id},{owner:'research-pipeline',reuseRunIds,beforeCommit:batch=>{
    context.assertActive();guard();valid(p);
    db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,?,?)').run(id,row.id,'active',batch.id,JSON.stringify(p));audit(id,'cluster-expansion-planned',{clusterId:cluster.id,batchId:batch.id,planHash:plan.planHash});
   }});
  }
 }
 return {
  snapshot(){return {items:db.prepare('SELECT * FROM research_pipeline_cluster_jobs ORDER BY rowid DESC LIMIT 30').all().map(row=>{
   const p=JSON.parse(row.payload),batch=row.batch_id?batches.get(row.batch_id):null;let stale=false,confirmedVersion=null;
   if(batch){const confirmed=clusters.get(p.clusterId).history.find(v=>{const {snapshotHash,...record}=v;return v.batchId===row.batch_id&&v.version>p.clusterVersion&&v.members.some(m=>m.kind==='event'&&m.id===p.sourceId)&&snapshotHash===digest(record);});confirmedVersion=confirmed?.version||null;if(!confirmedVersion)try{valid(p);}catch{stale=true;}}
   return {id:row.id,...p,batchId:row.batch_id,status:confirmedVersion?'confirmed':row.status==='active'?batch.state:row.status,confirmedVersion,stale,counts:batch?.counts||null,reusedPairs:batch?.items.filter(i=>i.reusedRunId).length||0};})};},
  step(context){
   context.assertActive();guard();scan(context);
   const rows=db.prepare("SELECT * FROM research_pipeline_cluster_jobs WHERE status='active' ORDER BY rowid").all();
   for(const row of rows){
    const batch=batches.get(row.batch_id);if(batch.state!=='active')continue;
    const p=JSON.parse(row.payload);
    try{valid(p);}catch{batches.control(row.batch_id,{action:'pause'});transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_cluster_jobs SET status='invalidated' WHERE id=?").run(row.id);audit(row.id,'cluster-expansion-invalidated');});return {ok:true,invalidated:true};}
    if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
    return batches.step(context,{batchId:row.batch_id,beforeCommit:run=>{
     context.assertActive();guard();valid(p);if(read(row.id).status!=='active'||used()>=settings().dailyCalls)throw Error('自动研究队列或调用额度已变化');
     db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());audit(row.id,'cluster-comparison-started',{batchId:row.batch_id,runId:run.id});
    }});
   }
   return null;
  }
 };
}
