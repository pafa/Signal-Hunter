import React from 'react';
export default function ArticleReadingScope({evidence,showMissing=false}){
 if(!evidence)return showMissing?<p className="m-note">旧材料未记录附件范围，不能据此判断已读完整公告。</p>:null;
 const removed=evidence.removedControls.fontSize+evidence.removedControls.share;
 return <details className="article-reading-scope" style={{overflowWrap:'anywhere'}}><summary>正文范围 · {evidence.attachments.length} 个附件入口尚未读取</summary><p className="m-note">这里只保存网页提取文本。附件未下载或读取，链接名称和格式提示不能代替内容核验。没有列出附件也不表示原文没有附件。</p>{removed>0&&<p className="m-note">已移除 {evidence.removedControls.fontSize} 处字号控件、{evidence.removedControls.share} 处分享控件；正文完整性仍待核对。</p>}{evidence.attachments.length>0&&<ul>{evidence.attachments.map(a=><li key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.label} ↗</a><small> · {a.formatHint==='unknown'?'格式待核':a.formatHint.toUpperCase()+' 链接'} · 尚未读取</small></li>)}</ul>}{evidence.omittedAttachmentLinks>0&&<p className="m-note">另有 {evidence.omittedAttachmentLinks} 个附件入口的地址不符合展示规则，未列出。</p>}{evidence.truncated&&<p className="m-warning">附件入口或名称超过记录上限，本列表不完整。</p>}</details>;
}
