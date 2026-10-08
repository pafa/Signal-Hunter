import {digest,validatePacket,CODEX_PROMPT_VERSION,CODEX_SCHEMA_VERSION,EVENT_SYNTHESIS_PROMPT_VERSION} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {PACKET_VERSION} from './research-materials.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {packetQuantities} from '../shared/source-quantities.mjs';
import {materialityReviewTargets} from './materiality-review.mjs';

// Evidence aliases retain each member's interpretation without pretending that
// repeated source documents are independent corroboration.
export function synthesisPacket(cluster,members,{version,generatedAt,priorSynthesis=null}={}){
 const evidence=[],companies=new Map(),sourceGroups=new Map();
 const inputs=members.map(({topic,scope,packet,sourceNews})=>{
  const aliases=new Map(packet.input.evidence.map(e=>[e.id,`${e.material?'material':'news'}:cluster-${digest({topic:topic.id,evidence:e.id}).slice(0,32)}`]));
  function refs(value){
   if(Array.isArray(value))return value.map(refs);
   if(!value||typeof value!=='object')return value;
   return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['sourceIds','evidenceIds'].includes(key)&&Array.isArray(v)?v.map(id=>aliases.get(id)||id):refs(v)]));
  }
  for(const item of packet.input.evidence){
   const id=aliases.get(item.id),e={...item,id,memberTopicId:topic.id,originalEvidenceId:item.id};evidence.push(e);
   const key=item.material?.documentId||item.url||item.materialId||item.id;
   if(!sourceGroups.has(key))sourceGroups.set(key,{document:key,evidenceIds:[],scope:'同一文档或链接的引用集合；不同文档也不自动证明来源独立'});
   sourceGroups.get(key).evidenceIds.push(id);
  }
  for(const company of packet.input.companies){
   const variant=refs(company),key=company.symbol;
   if(!companies.has(key))companies.set(key,{symbol:key,name:company.name,researchVariants:[],materiality:{rows:[]}});
   const merged=companies.get(key);merged.researchVariants.push({topicId:topic.id,topicVersion:topic.version,company:variant});
   for(const row of variant.materiality?.rows||[])merged.materiality.rows.push({...row,id:`${topic.id}:${row.id}`});
  }
  return {topicId:topic.id,topicVersion:topic.version,inputHash:packet.inputHash,title:topic.title,sourceNews,eventFocus:scope.eventFocus,evidenceIds:[...aliases.values()],priorJudgment:refs({summary:packet.input.summary,hypothesis:packet.input.hypothesis,claims:packet.input.claims,dossier:topic.dossier,nextEvidence:packet.input.nextEvidence})};
 });
 const input={topicId:`event-cluster:${cluster.id}`,topicVersion:version,title:cluster.title,eventSynthesis:{version:EVENT_SYNTHESIS_PROMPT_VERSION,clusterId:cluster.id,clusterVersion:cluster.version,clusterHash:cluster.snapshotHash,members:inputs,sourceGroups:[...sourceGroups.values()],priorSynthesis},companies:[...companies.values()],evidence};
 input.quantityEvidence=packetQuantities(evidence);input.materialityReview=materialityReviewTargets(input);
 return validatePacket({schema:PACKET_VERSION,analysisMode:'assistant-review-required',generatedAt,input,inputHash:digest(input)});
}

export function openEventSynthesis(store,research,clusters,models,{config={},now=Date.now,guard,transaction,audit,used,settings}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS event_cluster_research(id TEXT PRIMARY KEY,cluster_id TEXT NOT NULL,version INTEGER NOT NULL,basis_hash TEXT NOT NULL,execution_hash TEXT NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL,UNIQUE(cluster_id,version),UNIQUE(cluster_id,basis_hash,execution_hash));
 CREATE INDEX IF NOT EXISTS event_cluster_research_history ON event_cluster_research(cluster_id,version DESC);`);
 const executionHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeout:config.timeoutMs??180000,prompt:CODEX_PROMPT_VERSION,schema:CODEX_SCHEMA_VERSION,synthesis:EVENT_SYNTHESIS_PROMPT_VERSION});
 const read=id=>{const row=db.prepare('SELECT * FROM event_cluster_research WHERE id=?').get(id);if(!row)throw Error('事件综合研判不存在');return row;};
 const rows=id=>db.prepare('SELECT * FROM event_cluster_research WHERE cluster_id=? ORDER BY version DESC').all(id);
 const payload=row=>JSON.parse(row.payload);
 const set=(row,status,extra={})=>{db.prepare('UPDATE event_cluster_research SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...payload(row),...extra,updatedAt:at()}),row.id);audit(row.id,`automatic-synthesis-${status}`,{clusterId:row.cluster_id,title:payload(row).title,...extra});};
 function basis(id){
  const cluster=clusters.get(id);
  if(cluster.actor?.kind!=='system')throw Error('此事件由本人归组，当前自动综合只处理系统事件；各篇原研究仍可查看');
  if(cluster.status!=='active'||!cluster.health.current||cluster.members.length<2||cluster.members.some(m=>m.kind!=='event'))throw Error('当前事件归属或比较依据无效，暂不生成当前综合结果');
  const members=cluster.members.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(m=>{
   const topic=research.get(m.id),scope=eventComparisonSnapshot(db,{id:m.id,revision:m.revision});
   if(topic.status!=='active'||!topic.dossier||topic.origin!=='material-event-system'||db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${m.id}`)?.cluster_id!==id)throw Error('事件成员尚未完成研究或归属已变化');
   const source=research.get(scope.eventProvenance.sourceTopicId),news=store.newsById(source.sourceNewsId);
   if(!news||news.revision!==source.sourceNewsRevision)throw Error('来源新闻已有新修订，旧综合结果保留历史');
   return {topic,scope,packet:research.packet(m.id),sourceNews:{id:news.id,revision:news.revision,publishedAt:news.publishedAt}};
  });
  return {cluster,members,hash:digest({cluster:cluster.snapshotHash,members:members.map(m=>({id:m.topic.id,version:m.topic.version,inputHash:m.packet.inputHash,eventHash:digest(m.scope)}))})};
 }
 function valid(row){
  const p=payload(row);if(executionHash()!==row.execution_hash||basis(row.cluster_id).hash!==row.basis_hash||p.packet?.inputHash!==p.inputHash)throw Error('事件成员、材料、研究或模型配置已有变化');
  validatePacket(p.packet);return p;
 }
 function completed(row){
  const p=payload(row),run=row.run_id?models.get(`event-cluster:${row.cluster_id}`,row.run_id):null;
  if(row.status!=='completed'||run?.status!=='adopted'||run.subject!=='event-cluster'||run.packet.inputHash!==p.inputHash)throw Error('事件综合研判结果尚未完整保存');
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:run.topicId});return run;
 }
 function brief(row,currentHash){
  const p=payload(row);let current=row.basis_hash===currentHash&&row.execution_hash===executionHash(),status=row.status,run=null;
  if(status==='completed'){try{run=completed(row);}catch{current=false;status='invalidated';}}
  if(!current&&status==='completed')status='historical';
  const paragraph=id=>run?.candidate.sections.find(s=>s.id===id)?.paragraphs[0]||null;
  return {id:row.id,clusterId:row.cluster_id,version:row.version,clusterVersion:p.clusterVersion,title:p.title,status,current:current&&status==='completed',runId:row.run_id,createdAt:p.createdAt,updatedAt:p.updatedAt||p.createdAt,reason:p.reason||null,attemptCount:p.attemptCount||0,attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id),nextRetryAt:p.nextRetryAt||null,memberCount:p.members.length,companyCount:p.packet?.input.companies.length||0,...(run?{summary:paragraph('facts'),judgment:paragraph('materiality'),risk:paragraph('scenarios'),conditions:paragraph('conditions'),missingEvidence:run.candidate.missingEvidence,model:run.model,inputHash:run.packet.inputHash}: {})};
 }
 const api={
  overview(id){let hash=null,reason=null;try{hash=basis(id).hash;}catch(error){reason=error.message;}
   const list=rows(id),current=list.find(r=>r.basis_hash===hash&&r.execution_hash===executionHash()),last=current||list[0];
   if(!last)return {status:hash?'pending':'observing',current:false,reason:reason||'后台将综合当前事件成员；本篇研究可继续查看'};
   const result=brief(last,hash);return {...result,...(!current?{status:'stale',current:false,reason:'当前成员或依据已变化，旧综合结果保留历史，后台等待合格输入'}:{})};
  },
  detail(id,jobId){clusters.get(id);const list=rows(id);let hash=null;try{hash=basis(id).hash;}catch{}
   const row=jobId?list.find(r=>r.id===jobId):list.find(r=>r.basis_hash===hash&&r.execution_hash===executionHash())||list[0];
   if(jobId&&!row)throw Error('综合研判不属于此事件');
   let run=null;if(row?.run_id)run=models.get(`event-cluster:${id}`,row.run_id);
   const attemptRuns=row?db.prepare('SELECT run_id FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id).map(a=>models.get(`event-cluster:${id}`,a.run_id)):[];
   return {overview:api.overview(id),history:list.map(r=>brief(r,hash)),selected:row?{...brief(row,hash),packet:run?.packet||payload(row).packet||null,run,attemptRuns}:null};
  },
  cancel(id){guard();const row=read(id);if(!['queued','running'].includes(row.status))throw Error('此综合任务已经结束');transaction(()=>set(read(id),'cancelled',{reason:'本人取消本版综合任务，不自动重启',nextRetryAt:null}));if(row.run_id){try{models.cancel(`event-cluster:${row.cluster_id}`,row.run_id);}catch{}}return api.overview(row.cluster_id);},
  snapshot(){const hashes=new Map(),counts={};for(const r of db.prepare('SELECT status,count(*) n FROM event_cluster_research GROUP BY status').all())counts[r.status]=r.n;return {counts,items:db.prepare('SELECT * FROM event_cluster_research ORDER BY rowid DESC LIMIT 20').all().map(r=>{if(!hashes.has(r.cluster_id)){let hash=null;try{hash=basis(r.cluster_id).hash;}catch{}hashes.set(r.cluster_id,hash);}return brief(r,hashes.get(r.cluster_id));})};},
  step(context){
   if(!settings().automatic)return null;
   context.assertActive();guard();
   // Persist finished results before checking quota or starting another model.
   for(const row of db.prepare("SELECT * FROM event_cluster_research WHERE status IN ('queued','running') ORDER BY rowid").all()){
    let p;try{p=valid(row);}catch(error){transaction(()=>{context.assertActive();set(read(row.id),'invalidated',{reason:error.message});});if(row.run_id){try{models.cancel(`event-cluster:${row.cluster_id}`,row.run_id);}catch{}}continue;}
    if(!row.run_id)continue;
    const run=models.get(`event-cluster:${row.cluster_id}`,row.run_id);if(run.status==='running')continue;
    if(run.status==='candidate'){
     try{models.completeCluster(run.id,p.packet,SYSTEM_RESEARCH_ACTOR,()=>{context.assertActive();guard();const latest=read(row.id);valid(latest);if(latest.status!=='running'||latest.run_id!==run.id)throw Error('综合研判任务已有变化');set(latest,'completed',{reason:null,nextRetryAt:null});});}
     catch{context.assertActive();guard();return {skipped:'synthesis-save-pending'};}
     return {ok:true,synthesisId:row.id,runId:run.id};
    }
    transaction(()=>{context.assertActive();const latest=read(row.id),status=run.status==='cancelled'?'cancelled':p.attemptCount>=3?'observing':'queued';set(latest,status,{reason:status==='queued'?'综合调用未完成，后台按上限重试':status==='cancelled'?'调用已取消，保留记录，不自动重启':'已达三次尝试，保留观察；其他事件继续',nextRetryAt:status==='queued'?now()+60000*2**Math.max(0,p.attemptCount-1):null});db.prepare('UPDATE event_cluster_research SET run_id=NULL WHERE id=?').run(row.id);});
   }
   for(const c of db.prepare("SELECT id FROM event_clusters WHERE status='active' AND json_extract(payload,'$.actor.kind')='system' ORDER BY rowid").all()){
    let b;try{b=basis(c.id);}catch{continue;}
    if(db.prepare('SELECT 1 FROM event_cluster_research WHERE cluster_id=? AND basis_hash=? AND execution_hash=?').get(c.id,b.hash,executionHash()))continue;
    const history=rows(c.id),version=(history[0]?.version||0)+1,id=digest({clusterId:c.id,basis:b.hash,execution:executionHash()});
    let priorSynthesis=null;for(const previous of history){if(previous.basis_hash===b.hash)continue;try{const r=completed(previous);priorSynthesis={version:previous.version,clusterVersion:payload(previous).clusterVersion,createdAt:r.createdAt,sections:r.candidate.sections,missingEvidence:r.candidate.missingEvidence,scope:'历史综合判断，仅用于变化比较；不是当前独立证据'};break;}catch{}}
    let packet=null,reason=null;try{packet=synthesisPacket(b.cluster,b.members,{version,generatedAt:at(),priorSynthesis});}catch{reason='综合输入超过当前容量或材料校验失败；保留所有成员，本篇研究仍可查看，未声称完成综合';}
    const p={title:b.cluster.title,clusterVersion:b.cluster.version,createdAt:at(),automatic:true,members:b.members.map(m=>({topicId:m.topic.id,topicVersion:m.topic.version,inputHash:m.packet.inputHash})),packet,inputHash:packet?.inputHash||null,attemptCount:0,reason};
    transaction(()=>{context.assertActive();if(basis(c.id).hash!==b.hash)throw Error('事件输入已变化');db.prepare('INSERT INTO event_cluster_research VALUES(?,?,?,?,?,?,NULL,?)').run(id,c.id,version,b.hash,executionHash(),packet?'queued':'observing',JSON.stringify(p));audit(id,packet?'automatic-synthesis-queued':'automatic-synthesis-observing',{clusterId:c.id,title:p.title,reason});});
   }
   const row=db.prepare("SELECT * FROM event_cluster_research WHERE status='queued' AND run_id IS NULL AND coalesce(json_extract(payload,'$.nextRetryAt'),0)<=? ORDER BY rowid LIMIT 1").get(now());if(!row)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   const p=valid(row);
   const started=models.startCluster(p.packet,run=>{context.assertActive();guard();const latest=read(row.id);valid(latest);if(latest.status!=='queued'||latest.run_id||used()>=settings().dailyCalls)throw Error('事件任务或调用额度已有变化');db.prepare('UPDATE event_cluster_research SET run_id=? WHERE id=?').run(run.id,row.id);set(read(row.id),'running',{attemptCount:p.attemptCount+1,nextRetryAt:null,reason:null});db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());},SYSTEM_RESEARCH_ACTOR);
   return {ok:true,synthesisId:row.id,runId:started.id};
  }
 };
 return api;
}
