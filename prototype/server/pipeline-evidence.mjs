import {openLinkedEvidence,LINKED_EVIDENCE_POLICY,LINKED_EVIDENCE_HASH} from './pipeline-linked-evidence.mjs';
import {digest} from './codex-research.mjs';
import {describeNews} from './event-continuity.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {recallEvidenceNews,EVIDENCE_RECALL_POLICY,EVIDENCE_RECALL_HASH} from './evidence-recall.mjs';

// Follow-up owns discovery plans only. Materials, model calls, comparisons and
// grouping retain their existing owners, limits, immutable inputs and history.
export function openPipelineEvidence(store,research,relations,{now=Date.now,guard,transaction,audit,settings,executionHash,setState,enqueueLinked}={}){
 const db=store.db,at=()=>new Date(now()).toISOString(),parse=row=>JSON.parse(row.payload);
 db.exec(`CREATE TABLE IF NOT EXISTS research_evidence_searches(id TEXT PRIMARY KEY,anchor_id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS evidence_search_anchor ON research_evidence_searches(anchor_id);`);
 const read=id=>db.prepare('SELECT * FROM research_evidence_searches WHERE id=?').get(id);
 const item=id=>db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(id);
 const currentResearch=ref=>{try{const t=research.get(ref.id);return t.status==='active'&&t.version===ref.version&&digest(eventComparisonSnapshot(db,{id:t.id,revision:1}))===ref.eventBasisHash;}catch{return false;}};
 let settleCursor=0;
 function validAnchor(p){
  const n=store.newsById(p.anchor.newsId);if(!n||n.revision!==p.anchor.newsRevision)throw Error('原新闻已有修订，旧检索保留');
  const t=research.get(p.anchor.topicId);if(t.status!=='active'||t.version!==p.anchor.topicVersion)throw Error('原研究已被修改或归档，旧检索保留');
  if(p.anchor.kind==='event'&&digest(eventComparisonSnapshot(db,{id:t.id,revision:1}))!==p.anchor.eventBasisHash)throw Error('事项原文或选择依据已变化，旧检索保留');
  if(p.executionHash!==executionHash()||p.rulesHash!==(p.policy===LINKED_EVIDENCE_POLICY?LINKED_EVIDENCE_HASH:EVIDENCE_RECALL_HASH))throw Error('模型或检索规则已变化，旧计划不继续');
  if(p.anchor.kind==='source'){
   const source=item(p.anchor.id),s=source&&parse(source);
   if(!source||!['failed','observing','ready','preparing'].includes(source.status)||s.preparationFailure!=='source-unavailable')throw Error('原文准备状态已变化，替代检索仅供历史查看');
  }
  if(p.policy===LINKED_EVIDENCE_POLICY)linked.valid(p);
  return t;
 }
 function view(row){
  const p=parse(row),latest=db.prepare("SELECT id FROM research_evidence_searches WHERE anchor_id=? AND json_extract(payload,'$.policy')=? ORDER BY rowid DESC LIMIT 1").get(row.anchor_id,p.policy)?.id===row.id;let current=true,reason=p.reason;
  try{validAnchor(p);}catch(e){current=false;reason=e.message;}
  const candidates=p.candidates.map(c=>{
   const source=item(c.pipelineId),fresh=store.newsById(c.newsId)?.revision===c.revision;
   const pairs=(c.pairIds||[]).map(id=>relations.get(id));
   return {...c,sourceStatus:source?.status||'missing',topicId:source?.topic_id||null,current:fresh&&(c.researchRefs||[]).every(currentResearch)&&pairs.every(r=>!r.stale&&(r.status!=='completed'||r.active)),pairs};
  });
  if(candidates.some(c=>!c.current)){current=false;reason='补充来源或比较依据已有变化，旧检索与结果保留';}
  return {id:row.id,...p,status:!current?'invalidated':latest?row.status:'historical',current:current&&latest,latest,reason:current&&!latest?'已有新一轮检索；这条记录保留当时的范围与结果':reason,candidates};
 }
 function anchors(){
  const completed=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed' AND json_extract(payload,'$.automatic')=1 ORDER BY rowid DESC LIMIT 500").all();
  const failed=db.prepare("SELECT * FROM research_pipeline_items WHERE status IN ('failed','observing') AND json_extract(payload,'$.configuration.automatic')=1 AND json_extract(payload,'$.preparationFailure')='source-unavailable' ORDER BY rowid DESC LIMIT 500").all();
  return [...completed.map(r=>({row:r,kind:'event'})),...failed.map(r=>({row:r,kind:'source'}))].flatMap(({row,kind})=>{
   const p=parse(row);let topic;try{topic=research.get(row.topic_id);}catch{return [];}
   if(topic.status!=='active'||topic.version!==(kind==='event'?p.adoptedVersion:p.preparedTopicVersion))return [];
   const news=store.newsById(kind==='event'?p.newsId:row.news_id),revision=kind==='event'?p.newsRevision:row.revision;
   if(!news||news.revision!==revision)return [];
   const missing=kind==='event'?topic.dossier?.missingEvidence||[]:['原新闻正文未能读取'];
   if(!missing.length||kind==='event'&&!topic.eventExtraction)return [];
   let eventBasisHash=null;try{if(kind==='event')eventBasisHash=digest(eventComparisonSnapshot(db,{id:topic.id,revision:1}));}catch{return [];}
   return [{id:row.id,kind,topicId:topic.id,topicVersion:topic.version,title:topic.title,newsId:news.id,newsRevision:revision,missing,news,event:topic.eventExtraction?.event,eventBasisHash}];
  });
 }
 const linked=openLinkedEvidence(store,research,{anchors,validAnchor,executionHash,enqueueLinked,audit,guard,now});
 function scan(context){
  // Match only revisions that opted into automatic processing when discovered.
  // Turning automation on later never reactivates the old manual inbox.
  const rows=db.prepare('SELECT id,revision FROM news ORDER BY rowid DESC LIMIT 2000').all();
  const pool=rows.flatMap(n=>{const r=db.prepare("SELECT * FROM research_pipeline_items WHERE news_id=? AND revision=? ORDER BY rowid DESC LIMIT 1").get(n.id,n.revision);return r&&parse(r).configuration.automatic?[{news:store.newsById(n.id),item:r}]:[];});
  for(const entry of pool)entry.description=describeNews(entry.news);
  const last=new Map(db.prepare("SELECT anchor_id,max(rowid) latest FROM research_evidence_searches WHERE json_extract(payload,'$.policy')=? GROUP BY anchor_id").all(EVIDENCE_RECALL_POLICY).map(r=>[r.anchor_id,r.latest]));
  const sources=anchors().sort((a,b)=>(last.get(a.id)||0)-(last.get(b.id)||0)||a.id.localeCompare(b.id));
  for(const anchor of sources){
   const matches=recallEvidenceNews(anchor,pool),basis={anchor:{...anchor,news:undefined,event:undefined},rulesHash:EVIDENCE_RECALL_HASH,executionHash:executionHash(),matches:matches.map(c=>[c.newsId,c.revision,c.pipelineId])};
   const id=digest(basis);if(read(id))continue;
   const selected=matches.slice(0,3),p={anchor:basis.anchor,automatic:true,policy:EVIDENCE_RECALL_POLICY,rulesHash:basis.rulesHash,executionHash:basis.executionHash,createdAt:at(),updatedAt:at(),coverage:{newsIndexed:rows.length,newsTotal:db.prepare('SELECT count(*) n FROM news').get().n,automaticRevisions:pool.length,anchorsConsidered:sources.length,maximumEventAnchors:500,maximumFailedSources:500,matches:matches.length,selected:selected.length,maximumCandidates:3,windowDays:90},candidates:[],reason:selected.length?'相关线索进入原研究队列，缺口是否补齐仍需后续研判':'本次已收新闻范围未发现可用线索；等待新的相关输入，不要求本人处理'};
   transaction(()=>{
    context.assertActive();validAnchor(p);
    for(const c of selected){const r=item(c.pipelineId),old=parse(r);if(store.newsById(c.newsId)?.revision!==c.revision)throw Error('补充来源已有变化');
     const activated=r.status==='skipped'&&old.configuration.automatic&&old.executionHash===executionHash();
     if(activated)setState(r,'queued',{selectionReason:'evidence-followup',initialSelectionReason:old.selectionReason,evidenceSearchId:id,reason:'相关研究缺少依据，系统按已收新闻线索补充读取；原始初筛保留'});
     p.candidates.push({...c,activated,initialStatus:r.status,status:'pending',pairIds:[],reason:'等待正文与事项研判'});
    }
    db.prepare('INSERT INTO research_evidence_searches VALUES(?,?,?,?)').run(id,anchor.id,selected.length?'pending':'observing',JSON.stringify(p));
    audit(anchor.id,'evidence-search-planned',{searchId:id,anchor:p.anchor,coverage:p.coverage,candidates:p.candidates.map(c=>({newsId:c.newsId,revision:c.revision,activated:c.activated})),reason:p.reason});
   });
   return; // Do not monopolize the discovery tick; source processing continues.
  }
 }
 function candidate(c,p,topic){
  if(store.newsById(c.newsId)?.revision!==c.revision)return {...c,status:'invalidated',reason:'补充来源已修订，原版本记录保留'};
  const source=item(c.pipelineId);
  if(!source)return {...c,status:'observing',reason:'原研究队列记录不可用'};
  if(['queued','ready','preparing','processing','running','failed'].includes(source.status))return {...c,status:'pending',reason:source.status==='failed'?'正文准备失败，原队列限次重试':'沿原队列读取正文、识别事项与公司、保存研判'};
  if(!['completed','observing'].includes(source.status))return {...c,status:source.status==='cancelled'?'cancelled':'observing',reason:parse(source).reason||'补充材料未形成可用研判，保留原结果'};
  const jobs=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE item_id=? AND kind='dossier' AND status='completed' AND json_extract(payload,'$.automatic')=1 ORDER BY rowid").all(source.id);
  const topics=jobs.flatMap(j=>{try{const t=research.get(j.topic_id);eventComparisonSnapshot(db,{id:t.id,revision:1});return t.status==='active'&&t.version===parse(j).adoptedVersion?[t]:[];}catch{return [];}});
  if(!topics.length)return {...c,status:'observing',reason:'没有可比较的当前系统事项研判，保留已有研究'};
  c={...c,researchRefs:topics.map(t=>({id:t.id,version:t.version,eventBasisHash:digest(eventComparisonSnapshot(db,{id:t.id,revision:1}))}))};
  const partial=source.status!=='completed'||topics.length!==jobs.length,scopeNote=partial?'本篇仅部分事项具有当前可用研判；其余缺口和失败保留。':'';
  if(p.anchor.kind==='source')return {...c,partial,scopeNote,status:'researched',reason:'替代线索已独立研判；原文仍不可用，不能确认替代或补齐了原报道'};
  const pairIds=[];
  for(const t of topics){
   const prior=db.prepare(`SELECT * FROM research_pipeline_relations WHERE json_extract(payload,'$.automatic')=1 AND ((json_extract(payload,'$.source.id')=? AND json_extract(payload,'$.source.version')=? AND json_extract(payload,'$.target.id')=? AND json_extract(payload,'$.target.version')=?) OR (json_extract(payload,'$.target.id')=? AND json_extract(payload,'$.target.version')=? AND json_extract(payload,'$.source.id')=? AND json_extract(payload,'$.source.version')=?)) ORDER BY rowid DESC LIMIT 1`).get(t.id,t.version,topic.id,topic.version,t.id,t.version,topic.id,topic.version);
   if(prior){pairIds.push(prior.id);continue;}
   const owner={id:digest({search:p.id,source:t.id,target:topic.id}),news_id:c.newsId,revision:c.revision,automatic:true};
   const plan=relations.plan(owner,t,{targets:[topic.id],reason:'补充材料与原事项逐项比较；召回不代表证据已补齐'});
   relations.persist(owner,plan);pairIds.push(...plan.plans.map(r=>r.id));
  }
  const pairs=pairIds.map(id=>relations.get(id));
  if(pairs.some(r=>r.stale||r.status==='completed'&&!r.active))return {...c,partial,scopeNote,pairIds,status:'invalidated',reason:'事项或比较输入已变化，保留旧计划'};
  if(pairs.some(r=>['queued','running','candidate','failed','interrupted'].includes(r.status)))return {...c,partial,scopeNote,pairIds,status:'pending',reason:'正文与研判已保存，正在逐项核对原事件'};
  const kinds=pairs.filter(r=>r.status==='completed').map(r=>r.comparison?.relation);
  const matched=kinds.some(k=>['repeat','followup','reversal'].includes(k)),related=kinds.some(k=>['related','analogy'].includes(k));
  return {...c,partial,scopeNote,pairIds,status:matched?'matched':related?'related':kinds.length===pairs.length?'unrelated':'observing',reason:matched?'已有同事件系统判断；归组仍需核对全部成员，缺口以新版综合研判为准':related?'仅相关或类比，未作为同事件补证归组':kinds.length===pairs.length?'系统判断不属于同一事件，原研究与比较保留':'关系未知、取消或无法完成，保留缺口观察'};
 }
 function settle(context){
  const next=()=>db.prepare("SELECT rowid seq,* FROM research_evidence_searches WHERE status='pending' AND rowid>? ORDER BY rowid LIMIT 100").all(settleCursor);
  let rows=next();if(!rows.length){settleCursor=0;rows=next();}
  for(const row of rows){
   const p=parse(row);let topic,error;try{topic=validAnchor(p);}catch(e){error=e.message;}
   transaction(()=>{
    context.assertActive();guard();
    if(error){db.prepare("UPDATE research_evidence_searches SET status='invalidated',payload=? WHERE id=?").run(JSON.stringify({...p,reason:error,updatedAt:at()}),row.id);audit(row.anchor_id,'evidence-search-invalidated',{searchId:row.id,reason:error});return;}
    validAnchor(p);const candidates=p.candidates.map(c=>candidate(c,{...p,id:row.id},topic));
    if(digest(candidates)===digest(p.candidates))return;
    const status=candidates.some(c=>c.status==='pending')?'pending':candidates.every(c=>['observing','cancelled','invalidated'].includes(c.status))?'observing':'completed';
    const reason=status==='pending'?'后台继续补充研究与事项比较':status==='completed'?'本轮补充处理结束；这不表示原缺口已核实或全部补齐':'可用依据仍不足，保存尝试与原因；其他研究继续';
    db.prepare('UPDATE research_evidence_searches SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...p,candidates,reason,updatedAt:at()}),row.id);audit(row.anchor_id,'evidence-search-progress',{searchId:row.id,status,reason,candidates:candidates.map(c=>({newsId:c.newsId,status:c.status,pairIds:c.pairIds}))});
   });
   settleCursor=row.seq;
  }
 }
 return {
  hasActiveLinkedRequest(row){return db.prepare("SELECT * FROM research_evidence_searches WHERE json_extract(payload,'$.policy')=? AND status='pending'").all(LINKED_EVIDENCE_POLICY).some(r=>{const p=parse(r);if(!p.candidates.some(c=>c.pipelineId===row.id&&c.newsId===row.news_id&&c.revision===row.revision))return false;try{validAnchor(p);return true;}catch{return false;}});},
  step(context){context.assertActive();guard();if(!settings().automatic)return;linked.scan(context);scan(context);settle(context);},
  snapshot(){const counts={};for(const r of db.prepare('SELECT status,count(*) n FROM research_evidence_searches GROUP BY status').all())counts[r.status]=r.n;return {counts,total:db.prepare('SELECT count(*) n FROM research_evidence_searches').get().n,items:db.prepare('SELECT * FROM research_evidence_searches ORDER BY rowid DESC LIMIT 30').all().map(view),scope:'已收新闻与原文明确链接的有界补充研究；不是全网搜索，未命中不代表没有证据'};},
 };
}
