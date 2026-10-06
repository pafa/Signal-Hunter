import {marketTime,isMarketInstant,compareMarketTime} from './market-time.mjs';
import {instrument} from '../shared/securities.mjs';
import {marketConfigFields,marketErrors} from '../shared/market-simulation.mjs';
export const marketFail=i=>{throw new Error(marketErrors[i]);};
import {amount,cents,decimal,fee,sum} from './market-money.mjs';
export {amount,cents,decimal,fee,sum} from './market-money.mjs';
import {executionFees} from './market-fees.mjs';
export function validateConfig(data){
 if(!data||Object.keys(data).sort().join(',')!==Object.keys({...marketConfigFields,allowOvernight:0}).sort().join(','))marketFail(3);
 for(const k of Object.keys(marketConfigFields)){const n=data[k];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>(k.endsWith('Pct')?100:k.endsWith('Bps')?1000:k==='maxHoldDays'?365:k==='maxOrderMinutes'?10080:3600))marketFail(3);decimal(n);if(!k.endsWith('Pct')&&!k.endsWith('Bps')&&(!Number.isSafeInteger(n)||n<1))marketFail(3);}
 if(data.issuerCapPct<=0||data.themeCapPct<=0||typeof data.allowOvernight!=='boolean')marketFail(3);
 return structuredClone(data);
}
function instant(s){
 if(typeof s!=='string')return false;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
 if(!m||!Number.isFinite(Date.parse(s)))return false;
 const [,year,month,day,hour,minute,second]=m,days=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
 return Number(month)>=1&&Number(month)<=12&&Number(day)>=1&&Number(day)<=days&&Number(hour)<24&&Number(minute)<60&&Number(second)<60&&(!m[9]||Number(m[9])<=23&&Number(m[10])<60);
}
export const isInstant=instant;
export function quoteIssues(symbol,q,config,at,{execution=false,allowLimitUp=false}={}){
 const issues=[],now=marketTime(at),spec=instrument(symbol),bad=reason=>issues.push(`${symbol}：${reason}`);
 if(!q){bad('缺少可核验市场输入');return issues;}
 if(q.symbol!==symbol||q.currency!==spec.currency||q.kind!=='market-simulation-input'||q.verified!==true||!q.source||!q.rulesVersion||!q.id||!q.issuerId)bad('证券身份、来源或规则未核验');
 if(now===null)bad('检查时间无效');
 for(const k of ['asOf','receivedAt','validUntil'])if(!isMarketInstant(q[k]))bad('行情时间缺失');
 if(compareMarketTime(q.asOf,q.receivedAt)>0||compareMarketTime(q.receivedAt,at)>0||(now!==null&&marketTime(q.asOf)!==null&&now-marketTime(q.asOf)>BigInt(config.quoteMaxAgeSeconds)*1000000000n)||compareMarketTime(at,q.validUntil)>0)bad('行情过期或含未来数据');
 try{if(decimal(q.bid)<=0n||decimal(q.ask)<decimal(q.bid)||decimal(q.mark)<=0n)bad('报价无效');}catch{bad('报价精度无效');}
 const f=q.fx;
 if(f?.executable===false||f?.kind==='reference-fx')bad('参考汇率不能作为成交或账本FX');
 if(!f?.id||!f.source||!isMarketInstant(f.asOf)||!isMarketInstant(f.receivedAt)||!isMarketInstant(f.validUntil)||compareMarketTime(f.asOf,f.receivedAt)>0||compareMarketTime(f.receivedAt,at)>0||compareMarketTime(f.validUntil,at)<0)bad('FX缺失、过期或含未来数据');
 try{if(decimal(f?.usdPerUnit)<=0n||spec.currency==='USD'&&decimal(f.usdPerUnit)!==1000000n)bad('FX币种口径无效');}catch{bad('FX精度无效');}
 if(q.executionFeed===true){try{executionFees(q,{qty:1,price:q.ask,side:'buy',at,feeBps:config.feeBps});}catch{bad('费用方案未核验或不在生效窗口');}}
 if(execution){
  if(q.tradable!==true||q.halted!==false||(q.priceLimitState!=='normal'&&!(allowLimitUp&&q.priceLimitState==='limit-up')))bad('休市、停牌、涨跌停或交易状态未知');
  if(!isMarketInstant(q.sessionOpen)||!isMarketInstant(q.sessionClose)||compareMarketTime(at,q.sessionOpen)<0||compareMarketTime(at,q.sessionClose)>=0)bad('不在已核验交易时段');
  if(!isMarketInstant(q.sellableAt)||!isMarketInstant(q.settlesAt)||compareMarketTime(q.sellableAt,q.asOf)<0||compareMarketTime(q.settlesAt,q.asOf)<0)bad('可卖时间或结算时间未核验');
  for(const k of ['buyLot','sellLot','minBuyQty','availableBuy','availableSell'])if(!Number.isSafeInteger(q[k])||q[k]<(k.startsWith('available')?0:1))bad('数量单位或可用流动性未核验');
  try{if(decimal(q.tickSize)<=0n)bad('最小报价单位无效');}catch{bad('最小报价单位无效');}
 }
 return [...new Set(issues)];
}
export const working=o=>['approved','partial'].includes(o.status);
// A quote may change price, but cannot silently replace the issuer frozen by a fill or approval.
export function issuerIssues(symbol,issuerId,q){
 return typeof issuerId!=='string'||!issuerId.trim()||q?.issuerId!==issuerId?[`${symbol}：行情发行人与原持仓或批准依据不一致或缺失`]:[];
}
export function lotQuoteIssues(lot,q,config,at){return [...quoteIssues(lot.symbol,q,config,at),...issuerIssues(lot.symbol,lot.issuerId,q)];}
const approvalIssuerIssues=(order,q)=>{
 if(!working(order))return [];const original=order.approval?.evidence?.quotes?.[order.symbol];
 const changed=original?.executionFeed||q?.executionFeed?original?.executionFeed!==q?.executionFeed||original?.source!==q?.source||original?.rulesVersion!==q?.rulesVersion||original?.authorization?.configurationHash!==q?.authorization?.configurationHash:false;
 return [...issuerIssues(order.symbol,original?.issuerId,q),...(changed?[`${order.symbol}：执行来源权限或规则版本与原批准依据不同，需重新申请`]:[]),...(JSON.stringify(original?.fees??null)!==JSON.stringify(q?.fees??null)?[`${order.symbol}：费用方案与原批准依据不同，需重新申请`]:[])];
};
export function valuation(book,quotes,at){
 const missing=[],positions=book.lots.map(l=>{
  const q=quotes[l.symbol],issues=lotQuoteIssues(l,q,book.config,at);missing.push(...issues);
  let value=null;try{if(!issues.length)value=amount(l.qty,q.mark,q.fx.usdPerUnit);}catch{missing.push(`${l.symbol}：估值金额无效`);}
  return {...l,valueCents:value,unrealizedCents:value===null?null:value-l.costCents,overdue:Date.parse(l.holdUntil)<=Date.parse(at)};
 });
 const pendingCash=sum(book.unsettled.map(s=>s.amountCents)),nav=missing.length?null:sum([book.cashCents,pendingCash,...positions.map(p=>p.valueCents)]);
 const reserved=sum(book.orders.filter(o=>working(o)&&o.side==='buy').map(o=>o.budgetCents-o.spentCents));
 return {positions,settledCashCents:book.cashCents,unsettledCashCents:pendingCash,reservedCents:reserved,availableCashCents:book.cashCents-reserved,navCents:nav,pnlCents:nav===null?null:nav-book.initialCents,realizedCents:book.realizedCents,feesCents:book.feesCents,missing:[...new Set(missing)]};
}
export function assessOrder(book,order,quotes,at){
 const reasons=[],q=quotes[order.symbol],v=valuation(book,quotes,at);
 reasons.push(...quoteIssues(order.symbol,q,book.config,at,{execution:true,allowLimitUp:order.side==='buy'&&book.profile?.entry==='cn-main-board-limit-up'}));
 reasons.push(...approvalIssuerIssues(order,q));
 if(order.side==='sell')for(const lot of book.lots.filter(l=>l.symbol===order.symbol&&l.topicId===order.topicId))reasons.push(...issuerIssues(lot.symbol,lot.issuerId,q));
 if(Date.parse(order.expiresAt)<=Date.parse(at))reasons.push('订单已过期');
 if(order.side==='buy'&&Date.parse(order.holdUntil)<=Date.parse(at))reasons.push('持有期限已到');
 if(reasons.length)return {eligible:false,reasons:[...new Set(reasons)],valuation:v};
 const outstanding=book.orders.filter(o=>working(o)&&o.id!==order.id),qty=order.qty-order.filledQty;
 if(decimal(order.limitPrice)%decimal(q.tickSize)!==0n)reasons.push('限价不符合已核验报价单位');
 if(order.side==='sell'){
  const lots=book.lots.filter(l=>l.symbol===order.symbol&&l.topicId===order.topicId&&compareMarketTime(l.sellableAt,at)<=0);
  const reserved=outstanding.filter(o=>o.side==='sell'&&o.symbol===order.symbol&&o.topicId===order.topicId).reduce((n,o)=>n+o.qty-o.filledQty,0);
  const available=lots.reduce((n,l)=>n+l.qty,0)-reserved;
  if(qty>available)reasons.push('超过扣除已批卖单后的可卖数量');
  if(qty%q.sellLot!==0)reasons.push('卖出数量不符合已核验单位，碎股交易另行核验');
 }else{
  if(order.qty<q.minBuyQty||qty%q.buyLot!==0)reasons.push('买入数量不符合已核验申报单位');
  if(!book.config.allowOvernight&&compareMarketTime(order.holdUntil,q.sessionClose)>0)reasons.push('持有期限超过当前交易时段');
  if(Date.parse(order.holdUntil)-Date.parse(at)>book.config.maxHoldDays*86400000)reasons.push('超过最长持有期限');
  const buys=[...outstanding.filter(o=>o.side==='buy'),order],projected=[...v.positions],costs=[];
  reasons.push(...v.missing);
  for(const o of buys){
   const bq=quotes[o.symbol],issues=[...quoteIssues(o.symbol,bq,book.config,at),...approvalIssuerIssues(o,bq)];if(issues.length){reasons.push(...issues);continue;}
   const remaining=o.qty-o.filledQty,gross=amount(remaining,o.limitPrice,bq.fx.usdPerUnit);let charge;try{charge=executionFees(bq,{qty:remaining,price:o.limitPrice,side:'buy',at,feeBps:book.config.feeBps,accrual:o.feeAccrual}).totalCents;}catch{reasons.push(`${o.symbol}：费用方案未核验、过期或发生变化`);continue;}const cost=gross+charge;
   if(cost>o.budgetCents-o.spentCents)reasons.push(`${o.symbol}：限价与费用超过剩余USD预算`);
   costs.push(cost);projected.push({symbol:o.symbol,topicId:o.topicId,valueCents:amount(remaining,bq.mark,bq.fx.usdPerUnit)});
  }
  if(!reasons.length){
   const used=sum(costs),remainingCash=book.cashCents-used;
   const futureNav=sum([remainingCash,v.unsettledCashCents,...projected.map(p=>p.valueCents)]);
   if(remainingCash<0||book.cashCents-sum(buys.map(o=>o.budgetCents-o.spentCents))<0)reasons.push('可用现金不足以覆盖订单预算');
   if(futureNav<=0)reasons.push('预计净值无效');
   else{
    if(remainingCash/futureNav*100<book.config.cashFloorPct)reasons.push('低于现金底线');
    const issuerValue=sum(projected.filter(p=>quotes[p.symbol]?.issuerId===q.issuerId).map(p=>p.valueCents)),themeValue=sum(projected.filter(p=>p.topicId===order.topicId).map(p=>p.valueCents));
    if(issuerValue/futureNav*100>book.config.issuerCapPct)reasons.push('超过跨市场合并发行人上限');
    if(themeValue/futureNav*100>book.config.themeCapPct)reasons.push('超过主题仓位上限');
   }
  }
 }
 return {eligible:!reasons.length,reasons:[...new Set(reasons)],valuation:v};
}
