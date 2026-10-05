import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {digest} from './codex-research.mjs';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {evaluationTime} from '../shared/evaluation.mjs';
import {instrument} from '../shared/securities.mjs';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
import {EVENT_PRICE_VERSION,EVENT_PRICE_POLICY,EVENT_PRICE_WINDOWS,eventPriceErrors} from '../shared/event-prices.mjs';
const fail=i=>{throw Error(eventPriceErrors[i]);};
const root=fileURLToPath(new URL('../../',import.meta.url));
let loadedHash=null;try{loadedHash=digest(collectEvaluationSources(root));}catch{}
const stamp=evaluationTime,iso=t=>new Date(t).toISOString();
const counts=items=>items.reduce((out,s)=>(out[s]=(out[s]||0)+1,out),{});
const checked=row=>{if(!row)fail(1);const p=JSON.parse(row.payload),{hash,...v}=p;if(p.id!==row.id||hash!==digest(v))fail(2);return p;};
const group=p=>JSON.stringify([p.symbol,p.provider,p.timezone,p.currency,p.adjustment]);
const returnPct=(a,b)=>{const r=(b/a-1)*100;return Number.isFinite(r)?r:null;};
function pick(points,target,latest,predicate=()=>true){
 let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid].stamp<target)lo=mid+1;else hi=mid;}
 for(let i=lo;i<points.length&&points[i].stamp<=latest;i++)if(predicate(points[i]))return points[i];return null;
}

// Uses immutable observation snapshots, never mutable bars, scenario marks or fill prices.
export function eventPriceObservations(archives,asOf){
 if(stamp(asOf)===null)fail(0);
 const points=new Map(),diagnostics=[];let total=0;
 for(const a of [...archives].sort((x,y)=>stamp(x.received_at)-stamp(y.received_at)||x.id-y.id)){
  const content=JSON.parse(a.payload),q=content.quote,received=stamp(a.received_at);
  if(digest(a.payload)!==a.hash||received===null||content.receivedAt!==a.received_at||q?.symbol!==a.symbol)fail(2);
  const record={snapshotId:a.id,snapshotHash:a.hash,symbol:a.symbol,receivedAt:a.received_at,usedPoints:0,reason:null};diagnostics.push(record);
  const skip=reason=>{record.reason=reason;};
  if(received>stamp(asOf)){skip('接收时间晚于报告截止');continue;}
  if(!a.activated){skip('未启用的隔离快照：'+a.reason);continue;}
  const quality=q.minuteQuality;let spec;try{spec=instrument(q.symbol);}catch{skip('证券代码无效');continue;}
  if(!['eastmoney-public','yahoo-public-chart'].includes(q.provider)||q.interval!=='1m'||q.adjustment!=='none'||q.lastBarMayBeIncomplete!==true||q.currency!==spec.currency||q.market!==spec.market||!Array.isArray(q.points)||q.points.length>2000||!q.points.length){skip('来源、市场、币种或分钟结构未核验');continue;}
  total+=q.points.length;if(total>200000)fail(3);
  if(quality?.version!=='minute-quality/1'||!Number.isSafeInteger(quality.invalidRows)||quality.invalidRows<0||!Array.isArray(quality.duplicateTimes)||quality.duplicateTimes.length||!Array.isArray(quality.roundedTimes)){skip('解析质量不完整或存在无效/重复分钟');continue;}
  const sourceInterval=Object.hasOwn(quality,'sourceInterval')?quality.sourceInterval:q.minuteVolume?.interval;
  if(q.provider==='yahoo-public-chart'&&sourceInterval!=='1m'){skip('来源原始分钟粒度未核验');continue;}
  const missing=quality.missingCloseTimes??[],times=new Set(q.points.map(p=>p.time));
  if(!Array.isArray(missing)||new Set(missing).size!==missing.length||missing.some(t=>typeof t!=='string'||providerMinuteTimestamp(t,q.providerTimezone)===null||providerMinuteTimestamp(t,q.providerTimezone)>received||times.has(t))||quality.invalidRows!==(q.provider==='yahoo-public-chart'?missing.length:0)){
   skip('存在无效分钟或缺价依据不完整；不推断缺失价格');continue;
  }
  record.missingPriceTimes=[...missing];
  const rows=q.points.map(p=>({...p,stamp:providerMinuteTimestamp(p.time,q.providerTimezone)}));
  if(rows.some((p,i)=>p.stamp===null||!Number.isFinite(p.close)||p.close<=0||i>0&&p.stamp<=rows[i-1].stamp)||rows.at(-1).time!==q.providerTime||rows.at(-1).stamp>received){skip('时间、价格、排序或末尾指针无效');continue;}
  for(const p of rows.slice(0,-1)){
   if(p.stamp+60000>received||quality.roundedTimes.includes(p.time))continue;
   const point={symbol:q.symbol,provider:q.provider,timezone:q.providerTimezone,currency:q.currency,adjustment:q.adjustment,time:iso(p.stamp),stamp:p.stamp,providerTime:p.time,price:p.close,snapshotId:a.id,snapshotHash:a.hash,receivedAt:a.received_at};
   const key=group(point)+':'+p.stamp;
   if(!points.has(key)){points.set(key,point);record.usedPoints++;}
  }
  record.reason=record.usedPoints?'保留首次有效观察':'无新增可用端点；末柱及后续修订不替换首次观察';
 }
 return {points:[...points.values()].sort((a,b)=>a.stamp-b.stamp||stamp(a.receivedAt)-stamp(b.receivedAt)||a.snapshotId-b.snapshotId||group(a).localeCompare(group(b))),diagnostics};
}

export function eventPriceRows(samples,labels,observations,benchmarks,asOf){
 const rows=[],noSymbols=[],bySymbol=new Map(),bySource=new Map();
 for(const p of observations){if(!bySymbol.has(p.symbol))bySymbol.set(p.symbol,[]);bySymbol.get(p.symbol).push(p);const key=group(p);if(!bySource.has(key))bySource.set(key,[]);bySource.get(key).push(p);}
 for(const s of samples){
  const symbols=[...new Set((s.triage?.companies||[]).map(c=>c.symbol))].sort();
  if(!symbols.length){noSymbols.push({sampleId:s.id,reason:'冻结标题初筛没有关联证券；不按后来的研究补选'});continue;}
  for(const symbol of symbols){
   let spec;try{spec=instrument(symbol);if(spec.symbol!==symbol)throw Error();}catch{noSymbols.push({sampleId:s.id,symbol,reason:'冻结证券代码无法核验'});continue;}
   const decision=stamp(s.decisionAt),available=stamp(s.input.availableAt),seen=stamp(s.input.firstSeen),valid=decision!==null&&available!==null&&seen!==null&&seen<=available&&available<=decision;
   const earliest=decision===null?null:decision+60000;
   const candidates=bySymbol.get(symbol)||[],base=valid?pick(candidates,earliest,decision+EVENT_PRICE_POLICY.maximumBoundaryDelayMs):null;
   const benchmark=benchmarks[spec.currency]||null;
   for(const w of EVENT_PRICE_WINDOWS){
    const row={sampleId:s.id,newsId:s.input.id,symbol,bucket:s.triage?.bucket||'unknown',clusterId:labels[s.id]?.clusterId||null,decisionAt:s.decisionAt,availableAt:s.input.availableAt,firstSeen:s.input.firstSeen,window:w.id,baseline:base||null,targetAt:base?iso(base.stamp+w.ms):null,endpoint:null,returnPct:null,benchmark,benchmarkBaseline:null,benchmarkEndpoint:null,benchmarkReturnPct:null,excessPct:null,reason:null,benchmarkReason:null};
    rows.push(row);
    if(!valid){row.reason='首次获取、本版可用或判断时间缺失/矛盾';continue;}
    if(!base){row.reason=stamp(asOf)<earliest+60000?'起点观察尚未到期':'判断后1至5分钟内没有已结束的同源观察';continue;}
    const target=base.stamp+w.ms;
    if(stamp(asOf)<target+60000){row.reason='窗口尚未到期';continue;}
    const end=pick(bySource.get(group(base))||[],target,target+EVENT_PRICE_POLICY.maximumBoundaryDelayMs);
    if(!end){row.reason='窗口端点缺价、休市或来源不一致；不延展到下个交易日';continue;}
    row.endpoint=end;row.returnPct=returnPct(base.price,end.price);
    if(row.returnPct===null){row.reason='价格变化超出可计算范围';continue;}
    row.reason='可计算未复权观察价格变化';
    if(!benchmark){row.benchmarkReason='未配置参照标的';continue;}
    if(benchmark===symbol){row.benchmarkReason='参照标的与研究证券相同';continue;}
    const bp=bySymbol.get(benchmark)||[],same=p=>p.provider===base.provider&&p.currency===base.currency&&p.adjustment===base.adjustment;
    const bb=pick(bp,base.stamp,base.stamp,same),be=pick(bp,end.stamp,end.stamp,p=>same(p)&&p.timezone===bb?.timezone);
    if(!bb||!be){row.benchmarkReason='参照标的缺少同源、同币种、同一时刻的端点';continue;}
    row.benchmarkBaseline=bb;row.benchmarkEndpoint=be;row.benchmarkReturnPct=returnPct(bb.price,be.price);
    const excess=row.returnPct-row.benchmarkReturnPct;
    if(row.benchmarkReturnPct===null||!Number.isFinite(excess)){row.benchmarkReason='参照价格变化超出可计算范围';continue;}
    row.excessPct=excess;row.benchmarkReason='研究标的变化减参照标的变化（百分点）';
   }
  }
 }
 const represented=new Set(rows.map(r=>r.sampleId));
 return {rows,noSymbols,summary:{samples:samples.length,samplesWithoutUsableSymbol:samples.filter(s=>!represented.has(s.id)).length,pairs:rows.length,priced:rows.filter(r=>r.returnPct!==null).length,pairedBenchmark:rows.filter(r=>r.excessPct!==null).length,reasons:counts(rows.map(r=>r.reason)),windows:Object.fromEntries(EVENT_PRICE_WINDOWS.map(w=>{const r=rows.filter(r=>r.window===w.id);return [w.id,{total:r.length,priced:r.filter(x=>x.returnPct!==null).length,pairedBenchmark:r.filter(x=>x.excessPct!==null).length}];}))}};
}

export function openEventPrices(store,evaluations,{enabled=false,now=Date.now}={}){
 const db=store.db;db.exec('CREATE TABLE IF NOT EXISTS event_price_reports(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL)');
 const guard=()=>{if(!enabled)fail(5);if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');};
 const api={
  list(batchId){evaluations.report(batchId);const all=db.prepare("SELECT id,batch_id AS batchId,json_extract(payload,'$.asOf') AS asOf,json_extract(payload,'$.hash') AS hash,json_extract(payload,'$.benchmarks') AS benchmarks,json_extract(payload,'$.summary') AS summary FROM event_price_reports WHERE batch_id=? ORDER BY rowid DESC").all(batchId);return {enabled,reports:all.map(r=>({...r,benchmarks:JSON.parse(r.benchmarks),summary:JSON.parse(r.summary)}))};},
  get(batchId,id){const p=checked(db.prepare('SELECT id,payload FROM event_price_reports WHERE id=? AND batch_id=?').get(id,batchId));return p;},
  freeze(batchId,data){
   guard();if(!data||Object.keys(data).sort().join(',')!=='benchmarks,requestId'||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId)||!data.benchmarks||Array.isArray(data.benchmarks)||typeof data.benchmarks!=='object'||Object.keys(data.benchmarks).some(k=>!['USD','HKD','CNY'].includes(k)))fail(0);
   const benchmarks={};for(const [currency,value] of Object.entries(data.benchmarks)){let spec;try{if(typeof value!=='string')throw Error();spec=instrument(value);}catch{fail(0);}if(spec.currency!==currency)fail(0);benchmarks[currency]=spec.symbol;}
   const requestHash=digest({batchId,data});let report;
   db.exec('BEGIN IMMEDIATE');try{
    guard();const prior=db.prepare('SELECT * FROM event_price_reports WHERE request_id=?').get(data.requestId);
    if(prior){if(prior.request_hash!==requestHash)fail(4);report=checked(prior);}
    else{
     const cohort=evaluations.export(batchId),{sha256,...sealed}=cohort.report,b=cohort.batch;
     if(sha256!==digest(sealed)||b.id!==batchId||sealed.inputHash!==b.inputHash||sealed.sourceHash!==b.sourceHash||sealed.rulesHash!==b.rulesHash||b.inputHash!==digest({start:b.start,end:b.end,rulesHash:b.rulesHash,samples:b.samples,claimVersions:b.claimVersions})||digest(b.sources)!==b.sourceHash||b.samples.some(s=>digest(s.input)!==s.inputHash))fail(2);
     const sources=collectEvaluationSources(root);if(!loadedHash||digest(sources)!==loadedHash)fail(6);
     const asOf=iso(now()),symbols=new Set([...b.samples.flatMap(s=>(s.triage?.companies||[]).map(c=>c.symbol).filter(s=>typeof s==='string')),...Object.values(benchmarks)]);
     if(stamp(b.sealedAt)===null||stamp(asOf)<stamp(b.sealedAt))fail(0);
     const archives=[];let bytes=Buffer.byteLength(JSON.stringify({cohort,sources}));
     for(const symbol of [...symbols].sort())for(const row of db.prepare('SELECT * FROM quote_snapshots WHERE symbol=? ORDER BY id').iterate(symbol)){
      bytes+=Buffer.byteLength(row.payload);if(archives.length>=20000||bytes>64*1024*1024)fail(3);archives.push({...row});
     }
     const obs=eventPriceObservations(archives,asOf),result=eventPriceRows(b.samples,cohort.report.labelSnapshot,obs.points,benchmarks,asOf);
     const value={id:randomUUID(),batchId,asOf,format:EVENT_PRICE_VERSION,policy:EVENT_PRICE_POLICY,benchmarks,cohort,archives,archiveDiagnostics:obs.diagnostics,sources,sourceHash:digest(sources),...result,forwardEligible:false,limitations:['事后固定窗口描述，不是可成交报价、因果效应或独立前向效果','基于冻结初筛的提及证券，身份/影响方向未独立确认；全部层级与无证券样本保留','自然日不是交易日；休市、缺价、未到期和不同来源不填零','分钟标签口径仍需供应商核验；后续分钟仅作为已结束观察依据，不保证最终修订','未复权价格不含分红、拆合股调整、FX、费用或滑点，不是投资总回报','参照标的由本次配置选择，未证明行业代表性；相减是百分点差而非因果超额收益','同事件簇及转载可能相关；不把逐条或多证券数量当作独立样本']};
     report={...value,hash:digest(value)};if(Buffer.byteLength(JSON.stringify(report))>64*1024*1024)fail(3);
     db.prepare('INSERT INTO event_price_reports VALUES(?,?,?,?,?)').run(report.id,batchId,data.requestId,requestHash,JSON.stringify(report));
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return report;
  }
 };
 return api;
}
