import React from 'react';
import {time} from '../major/api';
const dollars=n=>n==null?'未知':`USD ${(n/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function MarketObservationStatus({checks=[]}){
 const accounts=[...new Set(checks.map(c=>c.accountId))];
 return accounts.length>0&&<aside aria-label="双策略持仓巡检状态">{accounts.map(id=>{const rows=checks.filter(c=>c.accountId===id);return <p key={id}>{id==='cross-theme'?'跨主题共同风险':id==='aggressive'?'激进热点池':'稳健长期池'} · {rows.filter(c=>c.status==='hit').length} 项当前命中 · {rows.filter(c=>c.status==='unknown').length} 项无法判断 · 检查 {time(rows.map(c=>c.checkedAt).sort().at(-1))}</p>;})}<small>当前状态与历史待办分开。行情未知不表示风险已解除；完成回执不平仓或恢复买入。</small></aside>;
}
export default function MarketObservationDetails({input}){
 const m=input.metrics;
 return <details style={{overflowWrap:"anywhere"}}><summary>查看策略池巡检依据</summary><p>模拟池 {input.accountId==='aggressive'?'激进热点池':'稳健长期池'} · 账本 v{input.bookVersion} · 配置 v{input.configVersion} · 第 {input.episode} 次触发 · {time(input.evaluatedAt)}</p>
 {m.openingVersion!=null&&<p>开仓研究 v{m.openingVersion} → 当前 v{m.currentVersion??'未知'}</p>}
 {m.holdUntil&&<p>持有复核截止 {time(m.holdUntil)}</p>}
 {m.observedPct!=null&&<p>观察值 {m.observedPct.toFixed(2)}% · 配置阈值 {m.thresholdPct}%</p>}
 {m.drawdownPct!=null&&<p>已记录净值高点回撤 {m.drawdownPct.toFixed(2)}% · 高点 {dollars(m.peakCents)} · 当前 {dollars(m.navCents)}</p>}
 {m.availableCashCents!=null&&<p>可用现金 {dollars(m.availableCashCents)} · 已批预算占用 {dollars(m.reservedCents)} · 净值 {dollars(m.navCents)}</p>}
 {m.entryPrice&&<p>原币成交价 {m.entryPrice} · 已记录价格高点 {m.recordedPeak} · 退出线 {input.profile?.risk.hardStopPct}% · 跟踪回撤线 {input.profile?.risk.trailingDrawdownPct}%</p>}
 {m.missing?.map(s=><p key={s}>{s}</p>)}
 {m.openingBaselineAvailable===false&&<p>开仓证据基线缺失；现有反证均需复核。</p>}
 {input.evidence.map(e=><p key={e.id}>{e.claim} · {e.verification}</p>)}
 {input.lots.map(l=><p key={l.id}>{l.symbol} · 批次 {l.id} · {l.qty} 股 · 持仓成本 {dollars(l.costCents)}</p>)}
 {Object.entries(input.quotes).map(([symbol,q])=><p key={symbol}>{symbol} · {q?`${q.mark} ${q.currency} · ${q.source} · 行情 ${q.asOf} · 获取 ${q.receivedAt}`:'无有效执行输入快照'}</p>)}
 <small>冻结首次命中时的输入；提示只形成复核待办，不执行交易。回撤高点来自已记录观察，不推断观察间隔内的最高价。</small></details>;
}
