import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time,currentInstanceId} from '../major/api';
import {evaluationVerdicts} from '../../shared/evaluation-review.mjs';
import {OUTCOMES} from '../../shared/claims.mjs';
import {clusterReviews} from '../../shared/forward-review.mjs';
const labelBlank={verdict:'unclear',exposure:'already-seen',reviewer:'',reason:'',novelty:'',scale:'',mechanism:'',clusterVerdict:'uncertain',clusterReason:'',revisionReason:''};
const pick=(value,fields)=>Object.fromEntries(fields.map(k=>[k,value[k]??'']));
const localDate=value=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,-1);};
const cleanEvidence=e=>pick(e,['ref','hash','quote','quoteField']);
function Form({review,kind,claim,inputs,busy,onSave}){
 const initial=()=>kind==='label'?{...labelBlank,...(review.label?pick(review.label,Object.keys(labelBlank)):{}),revisionReason:''}:{claimId:claim.id,outcome:claim.resolution?.outcome||'unresolved',eventAt:localDate(claim.resolution?.eventAt),reason:claim.resolution?.reason||'',reviewer:claim.resolution?.reviewer||'',revisionReason:'',evidence:claim.resolution?.evidence.map(cleanEvidence)||[]};
 const key=`signal.forward-review:${currentInstanceId()}:${review.runId}:${kind}:${claim?.id||''}`;
 const [draft,setDraft]=useState(()=>{try{const saved=JSON.parse(sessionStorage.getItem(key));if(saved?.value&&Number.isSafeInteger(saved.version))return saved;}catch{}return {version:review.version,value:initial()};}),[selected,setSelected]=useState('');
 useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{}},[key,draft]);
 const value=draft.value,stale=draft.version!==review.version,change=(k,v)=>setDraft(d=>({...d,value:{...d.value,[k]:v}}));
 const available=[...inputs.items,...(claim?.resolution?.evidence||[])],fields=kind==='label'?[['reason','复核依据'],['clusterReason','事件簇核对依据'],['novelty','信息新增量'],['scale','相对影响规模'],['mechanism','公司传导机制'],['revisionReason','本次新增或更正原因']]:[['reason','结局依据与不确定性'],['revisionReason','本次新增或更正原因']];
 async function submit(e){e.preventDefault();if(stale)return;const next={...value};if(kind==='outcome')next.eventAt=value.eventAt?new Date(value.eventAt).toISOString():null;const saved=await onSave(kind,{version:draft.version,value:next});if(saved)setDraft({version:saved.version,value:{...value,revisionReason:''}});}
 return <form className="m-form" onSubmit={submit} aria-label={kind==='label'?'前向标签表单':'冻结主张结局表单'}>
  {stale&&<p role="alert" className="m-warning">复核档案已更新，草稿保留。请先核对新版，再放弃旧草稿并重新编辑。</p>}
  <Button type="button" disabled={busy} onClick={()=>setDraft({version:review.version,value:initial()})}>放弃草稿并载入当前版本</Button>
  <fieldset disabled={busy||stale}>
   <label>评审者<input required maxLength={100} value={value.reviewer} onChange={e=>change('reviewer',e.target.value)}/></label>
   {kind==='label'?<><label>重大性结论<select value={value.verdict} onChange={e=>change('verdict',e.target.value)}>{Object.entries(evaluationVerdicts).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>是否见过模型结果<select value={value.exposure} onChange={e=>change('exposure',e.target.value)}><option value="already-seen">见过或不能确认</option><option value="unseen-attested">自述未见过结果（不证明独立）</option></select></label><label>事件簇核对<select value={value.clusterVerdict} onChange={e=>change('clusterVerdict',e.target.value)}>{Object.entries(clusterReviews).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></>:<>
    <p>冻结主张：{claim.claim}<br/>检验截止日 {claim.resolveBy||'未知'} · 冻结概率 {claim.probability===null?'未估计':`${claim.probability}%`}（研究者主观判断）</p>
    <label>结局状态<select value={value.outcome} onChange={e=>{change('outcome',e.target.value);if(['open','unresolved'].includes(e.target.value))change('eventAt','');}}>{Object.entries(OUTCOMES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>实际事件时点（本机时间；未知留空）<input type="datetime-local" step="any" disabled={['open','unresolved'].includes(value.outcome)} value={value.eventAt} onChange={e=>change('eventAt',e.target.value)}/></label>
    <p>登记时间由服务端保存。事件时点和引文仍需独立核验；未知时点、部分兑现与未解决不会强填成败。</p>
    <label>选择当前研究已关联的结局材料<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择</option>{inputs.items.map(s=><option key={s.hash} value={s.hash}>{s.snapshot.title} · 修订 {s.ref.revision}</option>)}</select></label>
    <Button type="button" disabled={!selected||value.evidence.length>=8||value.evidence.some(e=>e.hash===selected)} onClick={()=>{const s=inputs.items.find(s=>s.hash===selected);if(s)change('evidence',[...value.evidence,{ref:s.ref,hash:s.hash,quote:'',quoteField:'title'}]);}}>加入结局引用</Button>
    {!inputs.items.length&&<p>暂无可引用材料。先在原研究中保存结局新闻或正文，再刷新本档案；不会改动原调用输入。</p>}
    {inputs.unavailable.length>0&&<p>有 {inputs.unavailable.length} 份关联材料无法核实，未提供给引用选择。</p>}
    {value.evidence.map((e,i)=>{const source=available.find(s=>s.hash===e.hash)?.snapshot;return <div className="evaluation-case" key={e.hash}><strong>{source?.title||e.ref.id} · 修订 {e.ref.revision}</strong><details><summary>查看保存的原文</summary><p>{source?.title}</p><pre>{source?.body||'仅保存新闻标题'}</pre></details><label>引文字段<select value={e.quoteField} onChange={event=>change('evidence',value.evidence.map((x,n)=>n===i?{...x,quoteField:event.target.value}:x))}><option value="title">标题</option>{e.ref.kind==='material'&&<option value="body">正文</option>}</select></label><label>逐字引文<textarea required maxLength={2000} value={e.quote} onChange={event=>change('evidence',value.evidence.map((x,n)=>n===i?{...x,quote:event.target.value}:x))}/></label><Button type="button" onClick={()=>change('evidence',value.evidence.filter((_,n)=>n!==i))}>移除此引用</Button></div>;})}
   </>}
   {fields.map(([k,title])=><label key={k}>{title}<textarea required={kind==='outcome'||!['novelty','scale','mechanism'].includes(k)||value.verdict==='major'} maxLength={1200} value={value[k]} onChange={e=>change(k,e.target.value)}/></label>)}
   <Button primary type="submit">保存为新复核版本</Button>
  </fieldset>
 </form>;
}
function Review({runId}){
 const [review,setReview]=useState(null),[inputs,setInputs]=useState({items:[],unavailable:[]}),[mode,setMode]=useState('label'),[claimId,setClaimId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const live=useRef(true),lock=useRef(false),pending=useRef(null);
 const path=`/api/forward-evaluations/records/${runId}`;
 async function perform(fn){if(lock.current)return null;lock.current=true;setBusy(true);setError('');try{return await fn();}catch(e){if(live.current)setError(e.message);return null;}finally{lock.current=false;if(live.current)setBusy(false);}}
 async function refresh(){return perform(async()=>{const [r,i]=await Promise.all([request(path+'/review'),request(path+'/review-inputs')]);if(live.current){setReview(r);setInputs(i);setClaimId(id=>id||r.claims[0]?.id||'');}});}
 useEffect(()=>{live.current=true;refresh();return()=>{live.current=false;};},[runId]);
 async function save(kind,data){return perform(async()=>{const fingerprint=JSON.stringify({kind,data});if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,payload:{...data,requestId:crypto.randomUUID()}};const r=await request(path+'/'+kind,'POST',pending.current.payload);if(live.current){setReview(r);pending.current=null;}return r;});}
 const claim=review?.claims.find(c=>c.id===claimId);
 return <section aria-label="前向复核与结局"><h4>复核与结局 · 保留每次更正</h4><p>此处不展示五章模型正文，但其他页面可能展示过。未见结果仅为自述，不认定评审独立。</p>{error&&<p role="alert" className="m-warning">{error}</p>}<Button disabled={busy} onClick={refresh}>刷新复核档案</Button>
  {review?<><p>已保存 {review.version} 个复核版本 · {review.independence}</p><div className="evaluation-actions"><Button disabled={busy} primary={mode==='label'} onClick={()=>setMode('label')}>重大性与簇复核</Button><Button disabled={busy||!review.claims.length} primary={mode==='outcome'} onClick={()=>setMode('outcome')}>冻结主张的结局</Button></div>
   {!review.claims.length&&<p>原调用未冻结任何主张；不能事后补造预测。新主张只进入以后的调用。</p>}
   {mode==='outcome'&&<label>选择冻结主张<select disabled={busy} value={claimId} onChange={e=>setClaimId(e.target.value)}>{review.claims.map(c=><option key={c.id} value={c.id}>{c.claim} · {OUTCOMES[c.resolution?.outcome]||'未登记'}</option>)}</select></label>}
   {(mode==='label'||claim)&&<Form key={`${runId}:${mode}:${mode==='outcome'?claimId:''}`} review={review} kind={mode==='label'?'label':'outcome'} claim={claim} inputs={inputs} busy={busy} onSave={save}/>}
   <details><summary>历史复核与冻结概率的描述误差</summary>{review.history.map(h=><article className="evaluation-case" key={h.version}><strong>v{h.version} · {h.kind==='label'?evaluationVerdicts[h.value.verdict]:OUTCOMES[h.value.outcome]}</strong><p>{h.value.reviewer} · {time(h.at)}<br/>{h.value.reason}<br/>本次原因：{h.value.revisionReason}</p>{h.value.evidence?.map(e=><p key={e.hash}>{e.snapshot.title} · 修订 {e.ref.revision}<br/>“{e.quote}”</p>)}</article>)}{review.claims.map(c=><p key={c.id}>{c.claim}：{c.score===null?c.scoringReasons.join('；'):`单条平方误差 ${c.score.toFixed(4)}（描述值，不是模型准确率或胜率）`}</p>)}</details>
  </>:<p role="status">{error?'档案未加载，请刷新重试。':'正在读取复核档案…'}</p>}
 </section>;
}

export default function ForwardReview({runId}){
 const [opened,setOpened]=useState(false);
 return <details onToggle={e=>{if(e.currentTarget.open)setOpened(true);}}><summary>登记复核标签与主张结局</summary>{opened&&<Review key={runId} runId={runId}/>}</details>;
}
