import {digest} from './codex-research.mjs';
import {PDF_READER_VERSION,pdfReaderLimits} from '../shared/pdf-source.mjs';

const priorErrors=new Set(['PDF超过8 MB，保留读取缺口','PDF格式或容量无效（最大8 MB）','PDF文字超过8万字符，未截断保存']);
const action='automatic-source-capacity-recovery';
// A capability change gives an exhausted source a new, separately recorded
// budget. Total attempts, failures, prior inputs and user stops are never reset.
export function openPreparationRecovery(store,research,{settings,now,transaction,audit,setState,compatible,evidence}){
 const db=store.db,parse=row=>JSON.parse(row.payload),currentLimits=pdfReaderLimits(PDF_READER_VERSION);
 const attempts=row=>db.prepare('SELECT * FROM research_source_attempts WHERE topic_id=? ORDER BY id').all(row.topic_id);
 function validate(row){
  const p=parse(row),proof=p.preparationRecovery;if(!proof)return;
  const saved=db.prepare("SELECT payload FROM research_pipeline_audit WHERE item_id=? AND action=? ORDER BY id DESC LIMIT 1").get(row.id,action);
  let record;try{record=saved&&JSON.parse(saved.payload);}catch{}
  if(!record||digest(record.proof)!==digest(proof)||digest(record.previous)!==proof.previousHash||proof.version!=='source-capacity-recovery/1'||proof.fromReader!=='public-pdf-1'||proof.toReader!==PDF_READER_VERSION||digest(proof.limits)!==digest(currentLimits)||proof.attemptBase!==3||proof.additionalAttempts!==3||proof.newsId!==row.news_id||proof.newsRevision!==row.revision||proof.topicId!==row.topic_id||proof.executionHash!==p.executionHash||!compatible(p.executionHash)||!Number.isSafeInteger(p.prepareAttempts)||p.prepareAttempts<proof.attemptBase)throw Error('正文恢复依据已变化，保留旧尝试');
  for(const ref of proof.failures){const old=db.prepare('SELECT * FROM research_source_attempts WHERE id=? AND topic_id=?').get(ref.id,row.topic_id);if(!old||digest(old.payload)!==ref.payloadHash)throw Error('正文历史失败记录已变化');}
 }
 function attemptCount(row){
  const p=parse(row);if(p.preparationRecovery){try{validate(row);return p.prepareAttempts-p.preparationRecovery.attemptBase;}catch{}}
  return p.prepareAttempts||0;
 }
 function eligible(row){
  const p=parse(row),news=store.newsById(row.news_id);
  if(PDF_READER_VERSION!=='public-pdf-2'||!settings().automatic||!p.configuration.automatic||!['failed','observing'].includes(row.status)||p.preparationRecovery||p.preparationFailure!=='source-unavailable'||p.prepareAttempts!==3||row.run_id||!row.topic_id||row.rules_hash!==research.screenings.rulesHash||!news||news.revision!==row.revision||!compatible(p.executionHash))return null;
  if(db.prepare('SELECT 1 FROM research_pipeline_attempts WHERE item_id=?').get(row.id)||db.prepare('SELECT 1 FROM research_pipeline_event_jobs WHERE item_id=?').get(row.id))return null;
  let topic;try{topic=research.get(row.topic_id);}catch{return null;}
  if(topic.status!=='active'||topic.version!==p.preparedTopicVersion||topic.dossier||topic.evidence.some(e=>e.materialId))return null;
  const failures=attempts(row);if(failures.length!==3||failures.some(r=>{const a=parse(r);return a.state!=='failed'||a.method!=='public-web'||a.url!==news.url||!priorErrors.has(a.error);}))return null;
  if(news.provider==='linked-public-source'&&!evidence?.hasRecoverableLinkedRequest(row))return null;
  return {p,failures};
 }
 return {
  validate,attemptCount,
  step(context){
   if(!settings().automatic||db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return null;
   const rows=db.prepare("SELECT * FROM research_pipeline_items WHERE status IN ('failed','observing') AND json_extract(payload,'$.configuration.automatic')=1 AND json_extract(payload,'$.preparationFailure')='source-unavailable' AND json_extract(payload,'$.prepareAttempts')=3 AND json_extract(payload,'$.preparationRecovery') IS NULL ORDER BY rowid").all();
   for(const row of rows){if(!eligible(row))continue;
    return transaction(()=>{
     context.assertActive();const latest=db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(row.id),ready=eligible(latest);if(!ready)return null;
     const previous={status:latest.status,payload:ready.p},proof={version:'source-capacity-recovery/1',fromReader:'public-pdf-1',toReader:PDF_READER_VERSION,limits:currentLimits,newsId:row.news_id,newsRevision:row.revision,topicId:row.topic_id,executionHash:ready.p.executionHash,previousHash:digest(previous),attemptBase:3,additionalAttempts:3,failures:ready.failures.map(r=>({id:r.id,payloadHash:digest(r.payload)})),at:new Date(now()).toISOString()};
     audit(row.id,action,{proof,previous});
     setState(latest,'ready',{preparationRecovery:proof,nextRetryAt:null,reason:'PDF读取能力已升级，后台追加一轮有界读取；原3次失败保留'});
     if(store.newsById(row.news_id).provider==='linked-public-source')evidence.resumeLinkedRequest(latest,context);
     return {ok:true,sourceCapacityRecovery:row.id};
    });
   }
   return null;
  }
 };
}
