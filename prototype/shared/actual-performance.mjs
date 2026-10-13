// Reference performance for recorded actual accounts. No trading policy or
// account balance is inferred. The method and observed window travel with data.
export const ACTUAL_PERFORMANCE_VERSION='actual-performance/1';
export const actualPerformanceErrors=['净值采样时间无效','净值采样时钟倒退，本轮未保存','净值采样记录校验失败','净值历史查询参数无效','实际账本账户不存在'];
export const performanceBasis='按已记录的原币净值采样；出入金按实际记录时间加权，链结 Modified Dietz 近似收益；回撤只比较该采样指数，不推断未记录高低点';
export const performanceLimit='不是精确时间加权收益或券商收益；大额资金流与剧烈波动会扩大近似误差，缺价和历史修订保留缺口，不代表完整历史最大回撤';
export const performanceTimezone=currency=>currency==='USD'?'America/New_York':currency==='HKD'?'Asia/Hong_Kong':'Asia/Shanghai';
const dayFormatters=new Map();
export const performanceDay=(at,currency)=>{const zone=performanceTimezone(currency);if(!dayFormatters.has(zone))dayFormatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone}));return dayFormatters.get(zone).format(new Date(at));};
const cents=v=>{const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
const number=v=>v>BigInt(Number.MAX_SAFE_INTEGER)||v< -BigInt(Number.MAX_SAFE_INTEGER)?null:Number(v);
export function performanceInterval(start,end,entries){return intervalRows(start,end,entries.filter(r=>r.at>start.at&&r.at<=end.at&&r.type!=='void'));}
function intervalRows(start,end,rows){
 const duration=Date.parse(end.at)-Date.parse(start.at);
 if(!Number.isFinite(duration)||duration<=0||start.navCents===null||end.navCents===null)return {state:'unknown',reason:'缺少两个不同时间的有效净值采样'};
 if(rows.some(r=>['cash_balance','position_balance'].includes(r.type)))return {state:'reset',reason:'区间包含对账调整，从调整后的采样重新建立比较窗口'};
 const flows=rows.filter(r=>['deposit','withdrawal'].includes(r.type)).map(r=>({id:r.id||r.externalId,revision:r.revision,at:r.at,cents:number(cents(r.amount)*(r.type==='withdrawal'?-1n:1n))}));
 const net=flows.reduce((n,f)=>n+BigInt(f.cents),0n),pnl=BigInt(end.navCents)-BigInt(start.navCents)-net;
 // Work in integer cent-milliseconds until the final dimensionless division.
 const weighted=flows.reduce((n,f)=>n+BigInt(f.cents)*BigInt(Date.parse(end.at)-Date.parse(f.at)),0n),denominator=BigInt(start.navCents)*BigInt(duration)+weighted;
 const result={pnlCents:number(pnl),netFlowCents:number(net),flows,weightedCapitalCents:Number(denominator)/duration,approximate:flows.length>0};
 if(start.navCents<=0||denominator<=0n)return {...result,state:'reset',reason:'期初净值或时间加权资金不为正，不能继续链结收益'};
 const rate=Number(pnl*BigInt(duration))/Number(denominator),factor=1+rate;
 if(!Number.isFinite(rate)||factor<0||result.pnlCents===null||result.netFlowCents===null)return {...result,state:'reset',reason:'该区间无法形成有效收益指数，原金额与资金流保留'};
 return {...result,state:'available',rate,reason:flows.length?'资金流按记录时间加权的近似区间收益':'本区间无外部资金流'};
}

// The accumulator can resume at a verified checkpoint without retaining quotes
// or scanning every cash flow for each minute. Historical outputs are unchanged.
export function actualPerformanceAccumulator(entries,{currency,state=null}){
 const rows=entries.filter(r=>['deposit','withdrawal','cash_balance','position_balance'].includes(r.type)).sort((a,b)=>a.at.localeCompare(b.at));
 const after=at=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].at<=at)lo=mid+1;else hi=mid;}return lo;};
 const interval=(a,b)=>intervalRows(a,b,rows.slice(after(a.at),after(b.at)));
 const s=state?structuredClone(state):{previous:null,latest:null,last:null,dayFirst:null,start:null,index:100,peak:100,maxDrawdown:0,count:0,approximate:false,total:0,valid:0};
 return {
  push(point){
   const p={...point,index:null,returnPct:null,drawdownPct:null,maxDrawdownPct:null,interval:null};s.total++;
   if(point.eligible&&point.navCents!==null){
    const step=s.previous?interval(s.previous,point):null;
    if(!s.previous||step.state!=='available'||s.index===0){s.start=point.at;s.index=100;s.peak=100;s.maxDrawdown=0;s.count=1;s.approximate=false;p.resetReason=step?.reason||'首个有效采样';}
    else {s.index*=1+step.rate;s.count++;s.approximate ||= step.approximate;s.peak=Math.max(s.peak,s.index);s.maxDrawdown=Math.max(s.maxDrawdown,s.peak>0?(1-s.index/s.peak)*100:0);}
    if(!Number.isFinite(s.index)||s.index<0){p.eligible=false;p.issue='收益链结超出可计算范围';s.previous=null;s.last=p;return p;}
    p.index=s.index;p.returnPct=s.count>1?(s.index/100-1)*100:null;p.drawdownPct=s.count>1?(1-s.index/s.peak)*100:null;p.maxDrawdownPct=s.count>1?s.maxDrawdown:null;p.interval=step;p.windowStart=s.start;p.windowSamples=s.count;p.approximate=s.approximate;
    const day=performanceDay(p.at,currency);
    if(!s.dayFirst||s.dayFirst.windowStart!==p.windowStart||s.dayFirst.day!==day)s.dayFirst={at:p.at,navCents:p.navCents,windowStart:p.windowStart,day};
    // Only these scalars are needed to continue the next interval.
    s.previous={at:p.at,navCents:p.navCents};s.latest={at:p.at,id:p.id,returnPct:p.returnPct,drawdownPct:p.drawdownPct,maxDrawdownPct:p.maxDrawdownPct,windowStart:p.windowStart,windowSamples:p.windowSamples,approximate:p.approximate,navCents:p.navCents};s.valid++;
   }
   s.last={id:p.id,at:p.at,eligible:p.eligible,navCents:p.navCents};return p;
  },
  state(){return structuredClone(s);},
  summary({at,current=false,reason=''}){
   const latest=s.latest,today=performanceDay(at,currency),first=s.dayFirst;
   const day=latest&&first?.day===today&&first.at<latest.at?interval(first,latest):null;
   const fresh=current&&s.last?.id===latest?.id&&s.last?.at===latest?.at&&s.last?.eligible&&latest?.windowSamples>1;
   return {schema:ACTUAL_PERFORMANCE_VERSION,current:!!fresh,status:fresh?'available':!latest?'unavailable':latest.windowSamples<2?'baseline':'waiting',reason:fresh?'最新有效采样已核对':reason||(!latest?'尚无有效净值采样':latest.windowSamples<2?'已记录首个净值，等待下一次有效采样':'等待当前有效采样'),currency,timeZone:performanceTimezone(currency),asOf:latest?.at||null,lastId:s.last?.id||null,totalSamples:s.total,eligibleSamples:s.valid,gapSamples:s.total-s.valid,windowStart:latest?.windowStart||null,windowSamples:latest?.windowSamples||0,approximate:!!latest?.approximate,referenceReturnPct:fresh?latest.returnPct:null,currentDrawdownPct:fresh?latest.drawdownPct:null,maxDrawdownPct:fresh?latest.maxDrawdownPct:null,dailyPnlCents:fresh&&day?.state==='available'?day.pnlCents:null,dailyFrom:fresh&&day?.state==='available'?first.at:null,basis:performanceBasis,limit:performanceLimit};
  },
 };
}
export function actualPerformanceSeries(points,entries,options){
 const acc=actualPerformanceAccumulator(entries,options),series=points.map(p=>acc.push(p));return {series,summary:acc.summary(options)};
}
