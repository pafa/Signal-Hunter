import {randomUUID} from 'node:crypto';
import {digest,codexPrompt,codexDraftSchema} from './codex-research.mjs';
import {materialEventsPacket,materialEventsPrompt,MATERIAL_EVENTS_SCHEMA} from './material-events.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';

// Extraction proposes boundaries. Only a recorded human create decision can
// produce a child draft job; this queue never writes an event decision.
export function openPipelineEvents(store,research,models,extractions,{config={},now=Date.now,guard,transaction,audit,used,settings,relations=null}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_event_jobs(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,topic_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pipeline_event_kind ON research_pipeline_event_jobs(kind,status);
 CREATE UNIQUE INDEX IF NOT EXISTS pipeline_event_child ON research_pipeline_event_jobs(topic_id) WHERE kind='dossier';`);
 const configHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const fingerprint=(kind,packet)=>{
  // Packet generation time is packaging metadata. A quota wait must not expire
  // unchanged evidence; input availability dates and all instructions stay bound.
  const stable={...packet};if(kind==='dossier')delete stable.generatedAt;
  return digest({kind,packet:stable,prompt:kind==='extract'?materialEventsPrompt(stable):codexPrompt(stable),schema:kind==='extract'?MATERIAL_EVENTS_SCHEMA:codexDraftSchema(stable),configHash:configHash()});
 };
 const read=id=>{const row=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(id);if(!row)throw Error('事项队列条目不存在');return row;};
 const runOf=row=>row.run_id?(row.kind==='extract'?extractions.get(row.topic_id,row.run_id):models.get(row.topic_id,row.run_id)):null;
 function valid(row){
  const p=JSON.parse(row.payload),news=store.newsById(p.newsId),topic=research.get(row.topic_id);
  if(news?.revision!==p.newsRevision||topic.status==='archived'||topic.version!==p.topicVersion||p.configHash!==configHash())throw Error('来源、研究或配置已变化');
  if(row.kind==='dossier'){
   if(topic.dossier||digest(eventComparisonSnapshot(db,{id:topic.id,revision:1}))!==p.eventHash)throw Error('事项依据已变化或已有研判');
  }
  const packet=row.kind==='extract'?materialEventsPacket(store,research,row.topic_id,p.request):research.packet(row.topic_id);
  if(fingerprint(row.kind,packet)!==p.executionHash||fingerprint(row.kind,p.packet)!==p.executionHash)throw Error('输入材料或提示词已变化');
  return p;
 }
 function view(row){
  const p=JSON.parse(row.payload),run=runOf(row);let stale=!!run?.stale;
  try{valid(row);}catch{stale=true;}
  return {id:row.id,itemId:row.item_id,topicId:row.topic_id,kind:row.kind,title:p.title,status:run?.status||row.status,runId:row.run_id,stale,
   reason:p.reason||run?.failure?.message||null,eventCount:row.kind==='extract'&&run?.status==='candidate'&&!run.stale?run.candidate.decomposition.events.length:null,
   relationCoverage:p.relationCoverage||null,parentJobId:p.parentJobId||null,createdAt:p.createdAt,attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id)};
 }
 const insert=(row,p)=>db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(row.id,row.item_id,row.topic_id,row.kind,row.status,JSON.stringify(p));
 const api={
  plan(item,topic){
   const m=[...topic.evidence].reverse().find(e=>e.materialId);if(!m)throw Error('正文材料缺失');
   const request={version:topic.version,materialId:m.materialId,revision:m.materialRevision},packet=materialEventsPacket(store,research,topic.id,request);
   return {id:digest({item:item.id,kind:'extract'}),item_id:item.id,topic_id:topic.id,kind:'extract',status:'queued',payload:{newsId:item.news_id,newsRevision:item.revision,title:topic.title,topicVersion:topic.version,request,packet,executionHash:fingerprint('extract',packet),configHash:configHash(),createdAt:at()}};
  },
  // Called in the source dossier's model transaction, before any external call.
  persist(plan){valid({...plan,payload:JSON.stringify(plan.payload)});insert(plan,plan.payload);audit(plan.item_id,'event-extraction-planned',{jobId:plan.id,inputHash:plan.payload.packet.inputHash});},
  scan(context){
   return transaction(()=>{
    context.assertActive();
    // Decisions are append-only. Created topics cannot be re-created; retries
    // reuse their job rather than silently reacting to every topic revision.
    const rows=db.prepare(`SELECT j.id parent_id,j.item_id,j.payload parent_payload,d.payload decision FROM material_event_decisions d JOIN research_pipeline_event_jobs j ON j.run_id=d.run_id AND j.kind='extract'
     WHERE json_extract(d.payload,'$.action')='create' AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs child WHERE child.kind='dossier' AND child.topic_id=json_extract(d.payload,'$.topicId')) ORDER BY d.rowid LIMIT 200`).all();
    for(const row of rows){
     const origin=JSON.parse(row.parent_payload),decision=JSON.parse(row.decision),topic=research.get(decision.topicId),job={id:digest({kind:'event-dossier',topic:topic.id}),item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued'};
     const p={newsId:origin.newsId,newsRevision:origin.newsRevision,title:topic.title,topicVersion:topic.version,parentJobId:row.parent_id,configHash:origin.configHash,decision,createdAt:at()};
     try{
      if(topic.version!==1||topic.dossier)throw Error('事项已编辑');
      p.eventHash=digest(eventComparisonSnapshot(db,{id:topic.id,revision:1}));p.packet=research.packet(topic.id);p.executionHash=fingerprint('dossier',p.packet);valid({...job,payload:JSON.stringify(p)});
     }catch{job.status='invalidated';p.reason='事项已编辑、归档或原依据已变化；保留研究，需重新核对后手动生成';}
     insert(job,p);audit(row.item_id,'event-dossier-discovered',{jobId:job.id,parentJobId:row.parent_id,status:job.status});
    }
    return rows.length;
   });
  },
  snapshot(){const counts={};for(const row of db.prepare(`SELECT CASE WHEN coalesce(e.status,m.status)='running' AND coalesce(e.expires_at,m.expires_at)<? THEN 'interrupted' ELSE coalesce(e.status,m.status,j.status) END status,count(*) n FROM research_pipeline_event_jobs j LEFT JOIN material_event_runs e ON j.kind='extract' AND e.id=j.run_id LEFT JOIN model_research_runs m ON j.kind='dossier' AND m.id=j.run_id GROUP BY 1`).all(now()))counts[row.status]=row.n;
   return {counts,items:db.prepare('SELECT * FROM research_pipeline_event_jobs ORDER BY rowid DESC LIMIT 30').all().map(view)};
  },
  retry(id){return transaction(()=>{const row=read(id);if(!['failed','cancelled','interrupted'].includes(view(row).status))throw Error('只有失败、取消或中断事项调用可以重试');valid(row);db.prepare("UPDATE research_pipeline_event_jobs SET status='queued',run_id=NULL WHERE id=?").run(id);audit(row.item_id,'event-job-retry',{jobId:id,previousRun:row.run_id});return view(read(id));});},
  step(context){
   context.assertActive();guard();api.scan(context);
   const row=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();if(!row)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   let p;try{p=valid(row);}catch{
    transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_event_jobs SET status='invalidated' WHERE id=? AND status='queued'").run(row.id);audit(row.item_id,'event-job-invalidated',{jobId:row.id});});return {ok:true,invalidated:true};
   }
   const relationItem={id:row.id,news_id:p.newsId,revision:p.newsRevision},relationPlan=row.kind==='dossier'&&relations&&!p.relationCoverage?relations.plan(relationItem,research.get(row.topic_id)):null;
   const link=run=>{
    context.assertActive();guard();valid(row);const latest=read(row.id);
    if(latest.status!=='queued'||latest.payload!==row.payload||fingerprint(row.kind,run.packet)!==p.executionHash)throw Error('事项队列或模型输入已变化');
    if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
    if(relationPlan)relations.persist(relationItem,relationPlan);
    db.prepare("UPDATE research_pipeline_event_jobs SET status='running',run_id=?,payload=? WHERE id=?").run(run.id,JSON.stringify({...p,...(relationPlan?{relationCoverage:relationPlan.coverage}:{})}),row.id);
    db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());
    audit(row.item_id,'event-job-started',{jobId:row.id,runId:run.id,kind:row.kind,inputHash:run.packet.inputHash});
   };
   const run=row.kind==='extract'?extractions.start(row.topic_id,{...p.request,requestId:randomUUID()},link):models.start(row.topic_id,{version:p.topicVersion},link);
   return {ok:true,eventJobId:row.id,runId:run.id};
  }
 };
 return api;
}
