import {comparisonSummary} from './semantic-materials.mjs';
import {comparisonPacket} from './semantic-events.mjs';
import {digest} from './codex-research.mjs';
import {historyRecallErrors,historyReviewEligible} from '../shared/historical-recall.mjs';
const fail=()=>{throw Error(historyRecallErrors[9]);};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function reviewRow(report,candidateId){
 const row=report.rows.find(r=>r.newsId===candidateId);
 if(candidateId===report.anchor.id||!historyReviewEligible(row)||report.candidateIds.includes(candidateId)!==(row.status==='candidate')||!report.inputs.some(i=>i.id===candidateId))fail();
 return row;
}
export function historicalComparisonPair(store,report,candidateId){
 const row=reviewRow(report,candidateId);
 const records=[report.anchor,report.inputs.find(i=>i.id===candidateId)];if(records.some(r=>!r))fail();
 const pair=Object.fromEntries(['left','right'].map((side,i)=>{const r=records[i];return [side,r.kind==='material'?{kind:'material',id:r.materialId,revision:r.revision}:{id:r.id,revision:r.revision}];}));
 const packet=comparisonPacket(store,pair);
 for(const [i,side] of ['left','right'].entries()){
  const frozen=records[i],current=packet.input[side];
  const expected=frozen.kind==='material'?{kind:'material',id:frozen.materialId,documentId:frozen.documentId,revision:frozen.revision,title:frozen.title,url:frozen.url,publisher:frozen.sourceName,publishedAt:frozen.publishedAt,...(frozen.publicationDateEvidence?{publicationDateEvidence:frozen.publicationDateEvidence}:{}),...(frozen.extractionEvidence?{extractionEvidence:frozen.extractionEvidence}:{}),datePrecision:frozen.datePrecision,availableAt:frozen.availableAt,receivedAt:frozen.receivedAt,contentScope:frozen.scope,contentHash:frozen.contentHash,body:frozen.body,method:frozen.method,readerVersion:frozen.readerVersion,verification:frozen.verification}:{id:frozen.id,revision:frozen.revision,title:frozen.title,url:frozen.url,publisher:frozen.publisher,publishedAt:frozen.publishedAt,datePrecision:frozen.datePrecision||'instant',availableAt:frozen.availableAt,contentScope:'headline-only'};
  if(digest(expected)!==digest(current))fail();
 }
 return {pair,packet,retrievalStatus:row.status};
}
export function openHistoricalComparisons(store,history,semantic,{now=Date.now}={}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS historical_comparison_runs(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,report_id TEXT NOT NULL,candidate_id TEXT NOT NULL,run_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL)');
 const existing=(id,hash)=>{const r=db.prepare('SELECT * FROM historical_comparison_runs WHERE request_id=?').get(id);if(!r)return null;if(r.request_hash!==hash)fail();return semantic.get(r.run_id);};
 return {
  list(reportId,candidateId){
   const report=history.byId(reportId);reviewRow(report,candidateId);
   const where='report_id=? AND candidate_id=?',rows=db.prepare(`SELECT run_id FROM historical_comparison_runs WHERE ${where} ORDER BY rowid DESC LIMIT 50`).all(reportId,candidateId);
   return {...semantic.status(),total:db.prepare(`SELECT count(*) n FROM historical_comparison_runs WHERE ${where}`).get(reportId,candidateId).n,runs:rows.map(r=>{const run=semantic.get(r.run_id);return {id:run.id,status:run.status,createdAt:run.createdAt,left:comparisonSummary(run.packet.input.left),right:comparisonSummary(run.packet.input.right),relation:run.candidate?.comparison.relation,stale:run.stale,active:run.active,decision:run.decision};})};
  },
  start(reportId,data){
   if(!data||Object.keys(data).sort().join(',')!=='candidateId,reportHash,requestId'||!uuid(data.requestId)||typeof data.candidateId!=='string'||!/^[a-f0-9]{64}$/.test(data.reportHash||''))fail();
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error(historyRecallErrors[6]);
   const requestHash=digest({reportId,...data}),old=existing(data.requestId,requestHash);if(old)return old;
   const report=history.byId(reportId);if(report.hash!==data.reportHash)fail();
   const {pair,packet,retrievalStatus}=historicalComparisonPair(store,report,data.candidateId);
   try{return semantic.start(pair,run=>{
    if(run.packet.inputHash!==packet.inputHash)fail();
    const basis={version:'historical-comparison-basis/2',reportId,reportHash:report.hash,candidateId:data.candidateId,retrievalStatus,inputHash:run.packet.inputHash,runId:run.id,createdAt:new Date(now()).toISOString(),scope:retrievalStatus==='candidate'?'历史规则召回后的独立语义候选；不改变原检索与研究':'历史规则未命中资料的独立语义候选；保留原未命中原因，不改变原检索与研究'};
    db.prepare('INSERT INTO historical_comparison_runs VALUES(?,?,?,?,?,?)').run(data.requestId,requestHash,reportId,data.candidateId,run.id,JSON.stringify(basis));
   });}catch(error){const raced=existing(data.requestId,requestHash);if(raced)return raced;throw error;}
  }
 };
}
