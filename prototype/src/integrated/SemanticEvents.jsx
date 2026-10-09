import {historyStatusLabels} from '../../shared/historical-recall.mjs';
import ArticleReadingScope from '../major/ArticleReadingScope';
import PublicationDateEvidence from '../major/PublicationDateEvidence';
import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import NewsLibrary from '../major/NewsLibrary';
import {request,time} from '../major/api';
import {semanticKinds as kinds,semanticRunLabel,semanticScopeLabels} from '../../shared/semantic-labels.mjs';
import './semantic-events.css';
import SemanticEventLibrary,{EventFocus} from './SemanticEventLibrary';
import SemanticMaterialLibrary from './SemanticMaterialLibrary';
import SemanticBatches from './SemanticBatches';
import EventClusters from './EventClusters';
const publicationTime=value=>typeof value!=='string'||!value?'未提供':value.length===10?`${value}（仅日期）`:value.replace('T',' ').replace(/\.000(?=Z|[+-])/,'').replace(/Z$/,' UTC').replace(/([+-]\d{2}:\d{2})$/,' $1');
export function TimeEvidence({event,input}){
 const evidence=event.timeEvidence;
 if(!evidence)return <p className="m-note">旧版未记录时间依据；上方为历史模型表述。</p>;
 const label={explicit:'原文明确日期或期间（未独立核实）',relative:'原文相对时间（具体日历日期待核）',unknown:'未知：缺少本侧时间依据'}[evidence.basis];
 return <div className="event-time-evidence"><strong>时间依据：{label}</strong>{evidence.quote&&<blockquote>{evidence.quote}</blockquote>}{evidence.basis==='relative'&&<p>来源发布日期：{publicationTime(input.publishedAt)}。这是来源元数据，不是确定的事件日期。</p>}</div>;
}
const actions={accept:'采纳此判断',reject:'不采纳',withdraw:'撤销采纳'};
export function ComparisonResult({run}){
 const c=run.candidate?.comparison,hasMaterial=['left','right'].some(side=>['material','event'].includes(run.packet.input[side].kind));
 return <>
  {run.packet.schema==='event-revision-pair-1'&&<p className="m-note">新旧事项修订对照：左侧保留旧版，右侧为新版；判断右侧是否接续这个具体旧事项。此对照只用于版本延续，不作为当前新闻归组或新增独立证据。</p>}
  <p>{semanticRunLabel(run)} · {time(run.createdAt)}{run.stale?(run.packet.schema==='event-revision-pair-1'?' · 原簇或输入版本已变化；对应历史保留，不再用于当前接续':run.packet.schema==='event-pair-scoped-1'?' · 事项、材料或新闻已变化，旧候选不可采纳':hasMaterial?' · 材料或新闻已修订，旧候选不可采纳':' · 新闻已修订，旧候选不可采纳'):''}</p>
  {run.invocation&&<p className="m-note">本次模型调用包含 {run.invocation.comparisons} 对独立比较，当前为第 {run.invocation.index+1} 对。{run.status==='running'?'取消会停止本次调用中的全部配对。':'各对分别校验、保存与决定；不按关系传递省略比较。'}</p>}{run.failure&&<p role="alert" className="m-warning">{run.failure.message}</p>}
  <div className="event-pair">{['left','right'].map(side=><article key={side}><small>{side==='left'?'左侧':'右侧'}{run.packet.input[side].kind==='event'?`事项 v${run.packet.input[side].revision} · 材料 v${run.packet.input[side].materialRevision}`:`${run.packet.input[side].kind==='material'?'材料':'新闻'} · v${run.packet.input[side].revision}`} · {semanticScopeLabels[run.packet.input[side].contentScope]||'仅标题'}</small><h4>{run.packet.input[side].title}</h4><EventFocus input={run.packet.input[side]}/><p>发布 {publicationTime(run.packet.input[side].publishedAt)} · 本版可用 {time(run.packet.input[side].availableAt)}</p>{c&&<dl>{[['actor','主体'],['action','动作'],['object','对象'],['eventTime','事件时间'],['stage','阶段'],['quote',c[side].quoteField==='body'?'原文引用（正文）':'原文引用（标题）']].map(([key,label])=><React.Fragment key={key}><dt>{label}</dt><dd>{c[side][key]}</dd></React.Fragment>)}</dl>}{c&&<TimeEvidence event={c[side]} input={run.packet.input[side]}/>}<PublicationDateEvidence evidence={run.packet.input[side].publicationDateEvidence} showMissing={run.packet.input[side].contentScope==='extracted-text'}/><ArticleReadingScope evidence={run.packet.input[side].extractionEvidence} showMissing={run.packet.input[side].contentScope==='extracted-text'}/>{run.packet.input[side].body&&<details><summary>查看冻结正文与指纹</summary><p>内容指纹：{run.packet.input[side].contentHash}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'24rem',overflow:'auto'}}>{run.packet.input[side].body}</pre></details>}</article>)}</div>
  {c&&<><h3>{kinds[c.relation]}</h3><p>{c.reason}</p><h4>还需核对</h4>{c.missingEvidence.length?<ul>{c.missingEvidence.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>模型未列出具体缺口，仍需本人核对标题与原文。</p>}</>}
  {run.decision&&<p className="m-note">{run.decision.actor?.kind==='system'?'系统判断':'本人决定'} · 本输入对最新决定 v{run.decisionVersion}：{actions[run.decision.action]}{run.decision.runId!==run.id?'（针对另一份比较结果）':''}。{run.active?'当前采纳，限本次输入版本。':''}</p>}
  <details><summary>冻结输入与模型记录</summary><p>{hasMaterial?'按每侧标明的阅读范围比较；只使用已保存材料，未重新抓取或独立核实。':'标题级比较；没有读取正文，'}引用相符不等于推论正确。这里只保存成对判断，不自动归并新闻、研究或证据。</p><p>模型：{run.model} · 输入指纹：{run.packet.inputHash}</p>{run.invocation&&<p>完整调用输入指纹：{run.invocation.inputHash} · 调用记录：{run.invocation.id}</p>}{run.candidate&&<p>提示词 {run.candidate.trace.promptVersion} · 输出指纹 {run.candidate.trace.outputHash} · 观察到的工具调用 {run.candidate.trace.toolCallsObserved??'未提供'} · 运行警告 {run.candidate.trace.runtimeWarningCount??'未提供'}</p>}</details>
  {!!run.history?.length&&<details><summary>本输入对决定历史（{run.history.length}）</summary>{run.history.map(d=><p key={d.version}>v{d.version} · {d.actor?.kind==='system'?'系统判断':'本人决定'} · {actions[d.action]} · {kinds[d.relation]} · {time(d.at)}<br/>{d.note}</p>)}</details>}
 </>;
}
export default function SemanticEvents({initialPair=null,onBack,historyContext=null}){
 const pending=useRef(null),acting=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const historyBase=historyContext?`/api/historical-recall/${historyContext.reportId}/comparisons`:null;
 const listPath=historyBase?`${historyBase}?candidateId=${encodeURIComponent(historyContext.candidateId)}`:'/api/semantic-events';
 const [batches,setBatches]=useState(false),[clusters,setClusters]=useState(false);
 const [pair,setPair]=useState(initialPair||{left:null,right:null}),[picker,setPicker]=useState(null),[data,setData]=useState(null),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notes,setNotes]=useState({});
 useEffect(()=>{let live=true,timer;request(listPath).then(result=>{if(!live)return;setData(result);setSelected(id=>id||result.runs[0]?.id||'');if(result.runs.some(r=>r.status==='running'))timer=setTimeout(()=>setRefresh(n=>n+1),2000);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;clearTimeout(timer);};},[refresh,listPath]);
 useEffect(()=>{let live=true;setDetail(null);if(selected)request(`/api/semantic-events/${selected}`).then(r=>{if(live)setDetail(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[selected,refresh]);
 async function action(path,body,select=false){if(acting.current)return;acting.current=true;setBusy(true);setError('');try{const r=await request(path,'POST',body);if(!live.current)return;if(select){setSelected(r.id);pending.current=null;}setRefresh(n=>n+1);}catch(e){if(live.current)setError(e.message);}finally{acting.current=false;if(live.current)setBusy(false);}}
 function start(){if(historyContext){pending.current??={candidateId:historyContext.candidateId,reportHash:historyContext.reportHash,requestId:crypto.randomUUID()};action(historyBase,pending.current,true);return;}action('/api/semantic-events',Object.fromEntries(['left','right'].map(side=>[side,{id:pair[side].id,revision:pair[side].revision,...(pair[side].kind?{kind:pair[side].kind}:{})}])),true);}
 const ready=pair.left&&pair.right&&`${pair.left.kind||'news'}:${pair.left.id}`!==`${pair.right.kind||'news'}:${pair.right.id}`,run=detail?.id===selected?detail:null;
 if(clusters)return <EventClusters onBack={()=>setClusters(false)} onResult={id=>{setClusters(false);setSelected(id);setRefresh(n=>n+1);}}/>;
 if(batches)return <SemanticBatches onBack={()=>setBatches(false)} onResult={id=>{setBatches(false);setSelected(id);setRefresh(n=>n+1);}}/>;
 return <section className="semantic-events" aria-label="事件语义比较">
  <div className="event-actions"><Button onClick={onBack}>{historyContext?'返回历史类比':'返回规则召回'}</Button><Button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>刷新比较记录</Button>{!historyContext&&<><Button onClick={()=>setBatches(true)}>持久比较批次</Button><Button onClick={()=>setClusters(true)}>事件簇记录</Button></>}</div>
  <p>{historyContext?'核对这份历史报告中的固定输入对；来源变化后需重新检索。原报告保留，比较单独保存，不自动确认共同机制。':'从新闻、已保存材料或已建立的事项选择两侧，也可比较刚才的召回线索。'}Codex 判断仅作候选，冻结各侧阅读范围、输入版本与每次人工决定。采纳不改写研究，也不生成交易。</p>
  {historyContext?.retrievalStatus&&<p className="m-note">原检索结果：{historyStatusLabels[historyContext.retrievalStatus]||historyContext.retrievalStatus}。语义复核单独保存，原报告的命中数与排除原因保持不变。</p>}
  {error&&<p role="alert" className="m-warning">{error}</p>}
  <div className="event-pair">{['left','right'].map(side=><article key={side}><small>{side==='left'?'左侧':'右侧'}输入</small><h4>{pair[side]?.eventFocus?.title||pair[side]?.title||'尚未选择'}</h4>{pair[side]&&<p>{semanticScopeLabels[pair[side].contentScope]||'仅标题'} · v{pair[side].revision}</p>}{!historyContext&&<><Button disabled={busy} onClick={()=>setPicker({side,kind:'news'})}>选择{side==='left'?'左侧':'右侧'}新闻</Button><Button disabled={busy} onClick={()=>setPicker({side,kind:'material'})}>选择{side==='left'?'左侧':'右侧'}材料</Button><Button disabled={busy} onClick={()=>setPicker({side,kind:'event'})}>选择{side==='left'?'左侧':'右侧'}事项</Button></>}</article>)}</div>
  {picker&&<div className="semantic-picker"><h3>选择{picker.side==='left'?'左侧':'右侧'}{picker.kind==='event'?'事项':picker.kind==='material'?'材料':'报道'}</h3><Button onClick={()=>setPicker(null)}>收起选择列表</Button>{picker.kind==='event'?<SemanticEventLibrary onSelect={m=>{setPair(p=>({...p,[picker.side]:m}));setPicker(null);}}/>:picker.kind==='material'?<SemanticMaterialLibrary onSelect={m=>{setPair(p=>({...p,[picker.side]:m}));setPicker(null);}}/>:<NewsLibrary onOpen={n=>{setPair(p=>({...p,[picker.side]:n}));setPicker(null);}}/>}</div>}
  <div className="event-actions"><Button primary disabled={busy||!ready||!data?.enabled||data.runs.some(r=>r.status==='running')} onClick={start}>{historyContext&&pending.current?'重试本次比较':'比较所选输入'}</Button><span>{data?.enabled?`本机 Codex · ${data.model}`:'未启用本机 Codex；请检查服务配置'}</span></div>
  <div className="event-workspace"><div className="event-results" aria-label="语义比较记录">{data?.runs.map(r=><button key={r.id} disabled={busy} aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)}><small>{r.purpose==='revision-correspondence'?'新旧修订对照 · ':''}{semanticRunLabel(r)}{r.stale?' · 旧版本':''}{r.active?' · 当前采纳':''}</small><strong>{r.left.title}</strong><p>↔ {r.right.title}</p><small>{kinds[r.relation]||'等待结果'} · {time(r.createdAt)}</small></button>)}{data&&!data.runs.length&&<p>暂无比较记录。{historyContext?'点击上方开始核对这对历史资料。':'未被标题规则召回的报道也可在上方选择。'}</p>}</div>
   <div className="event-detail" aria-label="语义比较详情">{run?<><ComparisonResult run={run}/>{run.status==='running'&&<Button disabled={busy} onClick={()=>action(`/api/semantic-events/${run.id}/cancel`,{})}>{run.invocation?`取消同次 ${run.invocation.comparisons} 对比较`:'取消本次比较'}</Button>}{run.status==='candidate'&&<form className="m-form" onSubmit={e=>e.preventDefault()}><label>本人核对说明<textarea maxLength={1200} value={notes[run.id]||''} onChange={e=>setNotes(n=>({...n,[run.id]:e.target.value}))}/></label><div className="event-actions">{Object.entries(actions).map(([key,label])=><Button key={key} disabled={busy||!notes[run.id]?.trim()||key==='accept'&&run.stale||key==='withdraw'&&(run.decision?.runId!==run.id||run.decision?.action!=='accept')} onClick={()=>action(`/api/semantic-events/${run.id}/decision`,{version:run.decisionVersion,action:key,note:notes[run.id]})}>{label}</Button>)}</div></form>}</>:<p>选择一份比较查看冻结输入、结果与决定历史。</p>}</div>
  </div><small>{historyContext?`本条历史资料共 ${data?.total??0} 次比较，显示最近 50 次`:'最近 50 次比较'}；数据库保留更早记录。不同事件的类比与“无法判断”同样保留，不作为同一事件自动合并。</small>
 </section>;
}
