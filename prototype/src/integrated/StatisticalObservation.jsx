import React from 'react';
import {time} from '../major/api';
const minute=c=>c.type==='minute-anomaly'||c.interval==='1m';
const metrics={return:'日涨跌幅',volume:'日成交量'},directions={high:'高于基线',low:'低于基线',both:'双向偏离'};
export const statisticalLabel=c=>`${c.symbol} ${minute(c)?'分钟价格变化':metrics[c.metric]} · 前${c.windowSize}个样本 · ${directions[c.direction]} ${c.zThreshold}倍标准差`;
export function StatisticalControls({condition:c,companies,onChange}){
 const choices=minute(c)?{return:'分钟价格变化'}:metrics;
 return <><label>关联证券<select required value={c.symbol} onChange={e=>onChange({...c,symbol:e.target.value})}><option value="">选择关联证券</option>{companies.map(x=><option key={x.symbol} value={x.symbol}>{x.name} · {x.symbol}</option>)}</select></label>
 <label>统计指标<select value={c.metric} onChange={e=>onChange({...c,metric:e.target.value})}>{Object.entries(choices).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>历史基线样本数<input type="number" required min="5" max="120" step="1" value={c.windowSize} onChange={e=>onChange({...c,windowSize:e.target.value})}/></label>
 <label>标准差倍数<input type="number" required min="1" max="20" step="0.1" value={c.zThreshold} onChange={e=>onChange({...c,zThreshold:e.target.value})}/></label>
 <label>偏离方向<select value={c.direction} onChange={e=>onChange({...c,direction:e.target.value})}>{Object.entries(directions).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <small>{minute(c)?'只比较同一连续交易时段内的分钟价格变化，排除末尾采样并要求后续记录及60秒间隔。缺口、重复、坏数据或时区未知时无法判断；不支持分钟成交量。保存后可检查已有缓存，不代表当时发现或可成交；供应商仍可修订，倍数不是概率或显著性保证。':'只比较已结束日线，最新样本不参与基线。保存后可立即检查当前缓存，不恢复当时可交易性。基线样本需连续有效；缺口、公司行动、零波动或数据口径缺失时无法判断。倍数不是概率或显著性保证；成交量单位和复权仍待核验。'}</small></>;
}
export function StatisticalResult({input}){
 const s=input.statistical,value=n=>Number.isFinite(n)?s.metric==='return'?`${n.toFixed(4)}%`:n.toLocaleString('en-US',{maximumFractionDigits:2}):'未知';
 return <div><p>{input.symbol} · {minute(s)?'分钟价格变化':metrics[s.metric]} · {directions[s.direction]} · 阈值 {s.zThreshold} 倍标准差</p><p>{input.provider||'来源未知'} · {minute(s)?'分钟':'日线'} {input.dataAt||'未知'} · 获取 {time(input.receivedAt)}{input.synthetic?' · 合成演示':' · 研究统计'}</p>
 {s.candidate&&<p>最新样本 {s.candidate.date}：{value(s.candidate.value)}<br/>历史基线 {s.baselineFrom} → {s.baselineTo}，{s.baselineCount} 个样本<br/>均值 {value(s.mean)} · 样本标准差 {Number.isFinite(s.std)?s.std.toFixed(4):'未知'}{s.metric==='return'?' 个百分点':' 个供应商计量单位'}<br/>标准化偏离 {Number.isFinite(s.z)?s.z.toFixed(4)+' 倍标准差':'无法计算'}</p>}
 {s.actions?.map((a,i)=><p key={i}>待核对公司行动：{a.date} · {a.kind}</p>)}
 {s.samples&&<details><summary>查看统计窗口与原始样本</summary><p>最新样本独立比较，前 {s.baselineCount} 个样本计算均值和样本标准差（分母 n−1）。</p>{s.points.map(p=><p key={p.date}>{p.date} · {minute(s)?'采样价':'收盘'} {p.close} {input.currency}{!minute(s)&&<> · 成交量 {p.volume==null?'缺失':p.volume.toLocaleString('en-US')}</>}</p>)}<p>行情指纹 {input.quoteHash} · 算法 {s.engine}</p></details>}
 <small>{s.priceBasis||'价格口径未记录'}；{minute(s)?s.completionBasis||'分钟采样完整性待核验':(s.volumeBasis||'成交量口径未记录')+'。公司行动仅按供应商报告排查'}。统计偏离不证明有新事件、未来涨跌或可成交性。</small></div>;
}
