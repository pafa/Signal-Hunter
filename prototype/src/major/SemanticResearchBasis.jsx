import React from 'react';
import {semanticKinds,semanticScopeLabels} from '../../shared/semantic-labels.mjs';
import {time} from './api';
export default function SemanticResearchBasis({basis,status}){
 const sourceSide=basis.sourceSide,targetSide=sourceSide==='left'?'right':'left';
 return <details className="source-item"><summary>查看比较依据 · {semanticKinds[basis.relation]} · 决定 v{basis.decisionVersion}</summary>
 {status&&<p className={status.current?'m-note':'m-warning'}>{status.message}</p>}
 <p>原比较方向始终为左侧相对于右侧。本研究对应{sourceSide==='left'?'左':'右'}侧，目标研究对应{targetSide==='left'?'左':'右'}侧；需要另行确认研究之间的关系。</p>
 {[['source','本研究',sourceSide],['target','目标研究',targetSide]].map(([key,label,side])=><div key={key}><strong>{label}引用：{basis[key].title}</strong><p>{semanticScopeLabels[basis[key].contentScope]||'仅标题'} · 输入 v{basis[key].revision}</p><blockquote>{basis.comparison[side].quote}</blockquote><small>引用来自{basis.comparison[side].quoteField==='body'?'正文':'标题'}</small></div>)}
 <p>{basis.comparison.reason}</p><ul>{basis.comparison.missingEvidence.map((v,i)=><li key={i}>{v}</li>)}</ul><p>{basis.actor?.kind==='system'?'系统判断说明':'人工采纳说明'}：{basis.decisionNote} · {time(basis.decisionAt)}</p><small>模型 {basis.model} · 提示词 {basis.promptVersion||'旧版记录未提供'}<br/>比较 {basis.runId}<br/>输入指纹 {basis.inputHash}<br/>依据指纹 {basis.hash}</small>
 </details>;
}
