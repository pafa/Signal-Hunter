import {sessionFor,dailyEligibility} from '../shared/market-clock.mjs';
export const DAILY_ANOMALY_ENGINE='daily-anomaly/2';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const previous=d=>new Date(Date.parse(d+'T12:00:00Z')-86400000).toISOString().slice(0,10);
export const statisticalDefinition=c=>({engine:DAILY_ANOMALY_ENGINE,metric:c.metric,windowSize:c.windowSize,zThreshold:c.zThreshold,direction:c.direction});
// Descriptive sample statistic; no normality assumption, probability, forecast or trading permission.
export function evaluateDailyAnomaly(c,q,{at,provenance}){
 const input={...provenance,statistical:{...statisticalDefinition(c),priceBasis:q.priceBasis||null,actionsParsed:q.actionsParsed===true,volumeBasis:q.volumeBasis||null,actionCoverage:'仅供应商报告；不证明公司行动完整'}},s=input.statistical;
 const result=(state,reason)=>({state,reason,input}),unknown=reason=>result('unknown',reason);
 if(q.interval!=='1d'||!validDate(q.lastDate)||!Array.isArray(q.points)||q.points.length>1000)return unknown('日线结构、日期或样本上限无效');
 if(!dailyEligibility(c.symbol,q.lastDate,q.receivedAt).complete||!dailyEligibility(c.symbol,q.lastDate,at).complete)return unknown('最后日线在获取时或检查时尚未结束');
 const count=c.windowSize+(c.metric==='return'?2:1),points=q.points.slice(-count);
 if(points.length!==count)return unknown(`样本不足；需要 ${count} 个完整交易日`);
 if(points.at(-1).date!==q.lastDate)return unknown('末尾日线与有效收盘日期不一致');
 let date=q.lastDate;const expected=[];
 for(let n=0;n<count*4+30&&expected.length<count;n++,date=previous(date)){
  const day=sessionFor(c.symbol,date);if(!day.known)return unknown('统计窗口超出已维护日历');if(day.open)expected.unshift(date);
 }
 if(expected.length!==count||points.some((p,i)=>p.date!==expected[i]))return unknown('窗口存在交易日缺口、重复、乱序或非交易日，不跨缺口计算');
 if(q.duplicateDates?.some(d=>d>=points[0].date&&d<=q.lastDate))return unknown('供应商在统计窗口返回重复日线日期，不能静默选取其中一条');
 if(points.some(p=>!Number.isFinite(p.close)||p.close<=0))return unknown('统计窗口有缺失或无效收盘价，不补值');
 if(q.actionsParsed!==true)return unknown('公司行动解析依据缺失，需刷新日线；旧快照与待办保留');
 if(!Array.isArray(q.actions)||q.actions.some(a=>!a||!validDate(a.date)))return unknown('公司行动元数据缺失或日期无效，不能排除口径变化');
 const actions=q.actions.filter(a=>a.date>=points[0].date&&a.date<=q.lastDate);s.actions=actions;
 if(actions.length)return unknown('统计窗口含供应商报告的公司行动，先核对除权、拆股或分红口径');
 if(c.metric==='volume'&&(typeof q.volumeBasis!=='string'||!q.volumeBasis.trim()||points.some(p=>!Number.isSafeInteger(p.volume)||p.volume<0)))return unknown('窗口成交量缺失或单位口径未记录；旧缓存需刷新');
 if(c.metric==='return'&&(typeof q.priceBasis!=='string'||!q.priceBasis.trim()))return unknown('价格口径未记录，不能比较历史涨跌幅');
 const samples=c.metric==='return'?points.slice(1).map((p,i)=>({date:p.date,value:(p.close/points[i].close-1)*100})):points.map(p=>({date:p.date,value:p.volume}));
 if(samples.some(p=>!Number.isFinite(p.value)))return unknown('样本数值超出可计算范围');
 const baseline=samples.slice(0,-1),candidate=samples.at(-1);let mean=0,m2=0;
 baseline.forEach((p,i)=>{const delta=p.value-mean;mean+=delta/(i+1);m2+=delta*(p.value-mean);});
 const std=Math.sqrt(m2/(baseline.length-1));
 Object.assign(s,{baselineCount:baseline.length,baselineFrom:baseline[0].date,baselineTo:baseline.at(-1).date,candidate,mean,std:Number.isFinite(std)?std:null,samples,points});
 if(!Number.isFinite(std)||std<=Number.EPSILON*Math.max(c.metric==='return'?100:1,Math.abs(mean))*32)return unknown('基线波动为零或小到无法稳定标准化，不生成无限异常分数');
 const z=(candidate.value-mean)/std;if(!Number.isFinite(z))return unknown('偏离程度超出可计算范围');s.z=z;
 const hit=c.direction==='high'?z>=c.zThreshold:c.direction==='low'?z<=-c.zThreshold:Math.abs(z)>=c.zThreshold;
 return result(hit?'true':'false',hit?'最新完整日线偏离此前样本基线，需复核':'最新完整日线未达到所设统计偏离阈值');
}
