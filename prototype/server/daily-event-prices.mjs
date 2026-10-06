import {digest} from './codex-research.mjs';
import {evaluationTime as stamp} from '../shared/evaluation.mjs';
import {instrument} from '../shared/securities.mjs';
import {sessionFor,localParts,dailyEligibility,CALENDAR_VERSION} from '../shared/market-clock.mjs';
import {DAILY_PRICE_WINDOWS,eventPriceErrors} from '../shared/event-prices.mjs';
const fail=i=>{throw Error(eventPriceErrors[i]);};
const nextDate=date=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const group=p=>JSON.stringify([p.symbol,p.provider,p.currency,p.timezone,p.priceBasis]);
const pct=(a,b)=>{const value=(b/a-1)*100;return Number.isFinite(value)?value:null;};
export function dailyWindowDates(symbol,date,count){
 if(!sessionFor(symbol,date).known)return null;
 const dates=[];let day=date;
 for(let i=0;i<90&&dates.length<count;i++){
  day=nextDate(day);const session=sessionFor(symbol,day);
  if(!session.known)return null;if(session.open)dates.push(day);
 }
 return dates.length===count?dates:null;
}

// Historical date labels are not receipt times or executable quotes. Preserve the
// first valid archived close; a new report may reveal gaps, never rewrite an old one.
export function dailyPriceObservations(archives,asOf){
 if(stamp(asOf)===null)fail(0);
 const points=new Map(),diagnostics=[],actions=[];let total=0;
 for(const a of [...archives].sort((a,b)=>stamp(a.received_at)-stamp(b.received_at)||a.hash.localeCompare(b.hash))){
  const q=JSON.parse(a.payload),received=stamp(a.received_at);
  if(digest(a.payload)!==a.hash||received===null||q.receivedAt!==a.received_at||q.symbol!==a.symbol)fail(2);
  const record={snapshotHash:a.hash,symbol:a.symbol,receivedAt:a.received_at,usedPoints:0,missingPrices:0,excludedDates:0,reason:null};diagnostics.push(record);
  if(received>stamp(asOf)){record.reason='接收时间晚于报告截止';continue;}
  let spec;try{spec=instrument(q.symbol);}catch{record.reason='证券代码无效';continue;}
  if(!sessionFor(q.symbol,localParts(a.received_at,spec.marketTimezone).date).known){record.reason='接收日期的市场日历未覆盖';continue;}
  if(q.dailyQuality?.version!=='daily-quality/1'||q.dailyQuality.sourceInterval!=='1d'||q.dailyQuality.sourceTimezone!==spec.marketTimezone){record.reason='缺少来源响应的原始日线粒度或交易所时区；不补造旧档案依据';continue;}
  if(spec.symbol!==q.symbol||q.provider!=='yahoo-public-chart'||q.interval!=='1d'||q.currency!==spec.currency||q.market!==spec.market||q.marketTimezone!==spec.marketTimezone||q.calendarVersion!==CALENDAR_VERSION||typeof q.priceBasis!=='string'||!q.priceBasis||q.actionsParsed!==true||!Array.isArray(q.actions)||!Array.isArray(q.duplicateDates)||q.duplicateDates.length||!Array.isArray(q.points)||!q.points.length||q.points.length>2000){record.reason='日线来源、身份、日历或解析依据未核验';continue;}
  total+=q.points.length;if(total>200000)fail(3);
  if(q.points.some((p,i)=>typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||stamp(p.at)===null||stamp(p.at)>received||localParts(p.at,spec.marketTimezone).date!==p.date||i>0&&p.date<=q.points[i-1].date||p.close!==null&&(!Number.isFinite(p.close)||p.close<=0))||q.actions.some(a=>!a||typeof a.kind!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!sessionFor(q.symbol,a.date).known)){
   record.reason='日线日期、价格、排序或公司行动依据无效';continue;
  }
  for(const a of q.actions)actions.push({symbol:q.symbol,provider:q.provider,date:a.date,kind:a.kind,snapshotHash:record.snapshotHash});
  for(const p of q.points){
   if(!sessionFor(q.symbol,p.date).known||!dailyEligibility(q.symbol,p.date,a.received_at).complete){record.excludedDates++;continue;}
   if(p.close===null){record.missingPrices++;continue;}
   const point={symbol:q.symbol,provider:q.provider,currency:q.currency,timezone:q.marketTimezone,priceBasis:q.priceBasis,date:p.date,time:p.date,price:p.close,snapshotHash:a.hash,receivedAt:a.received_at,calendarVersion:CALENDAR_VERSION};
   const key=group(point)+':'+point.date;
   if(!points.has(key)){points.set(key,point);record.usedPoints++;}
  }
  record.reason=record.usedPoints?'保留首次有效已结束日线':'无新增有效日线；缺价和后续修订不填补旧报告';
 }
 return {points:[...points.values()].sort((a,b)=>a.date.localeCompare(b.date)||stamp(a.receivedAt)-stamp(b.receivedAt)||a.snapshotHash.localeCompare(b.snapshotHash)),actions,diagnostics};
}

export function dailyPriceRows(samples,labels,observations,benchmarks,asOf){
 const {points,actions}=observations,rows=[],noSymbols=[];
 const byDate=new Map();for(const p of points){const key=p.symbol+':'+p.date;if(!byDate.has(key))byDate.set(key,[]);byDate.get(key).push(p);}
 const pick=(symbol,date,predicate=()=>true)=>(byDate.get(symbol+':'+date)||[]).find(predicate);
 for(const s of samples){
  const symbols=[...new Set((s.triage?.companies||[]).map(c=>c.symbol))].sort();
  if(!symbols.length){noSymbols.push({sampleId:s.id,reason:'冻结标题初筛没有关联证券；不按后来的研究补选'});continue;}
  for(const symbol of symbols){
   let spec;try{spec=instrument(symbol);if(spec.symbol!==symbol)throw Error();}catch{noSymbols.push({sampleId:s.id,symbol,reason:'冻结证券代码无法核验'});continue;}
   const decision=stamp(s.decisionAt),seen=stamp(s.input.firstSeen),available=stamp(s.input.availableAt),valid=decision!==null&&seen!==null&&available!==null&&seen<=available&&available<=decision&&decision<=stamp(asOf);
   const decisionDate=valid?localParts(s.decisionAt,spec.marketTimezone).date:null;
   const startDates=valid?dailyWindowDates(symbol,decisionDate,1):null,baseDate=startDates?.[0]||null,base=baseDate?pick(symbol,baseDate):null;
   for(const w of DAILY_PRICE_WINDOWS){
    const dates=baseDate?dailyWindowDates(symbol,baseDate,w.days):null,targetDate=dates?.at(-1)||null;
    const row={sampleId:s.id,newsId:s.input.id,symbol,bucket:s.triage?.bucket||'unknown',clusterId:labels[s.id]?.clusterId||null,decisionAt:s.decisionAt,availableAt:s.input.availableAt,firstSeen:s.input.firstSeen,window:w.id,baselineDate:baseDate,targetAt:targetDate,baseline:base,endpoint:null,returnPct:null,maxDrawdownPct:null,pathReason:null,benchmark:benchmarks[spec.currency]||null,benchmarkBaseline:null,benchmarkEndpoint:null,benchmarkReturnPct:null,excessPct:null,reason:null,benchmarkReason:null};rows.push(row);
    if(!valid){row.reason='首次获取、本版可用或判断时间缺失/矛盾';continue;}
    if(!sessionFor(symbol,localParts(asOf,spec.marketTimezone).date).known){row.reason='报告截止日期的市场日历未覆盖';continue;}
    if(!baseDate||!targetDate){row.reason='市场日历未覆盖起点或窗口；不按已有数据条数推算交易日';continue;}
    if(!dailyEligibility(symbol,targetDate,asOf).complete){row.reason='交易日窗口尚未到期';continue;}
    if(!base){row.reason='判断后下个交易日收盘缺价；不顺延起点';continue;}
    const end=pick(symbol,targetDate,p=>group(p)===group(base));
    if(!end){row.reason='目标交易日缺价或来源/价格口径不同；不顺延终点';continue;}
    const affected=(symbol,provider)=>actions.some(a=>a.symbol===symbol&&a.provider===provider&&a.date>=baseDate&&a.date<=targetDate);
    if(affected(symbol,base.provider)){row.reason='窗口包含来源报告的公司行动；复权语义未核验';continue;}
    row.endpoint=end;row.returnPct=pct(base.price,end.price);
    row.reason=row.returnPct===null?'价格变化超出可计算范围':'可计算供应商收盘价变化；复权语义未独立核验';
    const path=[base,...dates.map(date=>pick(symbol,date,p=>group(p)===group(base)))];
    if(path.some(p=>!p)){row.pathReason='中间交易日缺价，收盘回撤不可计算';}
    else{let peak=base.price,drawdown=0;for(const p of path){peak=Math.max(peak,p.price);drawdown=Math.min(drawdown,pct(peak,p.price));}row.maxDrawdownPct=drawdown;row.pathReason='完整交易日收盘序列；不代表盘中或账户回撤';}
    const benchmark=row.benchmark;
    if(!benchmark){row.benchmarkReason='未配置参照标的';continue;}
    if(benchmark===symbol){row.benchmarkReason='参照标的与研究证券相同';continue;}
    const same=p=>p.provider===base.provider&&p.currency===base.currency&&p.timezone===base.timezone&&p.priceBasis===base.priceBasis;
    const bb=pick(benchmark,baseDate,same),be=pick(benchmark,targetDate,same);
    if(!bb||!be||affected(benchmark,base.provider)){row.benchmarkReason='参照缺少同市场同源端点，或窗口包含公司行动';continue;}
    row.benchmarkBaseline=bb;row.benchmarkEndpoint=be;row.benchmarkReturnPct=pct(bb.price,be.price);
    if(row.returnPct===null||row.benchmarkReturnPct===null){row.benchmarkReason='参照价格变化超出可计算范围';continue;}
    const excess=row.returnPct-row.benchmarkReturnPct;
    if(!Number.isFinite(excess)){row.benchmarkReason='参照价格变化超出可计算范围';continue;}
    row.excessPct=excess;row.benchmarkReason='证券变化减参照变化（百分点）';
   }
  }
 }
 const represented=new Set(rows.map(r=>r.sampleId));
 return {rows,noSymbols,summary:{samples:samples.length,samplesWithoutUsableSymbol:samples.filter(s=>!represented.has(s.id)).length,pairs:rows.length,priced:rows.filter(r=>r.returnPct!==null).length,pairedBenchmark:rows.filter(r=>r.excessPct!==null).length,reasons:rows.reduce((r,x)=>(r[x.reason]=(r[x.reason]||0)+1,r),{}),windows:Object.fromEntries(DAILY_PRICE_WINDOWS.map(w=>{const r=rows.filter(x=>x.window===w.id);return [w.id,{total:r.length,priced:r.filter(x=>x.returnPct!==null).length,pairedBenchmark:r.filter(x=>x.excessPct!==null).length}];}))}};
}
