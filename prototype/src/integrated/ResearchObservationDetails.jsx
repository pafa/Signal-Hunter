import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {ObservationResults} from './ObservationRules';
import {RESEARCH_CONDITION_FIELDS,describeResearchCondition} from '../../shared/research-conditions.mjs';

export function ResearchObservationInput({input}){
 if(!input)return <p>尚无保存的检查记录。</p>;
 return <div style={{overflowWrap:'anywhere'}}><p>{input.subject.kind==='event-cluster'?'事件综合':'单篇研究'} v{input.subject.version} · {input.symbol} · {time(input.evaluatedAt)}{input.episode?` · 第 ${input.episode} 次触发`:''}</p>
  <p>{input.basisReason}</p><p>{input.definition.reason}</p><p>{input.definition.join==='all'?'以下条件需全部满足':'以下条件任一满足'}</p><ul>{input.definition.conditions.map((c,i)=><li key={i}>{describeResearchCondition(c)}</li>)}</ul>
  <ObservationResults results={input.results}/><details><summary>查看本版研判与直接引用</summary><p>{input.analysis.text}</p>{input.analysis.citations.map((c,i)=><blockquote key={i}><p>{c.quote}</p><small>{c.evidenceId} · {c.field==='body'?'正文':'标题'}</small></blockquote>)}</details>
  <p className="m-note">这是研究观察，不是交易批准；{input.synthetic?'使用合成演示输入。':'行情是研究缓存，不是可执行报价。'} 原文含义与模型条件是否充分仍需结合研究判断。</p>
 </div>;
}
export default function ResearchObservationDetails({checks=[],onTopic,onSynthesis,onHistory}){
 const counts={true:0,false:0,unknown:0},groups=new Map();for(const c of checks){counts[c.status]=(counts[c.status]||0)+1;const key=c.subject.kind+':'+c.subject.id+':'+c.subject.runId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 return <section aria-label="自动研究条件"><h3>自动研究条件</h3><p>{checks.length} 项 · 已满足 {counts.true} · 未满足 {counts.false} · 无法判断 {counts.unknown}</p>
  <p className="m-note">研判保存后随后台观察任务检查，无需逐项启用。当前结果与历史触发分开；同一条件持续满足只提醒一次，回执不影响后续检查。</p>
  {!checks.length&&<p>尚无保存的结构化条件；旧研判不从文字自动补造阈值。</p>}
  {[...groups.entries()].sort((a,b)=>Number(b[1][0].subject.kind==='event-cluster')-Number(a[1][0].subject.kind==='event-cluster')).map(([id,items])=><details key={id}><summary>{items[0].subject.title} · {items[0].subject.kind==='event-cluster'?'事件综合':'单篇研究'} v{items[0].subject.version} · 满足 {items.filter(c=>c.status==='true').length} / 无法判断 {items.filter(c=>c.status==='unknown').length}</summary>{items.map(c=><details key={c.id}><summary>{c.symbol} · {RESEARCH_CONDITION_FIELDS[c.group]} · {{true:'已满足',false:'未满足',unknown:'无法判断'}[c.status]}</summary><p>{c.subject.title} · {c.subject.kind==='event-cluster'?'综合':'研究'} v{c.subject.version}</p><p>{c.reason}</p>{!c.current&&<p className="m-warning">以下仅为上次保存的检查，不能作为当前状态。</p>}{c.active&&c.status==='unknown'&&<p className="m-warning">旧触发尚未确认解除。</p>}
   <ResearchObservationInput input={c.details}/><div className="m-form-actions">{c.subject.kind==='research'?<Button onClick={()=>onTopic(c.subject.id)}>查看当前研究</Button>:<Button onClick={()=>onSynthesis(c.subject.id)}>查看事件综合</Button>}{c.lastTodoId&&<Button onClick={()=>onHistory(c.lastTodoId)}>查看最近触发记录</Button>}</div>
  </details>)}</details>)}
 </section>;
}
