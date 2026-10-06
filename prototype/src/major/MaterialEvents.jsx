import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time,currentInstanceId} from './api';
import useEditorDraft from './useEditorDraft';
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
const emptyEvent=()=>({note:''});
const validEvent=v=>typeof v?.note==='string'&&v.note.length<=1200;
function ReviewedEvent({topic,instance,run,index,disabled,onDecision}){
 const history=run.reviews[index]||[],version=history[0]?.version||0;
 const editor=useEditorDraft(topic,JSON.stringify(['material-event-review',run.id,run.createdAt||'',run.packet.inputHash,index,version]),emptyEvent,validEvent,instance);
 const stale=editor.draft.base!==topic.version,packetStale=run.stale||run.packet.input.topicVersion!==topic.version,locked=disabled||stale||packetStale;
 return <><EventReview event={run.candidate.decomposition.events[index]} index={index} history={history} disabled={locked} note={editor.draft.value.note}
  onNoteChange={note=>{if(!locked)editor.change({note});}}
  onDecision={(eventIndex,decisionVersion,action,note)=>{if(!locked)onDecision({eventIndex,version:decisionVersion,action,note},editor.draft,editor.ack);}}/>
  {stale&&<p className="m-warning">事项草稿基于研究 v{editor.draft.base}，当前为 v{topic.version}；请重新核对。<Button disabled={disabled} onClick={()=>{if(!disabled)editor.reset();}}>丢弃事项草稿并重新核对</Button></p>}
  {editor.draft.volatile&&<p className="m-warning">浏览器无法保存事项草稿，刷新页面前请保留输入。</p>}
 </>;
}
export default function MaterialEvents(props){
 const instance=props.instanceId??currentInstanceId();
 return <MaterialEventsBody key={JSON.stringify([instance,props.topic.id,props.topic.createdAt||''])} {...props} instance={instance}/>;
}
function MaterialEventsBody({topic,materials,busy,mutate,instance}){
 const [data,setData]=useState(null),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState(''),[listVersion,setListVersion]=useState(0),[detailVersion,setDetailVersion]=useState(0);
 const selection=useEditorDraft(topic,'material-event-selection',()=>({id:''}),v=>typeof v?.id==='string',instance);
 const generation=useEditorDraft(topic,'material-event-generation',()=>({materialId:'',revision:0,requestId:crypto.randomUUID()}),v=>typeof v?.materialId==='string'&&Number.isSafeInteger(v.revision)&&v.revision>=0&&typeof v.requestId==='string',instance);
 const selected=selection.draft.value.id,materialId=generation.draft.value.materialId;
 const alive=useRef(true),flight=useRef(false),selectionRef=useRef(selection),ready=useRef(false),base=`/api/research/${topic.id}/material-events`;
 selectionRef.current=selection;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true,timer;setListVersion(0);async function load(){try{const d=await request(base);if(!active)return;setData(d);setListVersion(topic.version);if(!selectionRef.current.draft.value.id&&d.runs[0])selectionRef.current.change({id:d.runs[0].id});if(d.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);}catch(e){if(active){setListVersion(0);setError(e.message);}}}void load();return()=>{active=false;clearTimeout(timer);};},[base,refresh,topic.version]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{let active=true;ready.current=false;setDetailVersion(0);setDetail(old=>old?.id===selected?old:null);if(selected)request(`${base}/${selected}`).then(r=>{if(active){if(r.id!==selected||!r.packet?.input||!Array.isArray(r.reviews))throw new Error('未能核对拆分记录，请刷新重试');setDetail(r);setDetailVersion(topic.version);ready.current=true;}}).catch(e=>{if(active){setDetailVersion(0);ready.current=false;setError(e.message);}});return()=>{active=false;};},[base,selected,selectedState,refresh,topic.version]);
 const disabled=busy||working,running=data?.runs.some(r=>r.status==='running'),listReady=listVersion===topic.version;
 const m=materials.find(v=>v.id===materialId),generationStale=!!materialId&&(generation.draft.base!==topic.version||!m||m.revision!==generation.draft.value.revision);
 const detailReady=detail?.id===selected&&detailVersion===topic.version&&ready.current;
 const begin=()=>{if(busy||flight.current)return false;flight.current=true;setWorking(true);setError('');return true;};
 const end=()=>{flight.current=false;if(alive.current)setWorking(false);};
 const reload=()=>{ready.current=false;setListVersion(0);setDetailVersion(0);setRefresh(n=>n+1);};
 async function generate(){
  if(!listReady||generationStale||!materialId||running||!data?.enabled||topic.status==='archived'||!begin())return;
  const submitted=generation.draft,input={version:submitted.base,materialId,revision:submitted.value.revision,requestId:submitted.value.requestId};
  try{const r=await request(base,'POST',input);if(!r?.id||r.topicId!==topic.id||r.materialId!==input.materialId||r.materialRevision!==input.revision)throw new Error('未能核对事项拆分回执；草稿及请求标识保留，请刷新核对后重试');
   const ack=generation.ack(submitted,{...submitted.value,requestId:crypto.randomUUID()},input.version);
   if(alive.current&&!ack.retained){selection.change({id:r.id});reload();}
  }catch(e){if(alive.current)setError(e.message);}finally{end();}
 }
 async function decide(input,submitted,acknowledge){
  if(!listReady||!detailReady||detail.stale||detail.packet.input.topicVersion!==topic.version||submitted.base!==topic.version||!begin())return;
  const run=detail;
  try{const r=await mutate(`${base}/${run.id}/decision`,'POST',input);if(!r)return;
   const saved=r.materialEventRun,receipt=saved?.reviews?.[input.eventIndex]?.find(v=>v.version===input.version+1);
   if(saved?.id!==run.id||JSON.stringify(saved?.packet)!==JSON.stringify(run.packet)||JSON.stringify(saved?.candidate)!==JSON.stringify(run.candidate)||!receipt||receipt.action!==input.action||receipt.note!==input.note.trim()||receipt.inputHash!==run.packet.inputHash||(input.action==='create'&&(typeof receipt.topicId!=='string'||!receipt.topicId||receipt.topicId.length>80)))throw new Error('未能核对事项决定回执；草稿保留，请刷新记录后核对');
   const ack=acknowledge(submitted,emptyEvent(),submitted.base);
   if(alive.current&&!ack.retained&&selectionRef.current.draft.value.id===run.id){setDetail(saved);reload();}
  }catch(e){if(alive.current)setError(e.message);}finally{end();}
 }
 async function cancel(){if(!listReady||!detailReady||detail.status!=='running'||!begin())return;try{await request(`${base}/${selected}/cancel`,'POST',{});if(alive.current)reload();}catch(e){if(alive.current)setError(e.message);}finally{end();}}
 const candidate=detail?.candidate?.decomposition;
 return <section className="model-research material-events" aria-label="材料多事件拆分">
  <h3>一份材料中的多个事项</h3><p className="m-note">选择一份已保存材料，调用本机 Codex 提出事项边界。政策条款不按段落机械拆开；所有候选共用同一来源，不构成独立佐证。</p>
  <label>拆分材料<select disabled={disabled} value={materialId} onChange={e=>{if(disabled||flight.current)return;const material=materials.find(v=>v.id===e.target.value);generation.change({materialId:material?.id||'',revision:material?.revision||0,requestId:crypto.randomUUID()},topic.version);}}><option value="">请选择材料</option>{materials.map(m=><option key={m.id} value={m.id}>{m.title} · 材料 v{m.revision}</option>)}</select></label>
  <Button primary disabled={disabled||!listReady||generationStale||running||!data?.enabled||!materialId||topic.status==='archived'} onClick={generate}>使用 Codex 拆分事项</Button>
  {generationStale&&<p className="m-warning">所选材料或研究版本已变化，原请求标识保留；重新选择材料后再调用。<Button disabled={disabled} onClick={()=>{if(!disabled&&!flight.current)generation.reset();}}>丢弃拆分请求草稿并重新选择材料</Button></p>}
  {generation.draft.volatile&&<p className="m-warning">浏览器无法保存拆分请求，刷新页面前请核对是否已生成记录。</p>}
  <p className="m-note">{data?.enabled?`模型 ${data.model}；发送所选材料，消耗一次当前账号调用，并非离线推理。`:'当前未启用本机 Codex 拆分。'}生成候选后逐项核对，建立研究仍需你点击。</p>
  {error&&<p className="m-warning" role="alert">{error}</p>}
  <label>拆分记录<select disabled={disabled} value={selected} onChange={e=>{if(!disabled&&!flight.current){ready.current=false;selection.change({id:e.target.value});}}}><option value="">尚未选择</option>{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · 材料 v{r.materialRevision} · {states[r.status]}{r.stale?' · 旧输入':''}</option>)}</select></label><Button disabled={disabled} onClick={()=>{if(!disabled&&!flight.current)reload();}}>刷新拆分记录</Button>
  {selected&&!detail&&<p>正在读取拆分记录…</p>}
  {detail&&<>
   <p role="status">{states[detail.status]} · {detail.packet.input.material.title} · 材料 v{detail.packet.input.material.revision}</p>
   {(detail.stale||detail.packet.input.topicVersion!==topic.version)&&<p className="m-warning">材料或来源研究已变化，旧候选保留；请用当前材料重新生成后建立研究。</p>}
   {detail.status==='running'&&<Button disabled={disabled||!listReady||!detailReady} onClick={cancel}>取消拆分调用</Button>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}</p>}
   {candidate&&<><p>{candidate.scopeNote}</p>{!candidate.events.length&&<p>本次没有提取到可支持的具体事项；该结果仍已保存。</p>}{candidate.events.map((e,i)=><ReviewedEvent key={JSON.stringify([detail.id,detail.createdAt||'',detail.packet.inputHash,i,detail.reviews[i]?.[0]?.version||0])} topic={topic} instance={instance} run={detail} index={i} disabled={disabled||!listReady||!detailReady} onDecision={decide}/>)}{!!candidate.missingEvidence.length&&<><h4>待补证据</h4><ul>{candidate.missingEvidence.map((s,i)=><li key={i}>{s}</li>)}</ul></>}</>}
   <details><summary>冻结材料与模型记录</summary><p>原研究 v{detail.packet.input.topicVersion} · 发布 {time(detail.packet.input.material.publishedAt)} · 本版获取 {time(detail.packet.input.material.availableAt)}</p><PublicationDateEvidence evidence={detail.packet.input.material.publicationDateEvidence}/><ArticleReadingScope evidence={detail.packet.input.material.extractionEvidence} showMissing={detail.packet.input.material.contentScope==='extracted-text'}/><pre className="source-body">{detail.packet.input.material.body}</pre><p style={{overflowWrap:'anywhere'}}>输入指纹 {detail.packet.inputHash}</p>{detail.candidate&&<p>提示词 {detail.candidate.trace.promptVersion} · 工具调用 {detail.candidate.trace.toolCallsObserved??'未知'} · 运行警告 {detail.candidate.trace.runtimeWarningCount??'未知'}</p>}</details>
  </>}
 </section>;
}
