import {marketClock} from '../shared/market-clock.mjs';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
export const MINUTE_ANOMALY_ENGINE='minute-anomaly/1';
export const minuteStatisticalDefinition=c=>({engine:c.metric==='volume'?'minute-volume/1':MINUTE_ANOMALY_ENGINE,metric:c.metric,interval:'1m',windowSize:c.windowSize,zThreshold:c.zThreshold,direction:c.direction});
function segment(symbol,at){
 const c=marketClock(symbol,at);if(!c.known||!c.session.open)return null;
 const m=c.minute,market=c.session.market;
 if(m<570)return null;
 if(market==='US')return m<c.session.close?c.date+':day':null;
 if(m<(market==='CN'?690:720))return c.date+':am';
 return !c.session.half&&m>=780&&m<(market==='CN'?897:960)?c.date+':pm':null;
}
// Research sampling statistic. Later samples and elapsed time do not prove final vendor prices.
export function evaluateMinuteAnomaly(c,q,{at,provenance}){
 const volume=c.metric==='volume',label=volume?'分钟量字段':'分钟价格变化';
 const s={...minuteStatisticalDefinition(c),priceBasis:'同源未复权分钟采样',completionBasis:'出现后续分钟采样并经过60秒；供应商仍可修订',...(volume?{volumeBasis:q.minuteVolume||null}: {})},input={...provenance,statistical:s};
 const reply=(state,reason)=>({state,reason,input}),unknown=reason=>reply('unknown',reason);
 const now=Date.parse(at),received=Date.parse(q.receivedAt),current=segment(c.symbol,at),quality=q.minuteQuality;
 if(q.interval!=='1m'||q.adjustment!=='none'||q.lastBarMayBeIncomplete!==true||!Array.isArray(q.points)||q.points.length>2000)return unknown('分钟结构或价格口径未核验');
 if(quality?.version!=='minute-quality/1'||quality.invalidRows!==0||!Array.isArray(quality.duplicateTimes)||quality.duplicateTimes.length||!Array.isArray(quality.roundedTimes))return unknown('分钟输入含无效或重复记录，或缺少解析依据；需刷新来源');
 if(!current||!Number.isFinite(received)||received>now)return unknown('当前不在已维护的连续交易时段或接收时间无效');
 const rows=q.points.map(p=>({...p,stamp:providerMinuteTimestamp(p.time,q.providerTimezone)}));
 if(rows.some((p,i)=>p.stamp===null||!Number.isFinite(p.close)||p.close<=0||i>0&&p.stamp<=rows[i-1].stamp)||rows.at(-1)?.time!==q.providerTime)return unknown('分钟时间、价格或末尾指针无效，不排序、补值或跨缺口计算');
 if(!rows.length||rows.at(-1).stamp>received||rows.at(-1).stamp>now)return unknown('来源包含未来分钟采样');
 // Always exclude the latest provider sample, even if the clock is already later.
 const completed=rows.slice(0,-1).filter(p=>p.stamp+60000<=Math.min(now,received)),count=c.windowSize+(volume?1:2),points=completed.slice(-count);
 if(points.length!==count)return unknown(`样本不足；需要 ${count} 个已结束采样及后续分钟记录`);
 if(points.some(p=>quality.roundedTimes.includes(p.time)))return unknown('统计窗口含非整分钟时间，不能把截断时间当作标准采样');
 const latest=points.at(-1);if(now-latest.stamp>300000)return unknown('最新可比较分钟采样已过期');
 if(points.some((p,i)=>segment(c.symbol,new Date(p.stamp).toISOString())!==current||i>0&&p.stamp-points[i-1].stamp!==60000))return unknown('窗口跨休市、交易日或存在分钟缺口，不连续计算');
 if(volume){const v=q.minuteVolume;if(q.provider!=='yahoo-public-chart'||v?.version!=='provider-minute-volume/1'||v.field!=='indicators.quote[0].volume'||v.interval!=='1m'||v.aligned!==true||v.basis!=='provider-bar-values'||typeof v.unit!=='string'||!v.unit.trim()||points.some(p=>!Number.isSafeInteger(p.volume)||p.volume<0))return unknown('分钟量字段缺失、未逐项对应或粒度/来源口径未核验；不补零或差分累计量');}
 const samples=volume?points.map(p=>({date:new Date(p.stamp).toISOString(),value:p.volume})):points.slice(1).map((p,i)=>({date:new Date(p.stamp).toISOString(),value:(p.close/points[i].close-1)*100}));
 if(samples.some(p=>!Number.isFinite(p.value)))return unknown(label+'超出可计算范围');
 const baseline=samples.slice(0,-1),candidate=samples.at(-1);let mean=0,m2=0;
 baseline.forEach((p,i)=>{const delta=p.value-mean;mean+=delta/(i+1);m2+=delta*(p.value-mean);});const std=Math.sqrt(m2/(baseline.length-1));
 Object.assign(s,{baselineCount:baseline.length,baselineFrom:baseline[0].date,baselineTo:baseline.at(-1).date,candidate,mean,std:Number.isFinite(std)?std:null,samples,points:points.map(({stamp,...p})=>({...p,date:new Date(stamp).toISOString()})),excludedLatest:q.providerTime});
 if(!Number.isFinite(std)||std<=Number.EPSILON*Math.max(volume?1:100,Math.abs(mean))*32)return unknown('基线波动为零或小到无法稳定标准化');
 const z=(candidate.value-mean)/std;if(!Number.isFinite(z))return unknown('分钟偏离程度超出可计算范围');s.z=z;
 const hit=c.direction==='high'?z>=c.zThreshold:c.direction==='low'?z<=-c.zThreshold:Math.abs(z)>=c.zThreshold;
 return reply(hit?'true':'false',hit?label+'偏离此前连续样本，需复核':label+'未达到所设统计偏离阈值');
}
