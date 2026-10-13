import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
// Pure projection. A new candidate is a new final decision, never a renewed
// approval. Its identity excludes price ticks, read time and current quantity.
export function planRenewal({baseId,familyId=baseId,decisions=[],orders=[],quote,at,trigger,belongs=d=>d.candidateId===baseId||d.basis?.familyId===familyId}){
 const previous=decisions.findLast(belongs)||null,order=previous&&orders.find(o=>o.id===previous.orderId);
 const result={id:previous?.candidateId||baseId,familyId,previousDecision:previous,previousOrderStatus:order?.status||null,continuation:null};
 if(!previous||previous.action!=='approve'||!order||!['expired','invalidated'].includes(order.status))return result;
 const endedAt=order.status==='expired'?order.expiresAt:order.endedAt;
 if(!instant(endedAt)||Date.parse(endedAt)>Date.parse(at)||!Number.isSafeInteger(order.qty-order.filledQty)||order.qty<=order.filledQty)return result;
 const priorQuote=previous.basis?.quote,priorCheck=(previous.basis?.checks||[]).find(c=>c.id===trigger?.id);
 let cause=null;
 if(instant(quote?.sessionOpen)&&instant(priorQuote?.sessionOpen)&&Date.parse(quote.sessionOpen)>Date.parse(priorQuote.sessionOpen)&&Date.parse(quote.sessionOpen)>=Date.parse(endedAt)&&Date.parse(quote.sessionOpen)<=Date.parse(at))cause={kind:'market-session',sessionOpen:quote.sessionOpen,sessionClose:quote.sessionClose,reason:'原订单已结束，已进入新的核验交易时段'};
 else if(trigger?.current&&trigger.status==='true'&&Number.isSafeInteger(trigger.episode)&&Number.isSafeInteger(priorCheck?.episode)&&trigger.episode>priorCheck.episode&&instant(trigger.lastHitAt)&&Date.parse(trigger.lastHitAt)>Date.parse(endedAt)&&Date.parse(trigger.lastHitAt)<=Date.parse(at))cause={kind:'condition-episode',checkId:trigger.id,episode:trigger.episode,hitAt:trigger.lastHitAt,reason:'原订单已结束，后台记录到条件重新触发'};
 if(!cause)return result;
 const continuation={engine:'market-plan-renewal/1',familyId,previousCandidateId:previous.candidateId,previousOrderId:order.id,previousOrderStatus:order.status,endedAt,trigger:cause,remainingQty:order.qty-order.filledQty,remainingBudgetCents:order.side==='buy'?Math.max(0,order.budgetCents-order.spentCents):null,targetLotIds:order.targetLotIds||null};
 return {...result,id:hash(['market-plan-renewal/1',familyId,previous.candidateId,order.id,cause]),previousDecision:null,continuation};
}
