import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {ObservationResults} from './ObservationRules';
import {actualCheckNames} from '../../shared/actual-monitoring.mjs';

export function ActualObservationInput({input}){
 const r=input.record,m=input.metrics||{};
 return <div style={{overflowWrap:'anywhere'}}>
  <p>{r.account} · {r.symbol} · 持仓记录 v{r.version} · {r.quantity} 股 · 记录时点 {time(r.asOf)}。</p>
  <p>绑定研究 v{r.topicVersion??'未知'} → 检查时 v{input.currentTopicVersion??'未知'} · 检查 {time(input.evaluatedAt)}{input.episode?` · 第 ${input.episode} 次触发`:''}。</p>
  {!input.baselineAvailable&&<p className="m-warning">绑定的历史研究不可用，新增反证不能可靠比较。</p>}
  {m.deadlines?.map((d,i)=><p key={i}>{d.kind==='claim'?'主张':'研究'}复核：{d.value}{m.due?.some(x=>x.kind===d.kind&&x.id===d.id)?' · 已到期':''}</p>)}
  {m.marketTimezone&&<p>{m.marketTimezone} · 当地日期 {m.localDate}。{m.dateBasis}。</p>}
  {input.evidence?.map(e=><p key={e.id}>{e.claim} · {{unverified:'待核实',verified:'已核实'}[e.verification]||e.verification||'核实状态未知'}</p>)}
  {input.definition&&<><p>观察条件「{input.definition.definition.label}」· 配置 v{input.definition.version} · {input.definition.definition.join==='all'?'全部满足':'任一满足'}。</p><ObservationResults results={input.results||[]}/></>}
  <small>价格观察使用独立行情输入；本人填报价格不参与触发，也不被改写为当前账户盈亏。触发提示不执行交易。</small>
 </div>;
}
export default function ActualObservationDetails({input}){
 return <details><summary>查看实际持仓触发依据</summary><ActualObservationInput input={input}/><p className="m-note">此处冻结当时的输入；当前检查结果请查看持仓档案。已读、已处理不解除风险。</p></details>;
}
export function ActualMonitoring({monitoring:m,onObservation}){
 if(!m)return null;
 return <section aria-label="实际持仓后台巡检"><h3>后台巡检 · {m.label}</h3><p>最近检查 {time(m.checkedAt)}{m.current?` · ${m.hitCount} 项命中 · ${m.unknownCount} 项无法判断`:' · 以下为上次检查，不代表当前状态'}。</p>
  {m.gaps.map(g=><p className="m-warning" key={g}>{g}</p>)}
  {m.checks.map(c=><details key={c.id}><summary>{actualCheckNames[c.reviewKind]||c.details?.definition?.definition.label||'观察条件'} · {{hit:'命中',clear:'本次未触发',unknown:'无法判断'}[c.status]}{c.active&&c.status==='unknown'?' · 旧触发未确认解除':''}</summary><p>{c.reason}</p><ActualObservationInput input={c.details}/>{c.lastTodoId&&onObservation&&<Button onClick={()=>onObservation(c.lastTodoId)}>查看最近触发与回执</Button>}</details>)}
  <p className="m-note">{m.policy}</p>
 </section>;
}
