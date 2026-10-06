import React from 'react';
import {time} from './api';
import MaterialityReview from './MaterialityReview';
import './research-dossier.css';

export default function ResearchDossier({topic}){
 const dossier=topic.dossier;if(!dossier)return <p>此主题尚无详细研判。</p>;
 const attachment=topic.attachment,window=attachment?{from:attachment.windowStart,to:attachment.windowEnd}:topic.analysisProvenance?.sourceWindow;
 return <article className="research-dossier" aria-label="详细研判">
  <p className="dossier-meta">{dossier.reviewStatus==='complete'?(topic.version===dossier.basedOnResearchVersion?'本人已完成核对':'研究已更新，需重新核对'):'研判草稿 / 历史导入'} · {dossier.preparedBy} · {time(dossier.preparedAt)} · 基于研究 v{dossier.basedOnResearchVersion}</p>
  {topic.version!==dossier.basedOnResearchVersion&&<p className="m-warning">这是导入时的研判快照。研究已更新，请同时核对当前概率、假设和版本历史。</p>}
  <p className="dossier-scope">{window?.from&&window?.to?<>{attachment?'附件':'新闻'}窗口 {time(window.from)} — {time(window.to)}。</>:<>材料窗口未记录。</>}系统首次获取 {time(topic.firstSeen)}；历史补采不代表原文发布时已发现。若填写情景概率，它是主观工作估计，未经校准。保存研判不会提交交易。</p>
  {dossier.sections.map((s,index)=><section key={s.id}><h3><span>{String(index+1).padStart(2,'0')}</span>{s.title}</h3>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}{s.table&&<div className="dossier-table"><table><thead><tr>{s.table.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{s.table.rows.map((row,i)=><tr key={i}>{row.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}{s.sourceIds?.length>0&&<div className="dossier-sources">依据：{s.sourceIds.map(id=>{const e=topic.evidence.find(e=>e.id===id);return e?.url?<a key={id} href={e.url} target="_blank" rel="noreferrer">{e.sourceName} ↗</a>:<span key={id}>来源记录缺失或无链接 · {id}</span>;})}</div>}</section>)}
  <MaterialityReview review={dossier.materialityReview} evidence={topic.evidence}/>
  {attachment&&<p className="dossier-meta">原附件：{attachment.fileName} · SHA-256 {attachment.sha256}</p>}
 </article>;
}
