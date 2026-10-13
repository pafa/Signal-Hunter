import React from 'react';
const time=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'未知';
const amount=(v,c)=>v==null?'未知':new Intl.NumberFormat('zh-CN',{style:'currency',currency:c}).format(v/100);
export default function ActualValuationDetails({position:p,disclosure=()=>({})}){
 const current=p.referenceValuation,record=p.recordValuation;
 if(!current||!record)return null;
 return <section aria-label="参考估值依据">
  <h3>当前参考估值</h3><p>{current.state==='available'?'行情可用于参考估算':'当前无法估值'} · 数量记录于 {time(current.quantityAsOf)}。</p>
  <p className="m-note">{current.basis}</p>
  {current.state==='unavailable'&&<p className="m-warning">{current.issues.join('；')}</p>}
  {current.provenance&&<details {...disclosure('actual-valuation-source')}><summary>展开行情来源与时点</summary><p>{current.provenance.source} · {current.provenance.priceBasis} · {p.currency}</p><p>报价 {time(current.priceAt)} · 接收 {time(current.provenance.receivedAt)} · 有效至 {time(current.provenance.validUntil)}</p><p>发行人标识 {current.provenance.issuerId}；仅与已录证券代码匹配，原持仓未提供发行人核对记录。</p><p style={{overflowWrap:'anywhere'}}>输入包 {current.provenance.frameHash}<br/>报价指纹 {current.provenance.quoteHash}</p></details>}
  {p.accountingOrigin==='actual-ledger'?<p>账本重算成本 {amount(p.costCents,p.currency)} · 记录版本 {p.recordVersion}。逐笔事实、费用和修订可在“组合 → 确认成交记录 → 逐笔账本”核对。</p>:<details {...disclosure('actual-record-value')}><summary>查看原记录价格与盈亏 · v{p.recordVersion}</summary><p>记录于 {time(p.recordedAsOf)} · {record.priceSource}</p><p>原记录价 {record.price??'未知'} {p.currency} · 记录市值 {amount(record.valueCents,p.currency)} · 记录浮盈亏 {amount(record.unrealizedCents,p.currency)}</p><p className="m-note">这是本人提供的原始快照，当前行情更新不会改写；{record.feeBasis==='included'?'记录成本已含费用':record.feeBasis==='excluded'?'记录成本未含费用':'成本是否含费用未知'}。</p></details>}
 </section>;
}
