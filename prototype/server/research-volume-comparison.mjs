import {verifyMarketDocument} from './research-price-material.mjs';
import {parseDaily} from './daily.mjs';
import {instrument,parseYahooMinutes} from './providers.mjs';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
import {CALENDAR_VERSION,localParts,sessionFor} from '../shared/market-clock.mjs';

export const VOLUME_COMPARISON_VERSION='research-volume-comparison/1';
const instructions='这里只核对同证券、同交易日的供应商原始数值，不证明成交量单位、覆盖或修订口径一致。不同获取时间分别保留；差异不推断为股/手、累计量或供应商错误，不缩放、补齐或改写原始值。数值相等也不代表来源语义已验证。价格可用性由各自 diagnostics 判断；成交量未核验时不能据此认定放量、缩量、资金流或生成依赖成交量的行动条件。';
const ref=m=>({materialId:m.id,materialRevision:m.revision,interval:m.marketSource.interval,source:m.marketSource.source});
const unknown=(base,reason)=>({...base,status:'unknown',reason,days:[]});

// Called only when a new pair finishes preparation. Historic topics and packets
// are not rewritten. Both original responses must pass the existing verifier.
export function researchVolumeComparison(symbol,materials,read){
 const base={schema:VOLUME_COMPARISON_VERSION,symbol,status:'unknown',units:'unverified',eligibleForVolumeSignal:false,calendarVersion:CALENDAR_VERSION,instructions,sources:materials.filter(Boolean).map(ref)};
 if(materials.length!==2||materials.some(m=>!m))return unknown(base,'日线或分钟材料缺失，不能比较成交量');
 const daily=materials.find(m=>m.marketSource.interval==='1d'),minute=materials.find(m=>m.marketSource.interval==='1m');
 if(!daily||!minute||materials.some(m=>m.marketSource.symbol!==symbol))return unknown(base,'证券或周期不对应，不能比较成交量');
 let dailyQuote,minuteQuote;
 try{
  const d=verifyMarketDocument(daily,read)[0],m=verifyMarketDocument(minute,read)[0],spec=instrument(symbol);
  if(spec.marketTimezone!=='America/New_York'||materials.some(x=>x.marketSource.provider!=='yahoo-public-chart'))return unknown(base,'当前只核对同一 Yahoo 来源的美股常规交易时段；其他市场或来源的成交量口径待核验');
  dailyQuote=parseDaily(JSON.parse(d.body.toString('utf8')),symbol,d.receivedAt);
  minuteQuote=parseYahooMinutes(JSON.parse(m.body.toString('utf8')),spec);
  if(dailyQuote.dailyQuality.sourceTimezone!==spec.marketTimezone||JSON.parse(m.body.toString('utf8')).chart.result[0].meta.exchangeTimezoneName!==spec.marketTimezone)return unknown(base,'原始响应未明确确认交易所时区');
 }catch{return unknown(base,'原始材料或响应无法完整核对，不能比较成交量');}
 const coverage=minute.marketSource.coverage,groups=new Map();
 for(const p of minuteQuote.points){
  // Reuse exactly the frozen material's selected range; no newer cache, partial
  // last bar, excluded latest-trade instant or omitted older minute is added.
  if(p.time<coverage.first||p.time>coverage.last)continue;
  const stamp=providerMinuteTimestamp(p.time,minuteQuote.providerTimezone),local=localParts(stamp,minute.marketSource.marketTimezone);
  if(!groups.has(local.date))groups.set(local.date,[]);
  groups.get(local.date).push({...p,minute:local.minute});
 }
 const days=[...groups].map(([date,points])=>{
  const session=sessionFor(symbol,date),day={date,status:'unknown',expectedMinutes:null,observedMinutes:0,missingMinutes:null,excludedOutsideSession:0,missingVolumeMinutes:0,minuteVolume:null,dailyVolume:null,difference:null,ratio:null};
  if(!session.known||!session.open)return {...day,reason:'当前日历未确认该日的常规交易时段'};
  const selected=points.filter(p=>p.minute>=570&&p.minute<session.close),minutes=new Set(selected.map(p=>p.minute));
  Object.assign(day,{expectedMinutes:session.close-570,observedMinutes:minutes.size,missingMinutes:session.close-570-minutes.size,excludedOutsideSession:points.length-selected.length,missingVolumeMinutes:selected.filter(p=>!Number.isSafeInteger(p.volume)||p.volume<0).length});
  const dailyCoverage=daily.marketSource.coverage;
  const d=dailyQuote.points.find(p=>p.date===date&&p.date>=dailyCoverage.first&&p.date<=dailyCoverage.last);
  day.dailyVolume=d?.volume??null;
  if(day.missingVolumeMinutes===0&&selected.length){const sum=selected.reduce((total,p)=>total+BigInt(p.volume),0n);if(sum<=BigInt(Number.MAX_SAFE_INTEGER))day.minuteVolume=Number(sum);}
  if(day.missingMinutes||day.missingVolumeMinutes||day.minuteVolume===null||day.dailyVolume===null)return {...day,reason:'分钟覆盖、成交量或同日已结束日线不足；保留未知，不补零或外推'};
  day.difference=day.minuteVolume-day.dailyVolume;day.ratio=day.dailyVolume>0?day.minuteVolume/day.dailyVolume:null;
  return {...day,status:day.difference===0?'equal':'different',reason:day.difference===0?'原始数值相等；单位和覆盖语义仍未核验':'同日常规分钟合计与日线原始数值不同；原因未核验'};
 });
 const status=days.some(d=>d.status==='different')?'different':days.length&&days.every(d=>d.status==='equal')?'equal':'unknown';
 return {...base,status,days,reason:status==='different'?'发现跨周期成交量差异，不能作为已验证的量价信号':status==='equal'?'跨周期原始数值相等，成交量语义仍待核验':'缺少可完整比较的同日成交量'};
}

export function volumeComparisonNote(result){
 const details=result.days.map(d=>`${d.date}：常规分钟 ${d.observedMinutes}/${d.expectedMinutes??'未知'}，分钟合计 ${d.minuteVolume??'未知'}，日线 ${d.dailyVolume??'未知'}${d.ratio===null?'':`，比值 ${d.ratio.toFixed(4)}`}；${d.reason}`).join('。');
 return `成交量核对：${result.reason}。${details}${details?'。':''}价格与成交量分别判断，不对原始数值作缩放或补齐。`;
}
