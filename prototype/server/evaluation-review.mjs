import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {evaluationTime} from '../shared/evaluation.mjs';
import {evaluationErrors,validateEvaluationLabel} from '../shared/evaluation-review.mjs';
import {evaluateBatch} from './evaluation-metrics.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const fail=i=>{throw new Error(evaluationErrors[i]);};
const text=(x,n=1200)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const root=fileURLToPath(new URL('../../',import.meta.url));
export function openEvaluationReview(store,{clock=()=>new Date().toISOString()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS evaluation_batches(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS evaluation_labels(batch_id TEXT NOT NULL,sample_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(batch_id,sample_id,version));
 CREATE TABLE IF NOT EXISTS evaluation_reports(batch_id TEXT PRIMARY KEY,payload TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS evaluation_commands(id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,batch_id TEXT NOT NULL);`);
 const get=id=>{const row=db.prepare('SELECT payload FROM evaluation_batches WHERE id=?').get(id);if(!row)fail(1);return JSON.parse(row.payload);};
 const histories=id=>db.prepare('SELECT payload FROM evaluation_labels WHERE batch_id=? ORDER BY version').all(id).map(r=>JSON.parse(r.payload));
 const labels=id=>Object.fromEntries(histories(id).map(l=>[l.sampleId,l]));
 const summary=b=>({id:b.id,title:b.title,version:b.version,state:b.state,frozenAt:b.frozenAt,start:b.start,end:b.end,rulesHash:b.rulesHash,inputHash:b.inputHash,sourceHash:b.sourceHash,total:b.total??b.samples.length,reviewed:db.prepare('SELECT COUNT(DISTINCT sample_id) n FROM evaluation_labels WHERE batch_id=?').get(b.id).n,forwardEligible:false});
 function mutate(id,data,action,change){
  if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')fail(9);
  if(!data||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId))fail(8);
  const inputHash=hash({id,data,action});let resultId;
  db.exec('BEGIN IMMEDIATE');try{
   const prior=db.prepare('SELECT * FROM evaluation_commands WHERE id=?').get(data.requestId);
   if(prior){if(prior.input_hash!==inputHash)fail(8);resultId=prior.batch_id;}
   else{const b=id?get(id):null;if(data.version!==(b?.version||0))fail(2);if(b?.state==='sealed')fail(3);const next=change(b,clock());next.version++;resultId=next.id;
    db.prepare('INSERT INTO evaluation_batches VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(next.id,JSON.stringify(next));
    db.prepare('INSERT INTO evaluation_commands VALUES(?,?,?)').run(data.requestId,inputHash,resultId);
   }db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return api.detail(resultId);
 }
 const api={
  list(){return {rules:db.prepare('SELECT hash,activated_at FROM screening_rules ORDER BY activated_at DESC').all(),batches:db.prepare("SELECT json_remove(payload,'$.samples','$.sources','$.ruleArchive','$.claimVersions') metadata,json_array_length(payload,'$.samples') total FROM evaluation_batches ORDER BY rowid DESC").all().map(r=>summary({...JSON.parse(r.metadata),total:r.total}))};},
  detail(id){const b=get(id),ls=labels(id);return {...summary(b),labels:ls,samples:b.samples.map(s=>({id:s.id,input:s.input,inputHash:s.inputHash,decisionAt:s.decisionAt,origin:s.origin,...(b.state==='sealed'?{triage:s.triage}:{})})),...(b.state==='sealed'?{report:api.report(id)}:{})};},
  create(data){return mutate(null,data,'create',(_,at)=>{
   if(!text(data.title,100)||evaluationTime(data.start)===null||evaluationTime(data.end)===null||Date.parse(data.start)>=Date.parse(data.end)||Date.parse(data.end)>Date.parse(at)||typeof data.rulesHash!=='string')fail(0);
   const rule=db.prepare('SELECT * FROM screening_rules WHERE hash=?').get(data.rulesHash);if(!rule)fail(0);
   const samples=db.prepare('SELECT payload FROM screening_samples WHERE rules_hash=? AND julianday(recorded_at)>=julianday(?) AND julianday(recorded_at)<julianday(?) ORDER BY recorded_at,id LIMIT 5001').all(data.rulesHash,data.start,data.end).map(r=>JSON.parse(r.payload));
   if(!samples.length)fail(4);if(samples.length>5000)fail(5);
   if(samples.some(s=>hash(s.input)!==s.inputHash||s.rulesHash!==data.rulesHash||evaluationTime(s.decisionAt)===null||Date.parse(s.decisionAt)<Date.parse(data.start)||Date.parse(s.decisionAt)>=Date.parse(data.end)))fail(11);
   const ruleArchive=JSON.parse(rule.payload);if(hash(ruleArchive.sources)!==rule.hash)fail(11);
   const sources=collectEvaluationSources(root),claimVersions=db.prepare('SELECT topic_id,version,payload,recorded_at FROM research_versions WHERE julianday(recorded_at)<=julianday(?) ORDER BY topic_id,version').all(at);
   const scope={start:new Date(data.start).toISOString(),end:new Date(data.end).toISOString(),rulesHash:data.rulesHash,samples,claimVersions};
   return {id:randomUUID(),version:0,title:data.title.trim(),state:'annotating',frozenAt:at,...scope,ruleArchive,sources,sourceHash:hash(sources),inputHash:hash(scope),configuration:{positiveBucket:'review',cohort:'all-saved-revisions-in-half-open-decision-window',clusterRepresentative:'earliest-decision-then-sample-id',kind:'retrospective-diagnostic'}};
  });},
  annotate(id,data){return mutate(id,data,'annotate',(b,at)=>{
   const l=data.label;if(!l||!b.samples.some(s=>s.id===l.sampleId))fail(6);
   const label={...validateEvaluationLabel(l),sampleId:l.sampleId,at,version:b.version+1,presentation:'rule-output-hidden',forwardEligible:false};
   db.prepare('INSERT INTO evaluation_labels VALUES(?,?,?,?)').run(id,label.sampleId,label.version,JSON.stringify(label));return b;
  });},
  seal(id,data){return mutate(id,data,'seal',(b,at)=>{
   if(data.confirm!==true||Object.keys(labels(id)).length!==b.samples.length)fail(7);
   const report={...evaluateBatch(b,labels(id),at),labelSnapshot:labels(id),labelHistory:histories(id)};
   db.prepare('INSERT INTO evaluation_reports VALUES(?,?,?)').run(id,JSON.stringify(report),hash(report));b.state='sealed';b.sealedAt=at;return b;
  });},
  report(id){if(get(id).state!=='sealed')fail(10);const r=db.prepare('SELECT payload,hash FROM evaluation_reports WHERE batch_id=?').get(id);return {...JSON.parse(r.payload),sha256:r.hash};},
  export(id){const b=get(id);if(b.state!=='sealed')fail(10);return {batch:b,report:api.report(id)};}
 };
 return api;
}
