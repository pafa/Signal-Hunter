import {openPipelineDuplicateSources} from './pipeline-duplicate-sources.mjs';
import {reviewHasActiveScope} from '../shared/research-watch.mjs';
import {openHoldingsReview} from './pipeline-holdings-review.mjs';
import {validateMonitoringFollowup} from './system-monitoring-revisions.mjs';
import {openHoldingsFinancial} from './pipeline-holdings-financial.mjs';
import {HOLDINGS_FINANCIAL_VERSION} from './holdings-financial-basis.mjs';
import {openFinancialFollowup} from './pipeline-financial-followup.mjs';
import {validateFinancialFollowup} from './system-financial-revisions.mjs';
import {openAttachmentIdentities} from './pipeline-attachment-identities.mjs';
import {openIdentityFollowup} from './pipeline-identity-followup.mjs';
import {identityResearchOrigin} from './system-identity-revisions.mjs';
import {currentDocumentResearch,documentGenerationChanged} from './research-document-context.mjs';
import {useStoredOutputContract,automaticResearchPacket} from './research-output-contract.mjs';
import {openDocumentFollowup} from './pipeline-document-followup.mjs';
import {EVENT_IDENTITY_CONTEXT_VERSION} from './company-event-context.mjs';
import {companyEntitiesPacket,companyEntitiesPrompt,companyEntitiesSchema} from './company-entities.mjs';
import {openPipelineEventAutomation} from './pipeline-event-automation.mjs';
import {prepareEventPrices} from './pipeline-prices.mjs';
import {prepareEventFinancials} from './pipeline-financials.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {randomUUID} from 'node:crypto';
import {digest,codexPrompt,codexDraftSchema} from './codex-research.mjs';
import {materialEventsPacket,materialEventsPrompt,MATERIAL_EVENTS_SCHEMA} from './material-events.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';

// Legacy queues remain review-driven. Opted-in queues record system provenance
// and progress through the same validated decisions and immutable model runs.
export function openPipelineEvents(store,research,models,extractions,{config={},now=Date.now,guard,transaction,audit,used,settings,relations=null,entities=null,financialSources=null,holdingSymbols=()=>[],getReviewContext=()=>null,priceSources=null,directories=null}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_event_jobs(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,topic_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pipeline_event_kind ON research_pipeline_event_jobs(kind,status);
 SAVEPOINT dossier_generation_upgrade;
 CREATE UNIQUE INDEX IF NOT EXISTS pipeline_event_generation ON research_pipeline_event_jobs(topic_id,json_extract(payload,'$.topicVersion')) WHERE kind='dossier';
 DROP INDEX IF EXISTS pipeline_event_child;
 RELEASE dossier_generation_upgrade;
 SAVEPOINT identity_generation_upgrade;
 CREATE UNIQUE INDEX IF NOT EXISTS pipeline_identity_generation ON research_pipeline_event_jobs(topic_id,coalesce(json_extract(payload,'$.identityFollowup.scopeHash'),'initial')) WHERE kind='identity';
 DROP INDEX IF EXISTS pipeline_identity_child;
 RELEASE identity_generation_upgrade;`);
 const configHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const fingerprint=(kind,packet)=>{
  // Packet generation time is packaging metadata. A quota wait must not expire
  // unchanged evidence; input availability dates and all instructions stay bound.
  const stable={...packet};if(kind==='dossier')delete stable.generatedAt;
  return digest({kind,packet:stable,prompt:kind==='extract'?materialEventsPrompt(stable):kind==='identity'?companyEntitiesPrompt(stable):codexPrompt(stable),schema:kind==='extract'?MATERIAL_EVENTS_SCHEMA:kind==='identity'?companyEntitiesSchema(stable):codexDraftSchema(stable),configHash:configHash()});
 };
 const read=id=>{const row=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(id);if(!row)throw Error('事项队列条目不存在');return row;};
 const runOf=row=>row.run_id?(row.kind==='extract'?extractions.get(row.topic_id,row.run_id):row.kind==='identity'?entities.get(row.topic_id,row.run_id):models.get(row.topic_id,row.run_id)):null;
 function valid(row,{identityVersion}={}){
  const p=JSON.parse(row.payload),news=store.newsById(p.newsId),topic=research.get(row.topic_id);
  if(news?.revision!==p.newsRevision||topic.status==='archived'||topic.version!==(identityVersion??p.topicVersion)||p.configHash!==configHash())throw Error('来源、研究或配置已变化');
  if(row.kind==='identity'&&p.identityFollowup&&db.prepare("SELECT 1 FROM company_entity_decisions d JOIN company_entity_runs r ON r.id=d.run_id WHERE r.topic_id=? AND (coalesce(json_extract(d.payload,'$.actor.kind'),'')!='system' OR coalesce(json_extract(d.payload,'$.actor.policy'),'')!='automatic-research/1')").get(topic.id))throw Error('公司身份已有人工处理');
  if(row.kind==='dossier'){
   if(p.monitoringFollowup){validateMonitoringFollowup(db,topic,row);if(!reviewHasActiveScope(topic.monitoringReview.triggers,holdingSymbols()))throw Error('持仓已结束');}
   if(p.financialFollowup){validateFinancialFollowup(db,topic,row);if(p.financialFollowup.schema===HOLDINGS_FINANCIAL_VERSION&&!holdingSymbols().includes(p.financialFollowup.proof.symbol))throw Error('持仓已结束');}
   if(p.identityFollowup&&!identityResearchOrigin(db,topic))throw Error('身份接续历史缺失');
   if(p.documentFollowup&&!currentDocumentResearch(store,research,topic))throw Error('附件范围已变化，旧输入不能继续');
   if(((p.documentFollowup||p.identityFollowup||p.financialFollowup||p.monitoringFollowup)?topic.dossier?.sourceModelRun?.id!==(p.documentFollowup||p.identityFollowup||p.financialFollowup||p.monitoringFollowup).baseRunId:!!topic.dossier)||digest(eventComparisonSnapshot(db,{id:topic.id,revision:1}))!==p.eventHash)throw Error('事项依据已变化或已有研判');
  }
  const packet=row.kind==='extract'?materialEventsPacket(store,research,row.topic_id,p.request):row.kind==='identity'?companyEntitiesPacket(store,research,row.topic_id,{...p.request,version:identityVersion??p.topicVersion},p.packet):useStoredOutputContract(research.packet(row.topic_id),p.packet);
  if(identityVersion!==undefined)packet.sourceResearchVersion=p.packet.sourceResearchVersion;
  if(fingerprint(row.kind,packet)!==p.executionHash||fingerprint(row.kind,p.packet)!==p.executionHash)throw Error('输入材料或提示词已变化');
  return p;
 }
 // Read-only links to the actual created occurrences, not the source draft.
 // Resolve the original run directly; the recent-30 jobs list is not authority.
 function resultLinks(row){
  const p=JSON.parse(row.payload);if(row.kind!=='extract'||!p.automatic)return null;
  const result={state:'waiting',shared:!!p.duplicateOf,items:[],unavailable:0};
  try{
   valid(row);duplicates.validate(row);
   const original=p.duplicateOf?read(p.duplicateOf.jobId):row,run=runOf(original);
   if(!run)return result;
   if(run.stale)throw Error('原事项依据变化');
   if(run.status!=='candidate')return result;
   result.state=run.candidate.decomposition.events.length?'available':'no-signal';
   for(const [index,history] of run.reviews.entries()){
    const decision=history[0];if(decision?.action!=='create')continue;
    try{
     const topic=research.get(decision.topicId),scope=eventComparisonSnapshot(db,{id:topic.id,revision:1});
     if(scope.eventProvenance.runId!==run.id||scope.eventProvenance.eventIndex!==index||scope.eventProvenance.sourceTopicId!==original.topic_id)throw Error('事项关联不匹配');
     result.items.push({topicId:topic.id,title:topic.title,version:topic.version,hasDossier:!!topic.dossier});
    }catch{result.unavailable++;}
   }
   return result;
  }catch{return {...result,state:'changed',items:[],unavailable:0};}
 }
 function view(row){
  const p=JSON.parse(row.payload),run=runOf(row);let stale=!!run?.stale;
  try{
   if(p.automatic&&row.status==='completed'&&row.kind!=='extract'){
    if(store.newsById(p.newsId)?.revision!==p.newsRevision||p.configHash!==configHash())throw Error('来源或配置已变化');
    const topic=research.get(row.topic_id);if(topic.status==='archived')throw Error('研究已归档');
    if(row.kind==='identity'){if(companyEntitiesPacket(store,research,topic.id,{...p.request,version:topic.version},p.packet).inputHash!==p.packet.inputHash)throw Error('身份依据变化');}
    else if(topic.version!==p.adoptedVersion||topic.dossier?.sourceModelRun?.id!==row.run_id)throw Error('研判已变化');
   }else valid(row);
   if(p.duplicateOf)duplicates.validate(row);
  }catch{stale=true;}
  const status=row.status==='running'?(run?.status||row.status):row.status;
  let reason=p.reason||run?.failure?.message||null;
  if(row.status==='running'){
   if(status==='running')reason={extract:'正在识别事项',identity:'正在核对公司身份',dossier:'正在形成研判'}[row.kind];
   else if(['failed','interrupted'].includes(status))reason=p.automatic?(run?.failure?.code==='timeout'?'本次调用超时，后台将按原限次规则处理；失败记录保留':'本次调用未完成，后台将按原限次规则处理；失败记录保留'):run?.failure?.message||'本次调用未完成';
   else if(status==='candidate')reason=p.automatic?'模型结果已返回，后台正在核对并保存':'模型候选已返回，等待本人复核';
   else if(status==='adopted')reason='研判已保存，正在接续后续流程';
   else if(status==='cancelled')reason='本次调用已取消，保留记录，不自动重启';
  }
  return {id:row.id,itemId:row.item_id,topicId:row.topic_id,kind:row.kind,title:p.title,status,automatic:!!p.automatic,retryAt:row.status==='queued'?p.retryAt||null:null,identityOutcome:p.identityOutcome||null,prices:p.prices||null,researchPrices:!!p.researchPrices,financial:p.financial||null,financialSources:!!p.financialSources,unresolved:p.unresolved||[],runId:row.run_id,stale,
   reason,researchResults:resultLinks(row),duplicateOf:p.duplicateOf||null,monitoringFollowup:p.monitoringFollowup?{baseVersion:p.monitoringFollowup.baseVersion,sourceJobId:p.monitoringFollowup.sourceJobId}:null,financialFollowup:p.financialFollowup?{baseVersion:p.financialFollowup.baseVersion,sourceJobId:p.financialFollowup.sourceJobId,symbol:p.financialFollowup.proof.symbol}:null,identityFollowup:p.identityFollowup?{baseVersion:p.identityFollowup.baseVersion,sourceJobId:p.identityFollowup.sourceJobId}:null,documentFollowup:p.documentFollowup?{baseVersion:p.documentFollowup.baseVersion,sourceJobId:p.documentFollowup.sourceJobId}:null,documentPreparation:p.documentPreparation||null,eventCount:row.kind==='extract'&&run?.status==='candidate'&&!run.stale?run.candidate.decomposition.events.length:null,
   relationCoverage:relations?.coverage(row.id)||p.relationCoverage||null,parentJobId:p.parentJobId||null,createdAt:p.createdAt,attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id)};
 }
 const insert=(row,p)=>db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(row.id,row.item_id,row.topic_id,row.kind,row.status,JSON.stringify(p));
 const childPlan=(parent,topic,kind,origin)=>{
  const m=[...topic.evidence].reverse().find(e=>e.materialId);if(!m)throw Error('正文材料缺失');
  const request={version:topic.version,materialId:m.materialId,revision:m.materialRevision,...(kind==='identity'&&origin.automatic?{identityContextVersion:EVENT_IDENTITY_CONTEXT_VERSION}:{}),...(kind==='identity'&&origin.automatic&&directories?{directoryBasis:directories.freezeBasis()}: {})};
  const packet=kind==='identity'?companyEntitiesPacket(store,research,topic.id,request):origin.automatic?automaticResearchPacket(research.packet(topic.id)):research.packet(topic.id);
  return {id:digest({kind:'event-'+kind,topic:topic.id}),item_id:parent.item_id,topic_id:topic.id,kind,status:'queued',payload:{researchPrices:!!origin.researchPrices,financialSources:!!origin.financialSources,automatic:!!origin.automatic,newsId:origin.newsId,newsRevision:origin.newsRevision,title:topic.title,topicVersion:topic.version,parentJobId:parent.id,configHash:origin.configHash,request,eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),packet,executionHash:fingerprint(kind,packet),createdAt:at()}};
 };
 const automation=entities?openPipelineEventAutomation({db,store,research,models,extractions,entities,now,guard,transaction,audit,read,runOf,valid,insert,childPlan,relations,configHash}):null;
 const followup=openDocumentFollowup(store,research,{now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid});
 const holdingsReview=openHoldingsReview(store,research,{holdingSymbols,getReviewContext,now,guard,transaction,audit,settings,configHash,fingerprint,insert,valid});
 const holdingsFinancial=openHoldingsFinancial(store,research,{sources:financialSources,holdingSymbols,now,guard,transaction,audit,settings,configHash,fingerprint,insert,valid});
 const financialFollowup=openFinancialFollowup(store,research,{sources:financialSources,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid});
 const identityFollowup=openIdentityFollowup(store,research,{entities,directories,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid});
 const attachmentIdentities=openAttachmentIdentities(store,research,{entities,directories,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid});
 const stageKey='research_pipeline_event_next_kind',preparationKey='research_pipeline_event_preparation_turn',stages=['extract','identity','dossier'];
 function nextQueued(){
  const financialFilter=(settings().automatic&&settings().financialSources?'':" AND coalesce(json_extract(payload,'$.financialFollowup.schema'),'')!='holdings-financial-refresh/1'")+(settings().automatic?'':" AND json_type(payload,'$.monitoringFollowup') IS NULL");
  if(!settings().automatic)return db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE status='queued' AND coalesce(json_extract(payload,'$.retryAt'),0)<=?"+financialFilter+" ORDER BY rowid LIMIT 1").get(now());
  const saved=db.prepare('SELECT value FROM settings WHERE key=?').get(stageKey)?.value,start=Math.max(0,stages.indexOf(saved));
  const order=stages.map((_,i)=>stages[(start+i)%stages.length]);
  // A multi-event article must not spend the entire allowance on identities
  // while an already identified event waits for its first useful dossier.
  // Use the existing kind/status index rather than sorting every large packet.
  for(const kind of order){const row=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind=? AND status='queued' AND coalesce(json_extract(payload,'$.retryAt'),0)<=?"+financialFilter+" ORDER BY rowid LIMIT 1").get(kind,now());if(row)return row;}
  return null;
 }
 // Call within the model-link transaction, or when a preparation turn yields.
 // A busy lease / exhausted allowance never consumes a stage's turn.
 function advanceStage(row,context){
  context.assertActive();guard();if(!settings().automatic)return;
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(stageKey,stages[(stages.indexOf(row.kind)+1)%stages.length]);
  db.prepare('DELETE FROM settings WHERE key=?').run(preparationKey);
 }
 // Keep a dossier's model turn across up to three input preparation attempts
 // (one company's day, minute and financial inputs). Each scheduler step still
 // does at most one preparation; other pipeline lanes retain their own turns.
 // Reserve before I/O so pauses/restarts cannot reset the bound. A fourth input
 // yields without starting work; a ready dossier dispatches on its next step.
 function reservePreparation(row,context){
  return transaction(()=>{
   context.assertActive();guard();if(!settings().automatic)return true;
   const value=db.prepare('SELECT value FROM settings WHERE key=?').get(preparationKey)?.value,turn=value?JSON.parse(value):null;
   const steps=turn?.jobId===row.id&&Number.isSafeInteger(turn.steps)&&turn.steps>0?turn.steps:0;
   if(steps>=3){advanceStage(row,context);return false;}
   db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(stageKey,'dossier');
   db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(preparationKey,JSON.stringify({jobId:row.id,steps:steps+1}));
   return true;
  });
 }
 const duplicates=openPipelineDuplicateSources({db,store,valid,runOf,now,transaction,guard,audit});
 const api={
  sourceResults(source){
   const p=JSON.parse(source.payload);if(!p.eventJobId)return null;
   try{const row=read(p.eventJobId),basis=JSON.parse(row.payload);if(row.item_id!==source.id||row.topic_id!==source.topic_id||basis.newsId!==source.news_id||basis.newsRevision!==source.revision)throw Error('来源结果关联不匹配');return resultLinks(row);}
   catch{return {state:'changed',shared:false,items:[],unavailable:0};}
  },
  plan(item,topic){
   const m=[...topic.evidence].reverse().find(e=>e.materialId);if(!m)throw Error('正文材料缺失');
   const request={version:topic.version,materialId:m.materialId,revision:m.materialRevision},packet=materialEventsPacket(store,research,topic.id,request);
   return duplicates.plan({id:digest({item:item.id,kind:'extract'}),item_id:item.id,topic_id:topic.id,kind:'extract',status:'queued',payload:{researchPrices:!!JSON.parse(item.payload||'{}').configuration?.researchPrices,financialSources:!!JSON.parse(item.payload||'{}').configuration?.financialSources,automatic:!!JSON.parse(item.payload||'{}').configuration?.automatic,newsId:item.news_id,newsRevision:item.revision,title:topic.title,topicVersion:topic.version,request,packet,executionHash:fingerprint('extract',packet),configHash:configHash(),createdAt:at()}});
  },
  // Called in the source dossier's model transaction, before any external call.
  persist(plan){const row={...plan,payload:JSON.stringify(plan.payload)};valid(row);duplicates.validate(row);insert(plan,plan.payload);audit(plan.item_id,'event-extraction-planned',{jobId:plan.id,inputHash:plan.payload.packet.inputHash});},
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
      if(directories&&!directories.ready())continue;
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
   return {counts,holdingsFinancial:holdingsFinancial.snapshot(),items:db.prepare('SELECT * FROM research_pipeline_event_jobs ORDER BY rowid DESC LIMIT 30').all().map(view)};
  },
  retry(id){return transaction(()=>{const row=read(id);if(!['failed','cancelled','interrupted'].includes(view(row).status))throw Error('只有失败、取消或中断事项调用可以重试');valid(row);db.prepare("UPDATE research_pipeline_event_jobs SET status='queued',run_id=NULL WHERE id=?").run(id);audit(row.item_id,'event-job-retry',{jobId:id,previousRun:row.run_id});return view(read(id));});},
  reviewHoldings(context){return holdingsReview.step(context);},
  refreshHoldingsFinancial(context){return holdingsFinancial.step(context);},
  prepareDocuments(context){context.assertActive();guard();automation?.refreshSources(context);return followup.step(context);},
  async step(context){
   context.assertActive();guard();api.scan(context);automation?.refreshSources(context);
   const settled=automation?.settle(context);if(settled)return settled;
   const duplicate=duplicates.step(context);if(duplicate)return duplicate;
   const redundantIdentity=identityFollowup.discardRedundant(context);if(redundantIdentity)return redundantIdentity;
   const attachmentPrepared=attachmentIdentities.step(context);if(attachmentPrepared)return attachmentPrepared;
   const identityPrepared=identityFollowup.step(context);if(identityPrepared)return identityPrepared;
   const financialPrepared=financialFollowup.step(context);if(financialPrepared)return financialPrepared;
   const row=nextQueued();if(!row)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   const superseded=()=>{transaction(()=>{context.assertActive();guard();const p=JSON.parse(row.payload);db.prepare("UPDATE research_pipeline_event_jobs SET status='observing',payload=? WHERE id=?").run(JSON.stringify({...p,documentScopeChanged:true,reason:'附件范围已变化，后台追加新版输入；原任务保留'}),row.id);audit(row.item_id,'document-research-superseded',{jobId:row.id});advanceStage(row,context);});return {ok:true,documentScopeChanged:row.id};};
   if(!JSON.parse(row.payload).identityFollowup&&!JSON.parse(row.payload).financialFollowup&&!JSON.parse(row.payload).monitoringFollowup&&documentGenerationChanged(store,research,row,configHash()))return superseded();
   let p;try{p=valid(row);}catch{
    transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_event_jobs SET status='invalidated' WHERE id=? AND status='queued'").run(row.id);audit(row.item_id,'event-job-invalidated',{jobId:row.id});advanceStage(row,context);});return {ok:true,invalidated:true};
   }
   if(row.kind==='dossier'&&p.automatic&&!p.financialFollowup&&p.researchPrices&&settings().researchPrices&&priceSources){
    const result=await prepareEventPrices({db,research,sources:priceSources,row,p,context,now,guard,settings,read,valid,transaction,audit,fingerprint,beforePrepare:()=>reservePreparation(row,context)});if(result){if(result.researchPrice==='retry')transaction(()=>advanceStage(row,context));return result;}
   }
   if(row.kind==='dossier'&&p.automatic&&p.financialSources&&settings().financialSources&&financialSources){
    const result=await prepareEventFinancials({db,research,sources:financialSources,row,p,context,now,guard,settings,read,valid,transaction,audit,fingerprint,beforePrepare:()=>reservePreparation(row,context)});if(result){if(result.financialSource==='retry')transaction(()=>advanceStage(row,context));return result;}
   }
   if((p.identityFollowup||p.financialFollowup||p.monitoringFollowup)&&documentGenerationChanged(store,research,row,configHash()))return superseded();
   const relationItem={id:row.id,news_id:p.newsId,revision:p.newsRevision},relationPlan=row.kind==='dossier'&&!p.automatic&&relations&&!p.relationCoverage?relations.plan(relationItem,research.get(row.topic_id)):null;
   const link=run=>{
    context.assertActive();guard();valid(row);const latest=read(row.id);
    if(latest.status!=='queued'||latest.payload!==row.payload||fingerprint(row.kind,run.packet)!==p.executionHash)throw Error('事项队列或模型输入已变化');
    if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
    if(relationPlan)relations.persist(relationItem,relationPlan);
    db.prepare("UPDATE research_pipeline_event_jobs SET status='running',run_id=?,payload=? WHERE id=?").run(run.id,JSON.stringify({...p,...(relationPlan?{relationCoverage:relationPlan.coverage}:{})}),row.id);
    db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());
    audit(row.item_id,'event-job-started',{jobId:row.id,runId:run.id,kind:row.kind,inputHash:run.packet.inputHash});
    advanceStage(row,context);
   };
   const identityRequest=row.kind==='identity'?{version:p.request.version,materialId:p.request.materialId,revision:p.request.revision,requestId:randomUUID()}:null;
   const run=row.kind==='extract'?extractions.start(row.topic_id,{...p.request,requestId:randomUUID()},link):row.kind==='identity'?(p.automatic?entities.startAutomatic(row.topic_id,identityRequest,link,SYSTEM_RESEARCH_ACTOR,p.request.directoryBasis,p.request.identityContextVersion,p.previousRunId,p.packet):entities.start(row.topic_id,identityRequest,link,p.request.directoryBasis,p.request.identityContextVersion,null,p.packet)):p.automatic?models.startAutomatic(row.topic_id,{version:p.topicVersion},link,SYSTEM_RESEARCH_ACTOR,p.previousRunId,p.packet):models.start(row.topic_id,{version:p.topicVersion},link,p.packet);
   return {ok:true,eventJobId:row.id,runId:run.id};
  }
 };
 return api;
}
