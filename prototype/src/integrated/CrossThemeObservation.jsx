import React from 'react';
import {time} from '../major/api';
const pool=id=>id==='aggressive'?'激进热点池':id==='steady'?'稳健长期池':id;
const dollars=n=>n==null?'未知':`USD ${(n/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export default function CrossThemeObservation({input}){
 return <details style={{overflowWrap:'anywhere'}}><summary>查看跨主题重叠依据</summary>
 <p>{input.groupKind==='issuer'?'共同发行人':'共同事件簇'} · {input.groupId} · 第 {input.episode} 次触发 · {time(input.evaluatedAt)}</p>
 <p>{input.metrics.topicCount} 个研究 · {input.metrics.accountCount} 个策略池 · {input.metrics.lotCount} 笔持仓 · {input.metrics.buyOrderCount} 笔未完成买单</p>
 <p>持仓加剩余买单的观察估值 {dollars(input.metrics.valueCents)}</p>
 {input.entries.map(e=><section key={e.key}><p>{pool(e.accountId)} · {e.topicTitle} · 研究 v{e.topicVersion??'未知'}</p><p>{e.symbol} · {e.kind==='lot'?'持仓数量':'已批买单剩余数量'} {e.qty} · {dollars(e.valueCents)} · 账本 v{e.bookVersion}</p>{e.valuationIssues.map((r,i)=><p key={i}>{r}</p>)}</section>)}
 {input.bases.map(([id,b])=><p key={id}>{input.topics.find(t=>t.id===id)?.title||id} · {input.groupKind==='issuer'?`发行人 ${b.issuerId}`:`${b.title} · 事件簇 v${b.version} · ${b.health?.reason||'依据未知'}`}</p>)}
 <small>{input.scope} 冻结首次命中资料；处理回执不解除风险，不调整仓位或执行交易。</small></details>;
}
