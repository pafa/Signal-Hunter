import {marketJson} from './market-diagnostics.mjs';
import {dailyEligibility,CALENDAR_VERSION} from '../shared/market-clock.mjs';
import {instrument,yahooSymbol,fetchText} from './providers.mjs';

const marketDate=(at,timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export function parseDaily(payload,symbol,receivedAt=new Date().toISOString()){
 const spec=instrument(symbol),r=payload?.chart?.result?.[0],meta=r?.meta;
 if(!meta||meta.symbol?.toUpperCase()!==yahooSymbol(spec)||meta.currency!==spec.currency)throw new Error('日线证券或币种不匹配');
 if(meta.dataGranularity&&meta.dataGranularity!=='1d')throw new Error('上游未返回日线');
 if(meta.exchangeTimezoneName&&meta.exchangeTimezoneName!==spec.marketTimezone)throw new Error('日线交易所时区不匹配');
 const timezone=spec.marketTimezone,today=marketDate(receivedAt,timezone),closes=r.indicators?.quote?.[0]?.close||[],volumes=r.indicators?.quote?.[0]?.volume||[];
 const points=[];let incomplete=0;
 for(const [i,t]of(r.timestamp||[]).entries()){
  if(!Number.isInteger(t)||t<=0||t>4102444800)continue;
  const at=new Date(t*1000).toISOString(),date=marketDate(at,timezone);
  // A local display buffer is explicit; this does not assert exchange tradability.
  if(!dailyEligibility(spec.symbol,date,receivedAt).complete){incomplete++;continue;}
  const close=closes[i],volume=volumes[i];points.push({date,at,close:Number.isFinite(close)&&close>0?close:null,volume:Number.isSafeInteger(volume)&&volume>=0?volume:null});
 }
 const counts=new Map();for(const p of points)counts.set(p.date,(counts.get(p.date)||0)+1);
 const duplicateDates=[...counts].filter(([,n])=>n>1).map(([date])=>date).sort();
 const unique=[...new Map(points.map(p=>[p.date,p])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(!unique.some(p=>p.close!==null))throw new Error('没有已结束的有效日线');
 const actions=Object.entries(r.events||{}).flatMap(([kind,group])=>Object.values(group||{}).filter(a=>Number.isFinite(a.date)).map(a=>({kind,date:marketDate(a.date*1000,timezone),amount:a.amount??null,ratio:a.splitRatio??null})));
 return {symbol:spec.symbol,name:meta.longName||meta.shortName||spec.code,market:spec.market,currency:spec.currency,marketTimezone:timezone,provider:'yahoo-public-chart',interval:'1d',requestedRange:'6mo',receivedAt,cutoffDate:today,calendarVersion:CALENDAR_VERSION,completionPolicy:'交易日历，收盘后30分钟缓冲；非最终价保证',points:unique,actions,duplicateDates,missing:unique.filter(p=>p.close===null).length,incomplete,priceBasis:'供应商 close；非含息回报，复权语义未独立核验',volumeBasis:'供应商报告成交量；单位与完整性未独立核验',deliveryDelay:'unverified',lastDate:unique.filter(p=>p.close!==null).at(-1).date};
}
export async function fetchDaily(symbol,fetcher=fetch,clock=()=>new Date().toISOString()){
 const spec=instrument(symbol),url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol(spec))+'?interval=1d&range=6mo&events=div%2Csplits';
 return parseDaily(await marketJson(()=>fetchText(url,fetcher)),symbol,clock());
}
