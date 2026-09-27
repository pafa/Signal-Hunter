import {instrument,yahooSymbol} from './providers.mjs';
export const STUDY_VERSION='recent-event-study/0.1.0';
export function localDate(at,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
export function parseStudyBars(payload,symbol,interval,receivedAt){
 const spec=instrument(symbol),r=payload?.chart?.result?.[0],m=r?.meta;
 if(!m||m.symbol?.toUpperCase()!==yahooSymbol(spec)||m.currency!==spec.currency)throw new Error('证券/币种不匹配');
 if(!['1d','5m'].includes(interval))throw new Error('Unsupported interval');
 const timezone=m.exchangeTimezoneName||spec.marketTimezone,quote=r.indicators?.quote?.[0],bars=[];let omitted=0;
 for(const [i,t] of (r.timestamp||[]).entries()){
  const close=quote?.close?.[i];if(!Number.isFinite(t)||t<=0||!Number.isFinite(close)||close<=0){omitted++;continue;}
  const at=new Date(t*1000).toISOString(),date=localDate(at,timezone);
  // Exclude today's daily bar even in markets already closed; uniform conservative cutoff.
  const complete=interval==='1d'?date<localDate(receivedAt,timezone):t*1000+300000<=Date.parse(receivedAt);
  if(complete)bars.push({at,date,close});
 }
 const unique=[...new Map(bars.map(b=>[b.at,b])).values()].sort((a,b)=>a.at.localeCompare(b.at));
 if(!unique.length)throw new Error('无已结束且有效的行情柱');
 return {symbol,name:m.longName||m.shortName||symbol,currency:spec.currency,marketTimezone:timezone,provider:'yahoo-public-chart',providerTimezone:'UTC',interval,receivedAt,bars:unique,omitted,actions:r.events||{},priceBasis:'供应商 close 原币价格；非含息收益，复权语义未独立核验。',deliveryDelay:'unverified'};
}
export function measureEvent(prices,eventDate){
 if(prices.interval!=='1d')throw new Error('日度窗口仅使用日线');
 const dates=[...new Set([...prices.bars.map(b=>b.date),...(prices.expectedDates||[])])].filter(d=>d>eventDate).sort();
 const byDate=new Map(prices.bars.map(b=>[b.date,b])),anchor=byDate.get(dates[0]);
 if(!anchor)return {anchor:null,outcomes:[],status:dates.length?'观察起点日线缺失':'尚无完整观察起点'};
 const actions=Object.values(prices.actions||{}).flatMap(group=>Object.values(group||{}));
 return {anchor,status:'描述性观察，不是可成交收益',outcomes:[1,3,5].map(h=>{
  if(!dates[h])return {sessions:h,status:'窗口未成熟',change:null};
  const end=byDate.get(dates[h]);
  if(dates.slice(0,h+1).some(d=>!byDate.has(d)))return {sessions:h,status:'窗口内日线缺失，暂不计算',change:null};
  const action=actions.some(a=>a.date*1000>Date.parse(anchor.at)&&a.date*1000<=Date.parse(end.at));
  if(action)return {sessions:h,status:'窗口含公司行动，暂不计算',change:null,end};
  return {sessions:h,status:'已成熟',change:(end.close/anchor.close-1)*100,end};
 })};
}
