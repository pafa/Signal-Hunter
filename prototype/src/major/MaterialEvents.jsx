import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time} from './api';
import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';

const states={running:'拆分中',candidate:'待核对',failed:'失败',cancelled:'已取消',interrupted:'中断'};
const topicLink=id=>`/?range=3&view=grid&topic=${encodeURIComponent(id)}`;
export function EventTime({event}){return <span>{({event:'发生或宣布时间',effective:'生效时间',deadline:'到期或截止时间',period:'涉及期间',unclear:'时间用途待核',unknown:'时间未知'})[event.timeRole]||'原文时间片段（旧版未记录用途）'}：{event.eventTime}{event.timeEvidence.basis==='relative'?'（原文相对时间，未换算）':''}</span>;}
export function EventReview({event,index,history,disabled,onDecision,note='',onNoteChange=()=>{}}){
 const latest=history?.[0];
 return <article className="source-item">
  <h4>{index+1}. {event.title}</h4><p>{event.actor} · {event.action} · {event.object}</p>
  <p>阶段：{event.stage} · <EventTime event={event}/></p>
  <blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{event.quote}</blockquote><small>引自{event.quoteField==='body'?'正文':'标题'}；引用相符不代表事实已证实。</small>
  {event.timeEvidence.quote&&<p>时间依据：{event.timeEvidence.quote}</p>}<p>事项边界：{event.boundaryReason}</p>
  {latest?.action==='create'?<p role="status">已建立待核对研究 · <a href={topicLink(latest.topicId)}>打开新研究</a>。需要撤销时可在该研究中归档，历史保留。</p>:<>
   {latest?.action==='reject'&&<p>已排除：{latest.note}</p>}
   <label>事项 {index+1} 核对说明<textarea maxLength={1200} rows={2} disabled={disabled} value={note} onChange={e=>onNoteChange(e.target.value)}/></label>
   <div className="m-form-actions">{latest?.action==='reject'?<Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest.version,'reopen',note)}>重新核对</Button>:<><Button primary disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest?.version||0,'create',note)}>为此事项建立研究</Button><Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest?.version||0,'reject',note)}>排除此事项</Button></>}</div>
  </>}
  {!!history?.length&&<details><summary>核对历史 · {history.length} 次</summary>{history.map(h=><p key={h.version}>v{h.version} · {time(h.at)} · {({create:'建立研究',reject:'排除',reopen:'重新核对'})[h.action]}：{h.note}</p>)}</details>}
 </article>;
}
export default function MaterialEvents({topic,materials,busy,mutate}){
 const [data,setData]=useState(null),[materialId,setMaterialId]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState(''),[notes,setNotes]=useState({});
 const alive=useRef(true),pending=useRef(null),base=`/api/research/${topic.id}/material-events`;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true,timer;async function load(){try{const d=await request(base);if(!active)return;setData(d);setSelected(v=>v||d.runs[0]?.id||'');if(d.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);}catch(e){if(active)setError(e.message);}}void load();return()=>{active=false;clearTimeout(timer);};},[base,refresh,topic.version]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{let active=true;setDetail(null);if(selected)request(`${base}/${selected}`).then(r=>{if(active)setDetail(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[base,selected,selectedState,refresh,topic.version]);
 async function generate(){
  if(busy||working)return;
  const m=materials.find(v=>v.id===materialId);if(!m)return;const input={version:topic.version,materialId:m.id,revision:m.revision},key=JSON.stringify(input);
  if(pending.current?.key!==key)pending.current={key,input:{...input,requestId:crypto.randomUUID()}};
  setWorking(true);setError('');try{const r=await request(base,'POST',pending.current.input);if(alive.current){pending.current=null;setSelected(r.id);setRefresh(n=>n+1);}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}
 }
 async function decide(eventIndex,version,action,note){if(busy||working||!detail||detail.id!==selected||detail.stale)return;const key=`${selected}:${eventIndex}:${version}`;setWorking(true);setError('');try{const r=await mutate(`${base}/${selected}/decision`,'POST',{eventIndex,version,action,note});if(r&&alive.current){setNotes(previous=>{const next={...previous};delete next[key];return next;});setDetail(r.materialEventRun);setRefresh(n=>n+1);}}finally{if(alive.current)setWorking(false);}}
 async function cancel(){if(busy||working)return;setWorking(true);setError('');try{await request(`${base}/${selected}/cancel`,'POST',{});if(alive.current)setRefresh(n=>n+1);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}}
 const disabled=busy||working,running=data?.runs.some(r=>r.status==='running'),candidate=detail?.candidate?.decomposition;
 return <section className="model-research material-events" aria-label="材料多事件拆分">
  <h3>一份材料中的多个事项</h3><p className="m-note">选择一份已保存材料，调用本机 Codex 提出事项边界。政策条款不按段落机械拆开；所有候选共用同一来源，不构成独立佐证。</p>
  <label>拆分材料<select disabled={disabled} value={materialId} onChange={e=>setMaterialId(e.target.value)}><option value="">请选择材料</option>{materials.map(m=><option key={m.id} value={m.id}>{m.title} · 材料 v{m.revision}</option>)}</select></label>
  <Button primary disabled={disabled||running||!data?.enabled||!materialId||topic.status==='archived'} onClick={generate}>使用 Codex 拆分事项</Button>
  <p className="m-note">{data?.enabled?`模型 ${data.model}；发送所选材料，消耗一次当前账号调用，并非离线推理。`:'当前未启用本机 Codex 拆分。'}生成候选后逐项核对，建立研究仍需你点击。</p>
  {error&&<p className="m-warning" role="alert">{error}</p>}
  <label>拆分记录<select disabled={disabled} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">尚未选择</option>{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · 材料 v{r.materialRevision} · {states[r.status]}{r.stale?' · 旧输入':''}</option>)}</select></label><Button disabled={disabled} onClick={()=>setRefresh(n=>n+1)}>刷新拆分记录</Button>
  {selected&&!detail&&<p>正在读取拆分记录…</p>}
  {detail&&<>
   <p role="status">{states[detail.status]} · {detail.packet.input.material.title} · 材料 v{detail.packet.input.material.revision}</p>
   {detail.stale&&<p className="m-warning">材料或来源研究已变化，旧候选保留；请用当前材料重新生成后建立研究。</p>}
   {detail.status==='running'&&<Button disabled={disabled} onClick={cancel}>取消拆分调用</Button>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}</p>}
   {candidate&&<><p>{candidate.scopeNote}</p>{!candidate.events.length&&<p>本次没有提取到可支持的具体事项；该结果仍已保存。</p>}{candidate.events.map((e,i)=>{const key=`${detail.id}:${i}:${detail.reviews[i]?.[0]?.version||0}`;return <EventReview key={key} event={e} index={i} history={detail.reviews[i]} disabled={disabled||detail.stale} note={notes[key]||''} onNoteChange={note=>setNotes(previous=>({...previous,[key]:note}))} onDecision={decide}/>;})}{!!candidate.missingEvidence.length&&<><h4>待补证据</h4><ul>{candidate.missingEvidence.map((s,i)=><li key={i}>{s}</li>)}</ul></>}</>}
   <details><summary>冻结材料与模型记录</summary><p>原研究 v{detail.packet.input.topicVersion} · 发布 {time(detail.packet.input.material.publishedAt)} · 本版获取 {time(detail.packet.input.material.availableAt)}</p><PublicationDateEvidence evidence={detail.packet.input.material.publicationDateEvidence}/><ArticleReadingScope evidence={detail.packet.input.material.extractionEvidence} showMissing={detail.packet.input.material.contentScope==='extracted-text'}/><pre className="source-body">{detail.packet.input.material.body}</pre><p style={{overflowWrap:'anywhere'}}>输入指纹 {detail.packet.inputHash}</p>{detail.candidate&&<p>提示词 {detail.candidate.trace.promptVersion} · 工具调用 {detail.candidate.trace.toolCallsObserved??'未知'} · 运行警告 {detail.candidate.trace.runtimeWarningCount??'未知'}</p>}</details>
  </>}
 </section>;
}
