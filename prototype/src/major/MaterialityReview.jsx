import React from 'react';
const verdicts={consistent:'模型判断：口径一致',contradicted:'模型判断：存在冲突',unknown:'依据不足，保持未知',assumption:'人工假设，未作事实核验'};
export default function MaterialityReview({review,evidence=[]}){
 if(!review?.checks?.length)return null;
 return <section aria-label="模型量级口径核对"><h3>量级口径核对 · 模型候选</h3>
 <p className="m-note">按研究 v{review.topicVersion} 的输入逐值判断，未独立核实财务事实，也不修改公司量级表。后续研究变化不更新这份历史结果。</p>
 {review.checks.map(check=>{const target=review.targets.find(t=>t.id===check.targetId);return <article key={check.targetId}>
 <h4>{target?.company||target?.symbol} · {target?.metric} · {target?.valueLabel}</h4><p>{target?.value} {target?.unit} · {target?.scope} · {target?.period}</p>
 <strong>{verdicts[check.verdict]||'结果待核对'}</strong><p>{check.reason}</p>
 {check.citations.length>0&&<details><summary>核对所引原文 · {check.citations.length} 段</summary>{check.citations.map((c,i)=>{const source=evidence.find(e=>e.id===c.evidenceId);return <blockquote key={i}><p>{c.quote}</p><small>{source?.sourceName||'原材料引用'} · {c.field==='body'?'正文':'标题'}{source?.materialRevision?` · 材料 v${source.materialRevision}`:''}</small></blockquote>;})}</details>}
 </article>;})}</section>;
}
