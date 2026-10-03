import React from 'react';
import useEditorDraft from './useEditorDraft';
import {Button} from './Primitives';
import {time} from './api';
import {CLAIM_STATES} from '../../shared/uncertainty.mjs';
import {claimsOf,CLAIM_KINDS,OUTCOMES,assessmentFields} from '../../shared/claims.mjs';
const empty=()=>({kind:'outcome',status:'unverified',claim:'',probability:null,basis:'',impactIfTrue:'',impactIfFalse:'',horizon:'',resolveBy:'',outcome:'open',evidenceIds:[],resolutionReason:'',revisionReason:''});
const validDraft=v=>v&&typeof v.editing==='string'&&v.form&&['kind','status','claim','basis','impactIfTrue','impactIfFalse','horizon','resolveBy','outcome','resolutionReason','revisionReason'].every(k=>typeof v.form[k]==='string')&&(v.form.probability===null||Number.isFinite(v.form.probability))&&Array.isArray(v.form.evidenceIds)&&v.form.evidenceIds.every(id=>typeof id==='string');
function ClaimForm({topic,claim,busy,mutate,onDone,form,base,onChange,onSave,volatile}){
 const update=(k,v)=>onChange({...form,[k]:v});
 return <form className="m-form v8-claim-form" onSubmit={async e=>{e.preventDefault();if(busy||base!==topic.version)return;const result=await mutate(`/api/research/${topic.id}/claims`,'POST',{version:base,claim:form});if(result)onSave(result);}}>
 <p>未保存主张保留在本浏览器标签页，切换页面或刷新后可恢复；尚未写入研究库。</p>{volatile&&<p role="alert">会话存储不可用，草稿仅保留到页面关闭，请及时保存。</p>}<fieldset className="m-editor-fields" disabled={busy}>{claim&&<p className="m-note">命题、类型和期限已冻结；这里修订概率、依据或结局。更换问题请返回“新增独立主张”，旧预测继续保留。</p>}<div className="m-form-row"><label>主张类型<select aria-label="主张类型" disabled={!!claim} value={form.kind} onChange={e=>update('kind',e.target.value)}>{Object.entries(CLAIM_KINDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>消息状态<select aria-label="消息状态" value={form.status} onChange={e=>update('status',e.target.value)}>{Object.entries(CLAIM_STATES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
 <label>可检验的具体主张<textarea required rows={2} maxLength={2000} readOnly={!!claim} value={form.claim} onChange={e=>update('claim',e.target.value)}/></label>
 <div className="m-form-row"><label>本主张概率（%）<input type="number" min="0" max="100" step="1" value={form.probability??''} placeholder="待评估" onChange={e=>update('probability',e.target.value===''?null:Number(e.target.value))}/></label><label>检验截止日<input type="date" required={form.probability!==null} readOnly={!!claim} value={form.resolveBy} onChange={e=>update('resolveBy',e.target.value)}/></label></div>
 {[['basis','概率依据与反证'],['impactIfTrue','若属实：公司影响'],['impactIfFalse','若未兑现：风险与损失'],['horizon','影响期限与观察点'],['revisionReason','本次新增或修订原因']].map(([k,l])=><label key={k}>{l}<textarea rows={2} maxLength={2000} required={k==='revisionReason'||form.probability!==null&&k!=='horizon'} value={form[k]} onChange={e=>update(k,e.target.value)}/></label>)}
 <fieldset><legend>关联依据（选取本事件已有证据）</legend>{topic.evidence.length?topic.evidence.map(e=><label className="v8-evidence-choice" key={e.id}><input type="checkbox" checked={form.evidenceIds.includes(e.id)} onChange={x=>update('evidenceIds',x.target.checked?[...form.evidenceIds,e.id]:form.evidenceIds.filter(id=>id!==e.id))}/><span>{e.claim}<small>{e.sourceName}</small></span></label>):<p>尚无线索，先补充来源后再判定结局。</p>}</fieldset>
 <div className="m-form-row"><label>结局标注<select aria-label="结局标注" value={form.outcome} onChange={e=>update('outcome',e.target.value)}>{Object.entries(OUTCOMES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>结局依据 / 未解决原因<textarea rows={2} required={form.outcome!=='open'} maxLength={2000} value={form.resolutionReason} onChange={e=>update('resolutionReason',e.target.value)}/></label></div>
 <p className="m-note">到期无消息仍可记“未解决”。结局不自动将历史概率改为 0 或 100；各主张互不替代，研究保存不产生交易。</p>
 {base!==topic.version&&<p className="m-warning">研究已有新版本，草稿仍保留。请先对照历史；丢弃草稿后再按最新版本编辑。</p>}
 <div className="m-form-actions"><Button type="button" onClick={onDone}>丢弃主张草稿</Button><Button primary disabled={busy||base!==topic.version}>保存主张版本</Button></div>
 </fieldset></form>;
}
export default function ClaimsEditor({topic,busy,mutate}){
 const {draft,change,reset,ack}=useEditorDraft(topic,'claims',()=>({editing:null,form:null}),validDraft),{editing,form}=draft.value,claims=claimsOf(topic);
 const begin=c=>change({editing:c?.id||'new',form:c?{...assessmentFields(c),id:c.id,kind:c.kind,outcome:c.outcome,evidenceIds:c.evidenceIds,resolutionReason:c.resolutionReason,revisionReason:''}:empty()},topic.version);
 return <div className="v8-claims"><p className="m-note">事实、事件兑现、盈利影响与价格假设分别评估。传闻不单独阻止模拟申请；所有概率是各自主张的主观估计，未经校准。</p>
 {claims.map((c,i)=><article className="v8-claim-card" key={c.id}><header><b>{CLAIM_KINDS[c.kind]}{i===0?' · 核心主张':''}</b><strong>{c.probability==null?'待估计':`${c.probability}%`}</strong><Button onClick={()=>begin(c)} disabled={editing!==null}>修订</Button></header><p>{c.claim}</p><div className="v8-claim-meta"><span>{CLAIM_STATES[c.status]}</span><span>{OUTCOMES[c.outcome]}</span><span>截至 {c.resolveBy||'待定义'}</span><span>评估 {time(c.assessedAt)}</span></div><details><summary>依据、条件影响与引用 {c.evidenceIds.length}</summary><p>{c.basis||'待补依据'}</p><p>若属实：{c.impactIfTrue||'待补'}</p><p>若未兑现：{c.impactIfFalse||'待补'}</p>{c.evidenceIds.map(id=>{const e=topic.evidence.find(e=>e.id===id);return e&&<p key={id}><a href={e.url||undefined} target="_blank" rel="noreferrer">{e.sourceName}</a> · {e.claim}</p>;})}<p>{c.resolutionReason}</p></details></article>)}
 {editing===null?<Button primary onClick={()=>begin(null)}>＋ 新增独立主张</Button>:<ClaimForm key={editing} topic={topic} claim={claims.find(c=>c.id===editing)} busy={busy} mutate={mutate} form={form} base={draft.base} volatile={draft.volatile} onChange={form=>change({...draft.value,form})} onDone={()=>reset()} onSave={result=>ack(draft,{editing:null,form:null},result.research.topics.find(t=>t.id===topic.id).version)}/>}
 </div>;
}
