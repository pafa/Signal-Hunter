import {planRenewal} from './market-plan-renewal.mjs';
import {holdingResearchLinks} from './holding-research.mjs';
import {createHash} from 'node:crypto';
import {valuationResult} from '../shared/research-financials.mjs';
import {researchActionReadiness} from '../shared/research-action.mjs';
import {amount,decimal,slippagePrice} from './market-money.mjs';
import {quoteIssues,valuation,marketFail} from './market-sim-risk.mjs';
import {executionFees} from './market-fees.mjs';
import {compareMarketTime} from './market-time.mjs';

export const RESEARCH_CANDIDATE_VERSION='market-research-candidate/1';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const active=o=>['pending','approved','partial'].includes(o.status);
export const researchTopicId=s=>s.kind==='event-cluster'?`event-cluster:${s.id}`:s.id;
export const researchBinding=s=>({kind:s.kind,id:s.id,runId:s.runId,version:s.version});
export const sameResearch=(a,b)=>!!a&&!!b&&['kind','id','runId','version'].every(k=>a[k]===b[k]);
export function validateAutoPolicy(p){
 if(!p||Object.keys(p).sort().join(',')!=='enabled,reducePct,targetIssuerPct'||typeof p.enabled!=='boolean')marketFail(3);
 for(const k of ['targetIssuerPct','reducePct'])if(p[k]!==null||p.enabled){if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<=0||p[k]>100||decimal(p[k])%10000n!==0n)marketFail(3);}
 return structuredClone(p);
}
// A composite keeps its own identity. It never borrows one member's research ID.
export function marketResearchTopic(s){
 if(!s)return null;
 return {id:researchTopicId(s),title:s.title,version:s.version,status:s.ready&&s.fresh&&!s.changed?'active':'unavailable',companies:s.current?.companies||[],
  evidence:(s.current?.evidence||[]).map(e=>({...e,id:s.kind==='event-cluster'?`${e.memberTopicId}:${e.originalEvidenceId||e.id}`:e.id})),researchSubject:{...researchBinding(s),preparedAt:s.preparedAt,reason:s.reason,assessments:s.assessments||[]}};
}
export function researchOrderIssues(book,order,context,at){
 const binding=order.researchBinding;if(!binding)return [];
 const s=context.subjects?.find(s=>s.kind===binding.kind&&s.id===binding.id);
 if(!sameResearch(binding,s)||!s.ready||!s.fresh||s.changed)return ['方案对应研究已变化或无法核对，剩余数量不可继续执行'];
 if(!order.researchCandidate)return [];
 if(order.side==='buy'&&binding.kind==='research'&&context.coveredResearchIds?.includes(binding.id))return ['单篇研究已接续事件综合，原买入批准不能继续使用'];
 if(!book.autoPolicy?.enabled||order.autoPolicyVersion!==book.autoPolicyVersion)return ['自动方案配置已变化，须重新形成方案'];
 const a=s.assessments.find(a=>a.symbol===order.symbol),r=a&&researchActionReadiness(a,{subject:s,checks:context.researchChecks||[],at});
 return r?.state==='conditional'&&a.recommendation.action===order.researchCandidate.action?[]:r?.reasons||['此证券的研究行动依据已不可用'];
}

// No writes, reservations or orders on reads. The final decision re-runs this
// exact projection inside the account transaction and compares its fingerprint.
export function marketResearchCandidates({book,accountId,context,quotes,at,preview,riskExits=[]}){
 if(!book?.autoPolicy?.enabled)return [];
 const holdingLinks=holdingResearchLinks(book,context),subjects=context.subjects||[],covered=new Set(context.coveredResearchIds||[]),v=valuation(book,quotes,at);
 const rows=subjects.flatMap(s=>(s.assessments||[]).filter(a=>['buy','reduce','exit'].includes(a.recommendation?.action)).map(a=>({s,a})))
  .sort((x,y)=>Number(y.s.kind==='event-cluster')-Number(x.s.kind==='event-cluster')||(y.s.preparedAt||'').localeCompare(x.s.preparedAt||'')||x.s.id.localeCompare(y.s.id));
 const preferred=new Set();
 return rows.map(({s,a})=>{
  const binding=researchBinding(s),topicId=researchTopicId(s),symbol=a.symbol,action=a.recommendation.action,q=quotes[symbol],reasons=[];
  const checks=(context.researchChecks||[]).filter(c=>c.symbol===symbol&&sameResearch(c.subject,s));
  // Keep the original identity; only a recorded new cause can create a successor.
  // Quote ticks and fills cannot reopen a decline or repeatedly halve a position.
  const baseId=hash([RESEARCH_CANDIDATE_VERSION,accountId,book.autoPolicyVersion,binding,symbol,action]);
  const renewal=planRenewal({baseId,decisions:book.researchDecisions,orders:book.orders,quote:q,at,trigger:checks.find(c=>c.group===(action==='buy'?'entryCondition':'exitCondition'))}),{id,previousDecision,continuation}=renewal;
  const readiness=researchActionReadiness(a,{subject:s,checks,at});
  if(readiness.state!=='conditional')reasons.push(...readiness.reasons);
  if(previousDecision)reasons.push('此版方案已有本人决定，后台继续监控；新研究或可核对的重提条件出现后再形成方案');
  if(s.kind==='research'&&covered.has(s.id))reasons.push('此研究已归入事件综合；等待综合结论，成员研究不重复生成买卖方案');
  reasons.push(...quoteIssues(symbol,q,book.config,at,{execution:true,allowLimitUp:action==='buy'&&book.profile?.entry==='cn-main-board-limit-up'}));
  const existingOrders=book.orders.filter(o=>active(o)&&(o.symbol===symbol||q?.issuerId&&quotes[o.symbol]?.issuerId===q.issuerId));
  if(existingOrders.length)reasons.push('同一证券或发行人已有未结束申请，先跟踪原申请');
  const links=holdingLinks.filter(l=>l.status==='current'&&sameResearch(l.current,binding)),lots=book.lots.filter(l=>l.symbol===symbol&&links.some(link=>link.lotId===l.id)&&(!continuation||continuation.targetLotIds?.includes(l.id))),sellable=lots.filter(l=>compareMarketTime(l.sellableAt,at)<=0);
  const heldQty=lots.reduce((n,l)=>n+l.qty,0),sellableQty=sellable.reduce((n,l)=>n+l.qty,0);
  if(action!=='buy'&&!heldQty)reasons.push('此研究对应的模拟账户没有持仓，不生成卖空方案');
  if(action!=='buy'&&riskExits.some(c=>c.eligible&&c.symbol===symbol&&c.order?.targetLotIds?.some(id=>lots.some(l=>l.id===id))&&!c.previousDecision))reasons.push('同一批次已有策略退出方案，首页优先展示该方案');
  if(action==='buy'&&q?.issuerId){if(preferred.has(q.issuerId))reasons.push('同一发行人优先展示最新的事件综合或研究方案');else if(readiness.state==='conditional'&&!(s.kind==='research'&&covered.has(s.id)))preferred.add(q.issuerId);}
  let order=null,review=null,estimate=null,targetCents=null,existingIssuerCents=null;
  if(!reasons.length){
   const expiresAt=new Date(Math.min(Date.parse(q.asOf)+book.config.maxOrderMinutes*60000,Date.parse(q.sessionClose),Date.parse(a.recommendation.validUntil))).toISOString();
   if(Date.parse(expiresAt)<=Date.parse(at))reasons.push('本次方案的行情或研究有效窗口已结束');
   if(q[action==='buy'?'availableBuy':'availableSell']<q[action==='buy'?'buyLot':'sellLot'])reasons.push('当前已核验成交容量不足一个申报单位');
   const holdUntil=action==='buy'?a.recommendation.holdingHorizon.until:null;
   if(action==='buy'&&Date.parse(holdUntil)<=Date.parse(expiresAt))reasons.push('研究持有复核期限不能早于订单截止；等待新版判断或下一窗口');
   if(action==='buy'&&(v.navCents===null||v.navCents<=0))reasons.push('账户净值不完整或无效，不能计算自动分配');
   if(!reasons.length){
    const side=action==='buy'?'buy':'sell';let limitPrice=null;
    try{limitPrice=side==='buy'&&book.profile?.entry==='cn-main-board-limit-up'?String(q.limitUpPrice):slippagePrice(side==='buy'?q.ask:q.bid,book.config.slippageBps,q.tickSize,side);if(decimal(limitPrice)<=0n)throw Error('Invalid limit');const scenario=valuationResult(a.financials);if(side==='buy'&&(!scenario||decimal(limitPrice)>=decimal(scenario.high)))reasons.push('买入限价已不低于全部估值情景，等待重新研判');}catch{reasons.push('策略限价缺失或无法核验，等待完整执行报价');}
    const base={id,topicId,topicVersion:s.version,researchBinding:binding,autoPolicyVersion:book.autoPolicyVersion,researchCandidate:{engine:RESEARCH_CANDIDATE_VERSION,id,action},configVersion:book.configVersion,symbol,currency:q.currency,side,limitPrice,expiresAt,holdUntil,budgetCents:0,filledQty:0,spentCents:0,status:'pending',
     thesis:a.recommendation.reason,trigger:`已保存研究 v${s.version} 的${side==='buy'?'进入':'退出'}条件满足；本方案仍须本人最后决定`,invalidation:'研究、条件检查、配置或市场输入失效时停止；批准后只使用新报价，未成交部分继续受限价和期限约束'};
    const make=qty=>{
     const grossCents=amount(qty,limitPrice,q.fx.usdPerUnit),fees=executionFees(q,{qty,price:limitPrice,side,at,feeBps:book.config.feeBps}),netCents=side==='buy'?grossCents+fees.totalCents:grossCents-fees.totalCents;
     const o={...base,qty,budgetCents:side==='buy'?Math.min(targetCents-existingIssuerCents,Math.max(0,v.availableCashCents),continuation?.remainingBudgetCents??Infinity):0,...(side==='sell'?{targetLotIds:sellable.map(l=>l.id),holdingResearchLinks:links.filter(link=>sellable.some(l=>l.id===link.lotId))}:{})};
     const r=preview(o);return {order:o,review:r,estimate:{grossCents,feeCents:fees.totalCents,netCents,fees},fits:r.eligible&&netCents>0&&(side==='sell'||netCents<=o.budgetCents&&amount(qty,q.mark,q.fx.usdPerUnit)<=targetCents-existingIssuerCents)};
    };
    try{
     let result;
     if(side==='buy'){
      targetCents=Number(BigInt(v.navCents)*decimal(book.autoPolicy.targetIssuerPct)/100000000n);
      existingIssuerCents=v.positions.filter(p=>p.issuerId===q.issuerId).reduce((n,p)=>n+p.valueCents,0);
      const min=Math.ceil(q.minBuyQty/q.buyLot),max=Math.floor(Math.min(100000000,continuation?.remainingQty??Infinity)/q.buyLot),first=min<=max?make(min*q.buyLot):null;
      if(!first?.fits)reasons.push(...(first?.review.reasons||[]),'当前配置、现金或发行人分配额度不足以形成最小买入单位');
      else{let lo=min,hi=max;result=first;while(lo<hi){const mid=Math.ceil((lo+hi)/2);let probe;try{probe=make(mid*q.buyLot);}catch{hi=mid-1;continue;}if(probe.fits){lo=mid;result=probe;}else hi=mid-1;}}
     }else{
      const intended=continuation?continuation.remainingQty:action==='exit'?heldQty:Number(BigInt(heldQty)*decimal(book.autoPolicy.reducePct)/100000000n),qty=Math.floor(Math.min(intended,sellableQty)/q.sellLot)*q.sellLot;
      if(qty<=0||qty>100000000)reasons.push('对应持仓尚无符合本次减仓比例和可卖规则的数量');else result=make(qty);
     }
     if(result){({order,review,estimate}=result);reasons.push(...review.reasons);if(estimate.netCents<=0)reasons.push('预计卖出金额不足以覆盖费用');}
    }catch{reasons.push('方案的价格、费用、额度或数量无法可靠计算');}
   }
  }
  const eligible=!!order&&!!review?.eligible&&!reasons.length;
  const basis={engine:RESEARCH_CANDIDATE_VERSION,familyId:renewal.familyId,continuation,accountId,bookVersion:book.version,configVersion:book.configVersion,autoPolicyVersion:book.autoPolicyVersion,policy:book.autoPolicy,binding,assessment:a,checks,quote:q||null,lots,holdingResearchLinks:links,navCents:v.navCents,targetCents,existingIssuerCents,order,reviewFingerprint:review?.fingerprint||null,eligible,reasons:[...new Set(reasons)]};
  return {id,accountId,topicId,topicVersion:s.version,researchBinding:binding,title:s.title,symbol,action,readiness,heldQty,sellableQty,order,estimate,eligible,reasons:basis.reasons,basis,fingerprint:hash(basis),checkedAt:at,previousDecision,previousOrderStatus:renewal.previousOrderStatus,continuation,existingOrderIds:existingOrders.map(o=>o.id)};
 });
}
