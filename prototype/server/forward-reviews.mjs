import {digest} from './codex-research.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {validateEvaluationLabel} from '../shared/evaluation-review.mjs';
import {evaluationTime,outcomeLabel} from '../shared/evaluation.mjs';
import {OUTCOMES} from '../shared/claims.mjs';
import {clusterReviews,forwardReviewErrors as errors} from '../shared/forward-review.mjs';
const fail=i=>{throw new Error(errors[i]);};
const text=(v,max=1200)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===list.split(',').sort().join(',');
export function openForwardReviews(store,research,captures,{enabled=false,now=Date.now}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS forward_reviews(run_id TEXT NOT NULL,version INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,PRIMARY KEY(run_id,version));`);
 const guard=()=>{if(!enabled)fail(8);if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 function original(id){const capture=captures.get(id);if(!capture.integrity.valid)fail(4);const run=JSON.parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(id).payload);return {capture,input:run.packet.input};}
 function history(id,capture){let previousHash=null;return db.prepare('SELECT * FROM forward_reviews WHERE run_id=? ORDER BY version').all(id).map((row,index)=>{const value=JSON.parse(row.payload),{hash,...data}=value;if(row.version!==index+1||value.version!==row.version||value.runId!==id||value.requestId!==row.request_id||value.captureHash!==capture.snapshotHash||value.previousHash!==previousHash||hash!==digest(data))fail(3);previousHash=hash;return value;});}
 function source(ref){
  try{
   if(!keys(ref,'kind,id,revision')||!['news','material'].includes(ref.kind)||!text(ref.id,200)||!Number.isSafeInteger(ref.revision)||ref.revision<1)fail(6);
   let snapshot;
   if(ref.kind==='material')snapshot={kind:'material',...immutableMaterialSnapshot(db,ref)};
   else{const row=db.prepare('SELECT payload,received_at FROM revisions WHERE news_id=? AND version=?').get(ref.id,ref.revision);if(!row)fail(6);const news=JSON.parse(row.payload);if(news.id!==ref.id)fail(6);snapshot={kind:'news',id:ref.id,revision:ref.revision,title:news.title,url:news.url,publisher:news.publisher,publishedAt:news.publishedAt,availableAt:row.received_at,scope:'headline-only'};}
   if(evaluationTime(snapshot.availableAt)===null||Date.parse(snapshot.availableAt)>now())fail(6);
   return {ref,snapshot,hash:digest(snapshot)};
  }catch{fail(6);}
 }
 function evidence(input){
  if(!Array.isArray(input)||input.length>8)fail(6);const seen=new Set();
  const result=input.map(e=>{if(!keys(e,'ref,hash,quote,quoteField')||!text(e.quote,2000)||!['title','body'].includes(e.quoteField))fail(6);const frozen=source(e.ref),key=`${e.ref.kind}:${e.ref.id}:${e.ref.revision}`;if(frozen.hash!==e.hash||seen.has(key)||typeof frozen.snapshot[e.quoteField]!=='string'||!frozen.snapshot[e.quoteField].includes(e.quote))fail(6);seen.add(key);return {...frozen,quote:e.quote,quoteField:e.quoteField};});
  if(Buffer.byteLength(JSON.stringify(result))>524288)fail(6);return result;
 }
 function summary(capture,input,entries){
  const outcomes={},label=entries.filter(e=>e.kind==='label').at(-1)?.value||null;
  for(const e of entries)if(e.kind==='outcome')outcomes[e.value.claimId]=e.value;
  const claims=(input.claims||[]).map(c=>{const result=outcomes[c.id],reasons=[];if(!result)return {...c,resolution:null,score:null,scoringReasons:['尚未登记结局']};
   const mature=outcomeLabel({...c,outcome:result.outcome,resolutionReason:result.reason,evidenceIds:result.evidence.map(e=>e.hash),resolvedAt:result.at,firstAssessedAt:capture.record.decisionAt},{now:new Date(now()).toISOString()});
   if(!mature.mature)reasons.push(mature.reason);
   const timeline=capture.claimTimeline?.flatMap(row=>row.claims.filter(old=>old.id===c.id).map(old=>({...old,recordedAt:row.recordedAt})));
   if(!timeline?.length)reasons.push('缺少调用前冻结的主张历史');
   else{if(timeline.some(old=>['true','false','partial'].includes(old.outcome)))reasons.push('调用前已有结局记录，重开不能变成事前预测');if(timeline.some(old=>old.claim!==c.claim||old.kind!==c.kind||old.resolveBy!==c.resolveBy))reasons.push('调用前主张身份有变化');}
   const eventTime=evaluationTime(result.eventAt);if(eventTime===null||eventTime<=Date.parse(capture.record.decisionAt))reasons.push('缺少判断之后的事件时点');
   if(evaluationTime(c.assessedAt||c.firstAssessedAt)===null||Date.parse(c.assessedAt||c.firstAssessedAt)>Date.parse(capture.record.decisionAt))reasons.push('冻结概率缺少有效的事前记录时间');
   if(!['open','unresolved'].includes(c.outcome)||typeof c.probability!=='number'||!Number.isFinite(c.probability)||c.probability<0||c.probability>100)reasons.push('冻结时没有未解决的有效概率');
   if(eventTime!==null&&!result.evidence.some(e=>Date.parse(e.snapshot.availableAt)>=eventTime))reasons.push('没有事件时点之后可用的结局证据');
   if(!capture.inputEligibility.eligible)reasons.push('原输入未通过前向结构准入');
   return {...c,resolution:result,score:reasons.length?null:(c.probability/100-mature.label)**2,scoringReasons:reasons};
  });
  return {runId:capture.runId,topicId:capture.topicId,topicTitle:capture.topicTitle,version:entries.length,captureHash:capture.snapshotHash,label,claims,history:entries,forwardEligible:false,independence:'评审者和未见结果为自述；未验证人员独立性、原文语义或实际事件时点。概率来自调用前的研究主张，不是五章模型输出。'};
 }
 const api={
  detail(id){const {capture,input}=original(id);return summary(capture,input,history(id,capture));},
  inputs(id){const {capture}=original(id),topic=research.get(capture.topicId),refs=topic.evidence.flatMap(e=>e.materialId?[{kind:'material',id:e.materialId,revision:e.materialRevision}]:e.newsId?[{kind:'news',id:e.newsId,revision:e.newsRevision}]:[]),items=[],unavailable=[];
   for(const ref of refs){try{items.push(source(ref));}catch{unavailable.push(ref);}}return {items,unavailable,scope:'当前研究已关联的确切新闻/正文版本；仅供选择结局证据，原调用输入不改变'};
  },
  write(id,kind,data){
   guard();if(!['label','outcome'].includes(kind)||!keys(data,'requestId,version,value')||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId)||!Number.isSafeInteger(data.version)||data.version<0)fail(0);
   const requestHash=digest({id,kind,version:data.version,value:data.value});
   db.exec('BEGIN IMMEDIATE');try{
    guard();const {capture,input}=original(id),entries=history(id,capture),old=db.prepare('SELECT run_id,payload FROM forward_reviews WHERE request_id=?').get(data.requestId);
    if(old){const saved=JSON.parse(old.payload);if(old.run_id!==id||saved.requestHash!==requestHash)fail(2);}
    else{
     if(data.version!==entries.length)fail(1);const at=new Date(now()).toISOString();if(Date.parse(at)<Date.parse(capture.record.decisionAt)||entries.some(e=>Date.parse(e.at)>Date.parse(at)))fail(7);let value;
     if(kind==='label'){
      const l=data.value;if(!keys(l,'verdict,exposure,reviewer,reason,novelty,scale,mechanism,clusterVerdict,clusterReason,revisionReason')||!Object.hasOwn(clusterReviews,l.clusterVerdict)||!text(l.clusterReason)||!text(l.revisionReason))fail(0);
      value={...validateEvaluationLabel({...l,clusterId:capture.record.clusterId||''}),clusterVerdict:l.clusterVerdict,clusterReason:l.clusterReason.trim(),revisionReason:l.revisionReason.trim(),at,presentation:'model-output-not-returned',independent:false};
     }else{
      const o=data.value;if(!keys(o,'claimId,outcome,eventAt,reason,reviewer,revisionReason,evidence')||!Object.hasOwn(OUTCOMES,o.outcome)||!text(o.reason)||!text(o.reviewer,100)||!text(o.revisionReason))fail(0);
      const claim=input.claims?.find(c=>c.id===o.claimId);if(!claim)fail(5);
      if(o.eventAt!==null&&(evaluationTime(o.eventAt)===null||Date.parse(o.eventAt)>now())||['open','unresolved'].includes(o.outcome)&&o.eventAt!==null)fail(7);
      const frozen=evidence(o.evidence);if(['true','false','partial'].includes(o.outcome)&&!frozen.length)fail(7);
      value={claimId:claim.id,claimHash:digest(claim),outcome:o.outcome,eventAt:o.eventAt,reason:o.reason.trim(),reviewer:o.reviewer.trim(),revisionReason:o.revisionReason.trim(),evidence:frozen,at,independent:false};
     }
     const entry={runId:id,version:entries.length+1,requestId:data.requestId,requestHash,kind,value,at,captureHash:capture.snapshotHash,previousHash:entries.at(-1)?.hash||null};
     db.prepare('INSERT INTO forward_reviews VALUES(?,?,?,?)').run(id,entry.version,data.requestId,JSON.stringify({...entry,hash:digest(entry)}));
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return api.detail(id);
  }
 };
 return api;
}
