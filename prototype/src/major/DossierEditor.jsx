import React,{useState} from 'react';
import {Button} from './Primitives';
const defaults=[['facts','事实与来源'],['impact','推论、公司影响与预期差'],['counter','反证与替代解释'],['conditions','观察条件、期限与无信号结论']];
export default function DossierEditor({topic,busy,mutate}){
 const [base,setBase]=useState(topic.version),[sections,setSections]=useState(()=>topic.dossier?.sections||defaults.map(([id,title])=>({id,title,paragraphs:[''],sourceIds:[]}))),[reason,setReason]=useState(''),[status,setStatus]=useState('draft'),[saved,setSaved]=useState(false);
 const edit=(i,patch)=>{setSections(old=>old.map((s,j)=>i===j?{...s,...patch}:s));setSaved(false);};
 return <form className="m-form" onSubmit={async e=>{e.preventDefault();const r=await mutate(`/api/research/${topic.id}/dossier`,'POST',{version:base,dossier:{sections,reviewStatus:status,revisionReason:reason}});if(r){setBase(r.research.topics.find(t=>t.id===topic.id).version);setSaved(true);}}}>
 <p>分别记录事实、推论与未知事项。完成表示本人核对了记录与引用，仍需观察结局；不会生成交易申请。</p>
 {base!==topic.version&&<p role="alert">研究已有新版本，输入保留；请先核对历史后重新打开编辑。</p>}
 {sections.map((s,i)=><fieldset key={s.id}><legend>{s.title}</legend><label>研判内容<textarea required maxLength={45000} rows={4} value={s.paragraphs.join('\n\n')} onChange={e=>edit(i,{paragraphs:e.target.value.split(/\n\s*\n/).filter(p=>p.trim())})}/></label><p>关联来源</p>{topic.evidence.map(ev=><label key={ev.id}><input type="checkbox" checked={s.sourceIds.includes(ev.id)} onChange={e=>edit(i,{sourceIds:e.target.checked?[...s.sourceIds,ev.id]:s.sourceIds.filter(id=>id!==ev.id)})}/>{ev.sourceName} · {ev.claim}</label>)}</fieldset>)}
 <label>本次修订原因<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><label>保存状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="draft">草稿，继续补充</option><option value="complete">本人完成核对</option></select></label><Button primary disabled={busy||base!==topic.version}>保存研判新版本</Button>{saved&&<p role="status">研判已保存为新版本。</p>}
 </form>;
}
