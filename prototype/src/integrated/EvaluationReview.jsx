import React,{useEffect,useState} from 'react';
import {Button,Modal} from '../major/Primitives';
import {request,time} from '../major/api';
import {evaluationVerdicts} from '../../shared/evaluation-review.mjs';
import {CLAIM_KINDS,OUTCOMES} from '../../shared/claims.mjs';
import './evaluation-review.css';
import ForwardEvaluations from './ForwardEvaluations';
import EventPrices from './EventPrices';
const pct=v=>v===null?'不可计算':`${(v*100).toFixed(1)}%`,score=v=>v===null?'不可计算':v.toFixed(4);
const localDate=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key))||{};}catch{return {};}};
const blank={verdict:'',clusterId:'',reviewer:'',exposure:'',reason:'',novelty:'',scale:'',mechanism:''};
function LabelForm({batch,sample,dataset,busy,onSave,onDirty}){
 const key=`signal.evaluation-label:${dataset}:${batch.id}:${sample.id}`,saved={...blank,...batch.labels[sample.id]},[draft,setDraft]=useState(()=>({...saved,...read(key)}));
 const dirty=Object.keys(blank).some(k=>(draft[k]||'')!==(saved[k]||''));
 useEffect(()=>{onDirty(dirty);try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{}},[draft,dirty,key]);
 const change=(k,v)=>setDraft(d=>({...d,[k]:v}));
 return <form className="m-form evaluation-label" onSubmit={async e=>{e.preventDefault();const b=await onSave({sampleId:sample.id,...Object.fromEntries(Object.keys(blank).map(k=>[k,draft[k]||'']))});if(b)setDraft({...blank,...b.labels[sample.id]});}}>
  <div className="evaluation-form-grid"><label>人工结论<select required value={draft.verdict} onChange={e=>change('verdict',e.target.value)}><option value="">请选择</option>{Object.entries(evaluationVerdicts).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>事件簇 ID（不确定留空）<input maxLength={100} pattern="(?:[A-Za-z0-9_]|-)*" value={draft.clusterId||''} onChange={e=>change('clusterId',e.target.value)} placeholder="例如 merger-company-a"/></label><label>评审者<input required maxLength={100} value={draft.reviewer} onChange={e=>change('reviewer',e.target.value)}/></label><label>此前是否见过规则结果<select required value={draft.exposure} onChange={e=>change('exposure',e.target.value)}><option value="">请选择</option><option value="already-seen">见过或不能确认未见过</option><option value="unseen-attested">我确认此前未看过规则结果</option></select></label></div>
  <p>同一交易、产品、政策或事故的后续报道使用相同事件簇；换新闻 ID 不代表新事件。隐藏规则不保证评审独立。</p>
  {[['novelty','信息新增量'],['scale','相对影响规模'],['mechanism','公司传导机制']].map(([k,label])=><label key={k}>{label}{draft.verdict==='major'?'（重大候选必填）':''}<textarea required={draft.verdict==='major'} maxLength={1200} value={draft[k]} onChange={e=>change(k,e.target.value)}/></label>)}
  <label>结论依据与不确定性<textarea required maxLength={1200} value={draft.reason} onChange={e=>change('reason',e.target.value)}/></label>
  <div className="evaluation-actions"><Button primary disabled={busy} type="submit">保存标签并检查下一条</Button>{dirty&&<Button disabled={busy} type="button" onClick={()=>setDraft(saved)}>放弃未保存标签改动</Button>}<small>{batch.labels[sample.id]?`已保存标签 v${batch.labels[sample.id].version}`:'尚未标注'}{dirty?' · 有未保存改动':''}</small></div>
 </form>;
}
function Report({report,samples,onExport,busy}){
 const m=report.screening,c=report.claims,titles=new Map(samples.map(s=>[s.id,s.input.title]));
 return <section aria-label="评估结果"><h3>已封存的描述统计</h3><p className="m-warning">回溯诊断，不是前向独立验证。统计只反映已保存样本；不能据此宣称完整新闻召回率、策略盈利或概率已校准。</p>
  <div className="evaluation-counts">{[['全部样本',m.total],['信息不足',m.unclear],['事件簇未确定',m.unknownCluster],['同簇后续样本',m.duplicateClusterSamples],['未见结果自述',m.unseenAttested],['已见或不能确认',m.alreadySeen]].map(([k,v])=><div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div>
  <div className="evaluation-table"><table><caption>规则以 review 为阳性；“普通资讯”是人工阴性，信息不足不算阴性</caption><thead><tr><th>统计口径</th><th>明确标签数</th><th>正确提升 / 误提升 / 漏提 / 正确未提</th><th>精确率</th><th>本样本集召回率</th></tr></thead><tbody>{[['逐条标题（可能相关）',m.raw],['每簇最早判断代表',m.clusterRepresentatives]].map(([k,v])=><tr key={k}><th>{k}</th><td>{v.n}</td><td>{v.tp} / {v.fp} / {v.fn} / {v.tn}</td><td>{pct(v.precision)}</td><td>{pct(v.recallWithinCohort)}</td></tr>)}</tbody></table></div>
  <p>规则结果未知 {m.unknownPrediction} 条，不当作阴性。人工标注 {m.clusterCount} 个事件簇，其中 {m.clusterUnclear} 个最早代表标签仍不明确。代表按判断时间、样本 ID 固定选择，不挑选表现较好的后续修订。</p>
  <h3>冻结时的全部研究主张 · 与标题窗口分开统计</h3><p>共 {c.total} 个主张，{c.matureBinary} 个具有有效二元结局，{c.unscored} 个没有可评分概率。Brier 为概率与二元结局的平方误差均值，越低越好；它不是胜率。结局时间取人工登记记录，尚未核验事件实际发生时间；这些分数不能作为前向预测有效的证明。</p>
  <div className="evaluation-table"><table><thead><tr><th>概率版本</th><th>样本数</th><th>Brier</th></tr></thead><tbody><tr><th>首次记录概率</th><td>{c.first.n}</td><td>{score(c.first.brier)}</td></tr><tr><th>结局前最后一次概率</th><td>{c.last.n}</td><td>{score(c.last.brier)}</td></tr><tr><th>同一批可配对主张</th><td>{c.paired.n}</td><td>{score(c.paired.first)} → {score(c.paired.last)}</td></tr></tbody></table></div>
  <details><summary>概率分箱与逐条排除原因</summary><div className="evaluation-table"><table><thead><tr><th>首次概率区间</th><th>样本数</th><th>平均预测</th><th>实际兑现比例</th></tr></thead><tbody>{c.first.bins.map(b=><tr key={b.lower}><th>{pct(b.lower)}–{pct(b.upper)}</th><td>{b.n}</td><td>{pct(b.meanProbability)}</td><td>{pct(b.observedFrequency)}</td></tr>)}</tbody></table></div><p>区间左闭右开，最后一区间包含 100%；小样本频率不代表已校准。</p>{c.cases.map(x=><article key={`${x.topicId}:${x.claimId}`} className="evaluation-case"><strong>{x.claim}</strong><p>{CLAIM_KINDS[x.kind]||x.kind} · {OUTCOMES[x.outcome]||x.outcome}<br/>首次概率 {x.first===null?'无可评分记录':`${x.first}%`} · 结局前最后概率 {x.last===null?'无可评分记录':`${x.last}%`}<br/>{x.reason||'纳入描述统计；仍需核验结局与事件独立性'}</p></article>)}</details>
  <details><summary>逐条核对规则与人工结论</summary>{m.rows.map(r=><article key={r.sampleId} className="evaluation-case"><strong>{titles.get(r.sampleId)||r.newsId}</strong><p>规则：{r.predicted===null?'未知':r.predicted?'提升复核':'未提升'} · 人工：{evaluationVerdicts[r.label]||'未标注'} · 事件簇：{r.clusterId||'未确定'}</p><p>{report.labelSnapshot[r.sampleId]?.reason}</p></article>)}</details>
  <p>原报告冻结时：{report.priceChanges.reason}。{report.trading.reason}。</p><p>封存 {time(report.sealedAt)} · 指标 {report.metricsVersion}<br/>报告指纹 {report.sha256}</p>
  <Button disabled={busy} onClick={onExport}>导出到本机（含冻结输入与标注）</Button>
 </section>;
}
export default function EvaluationReview({data,onClose}){
 const dataset=data?.runtime?.instance?.id||'unknown',key=`signal.evaluation-create:${dataset}`;
 const [forwardOpen,setForwardOpen]=useState(false);
 const [catalog,setCatalog]=useState(null),[batch,setBatch]=useState(null),[sampleId,setSampleId]=useState(''),[draft,setDraft]=useState(()=>({title:'',start:localDate(new Date(Date.now()-7*86400000)),end:localDate(new Date()),...read(key)})),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[confirm,setConfirm]=useState(false);
 useEffect(()=>{let live=true;request('/api/evaluations').then(r=>{if(live)setCatalog(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{}},[key,draft]);
 async function choose(id){setBusy(true);setError('');try{const b=await request(`/api/evaluations/${id}`);setBatch(b);setSampleId(b.samples.find(s=>!b.labels[s.id])?.id||b.samples[0]?.id||'');setConfirm(false);setDirty(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function mutate(path,payload){setBusy(true);setError('');try{const b=await request(`/api/evaluations${path}`,'POST',{requestId:crypto.randomUUID(),version:batch?.version||0,...payload});setBatch(b);setCatalog(await request('/api/evaluations'));setConfirm(false);setDirty(false);return b;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
 async function create(e){e.preventDefault();try{const b=await mutate('',{version:0,title:draft.title,start:new Date(draft.start).toISOString(),end:new Date(draft.end).toISOString(),rulesHash:draft.rulesHash||catalog.rules[0]?.hash});if(b)setSampleId(b.samples[0]?.id||'');}catch(e){setError(e.message);}}
 async function annotate(label){const b=await mutate(`/${batch.id}/annotate`,{label});if(b)setSampleId(b.samples.find(s=>!b.labels[s.id])?.id||label.sampleId);return b;}
 async function download(){setBusy(true);setError('');try{const doc=await request(`/api/evaluations/${batch.id}/export`),blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`evaluation-${batch.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const sample=batch?.samples.find(s=>s.id===sampleId),change=(k,v)=>setDraft(d=>({...d,[k]:v}));
 return <Modal title="研究评估 · 冻结样本与人工标注" onClose={onClose}><section className="evaluation-review" aria-label="研究评估">
  <p>完整冻结时间窗中的全部初筛层级，先标注、后揭示规则结果。新闻数量不等于独立事件数；当前用于诊断改进，不自动调参或批准交易。</p>{error&&<p role="alert" className="m-warning">{error}</p>}
  <details onToggle={e=>{if(e.currentTarget.open)setForwardOpen(true);}}><summary>前向调用档案 · 基线与版本</summary>{forwardOpen&&<ForwardEvaluations/>}</details>
  <details open={!batch}><summary>建立新的评估批次</summary><form className="m-form" onSubmit={create}><div className="evaluation-form-grid"><label>批次名称<input required maxLength={100} value={draft.title} onChange={e=>change('title',e.target.value)}/></label><label>冻结的初筛规则<select required value={draft.rulesHash||catalog?.rules[0]?.hash||''} onChange={e=>change('rulesHash',e.target.value)}>{catalog?.rules.map(r=><option key={r.hash} value={r.hash}>{r.hash.slice(0,12)} · {time(r.activated_at)}</option>)}</select></label><label>判断窗口起点（本机时间）<input type="datetime-local" required value={draft.start} onChange={e=>change('start',e.target.value)}/></label><label>窗口终点（不含，本机时间）<input type="datetime-local" required value={draft.end} onChange={e=>change('end',e.target.value)}/></label></div><p>冻结后不追加新新闻，也不按结果挑选样本。最多 5000 条，超过时需缩短窗口，不能静默截取。</p><Button primary type="submit" disabled={busy||!catalog?.rules.length}>冻结整批样本</Button></form></details>
  <div className="evaluation-actions" aria-label="评估批次列表">{catalog?.batches.map(b=><Button key={b.id} disabled={busy} primary={batch?.id===b.id} onClick={()=>choose(b.id)}>{b.title} · {b.reviewed}/{b.total} · {b.state==='sealed'?'已封存':'标注中'}</Button>)}</div>
  {batch&&<><h3>{batch.title}</h3><p>{time(batch.start)} ≤ 判断时间 &lt; {time(batch.end)} · 冻结 {time(batch.frozenAt)} · v{batch.version}<br/>输入指纹 {batch.inputHash}</p>
   {batch.state==='sealed'?<><Report report={batch.report} samples={batch.samples} busy={busy} onExport={download}/><EventPrices key={batch.id} batchId={batch.id}/></>:<>
    <div className="evaluation-workspace"><div className="evaluation-samples" aria-label="评估样本列表">{batch.samples.map((s,i)=><button key={s.id} disabled={busy} aria-pressed={sampleId===s.id} onClick={()=>{setSampleId(s.id);setDirty(false);}}>{i+1}. {s.input.title}<small>{batch.labels[s.id]?evaluationVerdicts[batch.labels[s.id].verdict]:'待标注'} · 修订 {s.input.revision}</small></button>)}</div>
     {sample&&<article><h3>{sample.input.title}</h3><p>{sample.input.publisher} · 发布 {time(sample.input.publishedAt)}<br/>首次获取 {time(sample.input.firstSeen)} · 本版可用 {time(sample.input.availableAt)}<br/>仅有冻结标题；缺少足够上下文时选择信息不足。</p><p>规则判断暂不展示，封存全部标签后才揭示。</p><LabelForm key={`${batch.id}:${sample.id}`} batch={batch} sample={sample} dataset={dataset} busy={busy} onSave={annotate} onDirty={setDirty}/></article>}
    </div><div className="evaluation-seal"><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>我已核对全部标签；封存后不得改写，可另建批次保留更正</label><Button primary disabled={busy||dirty||!confirm||batch.reviewed!==batch.total} onClick={()=>mutate(`/${batch.id}/seal`,{confirm:true})}>封存标签并揭示统计</Button><p>已标注 {batch.reviewed}/{batch.total}{dirty?' · 请先保存或放弃当前标签改动':''}</p></div>
   </>}
  </>}
 </section></Modal>;
}
