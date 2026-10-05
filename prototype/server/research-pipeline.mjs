import {digest,CODEX_PROMPT_VERSION,CODEX_DRAFT_SCHEMA,CODEX_SCHEMA_VERSION} from './codex-research.mjs';
import {RULES_VERSION} from './triage.mjs';
import {READER_VERSION} from './source-reader.mjs';
import {openPipelineRelations} from './pipeline-relations.mjs';
import {openPipelineClusters} from './pipeline-clusters.mjs';
import {openPipelineEvents} from './pipeline-events.mjs';

// This queue proposes research only. It never adopts a model draft or touches orders.
export function openResearchPipeline(store,research,models,{enabled=false,config={},now=Date.now,semantic=null,recall=null,materialEvents=null,batches=null,clusters=null}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_settings(slot INTEGER PRIMARY KEY CHECK(slot=1),version INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_pipeline_items(id TEXT PRIMARY KEY,news_id TEXT NOT NULL,revision INTEGER NOT NULL,rules_hash TEXT NOT NULL,status TEXT NOT NULL,topic_id TEXT,run_id TEXT,payload TEXT NOT NULL,UNIQUE(news_id,revision,rules_hash));
 CREATE TABLE IF NOT EXISTS research_pipeline_attempts(id INTEGER PRIMARY KEY,item_id TEXT NOT NULL,run_id TEXT UNIQUE NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_pipeline_audit(id INTEGER PRIMARY KEY,item_id TEXT,action TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);`);
 db.prepare('INSERT OR IGNORE INTO research_pipeline_settings VALUES(1,1,?)').run(JSON.stringify({dailyCalls:10,includeClues:false}));
 const settings=()=>{const r=db.prepare('SELECT * FROM research_pipeline_settings WHERE slot=1').get();return {extractEvents:false,version:r.version,...JSON.parse(r.payload)};};
 const executionHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000,prompt:CODEX_PROMPT_VERSION,schema:CODEX_DRAFT_SCHEMA,schemaVersion:CODEX_SCHEMA_VERSION,reader:READER_VERSION});
 const audit=(id,action,payload={})=>db.prepare('INSERT INTO research_pipeline_audit(item_id,action,at,payload) VALUES(?,?,?,?)').run(id,action,at(),JSON.stringify(payload));
 const guard=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{guard();const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const read=id=>{const row=db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(id);if(!row)throw Error('自动研究条目不存在');return row;};
 const current=row=>{const n=store.newsById(row.news_id);if(!n||n.revision!==row.revision)throw Error('来源新闻已有新修订');return n;};
 const used=()=>db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE at>=?').get(new Date(now()-86400000).toISOString()).n;
 const view=row=>{const p=JSON.parse(row.payload),run=row.run_id?models.get(row.topic_id,row.run_id):null;let status=run?.status||row.status;
  if(status==='preparing'){const lane=db.prepare("SELECT token,lease_until,paused FROM operation_tasks WHERE name='discovery'").get();if(!lane||lane.paused||lane.token!==p.token||lane.lease_until<=now())status='interrupted';}
  return {id:row.id,newsId:row.news_id,revision:row.revision,title:p.title,status,topicId:row.topic_id,runId:row.run_id,reason:p.reason||run?.failure?.message||null,createdAt:p.createdAt,relationCoverage:p.relationCoverage||null,selectionReason:p.selectionReason||null,attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id)};
 };
 const setState=(row,status,extra={})=>{db.prepare('UPDATE research_pipeline_items SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...JSON.parse(row.payload),...extra}),row.id);audit(row.id,status,extra);};
 const relations=semantic&&recall?openPipelineRelations(store,research,semantic,{config,now,guard,transaction,audit,used,settings,recall}):null;
 const events=materialEvents?openPipelineEvents(store,research,models,materialEvents,{config,now,guard,transaction,audit,used,settings,relations}):null;
 const clusterJobs=batches&&clusters&&semantic?openPipelineClusters(store,research,semantic,batches,clusters,{now,guard,transaction,audit,used,settings}):null;
 const api={
  snapshot(){const lane=db.prepare("SELECT token,lease_until,paused FROM operation_tasks WHERE name='discovery'").get(),counts={};
   const rows=db.prepare(`SELECT CASE WHEN r.status='running' AND r.expires_at<? THEN 'interrupted' WHEN r.status IS NOT NULL THEN r.status WHEN i.status='preparing' AND (? OR json_extract(i.payload,'$.token') IS NOT ?) THEN 'interrupted' ELSE i.status END status,count(*) n FROM research_pipeline_items i LEFT JOIN model_research_runs r ON r.id=i.run_id GROUP BY 1`).all(now(),Number(!lane||!!lane.paused||lane.lease_until<=now()),lane?.token||null);for(const r of rows)counts[r.status]=r.n;return {enabled:enabled&&models.status().enabled,settings:settings(),callsInLast24Hours:used(),counts,relations:relations?.snapshot()||null,events:events?.snapshot()||null,clusters:clusterJobs?.snapshot()||null,items:db.prepare('SELECT * FROM research_pipeline_items ORDER BY rowid DESC LIMIT 30').all().map(view)};},
  configure(input){if(!input||!['dailyCalls,includeClues,version','dailyCalls,extractEvents,includeClues,version'].includes(Object.keys(input).sort().join(','))||!Number.isSafeInteger(input.dailyCalls)||input.dailyCalls<1||input.dailyCalls>100||typeof input.includeClues!=='boolean'||Object.hasOwn(input,'extractEvents')&&typeof input.extractEvents!=='boolean')throw Error('自动研究配置无效');return transaction(()=>{if(input.version!==settings().version)throw Error('自动研究配置已变化，请刷新');db.prepare('UPDATE research_pipeline_settings SET version=version+1,payload=? WHERE slot=1').run(JSON.stringify({dailyCalls:input.dailyCalls,includeClues:input.includeClues,extractEvents:input.extractEvents??settings().extractEvents}));audit(null,'configure',input);return api.snapshot();});},
  retry(id){return transaction(()=>{if(!enabled)throw Error('当前未启用自动研究');const row=read(id),s=view(row).status;if(!['failed','cancelled','interrupted'].includes(s))throw Error('只有失败、取消或中断条目可以重试');current(row);if(JSON.parse(row.payload).executionHash!==executionHash())throw Error('模型或提示词已变化，旧条目需重新核对');db.prepare('UPDATE research_pipeline_items SET run_id=NULL WHERE id=?').run(id);setState(row,row.topic_id?'ready':'queued',{reason:null});return view(read(id));});},
  retryEvent(id){guard();if(!enabled||!events)throw Error('当前未启用自动研究');return events.retry(id);},
  retryRelation(id){guard();if(!enabled||!relations)throw Error('当前未启用自动研究');return relations.retry(id);},
  scan(context){context.assertActive();guard();if(!enabled)return 0;
   const s=settings(),key=`${RULES_VERSION}@${research.screenings.rulesHash}`;
   return transaction(()=>{context.assertActive();const pending=db.prepare(`SELECT n.id,n.revision,t.payload triage FROM news n JOIN triage t ON t.news_id=n.id AND t.news_revision=n.revision AND t.rules_version=? WHERE NOT EXISTS(SELECT 1 FROM research_pipeline_items p WHERE p.news_id=n.id AND p.revision=n.revision AND p.rules_hash=?) ORDER BY n.rowid LIMIT 200`).all(key,research.screenings.rulesHash);
    for(const n of pending){const news=store.newsById(n.id),triage=JSON.parse(n.triage),tracked=n.revision>1&&!!db.prepare("SELECT 1 FROM research_topics WHERE json_extract(payload,'$.sourceNewsId')=? AND json_extract(payload,'$.sourceNewsRevision')<? AND json_extract(payload,'$.status')='active' LIMIT 1").get(n.id,n.revision),selected=tracked||triage.bucket==='review'||s.includeClues&&triage.bucket==='clue',id=digest({news:n.id,revision:n.revision,rules:research.screenings.rulesHash});const payload={title:news.title,createdAt:at(),screening:triage,configuration:s,selectionReason:tracked?'source-revision':'screening',executionHash:executionHash(),reason:selected?null:'当前筛选配置未选择；保留记录供漏筛复核'};db.prepare('INSERT INTO research_pipeline_items VALUES(?,?,?,?,?,NULL,NULL,?)').run(id,n.id,n.revision,research.screenings.rulesHash,selected?'queued':'skipped',JSON.stringify(payload));audit(id,'discovered',{bucket:triage.bucket,selected});}
    return pending.length;
   });
  },
  async step(context){
   context.assertActive();guard();if(!enabled||!models.status().enabled)return {skipped:'model-disabled'};
   api.scan(context);
   const eventWork=events?.step(context);if(eventWork)return eventWork;
   const comparison=relations?.step(context);if(comparison)return comparison;
   const clusterWork=clusterJobs?.step(context);if(clusterWork)return clusterWork;
   const row=db.prepare("SELECT * FROM research_pipeline_items WHERE status IN ('queued','ready') ORDER BY rowid LIMIT 1").get();if(!row)return {skipped:'no-queued-items'};
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   const valid=()=>{context.assertActive();guard();current(row);if(JSON.parse(read(row.id).payload).executionHash!==executionHash())throw Error('模型或提示词已变化，旧条目需重新核对');};
   try{
    valid();
    if(row.status==='queued'){
     const history=research.list().filter(t=>t.sourceNewsId===row.news_id).sort((a,b)=>b.sourceNewsRevision-a.sourceNewsRevision||b.version-a.version||a.id.localeCompare(b.id));
     const existing=history.find(t=>t.sourceNewsRevision===row.revision),previous=history.find(t=>t.sourceNewsRevision<row.revision);
     if(existing){transaction(()=>{valid();setState(row,'needs-review',{reason:'此新闻版本已有研究，保留现有内容，请核对后继续'});});return {skipped:'existing-research'};}
     transaction(()=>{valid();if(read(row.id).status!=='queued')throw Error('队列条目已变化');setState(row,'preparing',{token:context.token});});
     const topic=research.createFromNews({newsId:row.news_id,newsRevision:row.revision},{requireNew:true,revisionOf:previous?{topicId:previous.id,topicVersion:previous.version}:null,beforeWrite:id=>{valid();db.prepare('UPDATE research_pipeline_items SET topic_id=? WHERE id=?').run(id,row.id);}});
     transaction(()=>{valid();db.prepare('UPDATE research_pipeline_items SET topic_id=? WHERE id=?').run(topic.id,row.id);});
     row.topic_id=topic.id;
    }
    let topic=research.get(row.topic_id);
    if(topic.status==='archived'||topic.dossier)throw Error('研究已归档或已有研判，请人工核对');
    if(!topic.evidence.some(e=>e.materialId)){
     // The existing reader enforces public URLs, byte limits and immutable materials.
     topic=await research.readMaterial(topic.id,{version:topic.version,url:current(row).url,stance:'unverified',family:'other',step:'fact',interpretation:'自动读取候选新闻来源；事实、公司影响及正文完整性仍待复核'},valid);
    }
    transaction(()=>{valid();setState(read(row.id),'ready',{reason:null});});
    const relationPlan=relations&&!JSON.parse(read(row.id).payload).relationCoverage?relations.plan(row,topic):null;
    const prepared=JSON.parse(read(row.id).payload),eventPlan=events&&prepared.configuration.extractEvents&&!prepared.eventJobId?events.plan(row,topic):null;
    const started=models.start(topic.id,{version:topic.version},run=>{
     valid();const latest=read(row.id);if(latest.status!=='ready'||latest.run_id)throw Error('队列条目已变化');if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
     if(relationPlan)relations.persist(row,relationPlan);if(eventPlan)events.persist(eventPlan);
     if(relationPlan||eventPlan)setState(latest,'ready',{...(relationPlan?{relationCoverage:relationPlan.coverage}:{}),...(eventPlan?{eventJobId:eventPlan.id}:{})});
     db.prepare("UPDATE research_pipeline_items SET status='running',run_id=? WHERE id=?").run(run.id,row.id);
     db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());audit(row.id,'model-started',{runId:run.id,inputHash:run.packet.inputHash});
    });
    return {ok:true,itemId:row.id,runId:started.id};
   }catch(error){
    context.assertActive();guard();
    if(error.message==='已有模型研判正在运行，请等待或取消后再试')return {skipped:'model-busy'};
    transaction(()=>{const latest=read(row.id);if(latest.run_id)return;setState(latest,'failed',{reason:'自动准备未完成；检查来源、研究版本或模型配置后重试'});});
    return {error:'自动研究准备失败，原新闻和已有研究保留'};
   }
  }
 };
 return api;
}
