import {marketClock,localParts,dailyHealth,sessionFor} from '../shared/market-clock.mjs';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
export function marketFailure(error){
 const text=String(error?.message??error),kind=error?.kind||(error?.name==='TimeoutError'||/超时|timeout/i.test(text)?'timeout':/fetch failed|ENOTFOUND|ECONN|连接失败/i.test(text)?'network':/HTTP \d+/.test(text)?'http':error instanceof SyntaxError?'format':/没有|未找到/.test(text)?'no-data':'invalid-data');
 return {kind,message:text.slice(0,160),...(error?.attempts?{attempts:error.attempts}:{})};
}
export async function marketJson(read){const text=await read();if(!text.trim()){const e=new Error('行情来源返回空响应');e.kind='empty-response';throw e;}try{return JSON.parse(text);}catch{const e=new Error('行情来源JSON格式异常');e.kind='format';throw e;}}
function minuteFreshness(symbol,stamp,clock,time){
 if(stamp>time+60000)return {state:'future',expectedDate:null};
 if(!clock.known)return {state:'calendar-unknown',expectedDate:null};
 const expectedDate=clock.session.open&&clock.minute>=570?clock.date:clock.expectedDate;
 if(!expectedDate)return {state:'calendar-unknown',expectedDate:null};
 const bar=localParts(new Date(stamp).toISOString(),clock.zone);
 if(bar.date<expectedDate)return {state:'stale',expectedDate};
 if(bar.date>expectedDate)return {state:'future',expectedDate};
 if(clock.label==='交易中')return {state:time-stamp>300000?'stale':'recent-unverified',expectedDate};
 const expectedSession=sessionFor(symbol,expectedDate);
 if(!expectedSession.known)return {state:'calendar-unknown',expectedDate};
 // Minute bars follow the latest elapsed trading segment, without the daily-close buffer.
 const segmentEnd=clock.label==='午间休市'?(clock.session.market==='CN'?690:720):expectedSession.close;
 return {state:segmentEnd-bar.minute>5?'stale':'closed-session-cache',expectedDate};
}
export function diagnoseMarketData(symbol,quote,check,at,{interval='1m',offline=false}={}){
 const time=Date.parse(at),clock=marketClock(symbol,at),received=Date.parse(quote?.receivedAt),validPoints=quote?.points?.filter(p=>Number.isFinite(p.close)&&p.close>0)||[];
 let dataState=!validPoints.length?'missing':'unverified',dataAt=null,dataAgeSeconds=null,expectedMinuteDate=null,dailyCoverage=null;
 if(interval==='1d'){const h=dailyHealth(symbol,quote,at);dataAt=h.lastDate;dataState=h.status;dailyCoverage={expectedDate:h.expectedDate,expectedBarStatus:h.expectedBarStatus,label:h.label};}
 if(validPoints.length&&interval==='1m'){
  const stamp=providerMinuteTimestamp(quote.providerTime,quote.providerTimezone);
  if(stamp!==null){dataAt=new Date(stamp).toISOString();dataAgeSeconds=(time-stamp)/1000;const freshness=minuteFreshness(symbol,stamp,clock,time);dataState=freshness.state;expectedMinuteDate=freshness.expectedDate;
  }else dataState='time-unverified';
 }
 if(offline&&validPoints.length)dataState='synthetic';
 return {source:quote?.provider||null,configuredSources:interval==='1d'?['yahoo-public-chart']:['eastmoney-public','yahoo-public-chart'],interval,quoteKind:'bar-close-research-only',sourceState:offline?'offline':check?.state==='error'?'failed':check?.state==='ok'?'last-attempt-succeeded':'not-attempted',failure:check?.failure||(check?.error?marketFailure(new Error(check.error)):null),noNewBar:check?.noNewBar??null,attemptedAt:check?.attemptedAt||null,lastSuccessfulAt:check?.receivedAt||null,receivedAt:quote?.receivedAt||null,cacheAgeSeconds:Number.isFinite(received)?Math.max(0,(time-received)/1000):null,dataAt,rawProviderTime:quote?.providerTime||quote?.lastDate||null,providerTimezone:quote?.providerTimezone||(interval==='1d'?quote?.marketTimezone:null)||null,marketTimezone:clock.zone||null,expectedMinuteDate,dailyCoverage,dataAgeSeconds,dataState,validPointCount:validPoints.length,marketState:clock.label,calendarKnown:clock.known,executable:false,realtimeVerified:false,deliveryDelay:quote?.deliveryDelay||'unverified',note:'来源请求成功不证明数据及时或可成交；休市状态不证明来源恢复'};
}
