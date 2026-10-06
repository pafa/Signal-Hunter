import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time,verificationNames} from './api';
import {claimsOf,OUTCOMES,CLAIM_KINDS} from '../../shared/claims.mjs';
import {AssessmentSummary} from './Uncertainty';

function HistoryVersion({topicId,row,initialOpen}){
 const [open,setOpen]=useState(initialOpen),[requested,setRequested]=useState(initialOpen),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!requested)return;let active=true;setError('');
  request(`/api/research/${topicId}/history/${row.version}`).then(r=>{if(r.version!==row.version||r.topic.id!==topicId||r.topic.version!==row.version)throw Error('研究历史版本不匹配');if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[topicId,row.version,requested,retry]);
 return <details className="m-history-version" open={open} onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open)setRequested(true);}}><summary><b>v{row.version}</b> {time(row.recordedAt)} · {row.reason}</summary>{open&&(error?<div role="alert">{error}<Button onClick={()=>setRetry(n=>n+1)}>重试读取此版研究</Button></div>:data?<HistoryContent r={data}/>:<p role="status">正在读取研究 v{row.version}…</p>)}</details>;
}

export default function ResearchHistory({topic}){
 const [page,setPage]=useState(null),[paths,setPaths]=useState([null]),[index,setIndex]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState('');
 const active=useRef(true),locked=useRef(false),pending=useRef(null);
 async function load(input){
  if(locked.current)return;locked.current=true;pending.current=input;setWorking(true);setError('');
  const params=new URLSearchParams({view:'summary',limit:'25'});if(input.ceiling!==undefined)params.set('ceiling',String(input.ceiling));if(input.before!==null)params.set('before',String(input.before));
  try{const result=await request(`/api/research/${topic.id}/history?${params}`);if(active.current){setPage(result);setPaths(input.paths);setIndex(input.index);}}
  catch(e){if(active.current)setError(e.message);}finally{locked.current=false;if(active.current)setWorking(false);}
 }
 useEffect(()=>{active.current=true;load({before:null,paths:[null],index:0});return()=>{active.current=false;};},[]);
 return <div className="m-history"><h3>来源时间线</h3><p className="m-note">来源发布时间与系统首次获知是两种时间。历史资料是本轮补入，不能用于声称提前发现。</p>{[...topic.evidence].filter(e=>e.publishedAt).sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)).map(e=><div className="m-source-history" key={e.id}><time>{e.publishedAt.slice(0,10)}</time><p>{e.claim}<small>本版可用 {time(e.newsId?e.availableAt:e.firstSeen)} · {verificationNames[e.verification]}</small></p></div>)}
 <h3>研究版本</h3><p className="m-note">按当时保存的证据和判断复核；旧版本不覆盖。每页25版，展开后读取该版详情。</p>
 {page&&<p role="status">第 {index+1} 页 · 本次共 {page.total} 个版本 · 固定至 v{page.ceiling}{topic.version>page.ceiling?'；已有新版本，可刷新到最新':''}</p>}
 <nav aria-label="研究历史分页"><Button aria-disabled={working||index===0} onClick={()=>{if(index>0)load({before:paths[index-1],ceiling:page.ceiling,paths,index:index-1});}}>上一页研究版本</Button><Button aria-disabled={working||!page?.nextCursor} onClick={()=>{if(page?.nextCursor)load({before:page.nextCursor,ceiling:page.ceiling,paths:[...paths.slice(0,index+1),page.nextCursor],index:index+1});}}>下一页研究版本</Button><Button aria-disabled={working} onClick={()=>load({before:null,paths:[null],index:0})}>刷新到最新研究版本</Button></nav>
 {working&&<p role="status">正在读取研究版本列表…</p>}{error&&<div role="alert">{error}<Button disabled={working} onClick={()=>load(pending.current)}>重试读取版本列表</Button></div>}
 {page?.items.map((row,i)=><HistoryVersion key={`${page.ceiling}:${index}:${row.version}`} topicId={topic.id} row={row} initialOpen={i===0}/>)}
 </div>;
}

function HistoryContent({r}){
 const ids=new Set(r.addedEvidenceIds),added=r.topic.evidence.filter(e=>ids.has(e.id));
 return <div>{!r.topic.claims?.length&&<AssessmentSummary assessment={r.topic.assessment}/>}{claimsOf(r.topic).map(c=><p key={c.id}>{CLAIM_KINDS[c.kind]}：{c.claim} · {c.probability===null?'待估计':`${c.probability}% 主观估计`} · {OUTCOMES[c.outcome]} · 截止 {c.resolveBy||'待定'} · {c.revisionReason||'既有记录'}{r.topic.claims?.length>0&&<><br/>依据：{c.basis||'待补'}<br/>若成立：{c.impactIfTrue||'待补'}；未兑现：{c.impactIfFalse||'待补'}</>}</p>)}{!r.topic.claims?.length&&r.topic.assessment&&<p>当时主张：{r.topic.assessment.claim} · 截止 {r.topic.assessment.resolveBy||'待定'}<br/>依据：{r.topic.assessment.basis}<br/>未兑现影响：{r.topic.assessment.impactIfFalse}</p>}<p>当时判断：{r.topic.hypothesis.logic}</p><p>当时观察点：{r.topic.nextEvidence||'未填写'}</p><p>触发条件：{r.topic.hypothesis.trigger||'未填写'}</p><p>失效条件：{r.topic.hypothesis.invalidation||'未填写'}</p><p>产业期限：{r.topic.hypothesis.industryHorizon||'未填写'} / 持有期：{r.topic.hypothesis.holdingHorizon||'未填写'}</p><details><summary>当时公司关系 {r.topic.companies.length} 家</summary>{r.topic.companies.map(c=><p key={c.symbol}>{c.name} · {c.symbol} · {c.role}<br/>{c.note}{c.url&&<><br/><a href={c.url} target="_blank" rel="noreferrer">当时关系依据 ↗</a></>}</p>)}</details><p>当时证据 {r.topic.evidence.length} 条；本版新增 {added.length} 条。</p>{added.map(e=><p className="m-muted" key={e.id}>+ {e.claim}</p>)}</div>;
}
