import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {currentInstanceId} from './api';
import {dossierDraftKey,readLegacyDossierDraft,readDossierDraft,persistDossierDraft,subscribeDossierDraft,acknowledgeDossierSave} from './dossier-drafts';
const defaults=[['facts','事实与来源'],['impact','推论、公司影响与预期差'],['counter','反证与替代解释'],['conditions','观察条件、期限与无信号结论']];
const storage=()=>{try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}};
export default function DossierEditor(props){
 const key=dossierDraftKey(props.topic,currentInstanceId());
 return <DossierForm key={key} draftKey={key} {...props}/>;
}
function DossierForm({topic,busy,mutate,draftKey:key}){
 const [legacy]=useState(()=>readLegacyDossierDraft(topic,storage()));
 const initial=()=>({base:topic.version,sections:topic.dossier?.sections||defaults.map(([id,title])=>({id,title,paragraphs:[''],sourceIds:[]})),reason:'',status:'draft'});
 const [draft,setDraft]=useState(()=>readDossierDraft(key,initial(),storage())),[saved,setSaved]=useState(false),[volatile,setVolatile]=useState(false);
 useEffect(()=>subscribeDossierDraft(key,result=>{setDraft(result.draft);setSaved(result.saved);setVolatile(result.volatile);}),[key]);
 const submitting=useRef(false);
 const {base,sections,reason,status}=draft;
 const change=patch=>{const result=persistDossierDraft(key,{...draft,...patch},storage());setDraft(result.draft);setVolatile(result.volatile);setSaved(false);};
 const edit=(i,patch)=>change({sections:sections.map((s,j)=>i===j?{...s,...patch}:s)});
 const currentDirty=draft.generation>0&&saved!==true;
 return <form className="m-form" onSubmit={async e=>{
  e.preventDefault();
  if(busy||base!==topic.version||submitting.current)return;
  submitting.current=true;
  const submitted=draft;
  try{
   const r=await mutate(`/api/research/${topic.id}/dossier`,'POST',{version:base,dossier:{sections,reviewStatus:status,revisionReason:reason}});
   if(r)acknowledgeDossierSave(key,submitted,r.research.topics.find(t=>t.id===topic.id).version,storage());
  }finally{submitting.current=false;}
 }}>
 <p>分别记录事实、推论与未知事项。完成表示本人核对了记录与引用，仍需观察结局；不会生成交易申请。未保存输入保留在本浏览器标签页，切换历史或研究后可恢复。</p>
 {legacy&&<aside aria-label="旧版研判草稿" style={{overflowWrap:'anywhere',minWidth:0}}>
  <p>发现未标记数据集的旧版研判草稿。原件仍保留，不会自动填入当前研究；请先核对内容和所属数据集。</p>
  {legacy.invalid?<p role="alert">旧版草稿内容无法读取。原始记录未删除，也未覆盖当前内容。</p>:<>
   <details><summary>查看未归属的旧版草稿</summary><p>原基础版本 v{legacy.draft.base} · {legacy.draft.status==='complete'?'拟保存为本人完成核对':'草稿'}</p>{legacy.draft.sections.map((s,i)=><section key={i}><h4>{s.title}</h4>{s.paragraphs.map((p,j)=><p key={j}>{p}</p>)}{s.sourceIds.length>0&&<p>原引用：{s.sourceIds.join('、')}</p>}</section>)}<p>原修订原因：{legacy.draft.reason}</p></details>
   {currentDirty&&<p>当前已有未保存草稿。可先保存当前输入，或从旧版预览手动复制所需内容；不会覆盖当前草稿。</p>}
   <Button type="button" disabled={busy||currentDirty} onClick={()=>{if(!busy&&!currentDirty)change({base:legacy.draft.base,sections:legacy.draft.sections,reason:legacy.draft.reason,status:legacy.draft.status});}}>已确认属于当前研究，载入旧版草稿</Button>
  </>}
 </aside>}
 {volatile&&<p role="alert">浏览器会话存储不可用，草稿仅保留到页面关闭。请及时保存到研究库。</p>}
 {base!==topic.version&&<div role="alert"><p>研究已有新版本，原草稿仍保留。先查看历史与当前研判；核对后可保留草稿并使用当前版本继续保存。</p><Button type="button" disabled={busy} onClick={()=>change({base:topic.version})}>已核对更新，保留草稿继续编辑</Button></div>}
 {sections.map((s,i)=><fieldset key={s.id}><legend>{s.title}</legend><label>研判内容<textarea required={status==='complete'} maxLength={45000} rows={4} value={s.paragraphs.join('\n\n')} onChange={e=>edit(i,{paragraphs:e.target.value.split(/\n\s*\n/).filter(p=>p.trim())})}/></label><p>关联来源</p>{topic.evidence.map(ev=><label key={ev.id}><input type="checkbox" checked={s.sourceIds.includes(ev.id)} onChange={e=>edit(i,{sourceIds:e.target.checked?[...s.sourceIds,ev.id]:s.sourceIds.filter(id=>id!==ev.id)})}/>{ev.sourceName} · {ev.claim}</label>)}{s.sourceIds.filter(id=>!topic.evidence.some(ev=>ev.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>edit(i,{sourceIds:s.sourceIds.filter(sourceId=>sourceId!==id)})}/>来源记录已缺失：{id}；取消勾选可移除此引用</label>)}</fieldset>)}
 <label>本次修订原因<input required maxLength={1000} value={reason} onChange={e=>change({reason:e.target.value})}/></label><label>保存状态<select value={status} onChange={e=>change({status:e.target.value})}><option value="draft">草稿，继续补充</option><option value="complete">本人完成核对</option></select></label><Button type="submit" primary disabled={busy||base!==topic.version}>保存研判新版本</Button>{saved===true&&<p role="status">研判已保存为新版本。</p>}{saved==='newer-edits'&&<p role="status">提交版本已保存；保存期间新增的输入仍为未保存草稿。</p>}
 </form>;
}
