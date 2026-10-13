import React from 'react';
import {Button} from '../major/Primitives';
export default function EventDocumentContext({context,disclosure,onEvidence}){
 if(!context?.entries?.length)return null;
 const available=context.entries.filter(e=>e.status==='available');
 return <details className="synthesis-source" {...disclosure('document-context')}><summary>通知与附件 · 本版纳入 {available.length} / {context.entries.length} 个入口</summary>
  <p className="m-note">“已纳入”表示附件正文进入本版分析，不表示全文完整、事实成立或独立佐证。附件不因文档关联而自动成为同一事件成员；通知快照中的“尚未读取”保留当时范围，以这里的本版输入为准。</p>
  {context.entries.map((e,i)=><section key={e.parentEvidenceId+':'+e.url+':'+i}><h3>{e.label} · {e.status==='available'?'已纳入本版':'未纳入本版'}</h3><p className="m-note">{e.reason}</p><Button onClick={()=>onEvidence(e.parentEvidenceId)}>查看父通知</Button>{e.status==='available'&&e.evidenceId&&<Button onClick={()=>onEvidence(e.evidenceId)}>查看附件正文</Button>}{e.status==='available'&&<small>材料 v{e.materialRevision} · 独立保留原文与获取时间</small>}</section>)}
 </details>;
}
