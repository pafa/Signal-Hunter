import {decimal,lotQuoteIssues,valuation} from './market-sim-risk.mjs';
export function strategyRisk(book,quotes,at){
 if(!book.profile)return {alerts:[],drawdownPct:null,navCents:null};
 const policy=book.profile.risk,v=valuation(book,quotes,at),peak=Math.max(book.highWaterCents||book.initialCents,v.navCents||0),drawdownPct=v.navCents===null?null:(peak-v.navCents)/peak*100,alerts=[];
 if(drawdownPct!==null&&drawdownPct>=policy.poolWarningPct)alerts.push({key:'pool',kind:drawdownPct>=policy.poolStopPct?'pool-stop':'pool-warning',message:`策略池相对已记录净值高点回撤 ${drawdownPct.toFixed(2)}%`,blocksBuy:drawdownPct>=policy.poolStopPct});
 for(const l of book.lots){
  if(Date.parse(l.holdUntil)<=Date.parse(at))alerts.push({key:`${l.id}:due`,lotId:l.id,symbol:l.symbol,kind:'holding-review',message:'持有复核截止已到，需本人决定是否退出',blocksBuy:true});
  const q=quotes[l.symbol];if(lotQuoteIssues(l,q,book.config,at).length||!l.entryPrice)continue;
  const price=Number(q.mark),entry=Number(l.entryPrice),high=Math.max(Number(l.peakPrice||l.entryPrice),price),loss=(entry-price)/entry*100,gain=(high-entry)/entry*100,trail=(high-price)/high*100;
  if(loss>=policy.hardStopPct)alerts.push({key:l.id,lotId:l.id,symbol:l.symbol,kind:'loss-exit-review',message:`相对成交价下跌 ${loss.toFixed(2)}%，达到 ${policy.hardStopPct}% 退出复核线`,blocksBuy:true});
  else if(gain>=policy.trailingArmPct&&trail>=policy.trailingDrawdownPct)alerts.push({key:l.id,lotId:l.id,symbol:l.symbol,kind:'trailing-exit-review',message:`浮盈曾达到 ${policy.trailingArmPct}%，现较已记录价格高点回撤 ${trail.toFixed(2)}%`,blocksBuy:true});
 }
 return {alerts,drawdownPct,navCents:v.navCents,peakCents:peak};
}
export function entryIssues(book,order,q){
 if(order.side!=='buy'||book.profile?.entry!=='cn-main-board-limit-up')return [];
 const issues=[];
 if(!/\.(SH|SZ)$/.test(order.symbol)||q?.board!=='CN_MAIN'||q.securityType!=='common-stock'||q.riskWarning!==false||q.listingStage!=='regular'||q.dailyLimitPct!==10)issues.push('激进池第一版仅接受已核验的A股主板普通股10%涨停；ST、新股特殊期和其他板块不进入');
 try{if(q?.priceLimitState!=='limit-up'||decimal(q.limitUpPrice)!==decimal(order.limitPrice)||decimal(q.ask)!==decimal(q.limitUpPrice))issues.push('激进池只在已核验涨停价申报，不能用普通上涨替代涨停');}catch{issues.push('缺少已核验的当日涨停价');}
 if(q?.queueVerified!==true||q.liquidityBasis!=='after-queue')issues.push('缺少排队之后可成交数量的依据，封板或成交量不能代替买入成交');
 return issues;
}
