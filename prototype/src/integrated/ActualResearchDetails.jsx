import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {describeResearchCondition} from '../../shared/research-conditions.mjs';
import {ObservationResults} from './ObservationRules';

export default function ActualResearchDetails({position:p,onResearch,disclosure=()=>({})}){
 const v=p.actualResearch;if(!v)return null;
 return <section aria-label="实际持仓当前研究">
  <h3>原记录关联与当前判断</h3><p>{v.link.reason}。原记录数量、成本及研究版本保持。</p>
  <p><b>{v.judgement}</b> · {v.title} · {v.currentBinding?.kind==='event-cluster'?'事件综合':'单篇研究'} v{v.currentBinding?.version??'待形成'}</p>
  <details {...disclosure('actual-origins')}><summary>原记录关联 · {v.origins.length} 项</summary>{v.origins.map((o,i)=><p key={i}>{o.title} · v{o.version??'未知'} · {o.baselineAvailable?'原版本可核对':'历史不可用'} {o.baselineAvailable&&<Button onClick={()=>onResearch({...p,topicId:o.topicId,openingVersion:o.version,researchBinding:null},true)}>查看原记录关联版本 · v{o.version}</Button>}</p>)}<p className="m-note">逐笔记录有多个来源时，只有全部关联指向同一合格研究才显示统一判断；不拆猜各研究对应的股数。</p></details>
  <h3>退出建议与复核</h3><p><b>{v.exitAdvice.label}</b> · {v.exitAdvice.state==='review'?'研究条件已满足，供本人决定':v.exitAdvice.state==='monitor'?'继续自动监控':'后台等待有效依据或条件'}</p><p>{v.exitAdvice.reason}</p>
  {v.action?.state==='waiting'&&<p className="m-warning">{v.action.reasons.join('；')}</p>}
  <p>{v.reviewPolicy==='research-business-facts/1'?'业务事实复核（每日调度）':v.reviewPolicy?'后台观察复核（每日调度）':'本版复核'} {time(v.reviewAt)} · 持有复核窗口 {time(v.horizonAt)}。</p><p>{v.holdingHorizon||'尚无有依据的持有窗口'}</p>
  {v.valuation&&<p>估值情景 {v.valuation.low}–{v.valuation.high} {v.valuation.currency} / 股 · 基准 {v.valuation.base}。情景终点 {time(v.valuation.horizonAt)}，不是卖出限价或日期。</p>}
  <p className="m-note">这里提供研究建议。实际可卖股数、交易费用和执行价格需以本人账户为准；本页不创建真实或模拟订单。研究条件不等于财务语义已经验证。</p>
  {v.conditions.filter(c=>c.key!=='entryCondition').map(c=><details key={c.key} {...disclosure('actual-condition:'+c.key)}><summary>{c.label} · {{true:'已满足',false:'尚未满足',unknown:'无法判断'}[c.status]}</summary><p>{c.reason} · 检查 {time(c.checkedAt)}</p>{c.definition?.status==='defined'?<><p>{c.definition.reason} · {c.definition.join==='all'?'全部满足':'任一满足'}</p><ul>{c.definition.conditions.map((x,i)=><li key={i}>{describeResearchCondition(x)}</li>)}</ul></>:<p>{c.definition?.reason||'尚未形成可计算条件'}</p>}{!c.current&&c.results.length>0&&<p className="m-warning">以下为上次检查输入，仅供追溯，不代表当前触发状态。</p>}<ObservationResults results={c.results}/>{c.analysis&&<details {...disclosure('actual-analysis:'+c.key)}><summary>查看条件依据与引用</summary><p>{c.analysis.text}</p>{c.analysis.citations?.map((r,i)=><blockquote key={i}>{r.quote}<small>{r.evidenceId}</small></blockquote>)}</details>}</details>)}
 </section>;
}
