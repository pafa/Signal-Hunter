import {openPipelineRecall,RECALL_PAGE_SIZE} from './pipeline-recall.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {recallOccurrence} from './event-continuity.mjs';
import {digest} from './codex-research.mjs';
import {comparisonPacket,comparisonPrompt,MATERIAL_SEMANTIC_SCHEMA} from './semantic-events.mjs';
import {comparisonGroup,COMPARISON_GROUP_SIZE} from './semantic-multiplex.mjs';

// Opted-in plans settle through the same versioned semantic API; legacy plans remain candidates.
export function openPipelineRelations(store,research,semantic,{config={},now=Date.now,guard,transaction,audit,used,settings,recall}={}){
 const db=store.db,at=()=>new Date(now()).toISOString();
 db.exec(`CREATE TABLE IF NOT EXISTS research_pipeline_relations(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pipeline_relation_item ON research_pipeline_relations(item_id);`);
 const fingerprint=packet=>digest({version:'pipeline-relations-1',packet,prompt:comparisonPrompt(packet),schema:MATERIAL_SEMANTIC_SCHEMA,model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const read=id=>{const row=db.prepare('SELECT * FROM research_pipeline_relations WHERE id=?').get(id);if(!row)throw Error('自动比较条目不存在');return row;};
 const inputRef=t=>{if(t.eventExtraction)return {kind:'event',id:t.id,revision:1};const e=[...t.evidence].reverse().find(e=>e.materialId);return e?{kind:'material',id:e.materialId,revision:e.materialRevision}:null;};
 const refKey=r=>`${r.kind}:${r.id}`;
 function valid(row){
  const p=JSON.parse(row.payload),news=store.newsById(p.newsId);
  if(db.prepare('SELECT state FROM event_link_decisions WHERE candidate_id=? ORDER BY version DESC LIMIT 1').get(p.candidateId)?.state==='dismissed')throw Error('该关联线索已排除');
  if(!news||news.revision!==p.newsRevision)throw Error('来源新闻已有新修订');
  for(const [side,saved] of [['left',p.source],['right',p.target]]){const t=research.get(saved.id);if(t.status==='archived'||t.version!==saved.version)throw Error('研究已有新版本，请核对比较依据');if(t.eventExtraction&&(p.refs[side].kind!=='event'||p.refs[side].id!==t.id))throw Error('事项研究必须按已选择的事项范围比较');}
  if(fingerprint(comparisonPacket(store,p.refs))!==p.executionHash)throw Error('材料、模型或提示词已变化');
  return p;
 }
 const view=row=>{const p=JSON.parse(row.payload),run=row.run_id?semantic.get(row.run_id):null;let stale=!!run?.stale;
  if(p.refs)try{valid(row);}catch{stale=true;}
  return {id:row.id,itemId:row.item_id,status:row.status==='running'?(run?.status||row.status):row.status,automatic:!!p.automatic,retryAt:p.retryAt||null,active:!!run?.active,runId:row.run_id,source:p.source,target:p.target,reason:p.reason||run?.failure?.message||null,stale,
   invocation:run?.invocation||null,scopes:p.packet?[p.packet.input.left.contentScope,p.packet.input.right.contentScope]:null,comparison:run?.status==='candidate'&&!run.stale?run.candidate.comparison:null,createdAt:p.createdAt,
   attempts:db.prepare('SELECT run_id,at FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id)};
 };
 function settle(context){
  const rows=db.prepare("SELECT * FROM research_pipeline_relations WHERE status='running' AND json_extract(payload,'$.automatic')=1 ORDER BY rowid").all();
  for(const row of rows){
   const run=semantic.get(row.run_id),p=JSON.parse(row.payload);
   if(run.status==='running')continue;
   const save=(status,reason,extra={})=>{
    context.assertActive();guard();if(read(row.id).status!=='running'||read(row.id).run_id!==run.id)throw Error('自动比较状态已变化');
    db.prepare('UPDATE research_pipeline_relations SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...p,...extra,reason}),row.id);
    audit(row.item_id,'automatic-relation-'+status,{relationId:row.id,runId:run.id,reason,...extra});
   };
   let invalid=false;try{valid(row);if(run.stale)throw Error();}catch{invalid=true;}
   if(invalid){transaction(()=>save('invalidated','比较输入或研究已有变化，保留旧结果'));return {ok:true,invalidated:true};}
   if(run.status==='candidate'){
    if(run.decision){transaction(()=>save('observing','已有关系决定，保留本人或此前系统处理结果'));}
    else if(run.candidate.comparison.relation==='uncertain'){transaction(()=>save('observing','关系尚不明确，保留比较依据与缺口，继续观察'));}
    else semantic.decide(run.id,{version:0,action:'accept',note:'系统按冻结材料保存关系判断；引用和输入通过校验，事实仍未核实。'},SYSTEM_RESEARCH_ACTOR,()=>{
     valid(row);save('completed','系统关系判断已保存；同事件归组继续校验全部成员');
    });
    return {ok:true,relationId:row.id};
   }
   const attempts=db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(row.id).n;
   if(['failed','interrupted'].includes(run.status)&&attempts<3){
    transaction(()=>{save('queued','比较未完成，后台限次重试',{retryAt:now()+60000*2**Math.max(0,attempts-1)});db.prepare('UPDATE research_pipeline_relations SET run_id=NULL WHERE id=?').run(row.id);});
   }else transaction(()=>save(run.status==='cancelled'?'cancelled':'observing',run.status==='cancelled'?'本次比较已取消，不自动重启':'比较尝试已用完，保留失败与缺口，其他研究继续'));
   return {ok:true,relationId:row.id};
  }
  return null;
 }

 const configHash=()=>digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const policyHash=()=>fingerprint({schema:'event-pair-scoped-1',input:{},inputHash:digest({})});
 function makePlans(item,topic,candidates,rulesHash){
  const source={id:topic.id,version:topic.version,title:topic.title,kind:topic.eventExtraction?'event':'material'},left=inputRef(topic),seen=new Set();
  return candidates.map(c=>{
    let target;try{target=research.get(c.right.id);}catch{}
    const right=target?inputRef(target):null,p={...(item.automatic?{automatic:true}:{}),newsId:item.news_id,newsRevision:item.revision,source,target:{id:c.right.id,version:c.right.version,title:c.right.title,kind:target?.eventExtraction?'event':'material'},candidateId:c.id,recallReasons:c.reasons,recallRulesHash:rulesHash,...(topic.eventExtraction?{clusterExpansion:'reviewed-increment-1'}:{}),createdAt:at()};
    let status='queued';
    if(!target||target.version!==c.right.version||target.status==='archived'){status='invalidated';p.target={id:c.right.id,version:c.right.version,title:c.right.title,kind:'event'};p.reason='召回时的目标研究已变化，保留原范围与缺口';}
    else if(item.automatic&&db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND json_extract(payload,'$.automatic')=1").get(target.id)&&!db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND status='completed'").get(target.id)){status='skipped';p.awaitingTargetDossier=true;p.reason='目标自动研判尚未完成；完成后由该事项的召回继续比较，当前保留缺口';}
    else if(!left||!right){status='skipped';p.reason='两侧尚未都有保存的正文材料；未退回标题比较';}
    else if(refKey(left)===refKey(right)||seen.has(refKey(right))){status='skipped';p.reason='同一材料或重复材料对，不增加独立证据或模型调用';}
    else{seen.add(refKey(right));p.refs={left,right};
     try{p.packet=comparisonPacket(store,p.refs);if(topic.eventExtraction&&p.packet.input.left.documentId===p.packet.input.right.documentId){status='skipped';p.reason='同一来源文档的事项不作为跨报道比较';delete p.refs;}else p.executionHash=fingerprint(p.packet);}
     catch{status='invalidated';p.reason='保存材料已有新修订或不满足比较要求，原研究保留';delete p.refs;}
    }
    return {id:digest({item:item.id,target:c.right.id}),itemId:item.id,status,payload:p};
   });
 }
 const persistPlans=plans=>{
  for(const r of plans){
   // A previous cancellation or decision is not a new queued comparison.
   if(db.prepare('SELECT 1 FROM research_pipeline_relations WHERE id=?').get(r.id))continue;
   if(r.status==='queued')valid({payload:JSON.stringify(r.payload)});
   db.prepare('INSERT INTO research_pipeline_relations VALUES(?,?,?,NULL,?)').run(r.id,r.itemId,r.status,JSON.stringify(r.payload));
  }
 };
 const continuation=openPipelineRecall(store,research,{now,guard,transaction,audit,policyHash,configHash,makePlans,persistPlans});
 return {
  get(id){return view(read(id));},
  plan(item,topic,followup=null){
   if(followup&&(!Array.isArray(followup.targets)||!followup.targets.length||followup.targets.length>3))throw Error('补充比较目标无效');
   const automatic=!!item.automatic&&!!topic.eventExtraction&&!followup;
   const recalled=followup?{items:[...new Set(followup.targets)].map(id=>({id:digest({method:'evidence-followup',source:topic.id,target:id}),right:research.get(id),reasons:[followup.reason]})),coverage:{method:'补充研究与明确原事项逐项比较'},rulesHash:'evidence-followup/1'}:topic.eventExtraction?recallOccurrence(topic,research.list(),{limit:automatic?null:500}):recall(item.news_id);
   recalled.items=recalled.items.filter(c=>c.right.id!==topic.id&&c.right.status!=='archived');
   if(automatic){
    // A previous source may have found this occurrence before its dossier was
    // ready. Preserve that match even if lexical recall is asymmetric now.
    const seen=new Set(recalled.items.map(c=>c.right.id));let deferredMatches=0;
    for(const row of db.prepare("SELECT payload FROM research_pipeline_relations WHERE status='skipped' AND json_extract(payload,'$.awaitingTargetDossier')=1 AND json_extract(payload,'$.target.id')=?").all(topic.id)){
     const previous=JSON.parse(row.payload);if(seen.has(previous.source.id))continue;
     let target;try{target=research.get(previous.source.id);}catch{continue;}
     if(target.status!=='active'||!target.eventExtraction)continue;
     recalled.items.push({id:digest({kind:'ready-occurrence-recall-1',source:topic.id,target:target.id,version:target.version}),right:{id:target.id,version:target.version,title:target.title,status:target.status},reasons:['先前事项已召回本项；本项系统研判完成后接续比较']});seen.add(target.id);deferredMatches++;
    }
    recalled.coverage={...recalled.coverage,deferredMatches};
   }
   const plans=makePlans(item,topic,recalled.items.slice(0,RECALL_PAGE_SIZE),recalled.rulesHash),scan=automatic?continuation.plan(item,topic,recalled):null;
   return {plans,...(scan?{scan}:{}),coverage:{...recalled.coverage,maximumComparisons:automatic?null:3,recalledTopics:recalled.items.length,selectedTopics:plans.length,...(scan?{automatic:true,scanId:scan.id,scopeAt:scan.payload.createdAt,remainingTopics:recalled.items.length-plans.length,pageSize:RECALL_PAGE_SIZE}: {})}};
  },
  // Caller holds the model-run transaction. Existing plans are immutable on retry.
  persist(item,plan){
   persistPlans(plan.plans);if(plan.scan)continuation.persist(plan.scan);
   audit(item.id,'relations-planned',{coverage:plan.coverage,relationIds:plan.plans.map(r=>r.id)});
  },
  coverage(itemId){return continuation.coverage(itemId);},
  snapshot(){const counts={};for(const r of db.prepare(`SELECT CASE WHEN r.status!='running' THEN r.status WHEN s.status='running' AND s.expires_at<? THEN 'interrupted' ELSE coalesce(s.status,r.status) END status,count(*) n FROM research_pipeline_relations r LEFT JOIN semantic_runs s ON s.id=r.run_id GROUP BY 1`).all(now()))counts[r.status]=r.n;
   return {counts,items:db.prepare('SELECT * FROM research_pipeline_relations ORDER BY rowid DESC LIMIT 30').all().map(view),maximumComparisons:3,automaticPageSize:RECALL_PAGE_SIZE,recall:continuation.snapshot()};
  },
  retry(id){return transaction(()=>{const row=read(id),v=view(row);if(!['failed','cancelled','interrupted'].includes(v.status))throw Error('只有失败、取消或中断比较可以重试');valid(row);db.prepare("UPDATE research_pipeline_relations SET status='queued',run_id=NULL WHERE id=?").run(id);audit(row.item_id,'relation-retry',{relationId:id,previousRun:row.run_id});return view(read(id));});},
  step(context){
   context.assertActive();guard();
   const settled=settle(context);if(settled)return settled;
   const recovered=continuation.recover(context);
   // One small page is admitted per lane turn; quota waits keep its cursor intact.
   const advanced=used()<settings().dailyCalls?continuation.advance(context):false;
   const row=db.prepare("SELECT * FROM research_pipeline_relations WHERE status='queued' AND coalesce(json_extract(payload,'$.retryAt'),0)<=? ORDER BY rowid LIMIT 1").get(now());if(!row)return recovered||advanced?{ok:true,recallProgress:true}:continuation.hasPending()&&used()>=settings().dailyCalls?{skipped:'call-limit'}:null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   let p;
   try{p=valid(row);}catch{
    transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_relations SET status='invalidated' WHERE id=? AND status='queued'").run(row.id);audit(row.item_id,'relation-invalidated',{relationId:row.id});});return {ok:true,invalidated:true};
   }
   // Only current automatic event pairs from the same source share a call.
   // Oversized packets fall back to smaller groups. Any retry runs alone so
   // one malformed result cannot exhaust the other pairs' retry budgets.
   const group=[{row,p}];
   if(p.automatic&&p.refs.left.kind==='event'&&p.refs.right.kind==='event'&&!db.prepare('SELECT 1 FROM research_pipeline_attempts WHERE item_id=? LIMIT 1').get(row.id))for(const other of db.prepare("SELECT r.* FROM research_pipeline_relations r WHERE r.item_id=? AND r.id<>? AND r.status='queued' AND coalesce(json_extract(r.payload,'$.retryAt'),0)<=? AND NOT EXISTS (SELECT 1 FROM research_pipeline_attempts a WHERE a.item_id=r.id) ORDER BY r.rowid LIMIT ?").all(row.item_id,row.id,now(),COMPARISON_GROUP_SIZE-1)){
    try{const next=valid(other);if(!next.automatic||next.refs.left.kind!=='event'||next.refs.right.kind!=='event')continue;comparisonGroup([...group.map(g=>g.p.packet),next.packet]);group.push({row:other,p:next});}catch{/* Retain this row for its own validation or single call. */}
   }
   if(group.length>1){
    const runs=semantic.startGroup(group.map(g=>g.p.refs),started=>{
     context.assertActive();guard();if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
     for(let i=0;i<group.length;i++){const {row,p}=group[i],run=started[i];valid(row);if(read(row.id).status!=='queued'||fingerprint(run.packet)!==p.executionHash)throw Error('比较计划已变化');
      db.prepare("UPDATE research_pipeline_relations SET status='running',run_id=? WHERE id=?").run(run.id,row.id);
      db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,run.id,at());
      audit(row.item_id,'relation-started',{relationId:row.id,runId:run.id,inputHash:run.packet.inputHash,invocation:run.invocation});
     }
    },SYSTEM_RESEARCH_ACTOR);
    return {ok:true,relationId:row.id,runId:runs[0].id,groupedComparisons:runs.length};
   }
   const run=semantic.start(p.refs,started=>{
    context.assertActive();guard();valid(row);if(read(row.id).status!=='queued'||fingerprint(started.packet)!==p.executionHash)throw Error('比较计划已变化');
    if(used()>=settings().dailyCalls)throw Error('自动研究调用额度已用完');
    db.prepare("UPDATE research_pipeline_relations SET status='running',run_id=? WHERE id=?").run(started.id,row.id);
    db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(row.id,started.id,at());
    audit(row.item_id,'relation-started',{relationId:row.id,runId:started.id,inputHash:started.packet.inputHash});
   },p.automatic?SYSTEM_RESEARCH_ACTOR:undefined);
   return {ok:true,relationId:row.id,runId:run.id};
  }
 };
}
