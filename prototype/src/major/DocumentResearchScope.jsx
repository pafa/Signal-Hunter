import React from 'react';
import {Button} from './Primitives';
export default function DocumentResearchScope({topic,onMaterials}){
 const context=topic.documentContext;if(!context?.entries?.length)return null;
 const count=context.entries.filter(e=>e.status==='available').length,ready=topic.dossier?.basedOnResearchVersion===topic.version;
 return <details className="source-item"><summary>通知与附件 · {ready?'本版研判已纳入':'材料已准备'} {count} / {context.entries.length} 个入口</summary>
  <p className="m-note">{ready?'以下是本版研判实际收到的阅读范围。':'材料已更新，当前显示的旧研判尚未覆盖本次变化；后台进度见运行详情。'}通知快照中的“尚未读取”保留当时范围；附件同源、不代表事实已核实，未读内容仍是缺口。</p>
  {context.entries.map((e,i)=><p key={e.parentEvidenceId+':'+e.url+':'+i}><strong>{e.label}</strong> · {e.status==='available'?'已提供正文':'未提供正文'}{e.requested&&e.status!=='available'?' · 原请求与未读原因保留':''}<br/>{e.reason}</p>)}
  {onMaterials?<Button onClick={onMaterials}>查看已归档的通知与附件</Button>:<p className="m-note">在下方“已关联材料”展开原通知或附件，可查看不可变正文与本版获取时间。</p>}
 </details>;
}
