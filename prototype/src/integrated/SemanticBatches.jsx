import React,{useEffect,useState} from 'react';
import EventClusters from './EventClusters';
import {Button} from '../major/Primitives';
import NewsLibrary from '../major/NewsLibrary';
import SemanticEventLibrary from './SemanticEventLibrary';
import SemanticMaterialLibrary from './SemanticMaterialLibrary';
import {request,time} from '../major/api';
import {batchStates,batchItemStates} from '../../shared/semantic-batch-labels.mjs';
import {semanticKinds,semanticScopeLabels} from '../../shared/semantic-labels.mjs';
const auditLabels={create:'建立批次',start:'发起调用',pause:'暂停',resume:'继续',cancel:'取消未开始项目',retry:'明确重试',invalidated:'输入失效'};
const ref=r=>({id:r.id,revision:r.revision,...(r.kind?{kind:r.kind}:{})});
export function BatchDetail({batch,busy,onControl,onResult}){
 return <section aria-label="比较批次详情"><h3>{batchStates[batch.state]} · {time(batch.createdAt)}</h3><p>{batch.inputCount} 份输入 · 全部 {batch.pairCount} 个不同配对 · 模型 {batch.model}</p><p>左、右顺序按加入输入的顺序固定。未命中、失败、中断与取消同样保留；结果不会自动采纳或合并研究。</p>
 <div className="event-actions"><Button disabled={busy||batch.state==='cancelled'} onClick={()=>onControl(batch.state==='paused'?'resume':'pause')}>{batch.state==='paused'?'继续此批次':'暂停后续调用'}</Button><Button disabled={busy||batch.state==='cancelled'||!batch.counts.queued} onClick={()=>onControl('cancel')}>取消未开始项目</Button></div>
 <p className="m-note">暂停或取消未开始项目不会中止已经开始的模型调用。可打开该项结果，单独取消当前调用。</p>
 {batch.items.map(item=><article className="source-item" key={item.ordinal}><strong>{item.ordinal+1}. {batch.inputs[item.left].title} ↔ {batch.inputs[item.right].title}</strong><p>{batchItemStates[item.status]}{item.relation?` · ${semanticKinds[item.relation]}`:''}{item.stale?' · 输入已变化':''} · 已发起 {item.attempts.length} 次</p>{item.failure&&<p className="m-warning">{item.failure}</p>}
 {item.runId&&<Button disabled={busy} onClick={()=>onResult(item.runId)}>查看第 {item.ordinal+1} 项结果</Button>}{['failed','interrupted','cancelled'].includes(item.status)&&batch.state!=='cancelled'&&<Button disabled={busy} onClick={()=>onControl('retry',item.ordinal)}>重试第 {item.ordinal+1} 项（再调用一次）</Button>}{item.attempts.length>1&&<details><summary>历次调用（{item.attempts.length}）</summary>{item.attempts.map((id,i)=><Button key={id} disabled={busy} onClick={()=>onResult(id)}>第 {i+1} 次调用</Button>)}</details>}</article>)}
 <details><summary>计划指纹与操作记录</summary><p>{batch.planHash}</p>{batch.audit.map((a,i)=><p key={i}>{time(a.at)} · {auditLabels[a.action]||a.action}{Number.isInteger(a.payload.ordinal)?` · 第 ${a.payload.ordinal+1} 项`:''}</p>)}</details>
 </section>;
}
export default function SemanticBatches({onBack,onResult}){
 const [clusters,setClusters]=useState(null);
 const [inputs,setInputs]=useState([]),[picker,setPicker]=useState(''),[plan,setPlan]=useState(null),[requestId,setRequestId]=useState(''),[data,setData]=useState(null),[selected,setSelected]=useState(''),[batch,setBatch]=useState(null),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true,timer;Promise.all([request('/api/semantic-batches'),selected?request(`/api/semantic-batches/${selected}`):Promise.resolve(null)]).then(([d,b])=>{if(!live)return;setData(d);setBatch(b);setSelected(id=>id||d.batches[0]?.id||'');}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)timer=setTimeout(()=>setRefresh(n=>n+1),3000);});return()=>{live=false;clearTimeout(timer);};},[selected,refresh]);
 const add=r=>{if(busy)return;if(!inputs.some(x=>x.id===r.id&&(x.kind||'news')===(r.kind||'news'))&&inputs.length<10){setInputs(v=>[...v,r]);setPlan(null);}setPicker('');};
 const act=async(fn)=>{if(busy)return;setBusy(true);setPicker('');setError('');try{await fn();setRefresh(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const detail=batch?.id===selected?batch:null;
 if(clusters)return <EventClusters batchId={clusters} onBack={()=>setClusters(null)} onResult={onResult}/>;
 return <section className="semantic-events" aria-label="持久比较批次"><Button disabled={busy} onClick={onBack}>返回单次比较</Button><h3>预览全部配对，再逐项比较</h3><p>选择2至10份新闻、已保存材料或事项研究。不按关键词预筛选，比较所选范围内每一对；10份输入最多45次本机Codex调用。持续扫描新新闻尚未启用。</p>{error&&<p role="alert" className="m-warning">{error}</p>}
 <div className="event-actions"><Button disabled={busy||inputs.length>=10} onClick={()=>setPicker('news')}>加入新闻</Button><Button disabled={busy||inputs.length>=10} onClick={()=>setPicker('material')}>加入已保存材料</Button><Button disabled={busy||inputs.length>=10} onClick={()=>setPicker('event')}>加入事项研究</Button></div>
 <ol>{inputs.map((r,i)=><li key={`${r.kind}:${r.id}`}>{r.title} · {semanticScopeLabels[r.contentScope]||'仅标题'} · v{r.revision} <Button disabled={busy} onClick={()=>{setInputs(v=>v.filter((_,n)=>n!==i));setPlan(null);}}>移除第 {i+1} 份</Button></li>)}</ol>
 {picker&&<div className="semantic-picker"><Button onClick={()=>setPicker('')}>收起输入列表</Button>{picker==='news'?<NewsLibrary onOpen={add}/>:picker==='event'?<SemanticEventLibrary onSelect={add}/>:<SemanticMaterialLibrary onSelect={add}/>}</div>}
 <Button disabled={busy||inputs.length<2||!data?.enabled} onClick={()=>act(async()=>{const p=await request('/api/semantic-batches/preview','POST',{inputs:inputs.map(ref)});setPlan(p);setRequestId(crypto.randomUUID());})}>预览比较计划</Button>
 {plan&&<div className="source-item"><strong>本计划：{plan.inputs.length} 份输入，共 {plan.maximumCalls} 次初始模型调用</strong><p>模型 {plan.model}。输入、顺序、提示词和模型配置被冻结；变化后对应项停止调用，需重新建立批次。失败不自动重试，手动重试另增加一次调用。</p><details><summary>查看全部 {plan.pairs.length} 对</summary>{plan.pairs.map((p,i)=><p key={i}>{i+1}. {plan.inputs[p.left].title} ↔ {plan.inputs[p.right].title}</p>)}</details><Button primary disabled={busy||!data?.enabled} onClick={()=>act(async()=>{const b=await request('/api/semantic-batches','POST',{inputs:inputs.map(ref),planHash:plan.planHash,requestId});setSelected(b.id);setBatch(b);setPlan(null);setInputs([]);})}>确认建立 {plan.maximumCalls} 次调用的批次</Button></div>}
 {data&&!data.enabled&&<p className="m-warning">当前未启用本机 Codex，无法建立调用批次。</p>}
 <p className="m-note">批次调度：{!data?'正在读取':data?.task?.paused?'已暂停':data?.task?.blocked?'运行异常，等待检查':'已启用'}。恢复调度会继续所有未暂停的批次；当前调用与单次比较、五章研判共用模型名额。</p><Button disabled={busy||!data?.enabled} onClick={()=>act(()=>request('/api/operations/semantic','POST',{action:data?.task?.paused?'resume':'pause'}))}>{data?.task?.paused?'恢复批次调度':'暂停批次调度'}</Button>{data?.task?.blocked&&<Button disabled={busy} onClick={()=>act(()=>request('/api/operations/semantic','POST',{action:'retry'}))}>检查并重试调度</Button>}
 <h3>已保存批次</h3><div className="source-news-list">{data?.batches.map(b=><button key={b.id} aria-pressed={selected===b.id} disabled={busy} onClick={()=>setSelected(b.id)}>{time(b.createdAt)} · {batchStates[b.state]} · {b.pairCount} 对</button>)}</div>{detail&&<BatchDetail batch={detail} busy={busy} onResult={onResult} onControl={(action,ordinal)=>act(async()=>{const b=await request(`/api/semantic-batches/${detail.id}/control`,'POST',{action,...(ordinal===undefined?{}:{ordinal})});setBatch(b);})}/>}
 {detail&&<Button disabled={busy} onClick={()=>setClusters(detail.id)}>核对事件簇</Button>}
 <small>显示最近50个批次；更早批次和全部调用仍保存在数据库中。</small>
 </section>;
}
