import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {recallOccurrence} from './event-continuity.mjs';
import {digest} from './codex-research.mjs';
import {comparisonPacket,comparisonPrompt,MATERIAL_SEMANTIC_SCHEMA} from './semantic-events.mjs';

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
  return {id:row.id,itemId:row.item_id,status:row.status==='running'?(run?.status||row.status):row.status,automatic:!!p.automatic,retryAt:p.retryAt||null,runId:row.run_id,source:p.source,target:p.target,reason:p.reason||run?.failure?.message||null,stale,
   scopes:p.packet?[p.packet.input.left.contentScope,p.packet.input.right.contentScope]:null,comparison:run?.status==='candidate'&&!run.stale?run.candidate.comparison:null,createdAt:p.createdAt,
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
 return {
  plan(item,topic){
   const recalled=topic.eventExtraction?recallOccurrence(topic,research.list()):recall(item.news_id),source={id:topic.id,version:topic.version,title:topic.title,kind:topic.eventExtraction?'event':'material'},left=inputRef(topic),seen=new Set();
   const candidates=recalled.items.filter(c=>c.right.id!==topic.id&&c.right.status!=='archived').slice(0,3);
   const plans=candidates.map(c=>{
    const target=research.get(c.right.id),right=inputRef(target),p={...(item.automatic?{automatic:true}:{}),newsId:item.news_id,newsRevision:item.revision,source,target:{id:target.id,version:target.version,title:target.title,kind:target.eventExtraction?'event':'material'},candidateId:c.id,recallReasons:c.reasons,recallRulesHash:recalled.rulesHash,...(topic.eventExtraction?{clusterExpansion:'reviewed-increment-1'}:{}),createdAt:at()};
    let status='queued';
    if(!left||!right){status='skipped';p.reason='两侧尚未都有保存的正文材料；未退回标题比较';}
    else if(refKey(left)===refKey(right)||seen.has(refKey(right))){status='skipped';p.reason='同一材料或重复材料对，不增加独立证据或模型调用';}
    else{seen.add(refKey(right));p.refs={left,right};
     try{p.packet=comparisonPacket(store,p.refs);if(topic.eventExtraction&&p.packet.input.left.documentId===p.packet.input.right.documentId){status='skipped';p.reason='同一来源文档的事项不作为跨报道比较';delete p.refs;}else p.executionHash=fingerprint(p.packet);}
     catch{status='invalidated';p.reason='保存材料已有新修订或不满足比较要求，原研究保留';delete p.refs;}
    }
    return {id:digest({item:item.id,target:target.id}),itemId:item.id,status,payload:p};
   });
   return {plans,coverage:{...recalled.coverage,maximumComparisons:3,recalledTopics:recalled.items.length,selectedTopics:plans.length}};
  },
  // Caller holds the model-run transaction. Existing plans are immutable on retry.
  persist(item,plan){
   for(const r of plan.plans){if(r.status==='queued')valid({payload:JSON.stringify(r.payload)});db.prepare('INSERT OR IGNORE INTO research_pipeline_relations VALUES(?,?,?,NULL,?)').run(r.id,r.itemId,r.status,JSON.stringify(r.payload));}
   audit(item.id,'relations-planned',{coverage:plan.coverage,relationIds:plan.plans.map(r=>r.id)});
  },
  snapshot(){const counts={};for(const r of db.prepare(`SELECT CASE WHEN r.status!='running' THEN r.status WHEN s.status='running' AND s.expires_at<? THEN 'interrupted' ELSE coalesce(s.status,r.status) END status,count(*) n FROM research_pipeline_relations r LEFT JOIN semantic_runs s ON s.id=r.run_id GROUP BY 1`).all(now()))counts[r.status]=r.n;
   return {counts,items:db.prepare('SELECT * FROM research_pipeline_relations ORDER BY rowid DESC LIMIT 30').all().map(view),maximumComparisons:3};
  },
  retry(id){return transaction(()=>{const row=read(id),v=view(row);if(!['failed','cancelled','interrupted'].includes(v.status))throw Error('只有失败、取消或中断比较可以重试');valid(row);db.prepare("UPDATE research_pipeline_relations SET status='queued',run_id=NULL WHERE id=?").run(id);audit(row.item_id,'relation-retry',{relationId:id,previousRun:row.run_id});return view(read(id));});},
  step(context){
   context.assertActive();guard();
   const settled=settle(context);if(settled)return settled;
   const row=db.prepare("SELECT * FROM research_pipeline_relations WHERE status='queued' AND coalesce(json_extract(payload,'$.retryAt'),0)<=? ORDER BY rowid LIMIT 1").get(now());if(!row)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   let p;
   try{p=valid(row);}catch{
    transaction(()=>{context.assertActive();db.prepare("UPDATE research_pipeline_relations SET status='invalidated' WHERE id=? AND status='queued'").run(row.id);audit(row.item_id,'relation-invalidated',{relationId:row.id});});return {ok:true,invalidated:true};
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
