import {digest} from './codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {openPipelineSuccession} from './pipeline-succession.mjs';
const same=new Set(['repeat','followup','reversal']);
const ref=m=>({id:m.id,revision:m.revision,...(m.kind?{kind:m.kind}:{})});
// Both modes use complete-pair batches. Only opted-in automatic plans save system clusters.
export function openPipelineClusters(store,research,semantic,batches,clusters,{now,guard,transaction,audit,used,settings}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_cluster_jobs(id TEXT PRIMARY KEY,relation_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,batch_id TEXT,payload TEXT NOT NULL);`);
 const read=id=>db.prepare('SELECT * FROM research_pipeline_cluster_jobs WHERE id=?').get(id);
 const assigned=id=>db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${id}`);
 const candidate=id=>{const r=semantic.get(id);if(r.status!=='candidate'||r.stale||!same.has(r.candidate.comparison.relation)||r.decision&&(r.decision.runId!==r.id||r.decision.action!=='accept'))throw Error('比较依据已失效或不支持同一事件');return r;};
 const triggerHash=r=>digest({input:r.packet.inputHash,output:r.candidate.trace.outputHash,decision:r.decision});
 const succession=openPipelineSuccession({store,research,semantic,batches,clusters,now,guard,transaction,audit});
 function valid(p){
  if(p.mode==='replace')return succession.valid(p);
  const t=research.get(p.sourceId),r=candidate(p.runId);
  if(t.status!=='active'||t.version!==p.sourceVersion||store.newsById(p.newsId)?.revision!==p.newsRevision||triggerHash(r)!==p.triggerHash)throw Error('来源或比较决定已变化');
  if(assigned(t.id))throw Error('新事项已分配事件簇');
  if(p.mode==='create'){
   const target=research.get(p.targetId);
   if(target.status!=='active'||target.version!==p.targetVersion||assigned(target.id))throw Error('目标事项或成员分配已有变化');
  }else{
   const c=clusters.get(p.clusterId);
   if(c.status!=='active'||!c.health.current||c.snapshotHash!==p.clusterHash)throw Error('事件簇或组内比较已有变化');
  }
 }
 function scan(context){
  succession.scan(context);
  const rows=db.prepare(`SELECT r.* FROM research_pipeline_relations r JOIN semantic_runs s ON s.id=r.run_id WHERE s.status='candidate' AND json_extract(r.payload,'$.clusterExpansion')='reviewed-increment-1'
   AND (coalesce(json_extract(r.payload,'$.automatic'),0)!=1 OR r.status='completed')
   AND NOT EXISTS(SELECT 1 FROM research_pipeline_cluster_jobs j WHERE j.relation_id=r.id) ORDER BY r.rowid LIMIT 20`).all();
  for(const row of rows){
   context.assertActive();guard();const source=JSON.parse(row.payload),p={...(source.automatic?{automatic:true}:{}),sourceId:source.source.id,sourceVersion:source.source.version,sourceTitle:source.source.title,newsId:source.newsId,newsRevision:source.newsRevision,runId:row.run_id,createdAt:at()},id=digest({relation:row.id,kind:'cluster-expansion'});
   // Serialize automatic plans so later relations see the newly saved membership.
   if(p.automatic&&db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs j JOIN semantic_batches b ON b.id=j.batch_id WHERE j.status='active' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(b.payload,'$.state')='active'").get())return;
   let cluster,run,plan,input,reason='比较依据失效或不支持同一事件';
   try{
    run=candidate(row.run_id);if(run.packet.input.left.kind!=='event'||run.packet.input.right.kind!=='event'||run.packet.input.left.id!==p.sourceId||run.packet.input.right.id!==source.target.id)throw Error();
    let membership=assigned(source.target.id);
    if(p.automatic&&!membership&&assigned(p.sourceId)){membership=assigned(p.sourceId);Object.assign(p,{sourceId:source.target.id,sourceVersion:source.target.version,sourceTitle:source.target.title});}
    if(membership){
     cluster=clusters.get(membership.cluster_id);Object.assign(p,{clusterId:cluster.id,clusterVersion:cluster.version,clusterTitle:cluster.title,clusterHash:cluster.snapshotHash});
    }else{
     reason='目标事项尚不属于已确认事件簇';if(!p.automatic)throw Error();
     Object.assign(p,{mode:'create',targetId:source.target.id,targetVersion:source.target.version,clusterTitle:source.source.title.slice(0,140)});
    }
    p.triggerHash=triggerHash(run);
    reason='事件簇或来源依据变化，或新事项已经归簇';valid(p);
    reason='扩展后超过10份输入，保留原簇全部成员，不截断';if(cluster?.members.length>=10)throw Error();
    reason='此事项针对同一事件簇版本已有扩展计划';
    if(cluster&&db.prepare("SELECT 1 FROM research_pipeline_cluster_jobs WHERE batch_id IS NOT NULL AND json_extract(payload,'$.sourceId')=? AND json_extract(payload,'$.clusterHash')=?").get(p.sourceId,p.clusterHash))throw Error();
    reason='完整成员的配对输入已失效，保留当前研究';
    input=cluster&&run.packet.input.right.id===p.sourceId?[...cluster.members.map(ref),ref(run.packet.input.right)]:[ref(run.packet.input.left),...(cluster?cluster.members.map(ref):[ref(run.packet.input.right)])];
    plan=batches.preview({inputs:input});
   }catch{
    transaction(()=>{context.assertActive();db.prepare('INSERT OR IGNORE INTO research_pipeline_cluster_jobs VALUES(?,?,?,NULL,?)').run(id,row.id,'skipped',JSON.stringify({...p,reason}));});continue;
   }
   const relatedRuns=db.prepare("SELECT run_id FROM research_pipeline_relations WHERE run_id IS NOT NULL AND json_extract(payload,'$.source.id')=? ORDER BY rowid DESC LIMIT 3").all(p.sourceId).map(r=>r.run_id);
   const reuseRunIds=[...new Set([row.run_id,...(cluster?.pairs||[]).map(pair=>pair.basis.runId),...relatedRuns])];
   batches.create({inputs:input,planHash:plan.planHash,requestId:id},{owner:'research-pipeline',reuseRunIds,beforeCommit:batch=>{
    context.assertActive();guard();valid(p);
    db.prepare('INSERT INTO research_pipeline_cluster_jobs VALUES(?,?,?,?,?)').run(id,row.id,'active',batch.id,JSON.stringify(p));audit(id,'cluster-expansion-planned',{clusterId:cluster?.id||null,batchId:batch.id,planHash:plan.planHash,automatic:!!p.automatic});
   }});
  }
 }
 function active(context,row,p){
  context.assertActive();guard();valid(p);
  if(read(row.id)?.status!=='active'||['paused','cancelled'].includes(batches.get(row.batch_id).state))throw Error('自动归组已暂停或状态变化');
 }
 function finish(context,row,p,status,reason){
  // Stop remaining batch work and record the terminal outcome in the same transaction.
  const save=()=>{context.assertActive();guard();if(read(row.id)?.status!=='active')throw Error('自动归组状态变化');
   db.prepare('UPDATE research_pipeline_cluster_jobs SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...p,reason}),row.id);
   audit(row.id,'automatic-cluster-'+status,{batchId:row.batch_id,reason});
  };
  if(batches.get(row.batch_id).state==='cancelled')transaction(save);else batches.control(row.batch_id,{action:'pause'},save);
  return {ok:true,clusterJobId:row.id,status};
 }
 function settle(context,row,p,batch){
  for(const item of batch.items){
   if(!item.runId||item.reusedRunId||item.status!=='candidate')continue;
   const run=semantic.get(item.runId);
   if(run.stale)return finish(context,row,p,'invalidated','组内比较输入已有变化，保留旧簇和判断');
   if(!run.decision&&run.candidate.comparison.relation!=='uncertain'){
    semantic.decide(run.id,{version:0,action:'accept',note:'系统保存完整成员配对结果；只有全部同事件判断一致才归组，事实仍未核实。'},SYSTEM_RESEARCH_ACTOR,()=>{
     active(context,row,p);audit(row.id,'automatic-cluster-pair',{batchId:row.batch_id,runId:run.id});
    });return {ok:true,clusterJobId:row.id};
   }
  }
  for(const item of batch.items){
   if(['cancelled','invalidated'].includes(item.status))return finish(context,row,p,item.status,'组内比较已取消或失效，不自动重新启动');
   if(!['failed','interrupted'].includes(item.status))continue;
   if(item.attempts.length>=3)return finish(context,row,p,'observing','组内比较尝试已用完，保留原簇与失败记录，其他研究继续');
   const run=semantic.get(item.runId),retryAt=Date.parse(run.finishedAt||run.createdAt)+60000*2**Math.max(0,item.attempts.length-1);
   if(now()<retryAt)continue;
   batches.control(row.batch_id,{action:'retry',ordinal:item.ordinal},()=>{active(context,row,p);audit(row.id,'automatic-cluster-retry',{batchId:row.batch_id,ordinal:item.ordinal,previousRun:item.runId,retryAt});});
   return {ok:true,clusterJobId:row.id};
  }
  if(batch.state!=='completed'||batch.items.some(i=>['failed','interrupted'].includes(i.status)))return null;
  if(p.mode==='replace'){
   const replacement=succession.replacement(p,batch);
   if(!replacement)return finish(context,row,p,'observing','新版事项与保留成员不一致或对应不唯一；保留旧事件身份和全部研究，不强行延续');
   clusters.replace(p.clusterId,{...replacement,note:'系统核对新版全部事项与保留成员，唯一对应后延续同一事件；原研究、比较与成员历史保留，事实仍未核实。',requestId:row.id},SYSTEM_RESEARCH_ACTOR,saved=>{
    active(context,row,p);
    db.prepare("UPDATE research_pipeline_cluster_jobs SET status='completed',payload=? WHERE id=?").run(JSON.stringify({...p,savedVersion:saved.version,reason:'来源修订已自动延续；原事件身份与研究历史保留'}),row.id);
    audit(row.id,'automatic-succession-completed',{clusterId:saved.id,version:saved.version,batchId:batch.id});
   });return {ok:true,clusterJobId:row.id,status:'completed'};
  }
  const preview=clusters.preview(batch.id),group=preview.groups.find(g=>g.members.length===batch.inputCount&&g.canSave);
  if(!group)return finish(context,row,p,'observing','组内存在不同事件、未知、冲突或成员变化；不强行合并，原簇保留');
  clusters.save({batchId:batch.id,groupId:group.id,previewHash:group.hash,clusterId:p.clusterId||'',version:p.clusterVersion||0,title:p.clusterTitle,note:'系统比较全部成员后归组；每对均指向同一具体事件，保留引用、缺口及版本。系统判断不等于事实已核实。',requestId:row.id},SYSTEM_RESEARCH_ACTOR,saved=>{
   active(context,row,p);
   db.prepare("UPDATE research_pipeline_cluster_jobs SET status='completed',payload=? WHERE id=?").run(JSON.stringify({...p,clusterId:saved.id,savedVersion:saved.version,reason:'系统归组完成，全部成员配对与历史已保存'}),row.id);
   audit(row.id,'automatic-cluster-completed',{clusterId:saved.id,version:saved.version,batchId:batch.id});
  });return {ok:true,clusterJobId:row.id,status:'completed'};
 }
 return {
  snapshot(){return {items:db.prepare('SELECT * FROM research_pipeline_cluster_jobs ORDER BY rowid DESC LIMIT 30').all().map(row=>{
   const p=JSON.parse(row.payload),batch=row.batch_id?batches.get(row.batch_id):null;let stale=false,confirmedVersion=null;
   if(batch){
    if(p.clusterId){const cluster=clusters.get(p.clusterId),confirmed=cluster.history.find(v=>{const {snapshotHash,...record}=v;return v.batchId===row.batch_id&&v.version>(p.clusterVersion||0)&&(p.mode==='replace'?v.replacement?.previousSnapshotHash===p.clusterHash:v.members.some(m=>m.kind==='event'&&m.id===p.sourceId))&&snapshotHash===digest(record);});confirmedVersion=confirmed?.version||null;if(p.automatic&&confirmedVersion)stale=!cluster.health.current;}
    if(!confirmedVersion)try{valid(p);}catch{stale=true;}
   }
   const status=p.automatic?row.status==='active'?(batch.state==='completed'?'processing':batch.state):row.status:confirmedVersion?'confirmed':row.status==='active'?batch.state:row.status;
   return {id:row.id,...p,batchId:row.batch_id,status,confirmedVersion,stale,counts:batch?.counts||null,reusedPairs:batch?.items.filter(i=>i.reusedRunId).length||0};})};},
  step(context){
   context.assertActive();guard();scan(context);
   const rows=db.prepare("SELECT * FROM research_pipeline_cluster_jobs WHERE status='active' ORDER BY rowid").all();let deferred=null;
   for(const row of rows){
    const batch=batches.get(row.batch_id),p=JSON.parse(row.payload);
    if(p.automatic&&batch.state==='cancelled')return finish(context,row,p,'cancelled','本批次已取消，不自动重新启动');
    if(batch.state==='paused'||batch.state==='cancelled'||!p.automatic&&batch.state!=='active')continue;
    try{valid(p);}catch{
     if(p.automatic)return finish(context,row,p,'invalidated','事件簇、来源或本人决定已变化，保留旧研究与事件簇');
     batches.control(row.batch_id,{action:'pause'});transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_cluster_jobs SET status='invalidated' WHERE id=?").run(row.id);audit(row.id,'cluster-expansion-invalidated');});return {ok:true,invalidated:true};
    }
    if(p.automatic){const settled=settle(context,row,p,batch);if(settled)return settled;}
    if(!batch.counts.queued)continue;
    if(used()>=settings().dailyCalls){deferred={skipped:'call-limit'};continue;}
    const result=batches.step(context,{batchId:row.batch_id,actor:p.automatic?SYSTEM_RESEARCH_ACTOR:undefined,beforeCommit:run=>{
     active(context,row,p);if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已变化');
     db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());audit(row.id,'cluster-comparison-started',{batchId:row.batch_id,runId:run.id});
    }});
    if(result.ok||!['model-busy','no-queued-items'].includes(result.skipped))return result;deferred=result;
   }
   return deferred;
  }
 };
}
