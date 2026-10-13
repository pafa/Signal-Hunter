import React from 'react';
export default function ArticleSourceLinks({links}){
 if(!links)return null;
 return <details className="article-source-links" style={{overflowWrap:'anywhere'}}><summary>补充来源入口 · {links.links.length} 个入口</summary>
  <p className="m-note">这里只记录正文或发布方附件区的链接、名称和邻近文字。目标网页是否已读取、与事件是否有关，见运行详情中的自动补充依据；链接本身不算事实或独立支持。每份原事项研判最多选择 3 个入口，新任务最多沿明确链接延伸两层；旧任务保留原范围。</p>
  {links.links.map(a=><div key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.label} ↗</a>{a.originalUrl&&<p className="m-note">原链接：<code>{a.originalUrl}</code>；仅升级为同主机 HTTPS，失败不降级 HTTP。</p>}<p className="m-note">原文标签 / 上下文：{a.context||'未记录'}</p></div>)}
  {links.truncated&&<p className="m-warning">入口或上下文超过记录上限，本列表不完整。</p>}
  <p className="m-note">{links.scope==='extracted-html-and-publisher-attachment-links'?'已检查提取正文与已识别发布方的明确附件入口。':'仅检查提取正文中的链接。'}未列出不表示没有其他来源；附件可能只有名称，内容是否已补读见运行详情。</p>
 </details>;
}
