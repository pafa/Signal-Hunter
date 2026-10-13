import {planRenewal} from './market-plan-renewal.mjs';
import {createHash} from 'node:crypto';
import {amount,slippagePrice} from './market-money.mjs';
import {compareMarketTime} from './market-time.mjs';
import {executionFees} from './market-fees.mjs';
import {quoteIssues} from './market-sim-risk.mjs';

export const EXIT_CANDIDATE_VERSION='market-exit-candidate/1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const family=(b,ids)=>hash([EXIT_CANDIDATE_VERSION,b.accountId,b.configVersion,b.topicVersion,b.lots.filter(l=>!ids||ids.includes(l.id)).map(l=>l.id).sort(),b.alerts.filter(a=>!ids||ids.includes(a.lotId)).map(a=>[a.lotId,a.kind]).sort(),(b.holdingResearchLinks||[]).filter(l=>l.relation.kind!=='same-research'&&(!ids||ids.includes(l.lotId))).sort((a,b)=>a.lotId.localeCompare(b.lotId))]);
const exitKinds=new Set(['holding-review','loss-exit-review','trailing-exit-review']);

// Pure projection: reading a risk never creates an order, a decision, or a fill.
export function marketExitCandidates({book,accountId,risk,quotes,at,getTopic,preview,holdingLinks=[]}){
 if(!book?.profile)return [];
 const groups=new Map();
 for(const alert of risk.alerts||[]){
  if(!exitKinds.has(alert.kind)||!alert.lotId)continue;
  const lot=book.lots.find(l=>l.id===alert.lotId);if(!lot)continue;
  const link=holdingLinks.find(x=>x.lotId===lot.id),topicId=link?.status==='current'?link.topicId:lot.topicId;
  const key=JSON.stringify([topicId,lot.symbol]);
  if(!groups.has(key))groups.set(key,{topicId,symbol:lot.symbol,lots:[],alerts:[],links:[]});
  const g=groups.get(key);if(!g.lots.some(l=>l.id===lot.id))g.lots.push(lot);if(link&&!g.links.some(x=>x.lotId===link.lotId))g.links.push(link);g.alerts.push(alert);
 }
 return [...groups.values()].map(g=>{
  g.lots.sort((a,b)=>a.id.localeCompare(b.id));g.alerts.sort((a,b)=>a.key.localeCompare(b.key));
  const topic=getTopic(g.topicId,g.links.find(l=>l.status==='current')?.current||g.lots[0].researchBinding),q=quotes[g.symbol],reasons=[];
  const identity=[EXIT_CANDIDATE_VERSION,accountId,book.configVersion,topic?.version??null,g.lots.map(l=>[l.id,l.qty]),g.alerts.map(a=>[a.lotId,a.kind])];
  if(g.links.some(l=>l.relation.kind!=='same-research'))identity.push(g.links);
  const baseId=hash(identity),currentFamily=family({accountId,configVersion:book.configVersion,topicVersion:topic?.version??null,lots:g.lots,alerts:g.alerts,holdingResearchLinks:g.links});
  const prior=(book.exitDecisions||[]).findLast(d=>d.basis&&family(d.basis,g.lots.map(l=>l.id))===currentFamily),familyId=prior?.basis.familyId||(prior?family(prior.basis):currentFamily);
  const renewal=planRenewal({baseId,familyId,decisions:book.exitDecisions,orders:book.orders,quote:q,at,belongs:d=>d===prior||d.candidateId===baseId||d.basis&&(d.basis.familyId||family(d.basis))===familyId}),{id,previousDecision,continuation}=renewal;
  const existingOrders=book.orders.filter(o=>o.side==='sell'&&o.symbol===g.symbol&&(o.topicId===g.topicId||o.targetLotIds?.some(id=>g.lots.some(l=>l.id===id)))&&['pending','approved','partial'].includes(o.status));
  if(existingOrders.length)reasons.push('已有同研究、同证券的未结束卖出申请，请先查看原申请');
  if(!topic||topic.status!=='active'||!topic.companies.some(c=>c.symbol===g.symbol))reasons.push('当前研究不可用、已归档或证券已移除');
  for(const link of g.links)if(link.status==='waiting')reasons.push(link.reason);
  // A current verified monitoring link is shown in the final decision; the
  // opening research is retained and never implicitly re-approved.
  if(g.lots.some(l=>!l.researchBinding&&!g.links.some(link=>link.lotId===l.id&&link.status==='current')&&l.topicVersion!==topic?.version))reasons.push('建仓研究与当前版本不同，原触发保留；须先复核研究后另拟方案');
  reasons.push(...quoteIssues(g.symbol,q,book.config,at,{execution:true}));
  const sellable=g.lots.filter(l=>compareMarketTime(l.sellableAt,at)<=0),heldQty=g.lots.reduce((n,l)=>n+l.qty,0),sellableQty=sellable.reduce((n,l)=>n+l.qty,0);
  let order=null,review=null,estimate=null;
  if(!reasons.length){
   const qty=Math.floor(Math.min(sellableQty,continuation?.remainingQty??Infinity)/q.sellLot)*q.sellLot;
   if(!Number.isSafeInteger(qty)||qty<=0||qty>100000000)reasons.push('触发批次当前没有符合申报单位的可卖数量');
   if(q.availableSell<q.sellLot)reasons.push('当前已核验卖出容量不足一个申报单位');
   const expiresAt=new Date(Math.min(Date.parse(q.asOf)+book.config.maxOrderMinutes*60000,Date.parse(q.sessionClose))).toISOString();
   if(Date.parse(expiresAt)<=Date.parse(at))reasons.push('本次报价对应的订单有效窗口已结束');
   if(!reasons.length){
    const limitPrice=slippagePrice(q.bid,book.config.slippageBps,q.tickSize,'sell');
    order={id,topicId:g.topicId,topicVersion:topic.version,...(topic.researchSubject?{researchBinding:Object.fromEntries(['kind','id','runId','version'].map(k=>[k,topic.researchSubject[k]]))}:{}),configVersion:book.configVersion,symbol:g.symbol,currency:q.currency,side:'sell',qty,limitPrice,expiresAt,holdUntil:null,budgetCents:0,filledQty:0,spentCents:0,status:'pending',targetLotIds:sellable.map(l=>l.id),...(g.links.some(link=>link.status==='current')?{holdingResearchLinks:g.links.filter(link=>sellable.some(l=>l.id===link.lotId))}:{}),
     thesis:'按已配置模拟策略，退出触发批次中当前可卖的整数申报单位；其余持仓继续跟踪',trigger:g.alerts.map(a=>a.message).join('；').slice(0,1200),invalidation:'研究、持仓、配置或审批依据变化时重新核对；批准后仍受新报价、限价、容量与到期约束'};
    try{
     const grossCents=amount(qty,limitPrice,q.fx.usdPerUnit),fees=executionFees(q,{qty,price:limitPrice,side:'sell',at,feeBps:book.config.feeBps});
     if(Number(limitPrice)<=0||grossCents<=fees.totalCents)reasons.push('预计卖出金额不足以覆盖费用，不能形成此退出候选');
     else estimate={grossCents,feeCents:fees.totalCents,netCents:grossCents-fees.totalCents,fees,basis:'按候选限价及当前FX估算；部分成交、后续汇率和费用可能不同'};
     review=preview(order);reasons.push(...review.reasons);
    }catch{reasons.push('候选价格、费用或金额无法可靠计算');}
   }
  }
  const eligible=!!order&&!!review?.eligible&&!reasons.length;
  const basis={engine:EXIT_CANDIDATE_VERSION,familyId,continuation,accountId,bookVersion:book.version,configVersion:book.configVersion,profile:book.profile,lots:g.lots,holdingResearchLinks:g.links,alerts:g.alerts,topicVersion:topic?.version??null,quote:q||null,order,reviewFingerprint:review?.fingerprint||null,eligible,reasons:[...new Set(reasons)]};
  return {id,accountId,topicId:g.topicId,topicVersion:topic?.version??null,symbol:g.symbol,heldQty,sellableQty,remainderQty:heldQty-(order?.qty||0),alerts:g.alerts,eligible,reasons:basis.reasons,order,estimate,review,basis,fingerprint:hash(basis),checkedAt:at,previousDecision,previousOrderStatus:renewal.previousOrderStatus,continuation,existingOrderIds:existingOrders.map(o=>o.id)};
 });
}
