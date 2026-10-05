import React,{useEffect,useState} from 'react';
import {Button} from './Primitives';
import {request,time,stanceNames} from './api';
import {MaterialHistoricalRecall} from './HistoricalRecall';
import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';
const scopes={'extracted-text':'网页提取正文 · 完整性待核','user-supplied-text':'人工提供正文 · 完整性未保证',excerpt:'摘录 · 仅此范围'};

// The parent keys this component by topic and immutable material id.
export default function SourceMaterial({topicId,material:m,busy}){
 const [open,setOpen]=useState(false),[requested,setRequested]=useState(false),[detail,setDetail]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const {id,revision,contentHash,documentId}=m;
 useEffect(()=>{
  if(!requested)return;
  let current=true;setError('');
  request(`/api/research/${topicId}/materials/${id}`).then(value=>{
   if(value.id!==id||value.revision!==revision||value.contentHash!==contentHash||value.documentId!==documentId||typeof value.body!=='string')throw Error('材料版本不匹配，请关闭后重新打开');
   if(current)setDetail(value);
  }).catch(e=>{if(current)setError(e.message);});
  return()=>{current=false;};
 },[topicId,id,revision,contentHash,documentId,requested,retry]);
 return <details className="source-item" onToggle={e=>{const opened=e.currentTarget.open;setOpen(opened);if(opened)setRequested(true);}}>
  <summary><strong>{m.title}</strong><small>材料 v{m.revision} · {scopes[m.scope]} · {stanceNames[m.stance]}</small></summary>
  {open&&<>
   <p className="m-note">{m.sourceName} · 来源 {m.publishedAt||'日期未知'}{m.datePrecision==='day'?'（仅日期）':''}<br/>本版获取 {time(m.availableAt)} · {m.verification==='unverified'?'内容未证实':'核验状态见证据链'}</p>
   {m.url&&<a href={m.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}<p className="m-note">与事件的关系：{m.interpretation}</p>
   {error?<div role="alert"><p>{error}</p><Button onClick={()=>setRetry(n=>n+1)}>重试读取此版材料</Button></div>:!detail?<p role="status">正在读取材料 v{m.revision}…</p>:<>
    <PublicationDateEvidence evidence={detail.publicationDateEvidence} showMissing={m.scope==='extracted-text'}/><ArticleReadingScope evidence={detail.extractionEvidence} showMissing={m.scope==='extracted-text'}/>
    <pre className="source-body">{detail.body}</pre><small>内容指纹 {m.contentHash.slice(0,20)} · 旧版保留</small><MaterialHistoricalRecall material={detail} busy={busy}/>
   </>}
  </>}
 </details>;
}
