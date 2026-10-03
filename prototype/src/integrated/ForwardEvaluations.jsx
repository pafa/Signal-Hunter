import ForwardReview from './ForwardReview';
import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
const statuses={running:'调用中',candidate:'待核对候选',adopted:'已采纳',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export default function ForwardEvaluations(){
 const [catalog,setCatalog]=useState(null),[detail,setDetail]=useState(null),[title,setTitle]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(null),alive=useRef(true),lock=useRef(false);
 useEffect(()=>{alive.current=true;refresh();return()=>{alive.current=false;};},[]);
 async function perform(action){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
 async function refresh(){await perform(async()=>{const result=await request('/api/forward-evaluations');if(alive.current)setCatalog(result);});}
 async function freeze(e){e.preventDefault();if(!confirm||!title.trim())return;await perform(async()=>{
  if(pending.current?.title!==title.trim())pending.current={requestId:crypto.randomUUID(),title:title.trim()};
  await request('/api/forward-evaluations','POST',pending.current);
  const result=await request('/api/forward-evaluations');if(alive.current){setCatalog(result);setConfirm(false);setTitle('');pending.current=null;}
 });}
 async function pause(){await perform(async()=>{await request('/api/forward-evaluations/pause','POST',{baselineId:catalog.activeBaselineId});const result=await request('/api/forward-evaluations');if(alive.current)setCatalog(result);});}
 async function inspect(runId){await perform(async()=>{const result=await request(`/api/forward-evaluations/records/${runId}`);if(alive.current)setDetail(result);});}
 const current=catalog?.baselines.find(b=>b.id===catalog.activeBaselineId);
 return <section aria-label="前向调用档案">
  <h3>前向调用档案</h3><p>先冻结基线，之后的五章研判在调用前保存输入、研究版本和完整事件簇。失败与排除项也保留。冻结不会启动模型调用。</p>
  <p className="m-warning">输入准入通过仍需独立标签和结局核验；这里不计算准确率或收益，也不把模型比较结果当作真值。</p>
  {error&&<p role="alert" className="m-warning">{error}</p>}
  <Button disabled={busy} onClick={refresh}>刷新前向档案</Button>
  {!catalog?<p role="status">{error?'档案未加载，可重新刷新。':'正在读取档案…'}</p>:<>
   <p role="status">{current?`正在记录 · ${current.title} · 冻结 ${time(current.frozenAt)}`:'尚未启用或已暂停记录；已有档案保留。'}</p>
   {current&&<><p>模型 {current.execution.model} · {current.execution.effort} · {current.execution.promptVersion}</p><Button disabled={busy||!catalog.enabled} onClick={pause}>暂停新调用登记</Button></>}
   {!catalog.enabled&&<p>仅在已配置本机 Codex 的研究实例中启用。</p>}
   <form className="m-form" onSubmit={freeze}><fieldset disabled={busy||!catalog.enabled}><label>前向基线名称<input required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="forward-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>从现在开始登记后续五章研判；已有输入排除，旧基线与记录保留</label><Button type="submit" primary disabled={!confirm||!title.trim()}>冻结新基线并登记后续调用</Button></fieldset></form>
   <details><summary>基线历史 · {catalog.totalBaselines} 版</summary><p>最近 {catalog.baselines.length} 版；更早档案保存在本机数据库。</p>{catalog.baselines.map(b=><article className="evaluation-case" key={b.id}><strong>{b.title}</strong><p>{time(b.frozenAt)} · {b.execution.model} · {b.id===catalog.activeBaselineId?'正在记录':'历史基线'}<br/>基线 ID {b.id}<br/>规则指纹 {b.rulesHash}</p></article>)}</details>
   <p>全部登记 {catalog.totalRecords} 次 · 展示最近 {catalog.records.length} 次。更早记录仍保存在本机数据库。</p>
   <div aria-label="前向调用列表">{catalog.records.map(r=><article className="evaluation-case" key={r.runId}><strong>{r.topicTitle||r.topicId} · v{r.topicVersion}</strong><p>{statuses[r.modelStatus]||r.modelStatus} · {r.integrity.valid?'档案关联校验通过':'档案关联异常'} · {r.inputEligibility.eligible?'输入准入通过，待独立复核':'输入排除'}<br/>{[...r.inputEligibility.reasons,...r.integrity.reasons].join('；')}</p><Button disabled={busy} onClick={()=>inspect(r.runId)}>查看调用 {r.runId.slice(0,8)}</Button></article>)}</div>
  </>}
  {detail&&<article className="evaluation-case" aria-label="冻结调用详情"><h4>冻结调用详情</h4><ForwardReview key={detail.runId} runId={detail.runId}/><p>调用 {detail.runId}<br/>基线 {detail.baselineId}<br/>判断 {time(detail.record.decisionAt)} · 首次获取 {time(detail.record.firstSeen)} · 本版可用 {time(detail.record.availableAt)}<br/>{detail.executionVerified?'实际执行依据校验通过':'实际执行依据尚未通过校验'} · {detail.qualification}</p><p>输入指纹 {detail.record.inputHash}<br/>材料包指纹 {detail.packetHash}<br/>规则指纹 {detail.record.rulesHash}</p><p>{[...detail.inputEligibility.reasons,...detail.integrity.reasons].join('；')}</p>{detail.clusterSnapshots.map(c=><div key={c.id}><strong>{c.title} · 簇 v{c.version}</strong><p>核验 {time(c.updatedAt)} · {c.members.length} 份冻结成员</p><ul>{c.members.map(m=><li key={`${m.kind||'news'}:${m.id}`}>{m.kind||'news'} · {m.id} · 修订 {m.revision}</li>)}</ul></div>)}</article>}
 </section>;
}
