import React,{useState} from 'react';
import {Button} from '../major/Primitives';
import {request} from '../major/api';
import {EventTime} from '../major/MaterialEvents';
const key=m=>m.kind==='event'?`event:${m.id}`:m.kind==='material'?`material:${m.documentId}`:`news:${m.id}`;
export function ReplacementEvidence({replacement}){
 if(!replacement)return null;
 return <section aria-label="事项延续依据"><p>本人核对同一材料更新前后的事项对应；此决定不代表模型已验证两个版本是同一事件。</p>{replacement.mappings.map(({before,after})=><article className="source-item" key={before.id}><div className="event-pair">{[[before,'原事项'],[after,'新事项']].map(([m,label])=><div key={label}><strong>{label}：{m.title}</strong><p>{m.sourceTitle||m.title} · 材料 v{m.materialRevision}</p><p>{m.eventFocus.actor} · {m.eventFocus.action} · {m.eventFocus.object} · {m.eventFocus.stage}</p><blockquote>{m.eventFocus.quote}</blockquote><EventTime event={m.eventFocus}/><small>研究 ID：{m.id}</small></div>)}</div></article>)}</section>;
}
export default function ClusterReplacement({record,group,batchId,busy,onSaved,onWorkingChange=()=>{}}){
 const [mapping,setMapping]=useState({}),[note,setNote]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 if(!record||record.status!=='active')return <p className="m-note">若此组是材料修订后的事项，可先在下方选择原事件簇，再核对新旧事项对应。</p>;
 const present=new Set(group.members.map(key)),missing=record.members.filter(m=>!present.has(key(m)));
 if(!missing.length)return null;
 const options=before=>group.members.filter(m=>before.kind==='event'&&m.kind==='event'&&m.documentId===before.documentId&&m.materialRevision>before.materialRevision&&!record.members.some(old=>key(old)===key(m)));
 const stale=preview&&(preview.input.version!==record.version||preview.groupHash!==group.hash),disabled=busy||working;
 async function prepare(){if(disabled)return;setWorking(true);onWorkingChange(true);setError('');setPreview(null);try{const input={batchId,groupId:group.id,version:record.version,replacements:missing.map(m=>({beforeId:m.id,afterId:mapping[m.id]||''}))};const result=await request(`/api/event-clusters/${record.id}/replacement-preview`,'POST',input);setPreview({...result,input,requestId:crypto.randomUUID()});}catch(e){setError(e.message);}finally{setWorking(false);onWorkingChange(false);}}
 async function save(){if(disabled||stale||!preview)return;setWorking(true);onWorkingChange(true);setError('');try{const result=await request(`/api/event-clusters/${record.id}/replace`,'POST',{...preview.input,previewHash:preview.previewHash,note,requestId:preview.requestId});onSaved(result);}catch(e){setError(e.message);}finally{setWorking(false);onWorkingChange(false);}}
 return <section className="source-item" aria-label={`延续事件簇 ${record.title}`}><h4>延续已选事件簇：{record.title} · v{record.version}</h4><p>保留原事件簇 ID。原成员必须保留，或逐一对应同一材料新修订中的事项；旧材料和研究不删除，拆分或合并多个事项不能在这里自动处理。</p>{missing.map(m=><label className="m-form" key={key(m)}>替换原事项：{m.title}（材料 v{m.materialRevision||m.revision}）<select value={mapping[m.id]||''} disabled={disabled} onChange={e=>{setMapping(v=>({...v,[m.id]:e.target.value}));setPreview(null);}}><option value="">请选择对应的新事项</option>{options(m).map(n=><option key={n.id} value={n.id}>{n.title} · 材料 v{n.materialRevision}</option>)}</select>{!options(m).length&&<span className="m-warning">本组没有可对应的同源新修订事项；请核对输入。</span>}</label>)}{error&&<p role="alert" className="m-warning">{error}</p>}<Button disabled={disabled||missing.some(m=>!mapping[m.id])} onClick={prepare}>预览新旧事项对应</Button>{preview&&<><ReplacementEvidence replacement={preview}/><p>新版本包含 {preview.members.length} 个成员、{preview.pairs.length} 对当前有效比较。核对主体、对象及阶段后再确认。</p><label className="m-form">事项延续核对说明<textarea maxLength={1200} value={note} onChange={e=>setNote(e.target.value)} disabled={disabled}/></label>{stale&&<p className="m-warning">事件簇或批次已变化，请重新预览。</p>}<Button primary disabled={disabled||stale||!note.trim()} onClick={save}>确认延续原事件簇</Button></>}</section>;
}
