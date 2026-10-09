import React from 'react';
export default function ArticleSourceLinks({links}){
 if(!links)return null;
 return <details className="article-source-links" style={{overflowWrap:'anywhere'}}><summary>正文引用网页 · {links.links.length} 个入口</summary>
  <p className="m-note">这里只记录原文中的链接、名称和邻近文字。目标网页是否已读取、与事件是否有关，见运行详情中的自动补充依据；链接本身不算事实或独立支持。每份原事项研判最多选择 3 个入口，补读只延伸一层。</p>
  {links.links.map(a=><div key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.label} ↗</a><p className="m-note">原文上下文：{a.context||'未记录'}</p></div>)}
  {links.truncated&&<p className="m-warning">入口或上下文超过记录上限，本列表不完整。</p>}
  <p className="m-note">仅检查提取正文中的链接；未列出不表示没有其他来源。PDF 等附件仍见正文范围记录。</p>
 </details>;
}
