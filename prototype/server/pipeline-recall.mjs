import {digest} from './codex-research.mjs';
import {recallOccurrence,CONTINUITY_RULES_HASH} from './event-continuity.mjs';

export const RECALL_PAGE_SIZE=3;

// Freeze lightweight candidate identities once; prepare immutable comparison
// packets only for the next page. The cursor and that page commit together.
export function openPipelineRecall(store,research,{now,guard,transaction,audit,policyHash,configHash,makePlans,persistPlans}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_relation_scans(id TEXT PRIMARY KEY,item_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,cursor INTEGER NOT NULL,turn INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS relation_scan_status ON research_relation_scans(status,turn);`);
 const read=id=>db.prepare('SELECT * FROM research_relation_scans WHERE id=?').get(id);
 const nextTurn=()=>db.prepare('SELECT coalesce(max(turn),0)+1 n FROM research_relation_scans').get().n;
 const source=p=>{
  const t=research.get(p.source.id);
  if(t.status!=='active'||t.version!==p.source.version||!t.eventExtraction||store.newsById(p.item.news_id)?.revision!==p.item.revision)throw Error('原研究或来源已变化，旧召回范围保留');
  if(p.policyHash!==policyHash()||p.rulesHash!==CONTINUITY_RULES_HASH)throw Error('模型、提示词或召回规则已变化，旧范围不继续');
  return t;
 };
 const api={
  plan(item,topic,recalled){
   const id=digest({kind:'automatic-occurrence-scan-1',item:item.id});
   return {id,itemId:item.id,cursor:Math.min(RECALL_PAGE_SIZE,recalled.items.length),payload:{policy:'automatic-occurrence-scan-1',item:{id:item.id,news_id:item.news_id,revision:item.revision,automatic:true},source:{id:topic.id,version:topic.version,title:topic.title},policyHash:policyHash(),rulesHash:recalled.rulesHash,createdAt:at(),coverage:recalled.coverage,candidates:recalled.items}};
  },
  persist(plan){
   source(plan.payload);
   db.prepare('INSERT OR IGNORE INTO research_relation_scans VALUES(?,?,?,?,?,?)').run(plan.id,plan.itemId,plan.cursor<plan.payload.candidates.length?'pending':'scheduled',plan.cursor,nextTurn(),JSON.stringify(plan.payload));
   audit(plan.itemId,'recall-scope-saved',{scanId:plan.id,coverage:plan.payload.coverage,candidates:plan.payload.candidates.length,scheduled:plan.cursor});
  },
  coverage(itemId){
   const row=db.prepare('SELECT * FROM research_relation_scans WHERE item_id=?').get(itemId);if(!row)return null;
   const p=JSON.parse(row.payload),counts={};
   for(const r of db.prepare('SELECT status,count(*) n FROM research_pipeline_relations WHERE item_id=? GROUP BY status').all(itemId))counts[r.status]=r.n;
   let current=row.status!=='invalidated',reason=p.reason||null;try{source(p);}catch(e){current=false;reason=e.message;}
   return {...p.coverage,automatic:true,scanId:row.id,source:p.source,scopeAt:p.createdAt,recalledTopics:p.candidates.length,selectedTopics:row.cursor,remainingTopics:p.candidates.length-row.cursor,pageSize:RECALL_PAGE_SIZE,maximumComparisons:null,status:current?row.status:'invalidated',current,reason,counts};
  },
  hasPending(){return !!db.prepare("SELECT 1 FROM research_relation_scans WHERE status='pending' LIMIT 1").get();},
  snapshot(){
   const counts={};for(const r of db.prepare('SELECT status,count(*) n FROM research_relation_scans GROUP BY status').all())counts[r.status]=r.n;
   return {counts,items:db.prepare('SELECT item_id FROM research_relation_scans ORDER BY rowid DESC LIMIT 30').all().map(r=>api.coverage(r.item_id))};
  },
  // Upgrade only completed, unedited automatic dossiers. Existing comparisons,
  // cancellations and decisions keep their IDs and are never overwritten.
  recover(context){
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='research_pipeline_event_jobs'").get())return false;
   const row=db.prepare(`SELECT j.* FROM research_pipeline_event_jobs j WHERE j.kind='dossier' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1
    AND NOT EXISTS(SELECT 1 FROM research_relation_scans s WHERE s.item_id=j.id) ORDER BY j.rowid LIMIT 1`).get();if(!row)return false;
   const old=JSON.parse(row.payload),item={id:row.id,news_id:old.newsId,revision:old.newsRevision,automatic:true};let plan,reason;
   try{
    const t=research.get(row.topic_id);
    if(t.version!==old.adoptedVersion||t.dossier?.sourceModelRun?.id!==row.run_id||old.configHash!==configHash())throw Error('原系统研判或配置已变化');
    const recalled=recallOccurrence(t,research.list(),{limit:null});plan=api.plan(item,t,recalled);plan.cursor=0;source(plan.payload);
   }catch(e){reason=e.message;plan={id:digest({kind:'automatic-occurrence-scan-1',item:item.id}),itemId:item.id,cursor:0,payload:{item,source:{id:row.topic_id,version:old.adoptedVersion,title:old.title},policyHash:policyHash(),rulesHash:CONTINUITY_RULES_HASH,createdAt:at(),coverage:{topicsIndexed:null,topicsTotal:null},candidates:[],reason}};}
   transaction(()=>{context.assertActive();guard();if(db.prepare("SELECT payload FROM research_pipeline_event_jobs WHERE id=? AND status='completed'").get(row.id)?.payload!==row.payload)throw Error('研判队列已变化');
    if(!reason)source(plan.payload);
    db.prepare('INSERT INTO research_relation_scans VALUES(?,?,?,?,?,?)').run(plan.id,item.id,reason?'invalidated':plan.payload.candidates.length?'pending':'scheduled',0,nextTurn(),JSON.stringify(plan.payload));
    audit(item.id,'recall-scope-recovered',{scanId:plan.id,candidates:plan.payload.candidates.length,reason:reason||'旧自动研判追加完整召回范围，原比较保留'});
   });return true;
  },
  advance(context){
   const row=db.prepare(`SELECT s.* FROM research_relation_scans s WHERE s.status='pending'
    AND NOT EXISTS(SELECT 1 FROM research_pipeline_relations r WHERE r.item_id=s.item_id AND r.status IN ('queued','running')) ORDER BY s.turn,s.rowid LIMIT 1`).get();if(!row)return false;
   const p=JSON.parse(row.payload);let topic,error;try{topic=source(p);}catch(e){error=e.message;}
   transaction(()=>{context.assertActive();guard();if(read(row.id)?.payload!==row.payload||read(row.id)?.cursor!==row.cursor||read(row.id)?.status!=='pending')throw Error('召回进度已变化');
    if(error){db.prepare("UPDATE research_relation_scans SET status='invalidated',payload=? WHERE id=?").run(JSON.stringify({...p,reason:error}),row.id);audit(row.item_id,'recall-scope-invalidated',{scanId:row.id,reason:error});return;}
    source(p);
    const page=p.candidates.slice(row.cursor,row.cursor+RECALL_PAGE_SIZE),plans=makePlans(p.item,topic,page,p.rulesHash);
    persistPlans(plans);
    const cursor=row.cursor+page.length;
    db.prepare('UPDATE research_relation_scans SET cursor=?,status=?,turn=? WHERE id=?').run(cursor,cursor===p.candidates.length?'scheduled':'pending',nextTurn(),row.id);
    audit(row.item_id,'recall-page-scheduled',{scanId:row.id,from:row.cursor,scheduled:cursor,total:p.candidates.length,relationIds:plans.map(r=>r.id)});
   });return true;
  }
 };
 return api;
}
