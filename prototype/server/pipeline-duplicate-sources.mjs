import {digest} from './codex-research.mjs';

// Reuse a workflow, not a model response. Both entries must first archive the
// same immutable material. Never rewrite the original source, model run or event.
export function openPipelineDuplicateSources({db,store,valid,runOf,now,transaction,guard,audit}){
 db.exec("CREATE INDEX IF NOT EXISTS pipeline_extract_material ON research_pipeline_event_jobs(json_extract(payload,'$.packet.input.material.id')) WHERE kind='extract' AND json_extract(payload,'$.automatic')=1 AND json_extract(payload,'$.duplicateOf') IS NULL");
 const parse=row=>JSON.parse(row.payload),source=id=>db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(id);
 const scope=row=>{
  const p=valid(row),s=source(row.item_id),input=s&&parse(s),news=store.newsById(p.newsId);
  if(row.kind!=='extract'||!p.automatic||!input?.configuration?.automatic||!news||news.revision!==p.newsRevision||s.news_id!==p.newsId||s.revision!==p.newsRevision||s.topic_id!==row.topic_id)throw Error('重复来源依据已变化');
  return {p,s,hash:digest({schema:p.packet.schema,material:p.packet.input.material,url:news.url,configuration:input.configuration,sourceExecutionHash:input.executionHash,configHash:p.configHash,researchPrices:p.researchPrices,financialSources:p.financialSources})};
 };
 function owner(row,ref){
  const current=scope(row),peer=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(ref.jobId);
  if(ref.schema!=='duplicate-source/1'||ref.materialId!==current.p.packet.input.material.id||ref.materialRevision!==current.p.packet.input.material.revision)throw Error('重复来源材料记录不符');
  if(!peer||peer.id===row.id||peer.item_id===row.item_id||parse(peer).duplicateOf)throw Error('重复来源不能循环关联');
   const shared=scope(peer),run=runOf(peer);
   if(['superseded','invalidated'].includes(shared.s.status))throw Error('原来源任务已失效');
  if(current.p.newsId===shared.p.newsId||shared.hash!==current.hash||ref.scopeHash!==current.hash||ref.itemId!==peer.item_id||ref.topicId!==peer.topic_id||ref.newsId!==shared.p.newsId||ref.newsRevision!==shared.p.newsRevision||run?.stale)throw Error('共用研究依据已变化');
  return shared;
 }
 return {
  plan(plan){
   const row={...plan,payload:JSON.stringify(plan.payload)};
   if(!plan.payload.automatic)return plan;
   const current=scope(row),candidates=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='extract' AND item_id<>? AND json_extract(payload,'$.automatic')=1 AND json_extract(payload,'$.duplicateOf') IS NULL AND json_extract(payload,'$.packet.input.material.id')=? ORDER BY rowid").all(row.item_id,plan.payload.packet.input.material.id);
   for(const candidate of candidates){
    let ref;try{const p=parse(candidate);ref={schema:'duplicate-source/1',jobId:candidate.id,itemId:candidate.item_id,topicId:candidate.topic_id,newsId:p.newsId,newsRevision:p.newsRevision,materialId:plan.payload.packet.input.material.id,materialRevision:plan.payload.packet.input.material.revision,scopeHash:current.hash};owner(row,ref);}catch{continue;}
    return {...plan,status:'waiting-source',payload:{...plan.payload,duplicateOf:ref,reason:'已读正文与已有入口完全相同，等待原研究完成；不重复提取事项或生成研判'}};
   }
   return plan;
  },
  validate(row){const ref=parse(row).duplicateOf;if(ref){if(ref.schema!=='duplicate-source/1'||ref.materialId!==parse(row).packet.input.material.id||ref.materialRevision!==parse(row).packet.input.material.revision)throw Error('重复来源记录不符');owner(row,ref);}},
  step(context){
   const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='extract' AND status='waiting-source' AND json_extract(payload,'$.duplicateOf.schema')='duplicate-source/1' ORDER BY rowid").all();
   for(const row of rows){
    context.assertActive();guard();const p=parse(row);let status,reason;
    try{
     const shared=owner(row,p.duplicateOf);
     if(['completed','no-signal'].includes(shared.s.status)){status='reused';reason=shared.s.status==='no-signal'?'同一正文的研究未发现具体事项；沿用原结果，不产生新的独立证据':'同一正文已完成研究，沿用原事项与研判；本入口记录保留，不重复创造机会';}
     else if(['observing','failed','cancelled','invalidated','superseded'].includes(shared.s.status)){status='observing';reason='同一正文的原研究尚无可沿用的完整结果；保留原失败或取消，不借另一入口重新消耗调用额度';}
     else continue;
    }catch{status='invalidated';reason='共用研究的来源、正文、配置或版本已变化；保留原关联，不把旧判断当当前结果';}
    transaction(()=>{context.assertActive();guard();const current=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(row.id);if(current.status!==row.status||current.payload!==row.payload)throw Error('重复来源队列已变化');db.prepare('UPDATE research_pipeline_event_jobs SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...p,reason,finishedAt:new Date(now()).toISOString()}),row.id);audit(row.item_id,'duplicate-source-'+status,{jobId:row.id,ownerJobId:p.duplicateOf.jobId,reason});});
    return {ok:true,duplicateSource:row.id,status};
   }
   return null;
  }
 };
}
