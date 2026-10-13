import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {RESEARCH_ACTIONS} from '../../shared/research-action.mjs';
import {valuationResult} from '../../shared/research-financials.mjs';
const usd=n=>n==null?'未知':(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD';
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}};
export default function MarketResearchCandidates({book,selected,busy,storageKey,onDecide,onOrder,onResearch}){
 const [pending,setPending]=useState(()=>read(storageKey)),flight=useRef(false),selectedRef=useRef(null),candidates=book.researchCandidates||[];
 useEffect(()=>{selectedRef.current?.scrollIntoView?.({block:'center'});},[selected]);
 useEffect(()=>{try{if(pending)sessionStorage.setItem(storageKey,JSON.stringify(pending));else sessionStorage.removeItem(storageKey);}catch{}},[pending,storageKey]);
 useEffect(()=>{if(pending&&(book.researchDecisions||[]).some(d=>d.candidateId===pending.id))setPending(null);},[book.version,pending]);
 async function decide(c,action,retry){
  if(flight.current||busy)return;flight.current=true;
  const receipt=retry||{id:c.id,data:{requestId:crypto.randomUUID(),version:book.version,action,fingerprint:c.fingerprint,confirmSimulation:action==='approve',note:action==='approve'?'本人查看自动研究方案后批准此模拟申请':'本人选择暂不执行此版研究方案，继续监控'}};
  setPending(receipt);
  try{const result=await onDecide({id:receipt.id},receipt.data,e=>{if(e.status>=400&&e.status<500)setPending(null);});if(result)setPending(null);}finally{flight.current=false;}
 }
 if(!book.autoPolicy?.enabled&&!pending)return null;
 return <section className="market-exits" aria-label="自动研究方案"><h3>自动研究方案 · 本人最后决定</h3><p className="m-note">事件综合优先；行情、研究条件和账户额度齐备后才可批准。合成或未验证研究不证明投资有效性。</p>
  {pending&&<p role="status">决定正在保存或回执尚未核对。<Button disabled={busy} onClick={()=>decide(null,null,pending)}>核对并重试原决定</Button><small>重试复用同一请求，不会另建一笔申请。</small></p>}
  {!candidates.length&&<p>暂无已保存的买入、减仓或退出判断。后台继续研究，结果会自动出现在原看板。</p>}
  {candidates.map(c=>{const v=valuationResult(c.basis.assessment.financials);return <details key={c.id} ref={selected===`research:${c.id}`?selectedRef:undefined} open={selected===`research:${c.id}`||undefined}><summary>{c.symbol} · {RESEARCH_ACTIONS[c.action]} · {c.previousDecision?c.previousDecision.action==='approve'?'已批准，跟踪执行':'本人暂不执行':c.eligible?'方案就绪':'等待条件'}</summary>
   <p>{c.title} · {c.researchBinding.kind==='event-cluster'?'事件综合':'单篇研究'} v{c.topicVersion}</p><p>{c.basis.assessment.recommendation.reason}</p>
   {c.order&&<><p><b>拟{c.order.side==='buy'?'买入':'卖出'} {c.order.qty} 股 · 限价 {c.order.limitPrice} {c.order.currency}</b><br/>订单有效至 {time(c.order.expiresAt)}{c.order.holdUntil&&` · 持有复核 ${time(c.order.holdUntil)}`}。市场时段来自当前已核验执行报价。</p><p>{c.order.side==='buy'?'含费预算上限':'预计扣费所得'} {usd(c.order.side==='buy'?c.order.budgetCents:c.estimate?.netCents)}{c.order.side==='buy'&&` · 预计支出 ${usd(c.estimate?.netCents)}`} · 预计费用 {usd(c.estimate?.feeCents)}。部分成交、后续 FX 或费用变化可能使成交结果不同。</p></>}
   {c.action==='buy'&&c.basis.targetCents!=null&&<p>同一发行人已有 {usd(c.basis.existingIssuerCents)} · 本次目标额度 {usd(c.basis.targetCents)}。数量按剩余额度和风险限制取整。</p>}
   {c.action!=='buy'&&<p>对应研究持仓 {c.heldQty} 股 · 当前可卖 {c.sellableQty} 股；未纳入本次方案的批次和余量继续跟踪。</p>}
   {c.continuation&&<p className="m-note"><b>重新提出的方案：</b>{c.continuation.trigger.reason}。原订单{c.continuation.previousOrderStatus==='expired'?'已到期':'已失效'}，未完成 {c.continuation.remainingQty} 股；本次重新核对数量、价格与有效期，原批准不沿用。<Button onClick={()=>onOrder(c.continuation.previousOrderId)}>查看上次订单</Button></p>}
   {c.previousDecision?.action==='approve'&&['expired','invalidated','cancelled'].includes(c.previousOrderStatus)&&<p>上次订单{({expired:'已到期',invalidated:'已失效',cancelled:'已撤销'})[c.previousOrderStatus]}，原批准已结束；后台继续监控。</p>}
   {c.reasons.map(r=><p className="m-warning" key={r}>{r}</p>)}
   <details><summary>研判、条件、目标情景与市场依据</summary>
    {v&&<p>估值情景：保守 {v.low} / 基准 {v.base} / 积极 {v.high} {c.basis.assessment.financials.valuation.currency} · {c.basis.assessment.financials.valuation.reason}</p>}
    {Object.entries(c.basis.assessment.analysis||{}).filter(([k])=>['impactMechanism','businessExposure','pricedIn','countercase','invalidation'].includes(k)).map(([k,value])=><p key={k}>{({impactMechanism:'影响逻辑',businessExposure:'业务关联',pricedIn:'价格反映',countercase:'反向依据',invalidation:'失效判断'})[k]}：{value.text}</p>)}
    {c.action!=='buy'&&(c.basis.holdingResearchLinks||[]).filter(l=>l.relation.kind!=='same-research').map(l=><p key={l.lotId}>接续批次 {l.lotId}：建仓研究 v{l.opening.version} → 当前{l.current?.kind==='event-cluster'?'事件综合':'研究'} v{l.current?.version}。{l.reason}；只卖出所列批次，原建仓依据不改写。</p>)}
    {c.basis.checks.map(check=><p key={check.id||check.group}>{({entryCondition:'进入',exitCondition:'退出',invalidation:'失效',nextCheck:'复核'})[check.group]}条件：{check.status==='true'?'已满足':check.status==='false'?'未满足':'无法判断'} · {time(check.checkedAt)}</p>)}
    {(c.basis.assessment.recommendation.citations||[]).map((ref,i)=><blockquote key={i}>{ref.quote}<small>原材料 {ref.evidenceId} · {ref.field}</small></blockquote>)}
    <p>行情来源 {c.basis.quote?.source||'缺失'} · {time(c.basis.quote?.asOf)} · 自动配置 v{c.basis.autoPolicyVersion} / 风险配置 v{c.basis.configVersion}</p><p>研究运行 {c.researchBinding.runId} · 方案指纹 <code>{c.fingerprint}</code></p>
   </details>
   {c.previousDecision&&<p>本人决定 {time(c.previousDecision.at)} · {c.previousDecision.note}；原依据已保存。</p>}
   <div className="market-actions">{onResearch&&<Button disabled={busy||!!pending} onClick={()=>onResearch(c)}>查看完整研究与原文</Button>}<Button primary disabled={busy||!!pending||!book.enabled||!c.eligible||!!c.previousDecision} onClick={()=>decide(c,'approve')}>本人批准此模拟方案</Button><Button disabled={busy||!!pending||!book.enabled||!!c.previousDecision} onClick={()=>decide(c,'reject')}>暂不执行，继续监控</Button>{[...new Set([...c.existingOrderIds,...(c.previousDecision?.orderId?[c.previousDecision.orderId]:[])])].map(id=><Button key={id} disabled={busy||!!pending} onClick={()=>onOrder(id)}>查看已保存申请</Button>)}</div>
  </details>;})}
 </section>;
}
