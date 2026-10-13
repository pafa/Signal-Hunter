import React,{useEffect,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
import {ObservationResults} from './ObservationRules';
import {actualCheckNames} from '../../shared/actual-monitoring.mjs';
import {describeResearchCondition} from '../../shared/research-conditions.mjs';

export function ActualObservationInput({input}){
 const r=input.record,m=input.metrics||{};
 return <div style={{overflowWrap:'anywhere'}}>
  <p>{r.account} · {r.symbol} · 持仓记录 v{r.version} · {r.quantity} 股 · 记录时点 {time(r.asOf)}。</p>
  <p>{input.monitoringLink?`原记录关联 ${input.monitoringLink.origins.length} 项研究`:`绑定研究 v${r.topicVersion??'未知'} → 检查时 v${input.currentTopicVersion??'未知'}`} · 检查 {time(input.evaluatedAt)}{input.episode?` · 第 ${input.episode} 次触发`:''}。</p>
  {input.monitoringLink&&<p>检查时当前监控：{input.monitoringLink.current?.kind==='event-cluster'?'事件综合':'单篇研究'} v{input.monitoringLink.current?.version??'待形成'}。{input.monitoringLink.reason}。</p>}
  {(!input.monitoringLink?!input.baselineAvailable:input.monitoringLink.origins.some(o=>!o.baselineAvailable))&&<p className="m-warning">绑定的历史研究不可用，新增反证不能可靠比较。</p>}
  {m.deadlines?.map((d,i)=><p key={i}>{d.kind==='claim'?'主张':'研究'}复核：{d.value}{m.due?.some(x=>x.kind===d.kind&&x.id===d.id)?' · 已到期':''}</p>)}
  {m.marketTimezone&&<p>{m.marketTimezone} · 当地日期 {m.localDate}。{m.dateBasis}。</p>}
  {input.evidence?.map(e=><p key={e.id}>{e.claim} · {{unverified:'待核实',verified:'已核实'}[e.verification]||e.verification||'核实状态未知'}</p>)}
  {input.definition&&<><p>观察条件「{input.definition.definition.label}」· 配置 v{input.definition.version} · {input.definition.definition.join==='all'?'全部满足':'任一满足'}。</p><ObservationResults results={input.results||[]}/></>}
  {m.researchCondition&&<><p>{m.researchCondition.label} · {m.researchCondition.definition?.reason||'条件未定义'}</p>{m.researchCondition.definition?.conditions?.map((c,i)=><p key={i}>{describeResearchCondition(c)}</p>)}<ObservationResults results={m.researchCondition.results}/></>}
  {m.exitAdvice&&<p>{m.exitAdvice.label} · {m.exitAdvice.reason}。冻结的研究条件状态不代表券商可交易状态。</p>}
  <small>价格观察使用独立行情输入；本人填报价格不参与触发，也不被改写为当前账户盈亏。触发提示不执行交易。</small>
 </div>;
}
export default function ActualObservationDetails({input}){
 return <details><summary>查看实际持仓触发依据</summary><ActualObservationInput input={input}/><p className="m-note">此处冻结当时的输入；当前检查结果请查看持仓档案。已读、已处理不解除风险。</p></details>;
}
function ActualCheck({check:c,onObservation,disclosure}){
 const [localOpen,setLocalOpen]=useState(false),[loaded,setLoaded]=useState(null),[attempt,setAttempt]=useState(0);
 const expanded=disclosure.open??localOpen,ref=c.detailRef;
 const key=ref?`${ref.recordId}/${ref.checkId}/${ref.hash}`:null;
 const input=c.details||(loaded?.key===key&&loaded.status==='ready'?loaded.input:null);
 useEffect(()=>{
  if(!expanded||c.details||!key||loaded?.key===key&&loaded.status==='ready')return;
  let current=true;setLoaded({key,status:'loading'});
  request('/api/actual-holdings/'+ref.recordId+'/checks/'+ref.checkId+'/'+ref.hash).then(result=>{
   if(!current)return;
   if(result.recordId!==ref.recordId||result.checkId!==ref.checkId||result.hash!==ref.hash||result.check?.id!==ref.checkId||result.check?.recordId!==ref.recordId||!result.check?.details?.record)throw Error('巡检依据校验失败，请重试');
   setLoaded({key,status:'ready',input:result.check.details});
  }).catch(error=>{if(current)setLoaded({key,status:'error',error:error.message});});
  return ()=>{current=false;};
 },[expanded,key,attempt,!!c.details]);
 const error=loaded?.key===key&&loaded.status==='error'?loaded.error:null;
 return <details {...disclosure} open={expanded} onToggle={e=>{setLocalOpen(e.currentTarget.open);disclosure.onToggle?.(e);}}><summary>{actualCheckNames[c.reviewKind]||c.conditionLabel||c.details?.definition?.definition.label||'观察条件'} · {{hit:'命中',clear:'本次未触发',unknown:'无法判断'}[c.status]}{c.active&&c.status==='unknown'?' · 旧触发未确认解除':''}</summary><p>{c.reason}</p>
  {input?<ActualObservationInput input={input}/>:expanded&&<div aria-live="polite">{error?<><p className="m-warning">{error}</p><Button onClick={()=>setAttempt(n=>n+1)}>重试读取依据</Button></>:<p>{key?'正在读取本次检查依据…':'本次检查依据不可用；请刷新后查看。'}</p>}</div>}
  {c.lastTodoId&&onObservation&&<Button onClick={()=>onObservation(c.lastTodoId)}>查看最近触发与回执</Button>}
 </details>;
}
export function ActualMonitoring({monitoring:m,onObservation,disclosure=()=>({})}){
 if(!m)return null;
 return <section aria-label="实际持仓后台巡检"><h3>后台巡检 · {m.label}</h3><p>最近检查 {time(m.checkedAt)}{m.current?` · ${m.hitCount} 项命中 · ${m.unknownCount} 项无法判断`:' · 以下为上次检查，不代表当前状态'}。</p>
  {m.watch?.mode==='holding'&&<p className="m-note">行情范围：{m.watch.reason}。暂停与实际行情缺口见下方检查。</p>}
  {m.gaps.map(g=><p className="m-warning" key={g}>{g}</p>)}
  {m.checks.map(c=><ActualCheck key={c.id} check={c} onObservation={onObservation} disclosure={disclosure('actual-check:'+c.id)}/>)}
  <p className="m-note">{m.policy}</p>
 </section>;
}
