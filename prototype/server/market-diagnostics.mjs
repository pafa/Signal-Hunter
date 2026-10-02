import {marketClock,localParts,dailyHealth} from '../shared/market-clock.mjs';
export function marketFailure(error){
 const text=String(error?.message??error),kind=error?.kind||(error?.name==='TimeoutError'||/超时|timeout/i.test(text)?'timeout':/fetch failed|ENOTFOUND|ECONN|连接失败/i.test(text)?'network':/HTTP \d+/.test(text)?'http':error instanceof SyntaxError?'format':/没有|未找到/.test(text)?'no-data':'invalid-data');
 return {kind,message:text.slice(0,160),...(error?.attempts?{attempts:error.attempts}:{})};
}
export async function marketJson(read){const text=await read();if(!text.trim()){const e=new Error('行情来源返回空响应');e.kind='empty-response';throw e;}try{return JSON.parse(text);}catch{const e=new Error('行情来源JSON格式异常');e.kind='format';throw e;}}
function utcMinute(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))return null;const iso=value.replace(' ','T')+':00.000Z',t=Date.parse(iso);return Number.isFinite(t)&&new Date(t).toISOString()===iso?t:null;}
export function diagnoseMarketData(symbol,quote,check,at,{interval='1m',offline=false}={}){
 const time=Date.parse(at),clock=marketClock(symbol,at),received=Date.parse(quote?.receivedAt),validPoints=quote?.points?.filter(p=>Number.isFinite(p.close)&&p.close>0)||[];
 let dataState=!validPoints.length?'missing':'unverified',dataAt=null,dataAgeSeconds=null;
 if(validPoints.length&&interval==='1d'){const h=dailyHealth(symbol,quote,at);dataAt=h.lastDate;dataState=h.status;}
 if(validPoints.length&&interval==='1m'){
  const stamp=quote.providerTimezone==='UTC'?utcMinute(quote.providerTime):null;
  if(stamp!==null){dataAt=new Date(stamp).toISOString();dataAgeSeconds=(time-stamp)/1000;const date=localParts(dataAt,clock.zone||'UTC').date;
   dataState=stamp>time+60000?'future':!clock.known?'calendar-unknown':date<(clock.expectedDate||clock.date)?'stale':clock.label==='交易中'&&time-stamp>300000?'stale':clock.label==='交易中'?'recent-unverified':'closed-session-cache';
  }else dataState='time-unverified';
 }
 if(offline&&validPoints.length)dataState='synthetic';
 return {source:quote?.provider||null,configuredSources:interval==='1d'?['yahoo-public-chart']:['eastmoney-public','yahoo-public-chart'],interval,quoteKind:'bar-close-research-only',sourceState:offline?'offline':check?.state==='error'?'failed':check?.state==='ok'?'last-attempt-succeeded':'not-attempted',failure:check?.failure||(check?.error?marketFailure(new Error(check.error)):null),noNewBar:check?.noNewBar??null,attemptedAt:check?.attemptedAt||null,lastSuccessfulAt:check?.receivedAt||null,receivedAt:quote?.receivedAt||null,cacheAgeSeconds:Number.isFinite(received)?Math.max(0,(time-received)/1000):null,dataAt,rawProviderTime:quote?.providerTime||quote?.lastDate||null,providerTimezone:quote?.providerTimezone||(interval==='1d'?quote?.marketTimezone:null)||null,marketTimezone:clock.zone||null,dataAgeSeconds,dataState,validPointCount:validPoints.length,marketState:clock.label,calendarKnown:clock.known,executable:false,realtimeVerified:false,deliveryDelay:quote?.deliveryDelay||'unverified',note:'来源请求成功不证明数据及时或可成交；休市状态不证明来源恢复'};
}
