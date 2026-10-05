import {historicalMaterials,historicalBodyProfile,historicalBodyMatch} from './historical-body.mjs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {digest} from './codex-research.mjs';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {historicalProfile,historicalMatch} from './historical-mechanisms.mjs';
import {HISTORY_RECALL_VERSION,historyRecallErrors} from '../shared/historical-recall.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
let loadedHash=null;try{loadedHash=digest(collectEvaluationSources(root));}catch{/* Minimal runtime may read old reports, but cannot freeze a complete source archive. */}
const fail=i=>{throw Error(historyRecallErrors[i]);},stamp=v=>typeof v==='string'?Date.parse(v):NaN;
function check(row){if(!row)fail(3);const p=JSON.parse(row.payload),{hash,...value}=p;if(p.id!==row.id||p.anchor?.id!==row.news_id||hash!==digest(value))fail(4);return p;}
export function historicalRows(anchor,inputs,asOf,{body=false}={}){
 const profileOf=body?historicalBodyProfile:historicalProfile,matchBudget={remaining:500000};
 const profile=profileOf(anchor),anchorTime=stamp(anchor.publishedAt),asOfTime=stamp(asOf),anchorAvailable=stamp(anchor.availableAt),anchorFirst=stamp(anchor.firstSeen),anchorValid=[anchorTime,asOfTime,anchorAvailable,anchorFirst].every(Number.isFinite)&&anchorFirst<=anchorAvailable&&anchorTime<=anchorAvailable&&anchorAvailable<=asOfTime;
 return inputs.map(input=>{
  const published=stamp(input.publishedAt),available=stamp(input.availableAt),first=stamp(input.firstSeen),candidateProfile=profileOf(input);
  let match;
  if(input.id===anchor.id)match={status:'anchor'};
  else if(!anchorValid||!Number.isFinite(anchorTime)||!Number.isFinite(published)||!Number.isFinite(available)||!Number.isFinite(first)||first>available||published>available||anchorTime>asOfTime)match={status:'invalid_time'};
  else if(available>asOfTime)match={status:'future_input'};
  else if(published>=anchorTime)match={status:'not_earlier'};
  else if(anchor.url&&input.url===anchor.url)match={status:'same_source'};
  else if(body&&anchor.contentHash&&anchor.contentHash===input.contentHash)match={status:'same_source'};
  else if((!body||!anchor.kind&&!input.kind)&&profile.normalized&&profile.normalized===candidateProfile.normalized)match={status:'duplicate_title'};
  else match=(body?historicalBodyMatch:historicalMatch)(anchor,input,profile,candidateProfile,matchBudget);
  return {newsId:input.id,newsRevision:input.revision,profile:candidateProfile,...match};
 });
}
export function openHistoricalRecall(store,{now=Date.now,mode='research'}={}){
 const db=store.db;db.exec('CREATE TABLE IF NOT EXISTS historical_recall_reports(id TEXT PRIMARY KEY,news_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL)');
 const read=(newsId,id)=>{const row=db.prepare('SELECT * FROM historical_recall_reports WHERE id=? AND news_id=?').get(id,newsId);return check(row);};
 return {
  get:read,
  byId(id){return check(db.prepare('SELECT * FROM historical_recall_reports WHERE id=?').get(id));},
  list(newsId){return {enabled:!!loadedHash,unavailableReason:loadedHash?null:historyRecallErrors[8],reports:db.prepare("SELECT id,json_extract(payload,'$.frozenAt') frozenAt,json_extract(payload,'$.anchor.revision') newsRevision,json_extract(payload,'$.summary.candidate') candidates,json_extract(payload,'$.hash') hash FROM historical_recall_reports WHERE news_id=? ORDER BY rowid DESC").all(newsId)};},
  freeze(newsId,data){
   if(!data||Object.keys(data).sort().join(',')!=='requestId,revision'||!Number.isSafeInteger(data.revision)||data.revision<1||typeof data.requestId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(data.requestId))fail(0);
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')fail(6);
   const body=new RegExp('^material:[a-f0-9]{64}$').test(newsId);
   const requestHash=digest({newsId,...data}),old=db.prepare('SELECT * FROM historical_recall_reports WHERE request_id=?').get(data.requestId);
   if(old){if(old.request_hash!==requestHash)fail(2);return check(old);}
   if(!loadedHash)fail(8);
   const sources=collectEvaluationSources(root);if(digest(sources)!==loadedHash)fail(7);
   db.exec('BEGIN IMMEDIATE');try{
    const raced=db.prepare('SELECT * FROM historical_recall_reports WHERE request_id=?').get(data.requestId);if(raced){if(raced.request_hash!==requestHash)fail(2);const report=check(raced);db.exec('COMMIT');return report;}
    const total=db.prepare('SELECT COUNT(*) n FROM news').get().n;if(total>20000)fail(5);
    const raw=db.prepare('SELECT n.id,n.payload,n.hash,n.revision,n.first_seen,r.payload revision_payload,r.received_at FROM news n LEFT JOIN revisions r ON r.news_id=n.id AND r.version=n.revision ORDER BY n.rowid').all();
    if(raw.reduce((n,r)=>n+Buffer.byteLength(r.payload),0)>12*1024*1024)fail(5);
    const inputs=raw.map(row=>{const value=JSON.parse(row.payload);if(value.id!==row.id||digest(row.payload)!==row.hash||row.payload!==row.revision_payload)fail(4);return {...value,revision:row.revision,firstSeen:row.first_seen,availableAt:row.received_at};});
    const materials=body?historicalMaterials(db):[];inputs.push(...materials);
    const anchor=inputs.find(i=>i.id===newsId);if(!anchor||anchor.revision!==data.revision)fail(1);
    const frozenAt=new Date(now()).toISOString(),rows=historicalRows(anchor,inputs,frozenAt,{body}),summary=Object.fromEntries([...new Set(rows.map(r=>r.status))].map(status=>[status,rows.filter(r=>r.status===status).length]));summary.candidate||=0;
    const byId=new Map(inputs.map(i=>[i.id,i]));
    const candidateIds=rows.filter(r=>r.status==='candidate').sort((a,b)=>b.rank-a.rank||stamp(byId.get(b.newsId).publishedAt)-stamp(byId.get(a.newsId).publishedAt)||a.newsId.localeCompare(b.newsId)).map(r=>r.newsId);
    const value={id:randomUUID(),version:body?'historical-recall-body/1':HISTORY_RECALL_VERSION,frozenAt,mode,anchor,inputs,inputHash:digest(inputs),rows,candidateIds,summary,coverage:{total:inputs.length,news:total,materials:materials.length,scanned:inputs.length,maximumNews:20000,maximumMaterials:2000,ageLimitDays:null,inputScope:body?'本机全部新闻标题与每份已存材料的最新修订；材料逐片段召回，非全市场覆盖':'本机新闻库当前修订，含全部初筛层级；不是全市场或当时可交易资料'},sources,sourceHash:digest(sources),forwardEligible:false,limitations:[body?'标题及已保存正文按标点/换行分段；长段1200字符窗口、200字符重叠；可能漏掉跨句关系，只是待核类比':'标题与有限规则召回，只是待核对类比，不确认同一事件或因果机制','早于本条的发布时间不等于当时已获取；接收和修订时间逐项保留',body?'只读取本机已保存材料；没有抓取新来源、调用模型、合并事件或创建交易':'没有抓取新来源、读取正文、调用模型、合并事件或创建交易','未命中、时间无效、较晚条目及重复项均保留；不按历史收益筛选']};
    const report={...value,hash:digest(value)},payload=JSON.stringify(report);if(Buffer.byteLength(payload)>32*1024*1024)fail(5);
    db.prepare('INSERT INTO historical_recall_reports VALUES(?,?,?,?,?)').run(report.id,newsId,data.requestId,requestHash,payload);db.exec('COMMIT');return report;
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
 };
}
