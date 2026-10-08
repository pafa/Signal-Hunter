import {companyEntitiesPacket,companyEntitiesPrompt,COMPANY_ENTITIES_SCHEMA} from './company-entities.mjs';
import {openPipelineEventAutomation} from './pipeline-event-automation.mjs';
import {randomUUID} from 'node:crypto';
import {digest,codexPrompt,codexDraftSchema} from './codex-research.mjs';
import {materialEventsPacket,materialEventsPrompt,MATERIAL_EVENTS_SCHEMA} from './material-events.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';

// Legacy queues remain review-driven. Opted-in queues record system provenance
// and progress through the same validated decisions and immutable model runs.
export function openPipelineEvents(store,research,models,extractions,{config={},now=Date.now,guard,transaction,audit,used,settings,relations=null,entities=null}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_event_jobs(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,topic_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pipeline_event_kind ON research_pipeline_event_jobs(kind,status);
 CREATE UNIQUE INDEX IF NOT EXISTS pipeline_event_child ON research_pipeline_event_jobs(topic_id) WHERE kind='dossier';
 CREATE UNIQUE INDEX IF NOT EXISTS pipeline_identity_child ON research_pipeline_event_jobs(topic_id) WHERE kind='identity';`);
 const configHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const fingerprint=(kind,packet)=>{
  // Packet generation time is packaging metadata. A quota wait must not expire
  // unchanged evidence; input availability dates and all instructions stay bound.
  const stable={...packet};if(kind==='dossier')delete stable.generatedAt;
  return digest({kind,packet:stable,prompt:kind==='extract'?materialEventsPrompt(stable):kind==='identity'?companyEntitiesPrompt(stable):codexPrompt(stable),schema:kind==='extract'?MATERIAL_EVENTS_SCHEMA:kind==='identity'?COMPANY_ENTITIES_SCHEMA:codexDraftSchema(stable),configHash:configHash()});
 };
 const read=id=>{const row=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(id);if(!row)throw Error('事项队列条目不存在');return row;};
 const runOf=row=>row.run_id?(row.kind==='extract'?extractions.get(row.topic_id,row.run_id):row.kind==='identity'?entities.get(row.topic_id,row.run_id):models.get(row.topic_id,row.run_id)):null;
 function valid(row,{identityVersion}={}){
  const p=JSON.parse(row.payload),news=store.newsById(p.newsId),topic=research.get(row.topic_id);
  if(news?.revision!==p.newsRevision||topic.status==='archived'||topic.version!==(identityVersion??p.topicVersion)||p.configHash!==configHash())throw Error('来源、研究或配置已变化');
  if(row.kind==='dossier'){
   if(topic.dossier||digest(eventComparisonSnapshot(db,{id:topic.id,revision:1}))!==p.eventHash)throw Error('事项依据已变化或已有研判');
  }
  const packet=row.kind==='extract'?materialEventsPacket(store,research,row.topic_id,p.request):row.kind==='identity'?companyEntitiesPacket(store,research,row.topic_id,{...p.request,version:identityVersion??p.topicVersion}):research.packet(row.topic_id);
  if(identityVersion!==undefined)packet.sourceResearchVersion=p.packet.sourceResearchVersion;
  if(fingerprint(row.kind,packet)!==p.executionHash||fingerprint(row.kind,p.packet)!==p.executionHash)throw Error('输入材料或提示词已变化');
  return p;
 }
 function view(row){
  const p=JSON.parse(row.payload),run=runOf(row);let stale=!!run?.stale;
  try{
   if(p.automatic&&row.status==='completed'&&row.kind!=='extract'){
    if(store.newsById(p.newsId)?.revision!==p.newsRevision||p.configHash!==configHash())throw Error('来源或配置已变化');
    const topic=research.get(row.topic_id);if(topic.status==='archived')throw Error('研究已归档');
    if(row.kind==='identity'){if(companyEntitiesPacket(store,research,topic.id,{...p.request,version:topic.version}).inputHash!==p.packet.inputHash)throw Error('身份依据变化');}
    else if(topic.version!==p.adoptedVersion||topic.dossier?.sourceModelRun?.id!==row.run_id)throw Error('研判已变化');
   }else valid(row);
  }catch{stale=true;}
  return {id:row.id,itemId:row.item_id,topicId:row.topic_id,kind:row.kind,title:p.title,status:row.status==='running'?(run?.status||row.status):row.status,automatic:!!p.automatic,retryAt:p.retryAt||null,identityOutcome:p.identityOutcome||null,unresolved:p.unresolved||[],runId:row.run_id,stale,
   reason:p.reason||run?.failure?.message||null,eventCount:row.kind==='extract'&&run?.status==='candidate'&&!run.stale?run.candidate.decomposition.events.length:null,
   relationCoverage:p.relationCoverage||null,parentJobId:p.parentJobId||null,createdAt:p.createdAt,attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id)};
 }
 const insert=(row,p)=>db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(row.id,row.item_id,row.topic_id,row.kind,row.status,JSON.stringify(p));
 const childPlan=(parent,topic,kind,origin)=>{
  const m=[...topic.evidence].reverse().find(e=>e.materialId);if(!m)throw Error('正文材料缺失');
  const request={version:topic.version,materialId:m.materialId,revision:m.materialRevision};
  const packet=kind==='identity'?companyEntitiesPacket(store,research,topic.id,request):research.packet(topic.id);
  return {id:digest({kind:'event-'+kind,topic:topic.id}),item_id:parent.item_id,topic_id:topic.id,kind,status:'queued',payload:{automatic:!!origin.automatic,newsId:origin.newsId,newsRevision:origin.newsRevision,title:topic.title,topicVersion:topic.version,parentJobId:parent.id,configHash:origin.configHash,request,eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),packet,executionHash:fingerprint(kind,packet),createdAt:at()}};
 };
 const automation=entities?openPipelineEventAutomation({db,store,research,models,extractions,entities,now,guard,transaction,audit,read,runOf,valid,insert,childPlan,relations}):null;
 const api={
  plan(item,topic){
   const m=[...topic.evidence].reverse().find(e=>e.materialId);if(!m)throw Error('正文材料缺失');
   const request={version:topic.version,materialId:m.materialId,revision:m.materialRevision},packet=materialEventsPacket(store,research,topic.id,request);
   return {id:digest({item:item.id,kind:'extract'}),item_id:item.id,topic_id:topic.id,kind:'extract',status:'queued',payload:{automatic:!!JSON.parse(item.payload||'{}').configuration?.automatic,newsId:item.news_id,newsRevision:item.revision,title:topic.title,topicVersion:topic.version,request,packet,executionHash:fingerprint('extract',packet),configHash:configHash(),createdAt:at()}};
  },
  // Called in the source dossier's model transaction, before any external call.
  persist(plan){valid({...plan,payload:JSON.stringify(plan.payload)});insert(plan,plan.payload);audit(plan.item_id,'event-extraction-planned',{jobId:plan.id,inputHash:plan.payload.packet.inputHash});},
  scan(context){
   return transaction(()=>{
    context.assertActive();
    // Decisions are append-only. Created topics cannot be re-created; retries
    // reuse their job rather than silently reacting to every topic revision.
    const rows=db.prepare(`SELECT j.id parent_id,j.item_id,j.payload parent_payload,d.payload decision FROM material_event_decisions d JOIN research_pipeline_event_jobs j ON j.run_id=d.run_id AND j.kind='extract'
     WHERE json_extract(d.payload,'$.action')='create' AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs child WHERE child.kind IN ('identity','dossier') AND child.topic_id=json_extract(d.payload,'$.topicId')) ORDER BY d.rowid LIMIT 200`).all();
    for(const row of rows){
     const origin=JSON.parse(row.parent_payload),decision=JSON.parse(row.decision),topic=research.get(decision.topicId);
     if(origin.automatic&&automation&&decision.actor?.kind==='system'){
      let plan;try{if(topic.version!==1||topic.dossier)throw Error('事项已编辑');plan=childPlan({id:row.parent_id,item_id:row.item_id},topic,'identity',origin);valid({...plan,payload:JSON.stringify(plan.payload)});}catch{plan={id:digest({kind:'event-identity',topic:topic.id}),item_id:row.item_id,topic_id:topic.id,kind:'identity',status:'invalidated',payload:{...origin,parentJobId:row.parent_id,title:topic.title,reason:'事项或输入已变化，保留现有研究'}};}
      insert(plan,plan.payload);audit(row.item_id,'event-identity-discovered',{jobId:plan.id,parentJobId:row.parent_id,status:plan.status});continue;
     }
     const job={id:digest({kind:'event-dossier',topic:topic.id}),item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued'};
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
  snapshot(){const counts={},state=entities?'coalesce(e.status,m.status,c.status,j.status)':'coalesce(e.status,m.status,j.status)',expires=entities?'coalesce(e.expires_at,m.expires_at,c.expires_at)':'coalesce(e.expires_at,m.expires_at)';for(const row of db.prepare(`SELECT CASE WHEN j.status!='running' THEN j.status WHEN ${state}='running' AND ${expires}<? THEN 'interrupted' ELSE ${state} END status,count(*) n FROM research_pipeline_event_jobs j LEFT JOIN material_event_runs e ON j.kind='extract' AND e.id=j.run_id LEFT JOIN model_research_runs m ON j.kind='dossier' AND m.id=j.run_id ${entities?"LEFT JOIN company_entity_runs c ON j.kind='identity' AND c.id=j.run_id":''} GROUP BY 1`).all(now()))counts[row.status]=row.n;
   return {counts,items:db.prepare('SELECT * FROM research_pipeline_event_jobs ORDER BY rowid DESC LIMIT 30').all().map(view)};
  },
  retry(id){return transaction(()=>{const row=read(id);if(!['failed','cancelled','interrupted'].includes(view(row).status))throw Error('只有失败、取消或中断事项调用可以重试');valid(row);db.prepare("UPDATE research_pipeline_event_jobs SET status='queued',run_id=NULL WHERE id=?").run(id);audit(row.item_id,'event-job-retry',{jobId:id,previousRun:row.run_id});return view(read(id));});},
  step(context){
   context.assertActive();guard();api.scan(context);automation?.refreshSources(context);
   const settled=automation?.settle(context);if(settled)return settled;
   const row=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE status='queued' AND coalesce(json_extract(payload,'$.retryAt'),0)<=? ORDER BY rowid LIMIT 1").get(now());if(!row)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   let p;try{p=valid(row);}catch{
    transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_event_jobs SET status='invalidated' WHERE id=? AND status='queued'").run(row.id);audit(row.item_id,'event-job-invalidated',{jobId:row.id});});return {ok:true,invalidated:true};
   }
   const relationItem={id:row.id,news_id:p.newsId,revision:p.newsRevision},relationPlan=row.kind==='dossier'&&!p.automatic&&relations&&!p.relationCoverage?relations.plan(relationItem,research.get(row.topic_id)):null;
   const link=run=>{
    context.assertActive();guard();valid(row);const latest=read(row.id);
    if(latest.status!=='queued'||latest.payload!==row.payload||fingerprint(row.kind,run.packet)!==p.executionHash)throw Error('事项队列或模型输入已变化');
    if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
    if(relationPlan)relations.persist(relationItem,relationPlan);
    db.prepare("UPDATE research_pipeline_event_jobs SET status='running',run_id=?,payload=? WHERE id=?").run(run.id,JSON.stringify({...p,...(relationPlan?{relationCoverage:relationPlan.coverage}:{})}),row.id);
    db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());
    audit(row.item_id,'event-job-started',{jobId:row.id,runId:run.id,kind:row.kind,inputHash:run.packet.inputHash});
   };
   const run=row.kind==='extract'?extractions.start(row.topic_id,{...p.request,requestId:randomUUID()},link):row.kind==='identity'?entities.start(row.topic_id,{...p.request,requestId:randomUUID()},link):models.start(row.topic_id,{version:p.topicVersion},link);
   return {ok:true,eventJobId:row.id,runId:run.id};
  }
 };
 return api;
}
