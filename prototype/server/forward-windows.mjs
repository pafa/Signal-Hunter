import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {digest} from './codex-research.mjs';
import {evaluationTime} from '../shared/evaluation.mjs';
import {forwardWindowErrors as errors} from '../shared/forward-window.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
let loadedSourceHash=null;try{loadedSourceHash=digest(collectEvaluationSources(root));}catch{}
const fail=i=>{throw Error(errors[i]);};
const counts=values=>Object.fromEntries([...new Set(values)].sort().map(k=>[k,values.filter(v=>v===k).length]));
const checked=row=>{if(!row)fail(2);const p=JSON.parse(row.payload),{hash,...value}=p;if(hash!==digest(value)||p.id!==row.id)fail(3);return p;};
function summarize(rows){
 const claims=rows.flatMap(r=>r.review.claims.map(c=>({runId:r.capture.runId,clusterId:r.capture.record.clusterId,...c}))),groups=new Map();
 for(const r of rows){const id=r.capture.record.clusterId;if(id&&!groups.has(id))groups.set(id,r.capture.runId);}
 return {calls:rows.length,statuses:counts(rows.map(r=>r.capture.modelStatus)),inputEligible:rows.filter(r=>r.capture.inputEligibility.eligible).length,inputExcluded:rows.filter(r=>!r.capture.inputEligibility.eligible).length,exclusionReasons:counts(rows.flatMap(r=>r.capture.inputEligibility.reasons)),executionVerified:rows.filter(r=>r.capture.executionVerified).length,labels:counts(rows.map(r=>r.review.label?.verdict||'unreviewed')),clusterReviews:counts(rows.map(r=>r.review.label?.clusterVerdict||'unreviewed')),clusters:{known:groups.size,unknownCalls:rows.filter(r=>!r.capture.record.clusterId).length,repeatCalls:rows.filter(r=>r.capture.record.clusterId).length-groups.size,representatives:[...groups].map(([clusterId,runId])=>({clusterId,runId}))},claims:{total:claims.length,outcomes:counts(claims.map(c=>c.resolution?.outcome||'unregistered')),withDescriptiveError:claims.filter(c=>c.score!==null).length,withoutDescriptiveError:claims.filter(c=>c.score===null).length,unscoredReasons:counts(claims.flatMap(c=>c.scoringReasons)),aggregateError:null},independentValidation:false};
}
export function openForwardWindows(store,captures,reviews,{enabled=false,now=Date.now}={}){
 const db=store.db;db.exec('CREATE TABLE IF NOT EXISTS forward_windows(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL)');
 const guard=()=>{if(!enabled)fail(6);if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');};
 const brief=p=>({id:p.id,title:p.title,baselineId:p.baseline.id,start:p.start,end:p.end,asOf:p.asOf,hash:p.hash,summary:p.summary,forwardEligible:false});
 const api={
  list(){return {total:db.prepare('SELECT count(*) n FROM forward_windows').get().n,reports:db.prepare('SELECT id,payload FROM forward_windows ORDER BY rowid DESC LIMIT 50').all().map(r=>brief(checked(r)))};},
  get(id){return checked(db.prepare('SELECT id,payload FROM forward_windows WHERE id=?').get(id));},
  freeze(data){
   guard();if(!data||Object.keys(data).sort().join(',')!=='baselineId,end,requestId,start,title'||typeof data.title!=='string'||!data.title.trim()||data.title.length>100||typeof data.baselineId!=='string'||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId))fail(0);
   const start=evaluationTime(data.start),end=evaluationTime(data.end);if(start===null||end===null||start>=end||end>now())fail(0);
   const requestHash=digest(data);let report;
   db.exec('BEGIN IMMEDIATE');try{
    guard();const old=db.prepare('SELECT * FROM forward_windows WHERE request_id=?').get(data.requestId);
    if(old){if(old.request_hash!==requestHash)fail(1);report=checked(old);}
    else{
     const baseline=captures.baseline(data.baselineId);if(start<Date.parse(baseline.baseline.frozenAt))fail(0);
     const selected=[];
     // Read the complete baseline, not the UI's most recent 100 records. Invalid
     // timestamps/index bindings stop the freeze rather than hiding a sample.
     for(const row of db.prepare('SELECT * FROM forward_captures WHERE baseline_id=?').iterate(data.baselineId)){
      const raw=JSON.parse(row.payload),{snapshotHash,...value}=raw,at=evaluationTime(raw.record?.decisionAt);
      if(snapshotHash!==digest(value)||raw.runId!==row.run_id||raw.baselineId!==row.baseline_id||raw.topicId!==row.topic_id||at===null)fail(3);
      if(at>=start&&at<end){selected.push({runId:row.run_id,at});if(selected.length>5000)fail(4);}
     }
     selected.sort((a,b)=>a.at-b.at||a.runId.localeCompare(b.runId));
     const reportSources=collectEvaluationSources(root);if(!loadedSourceHash||digest(reportSources)!==loadedSourceHash)fail(7);const rows=[];let bytes=Buffer.byteLength(JSON.stringify({baseline,reportSources}));
     for(const {runId} of selected){const row={capture:captures.get(runId),review:reviews.detail(runId)};bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>64*1024*1024)fail(5);rows.push(row);}
     const value={id:randomUUID(),title:data.title.trim(),format:'forward-window/1',start:new Date(start).toISOString(),end:new Date(end).toISOString(),asOf:new Date(now()).toISOString(),reportSources,reportSourceHash:digest(reportSources),baseline,rows,summary:summarize(rows),forwardEligible:false,limitations:['仅该基线已登记五章调用，暂停/未登记及全量新闻不在分母；不计算新闻召回率','窗口按调用时刻左闭右开，标签和结局取报告冻结时已保存版本；不同冻结时刻不可视为同期比较','标签、簇身份及事件时点未独立验证；主张概率来自研究者，不是模型预测','同源/同簇记录与全部未知结局保留；不合并为独立样本，不计算总体准确率、收益或自动晋升']};
     report={...value,hash:digest(value)};if(Buffer.byteLength(JSON.stringify(report))>64*1024*1024)fail(5);
     db.prepare('INSERT INTO forward_windows VALUES(?,?,?,?)').run(report.id,data.requestId,requestHash,JSON.stringify(report));
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return report;
  }
 };
 return api;
}
