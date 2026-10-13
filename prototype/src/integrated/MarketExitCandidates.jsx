import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
const usd=n=>n==null?'未知':(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD';
export default function MarketExitCandidates({candidates=[],selected,busy,enabled,onDecide,onOrder}){
 if(!candidates.length)return null;
 return <section className="market-exits" aria-label="自动退出候选"><h3>系统已整理的退出候选 · {candidates.length}</h3><p className="m-note">依据本模拟池已有止损、回撤或到期复核规则。仅涉及触发批次，不是目标价预测；选择批准才创建模拟卖单。批准后等待新报价，仍可能未成交。</p>
  {candidates.map(c=><details key={c.id} open={selected===`exit:${c.id}`||undefined}><summary>{c.symbol} · {c.existingOrderIds.length?'已有卖出申请 · 跟踪执行':c.eligible?`可卖 ${c.order.qty} 股`:'继续监控，暂不能形成可批准方案'}{c.previousDecision?.action==='reject'?' · 本人暂不退出':''}</summary>
   {c.alerts.map(a=><p key={a.key} className="m-warning">{a.message}</p>)}
   <p>触发批次共 {c.heldQty} 股 · 到达可卖时间 {c.sellableQty} 股 · 此方案之外 {c.remainderQty} 股继续跟踪。研究 v{c.topicVersion??'未知'}。</p>
   {c.order&&<p><b>拟卖 {c.order.qty} 股，限价 {c.order.limitPrice} {c.order.currency}</b><br/>按当前买价扣除已配置不利滑点并按报价单位向下取整；有效至 {time(c.order.expiresAt)}，最晚本交易时段收盘。后续价格低于限价时等待或到期。</p>}
   {c.estimate&&<p>按限价估算卖出总额 {usd(c.estimate.grossCents)} · 费用 {usd(c.estimate.feeCents)} · 扣费款 {usd(c.estimate.netCents)}。{c.estimate.basis}</p>}
   {c.continuation&&<p className="m-note"><b>重新提出的方案：</b>{c.continuation.trigger.reason}。原订单{c.continuation.previousOrderStatus==='expired'?'已到期':'已失效'}，未完成 {c.continuation.remainingQty} 股；本次重新核对数量、价格与有效期，原批准不沿用。<Button onClick={()=>onOrder(c.continuation.previousOrderId)}>查看上次订单</Button></p>}
   {c.previousDecision?.action==='approve'&&['expired','invalidated','cancelled'].includes(c.previousOrderStatus)&&<p>上次订单{({expired:'已到期',invalidated:'已失效',cancelled:'已撤销'})[c.previousOrderStatus]}，原批准已结束；后台继续监控。</p>}
   {c.reasons.map(r=><p key={r} className="m-warning">{r}</p>)}
   {c.previousDecision&&<p>本人上次选择：{c.previousDecision.action==='reject'?'暂不退出':'批准模拟退出'} · {time(c.previousDecision.at)}。原决定保留；暂不退出不会解除风险。</p>}
   <details><summary>查看触发批次、行情与配置依据</summary>{c.basis.lots.map(l=><p key={l.id}>批次 {l.id} · {l.qty} 股 · 建仓 {time(l.openedAt)} · 原研究 v{l.topicVersion}</p>)}{(c.basis.holdingResearchLinks||[]).filter(l=>l.relation.kind!=='same-research').map(l=><p key={l.lotId}>建仓单篇 v{l.opening.version} → 当前{l.current?.kind==='event-cluster'?'事件综合':'研究'} v{l.current?.version??'待更新'}。{l.reason}；原建仓记录保留。</p>)}<p>行情 {c.basis.quote?.source||'缺失'} · {time(c.basis.quote?.asOf)} · 有效至 {time(c.basis.quote?.validUntil)} · 配置 v{c.basis.configVersion}</p><p>候选指纹 <code>{c.fingerprint}</code>。输入变化需重新查看并决定，页面不会自行批准。</p></details>
   <div className="market-actions"><Button primary disabled={busy||!enabled||!c.eligible} onClick={()=>onDecide(c,'approve')}>本人批准此模拟退出</Button><Button disabled={busy||!enabled||c.previousDecision?.action==='reject'||!!c.existingOrderIds.length} onClick={()=>onDecide(c,'reject')}>暂不退出，继续监控</Button>{c.existingOrderIds.map(id=><Button key={id} disabled={busy} onClick={()=>onOrder(id)}>查看原卖出申请</Button>)}</div>
  </details>)}
 </section>;
}
