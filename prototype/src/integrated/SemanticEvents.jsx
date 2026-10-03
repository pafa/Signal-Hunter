import React,{useEffect,useState} from 'react';
import {Button} from '../major/Primitives';
import NewsLibrary from '../major/NewsLibrary';
import {request,time} from '../major/api';
import {semanticKinds as kinds,semanticRunLabel,semanticScopeLabels} from '../../shared/semantic-labels.mjs';
import './semantic-events.css';
import SemanticMaterialLibrary from './SemanticMaterialLibrary';
const actions={accept:'采纳此判断',reject:'不采纳',withdraw:'撤销采纳'};
export function ComparisonResult({run}){
 const c=run.candidate?.comparison,hasMaterial=['left','right'].some(side=>run.packet.input[side].kind==='material');
 return <>
  <p>{semanticRunLabel(run)} · {time(run.createdAt)}{run.stale?(hasMaterial?' · 材料或新闻已修订，旧候选不可采纳':' · 新闻已修订，旧候选不可采纳'):''}</p>
  {run.failure&&<p role="alert" className="m-warning">{run.failure.message}</p>}
  <div className="event-pair">{['left','right'].map(side=><article key={side}><small>{side==='left'?'左侧':'右侧'}{run.packet.input[side].kind==='material'?'材料':'新闻'} · v{run.packet.input[side].revision} · {semanticScopeLabels[run.packet.input[side].contentScope]||'仅标题'}</small><h4>{run.packet.input[side].title}</h4><p>发布 {time(run.packet.input[side].publishedAt)} · 本版可用 {time(run.packet.input[side].availableAt)}</p>{c&&<dl>{[['actor','主体'],['action','动作'],['object','对象'],['eventTime','事件时间'],['stage','阶段'],['quote',c[side].quoteField==='body'?'原文引用（正文）':'原文引用（标题）']].map(([key,label])=><React.Fragment key={key}><dt>{label}</dt><dd>{c[side][key]}</dd></React.Fragment>)}</dl>}{run.packet.input[side].body&&<details><summary>查看冻结正文与指纹</summary><p>内容指纹：{run.packet.input[side].contentHash}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'24rem',overflow:'auto'}}>{run.packet.input[side].body}</pre></details>}</article>)}</div>
  {c&&<><h3>{kinds[c.relation]}</h3><p>{c.reason}</p><h4>还需核对</h4>{c.missingEvidence.length?<ul>{c.missingEvidence.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>模型未列出具体缺口，仍需本人核对标题与原文。</p>}</>}
  {run.decision&&<p className="m-note">本输入对最新决定 v{run.decisionVersion}：{actions[run.decision.action]}{run.decision.runId!==run.id?'（针对另一份比较结果）':''}。{run.active?'当前采纳，限本次输入版本。':''}</p>}
  <details><summary>冻结输入与模型记录</summary><p>{hasMaterial?'按每侧标明的阅读范围比较；只使用已保存材料，未重新抓取或独立核实。':'标题级比较；没有读取正文，'}引用相符不等于推论正确。这里只保存成对判断，不自动归并新闻、研究或证据。</p><p>模型：{run.model} · 输入指纹：{run.packet.inputHash}</p>{run.candidate&&<p>提示词 {run.candidate.trace.promptVersion} · 输出指纹 {run.candidate.trace.outputHash} · 观察到的工具调用 {run.candidate.trace.toolCallsObserved??'未提供'} · 运行警告 {run.candidate.trace.runtimeWarningCount??'未提供'}</p>}</details>
  {!!run.history?.length&&<details><summary>本输入对决定历史（{run.history.length}）</summary>{run.history.map(d=><p key={d.version}>v{d.version} · {actions[d.action]} · {kinds[d.relation]} · {time(d.at)}<br/>{d.note}</p>)}</details>}
 </>;
}
export default function SemanticEvents({initialPair=null,onBack}){
 const [pair,setPair]=useState(initialPair||{left:null,right:null}),[picker,setPicker]=useState(null),[data,setData]=useState(null),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notes,setNotes]=useState({});
 useEffect(()=>{let live=true,timer;request('/api/semantic-events').then(result=>{if(!live)return;setData(result);setSelected(id=>id||result.runs[0]?.id||'');if(result.runs.some(r=>r.status==='running'))timer=setTimeout(()=>setRefresh(n=>n+1),2000);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;clearTimeout(timer);};},[refresh]);
 useEffect(()=>{let live=true;setDetail(null);if(selected)request(`/api/semantic-events/${selected}`).then(r=>{if(live)setDetail(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[selected,refresh]);
 async function action(path,body,select=false){setBusy(true);setError('');try{const r=await request(path,'POST',body);if(select)setSelected(r.id);setRefresh(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 function start(){action('/api/semantic-events',Object.fromEntries(['left','right'].map(side=>[side,{id:pair[side].id,revision:pair[side].revision,...(pair[side].kind==='material'?{kind:'material'}:{})}])),true);}
 const ready=pair.left&&pair.right&&`${pair.left.kind||'news'}:${pair.left.id}`!==`${pair.right.kind||'news'}:${pair.right.id}`,run=detail?.id===selected?detail:null;
 return <section className="semantic-events" aria-label="事件语义比较">
  <div className="event-actions"><Button onClick={onBack}>返回规则召回</Button><Button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>刷新比较记录</Button></div>
  <p>从完整新闻库或已保存材料选择两侧，也可比较刚才的召回线索。Codex 判断仅作候选，冻结各侧阅读范围、输入版本与每次人工决定。采纳不改写研究，也不生成交易。</p>
  {error&&<p role="alert" className="m-warning">{error}</p>}
  <div className="event-pair">{['left','right'].map(side=><article key={side}><small>{side==='left'?'左侧':'右侧'}输入</small><h4>{pair[side]?.title||'尚未选择'}</h4>{pair[side]&&<p>{semanticScopeLabels[pair[side].contentScope]||'仅标题'} · v{pair[side].revision}</p>}<Button disabled={busy} onClick={()=>setPicker({side,kind:'news'})}>选择{side==='left'?'左侧':'右侧'}新闻</Button><Button disabled={busy} onClick={()=>setPicker({side,kind:'material'})}>选择{side==='left'?'左侧':'右侧'}材料</Button></article>)}</div>
  {picker&&<div className="semantic-picker"><h3>选择{picker.side==='left'?'左侧':'右侧'}{picker.kind==='material'?'材料':'报道'}</h3><Button onClick={()=>setPicker(null)}>收起选择列表</Button>{picker.kind==='material'?<SemanticMaterialLibrary onSelect={m=>{setPair(p=>({...p,[picker.side]:m}));setPicker(null);}}/>:<NewsLibrary onOpen={n=>{setPair(p=>({...p,[picker.side]:n}));setPicker(null);}}/>}</div>}
  <div className="event-actions"><Button primary disabled={busy||!ready||!data?.enabled||data.runs.some(r=>r.status==='running')} onClick={start}>比较所选输入</Button><span>{data?.enabled?`本机 Codex · ${data.model}`:'未启用本机 Codex；请检查服务配置'}</span></div>
  <div className="event-workspace"><div className="event-results" aria-label="语义比较记录">{data?.runs.map(r=><button key={r.id} disabled={busy} aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)}><small>{semanticRunLabel(r)}{r.stale?' · 旧版本':''}{r.active?' · 当前采纳':''}</small><strong>{r.left.title}</strong><p>↔ {r.right.title}</p><small>{kinds[r.relation]||'等待结果'} · {time(r.createdAt)}</small></button>)}{data&&!data.runs.length&&<p>暂无比较记录。未被标题规则召回的报道也可在上方选择。</p>}</div>
   <div className="event-detail" aria-label="语义比较详情">{run?<><ComparisonResult run={run}/>{run.status==='running'&&<Button disabled={busy} onClick={()=>action(`/api/semantic-events/${run.id}/cancel`,{})}>取消本次比较</Button>}{run.status==='candidate'&&<form className="m-form" onSubmit={e=>e.preventDefault()}><label>本人核对说明<textarea maxLength={1200} value={notes[run.id]||''} onChange={e=>setNotes(n=>({...n,[run.id]:e.target.value}))}/></label><div className="event-actions">{Object.entries(actions).map(([key,label])=><Button key={key} disabled={busy||!notes[run.id]?.trim()||key==='accept'&&run.stale||key==='withdraw'&&(run.decision?.runId!==run.id||run.decision?.action!=='accept')} onClick={()=>action(`/api/semantic-events/${run.id}/decision`,{version:run.decisionVersion,action:key,note:notes[run.id]})}>{label}</Button>)}</div></form>}</>:<p>选择一份比较查看冻结输入、结果与决定历史。</p>}</div>
  </div><small>最近 50 次比较；数据库保留更早记录。不同事件的类比与“无法判断”同样保留，不作为同一事件自动合并。</small>
 </section>;
}
