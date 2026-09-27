import React from 'react';
import {time} from './api';
import './research-dossier.css';

export default function ResearchDossier({topic}){
 const dossier=topic.dossier;if(!dossier)return <p>此主题尚无详细研判。</p>;
 return <article className="research-dossier" aria-label="附件详细研判">
  <p className="dossier-meta">{dossier.preparedBy} · {time(dossier.preparedAt)} · 基于研究 v{dossier.basedOnResearchVersion}</p>
  {topic.version!==dossier.basedOnResearchVersion&&<p className="m-warning">这是导入时的研判快照。研究已更新，请同时核对当前概率、假设和版本历史。</p>}
  <p className="dossier-scope">附件窗口 {time(topic.attachment.windowStart)} — {time(topic.attachment.windowEnd)}。系统首次获取 {time(topic.firstSeen)}，不是在原文发布时发现。情景概率为研究助手的主观工作估计，未校准；未提交交易。</p>
  {dossier.sections.map((s,index)=><section key={s.id}><h3><span>{String(index+1).padStart(2,'0')}</span>{s.title}</h3>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}{s.table&&<div className="dossier-table"><table><thead><tr>{s.table.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{s.table.rows.map((row,i)=><tr key={i}>{row.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}{s.sourceIds.length>0&&<div className="dossier-sources">依据：{s.sourceIds.map(id=>{const e=topic.evidence.find(e=>e.id===id);return <a key={id} href={e.url} target="_blank" rel="noreferrer">{e.sourceName} ↗</a>;})}</div>}</section>)}
  <p className="dossier-meta">原附件：{topic.attachment.fileName} · SHA-256 {topic.attachment.sha256}</p>
 </article>;
}
