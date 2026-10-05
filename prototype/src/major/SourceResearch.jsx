import SourceMaterial from './SourceMaterial';
import useEditorDraft from './useEditorDraft';
import CompanyEntities from './CompanyEntities';
import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {EvidenceFields} from './ResearchForms';
import {request,time,currentInstanceId} from './api';
import ModelResearch from './ModelResearch';
import MaterialEvents,{EventTime} from './MaterialEvents';
import './research-materials.css';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sourceUrl=value=>{if(!value)return '';const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('材料来源需为无凭据的 HTTPS 链接');u.hash='';return u.href;};
const sameEvidence=(m,e)=>m?.id===e.materialId&&m.evidenceId===e.id&&m.revision===e.materialRevision&&m.title===e.claim&&m.sourceName===e.sourceName&&m.url===e.url&&m.scope===e.contentScope&&m.publishedAt===e.publishedAt&&m.stance===e.stance&&m.interpretation===e.interpretation&&m.verification===e.verification;
function checkedList(value,topic){
 const expected=topic.evidence.filter(e=>e.materialId);
 if(!Array.isArray(value?.materials)||!Array.isArray(value?.attempts)||value.materials.length!==expected.length||new Set(value.materials.map(m=>m?.id)).size!==expected.length||value.materials.some(m=>!hash(m?.id)||!hash(m.contentHash)||!hash(m.documentId)||!Number.isSafeInteger(m.revision)||m.revision<1||!expected.some(e=>sameEvidence(m,e)))||value.attempts.some(a=>!a||!['saved','failed'].includes(a.state)||typeof a.url!=='string'||typeof a.at!=='string'||(a.state==='failed'&&typeof a.error!=='string')))throw Error('未能核对材料记录，请刷新材料记录后重试');
 return {...value,topicId:topic.id};
}
async function checkedSave(result,topic,submitted){
 const saved=result?.research?.topics?.find(t=>t.id===topic.id),{mode,form}=submitted.value;
 if(!saved||saved.createdAt!==topic.createdAt||!Array.isArray(saved.evidence)||![submitted.base,submitted.base+1].includes(saved.version))throw Error('未能核对材料保存；输入仍保留，请刷新材料记录并核对研究版本');
 const url=sourceUrl(form.url),oldIds=new Set(topic.evidence.filter(e=>e.materialId).map(e=>e.materialId));
 const matches=saved.evidence.filter(e=>e.materialId&&e.stance===form.stance&&e.family===form.family&&e.step===form.step&&e.interpretation===form.interpretation.trim()&&(mode==='manual'?e.claim===form.title.trim()&&e.sourceName===form.sourceName.trim()&&e.url===url&&e.contentScope===form.scope&&e.publishedAt===(form.publishedAt||null):e.contentScope==='extracted-text'&&(!oldIds.has(e.materialId)||e.url===url)));
 if(matches.length!==1||saved.version!==submitted.base+(oldIds.has(matches[0].materialId)?0:1)||!topic.evidence.filter(e=>e.materialId).every(e=>saved.evidence.some(v=>v.materialId===e.materialId&&v.materialRevision===e.materialRevision)))throw Error('未能核对材料保存；输入仍保留，请刷新材料记录并核对研究版本');
 const e=matches[0],m=await request(`/api/research/${topic.id}/materials/${e.materialId}`);
 if(!hash(m?.id)||!hash(m.contentHash)||!hash(m.documentId)||m.id!==e.materialId||m.revision!==e.materialRevision||m.title!==e.claim||m.sourceName!==e.sourceName||m.url!==e.url||m.publishedAt!==e.publishedAt||m.scope!==e.contentScope||typeof m.body!=='string'||!m.body.trim()||m.body.length>80000||m.method!==(mode==='web'?'public-web':'manual')||(mode==='manual'&&m.body!==form.body.trim()))throw Error('未能核对材料保存；输入仍保留，请刷新材料记录并核对研究版本');
 return saved;
}
export default function SourceResearch(props){
 const instance=props.instanceId??currentInstanceId();
 return <SourceResearchBody key={JSON.stringify([instance,props.topic.id,props.topic.createdAt||''])} {...props} instance={instance}/>;
}
function SourceResearchBody({topic,busy,mutate,instance}){
 const initial=()=>({mode:'manual',form:{url:'',title:'',sourceName:'',publishedAt:'',body:'',scope:'excerpt',stance:'unverified',family:'other',step:topic.chain[0]?.id||'',interpretation:''}});
 const editor=useEditorDraft(topic,'source-material',initial,v=>v&&['manual','web'].includes(v.mode)&&v.form&&Object.keys(initial().form).every(k=>typeof v.form[k]==='string')&&v.form.body.length<=80000,instance),{draft}=editor,{mode,form}=draft.value,base=draft.base;
 const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[packet,setPacket]=useState(null),[working,setWorking]=useState(''),[readVersion,setReadVersion]=useState(0),[needsReview,setNeedsReview]=useState(false);
 const active=useRef(true),flight=useRef(false),currentTopic=useRef(topic),ready=useRef(false);currentTopic.current=topic;
 const locked=busy||!!working,readReady=readVersion===topic.version&&ready.current,actionsBlocked=locked||!readReady||needsReview||topic.status==='archived';
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let current=true;ready.current=false;setReadVersion(0);request(`/api/research/${topic.id}/materials?view=summary`).then(r=>{if(!current)return;const value=checkedList(r,topic);setData(value);setReadVersion(topic.version);ready.current=true;}).catch(e=>{if(current){ready.current=false;setReadVersion(0);setError(e.message);}});return()=>{current=false;};},[topic.id,topic.version,refresh]);
 const setForm=value=>{if(!busy&&!flight.current)editor.change(v=>({...v,form:typeof value==='function'?value(v.form):value}));};
 const setMode=mode=>{if(!busy&&!flight.current)editor.change(v=>({...v,mode}));};
 const change=(k,v)=>setForm(f=>({...f,[k]:v}));
 const begin=kind=>{if(actionsBlocked||flight.current)return false;flight.current=true;setWorking(kind);setError('');return true;};
 const end=()=>{flight.current=false;if(active.current)setWorking('');};
 const reload=()=>{if(busy||flight.current)return;ready.current=false;setReadVersion(0);setNeedsReview(false);setError('');setRefresh(n=>n+1);};
 async function save(e){
  e.preventDefault();if(base!==topic.version||!begin('save'))return;const submitted=draft,original=topic;
  try{const result=await mutate(`/api/research/${topic.id}/${mode==='web'?'read-source':'materials'}`,'POST',{...form,version:base});if(!active.current)return;if(!result)throw Error('未能核对材料保存；输入仍保留，请刷新材料记录并核对研究版本');
   const saved=await checkedSave(result,original,submitted);if(!active.current)return;
   if(currentTopic.current.version>saved.version)throw Error('研究已更新，材料保存回执仍需核对；输入保留');
   editor.ack(submitted,initial(),saved.version);setPacket(null);ready.current=false;setReadVersion(0);setRefresh(n=>n+1);
  }catch(e){if(active.current){setError(e.message);setNeedsReview(true);ready.current=false;setReadVersion(0);}}finally{end();}
 }
 async function makePacket(){
  if(!begin('packet'))return;const version=topic.version;
  try{const p=await request(`/api/research/${topic.id}/packet`);if(!active.current)return;if(currentTopic.current.version!==version)throw Error('研究已更新，请重新生成当前版本的材料包');if(p?.schema!=='event-research-packet-1'||p.analysisMode!=='assistant-review-required'||p.input?.topicId!==topic.id||p.input.topicVersion!==version||!hash(p.inputHash)||!Array.isArray(p.instructions))throw Error('未能核对研判材料包，请刷新后重试');setPacket(p);
  }catch(e){if(active.current)setError(e.message);}finally{end();}
 }
 return <div className="research-materials">
 <ModelResearch key={`model:${topic.id}`} topic={topic} busy={locked} instanceId={instance} mutate={mutate}/>
 {topic.sourceRevisionOf&&<details><summary>同一来源的新修订 · 旧研究保留</summary><p>本研究对应新闻 v{topic.sourceNewsRevision}，上一研究来自新闻 v{topic.sourceRevisionOf.newsRevision}。研判材料包固定引用上一研究 v{topic.sourceRevisionOf.topicVersion} 的已保存材料与判断，只用于历史对照，不增加独立证据。</p><a href={`/?topic=${encodeURIComponent(topic.sourceRevisionOf.topicId)}`}>打开原研究及版本记录</a></details>}
 {topic.eventExtraction&&<details><summary>此研究来自材料事项拆分 · 待核对</summary><p>原研究 v{topic.eventExtraction.sourceTopicVersion}；事项 {topic.eventExtraction.eventIndex+1}。共用材料不是独立佐证；原文及模型判断保留在原拆分记录中。</p><p>{topic.eventExtraction.event.actor} · {topic.eventExtraction.event.action} · {topic.eventExtraction.event.object}</p><p>来源候选阶段：{topic.eventExtraction.event.stage} · <EventTime event={topic.eventExtraction.event}/></p><p>{topic.eventExtraction.reviewNote}</p><blockquote>{topic.eventExtraction.event.quote}</blockquote><a href={`/?range=3&view=grid&topic=${encodeURIComponent(topic.eventExtraction.sourceTopicId)}`}>打开来源研究及拆分记录</a></details>}
 {data&&<MaterialEvents key={`events:${topic.id}`} topic={topic} materials={data.materials} busy={actionsBlocked} instanceId={instance} mutate={mutate}/>}
 {data&&<CompanyEntities key={`entities:${topic.id}`} topic={topic} materials={data.materials} busy={actionsBlocked} instanceId={instance} mutate={mutate}/>}
 <div className="source-intro"><div><h3>材料 → 研判 → 条件</h3><p>只读取当前候选需要的来源。保存材料后，在“概率与影响”和“交易假设”记录研判。</p></div><Button onClick={makePacket} disabled={actionsBlocked}>{working==='packet'?'整理中…':'生成研判材料包'}</Button><Button onClick={reload} disabled={locked}>刷新材料记录</Button></div>
 {error&&<p className="m-warning" role="alert">{error}</p>}
 {packet&&<details className="source-packet" open><summary>研判材料包 · 研究 v{packet.input.topicVersion} · {packet.inputHash.slice(0,12)}</summary><p className="m-note">包括事实、传闻、反证、公司关系、期限与买卖条件的分析要求。可复制给研究助手；生成材料包本身不会调用模型。此包固定于生成时的版本。{packet.input.topicVersion!==topic.version?' 当前研究已有更新，请重新生成。':''}</p><textarea readOnly aria-label="研判材料包" rows={9} value={JSON.stringify(packet,null,2)} onFocus={e=>e.target.select()}/></details>}
 <details className="source-add" open={draft.dirty||!data?.materials.length}><summary>＋ 补充正文 / 公告材料</summary><nav className="source-modes" aria-label="材料导入方式">{[['manual','粘贴材料'],['web','读取公开网页']].map(([v,label])=><Button key={v} aria-pressed={mode===v} disabled={locked} onClick={()=>setMode(v)}>{label}</Button>)}</nav>
 <form className="m-form" onSubmit={save}><p className="m-note">未保存材料仅保存在本标签页，关闭或刷新可恢复；尚未写入研究库。关闭标签页可能丢失，请及时保存。</p>{draft.volatile&&<p role="alert">会话存储不可用，材料草稿仅保留在当前页面。</p>}<fieldset className="m-editor-fields" disabled={locked}>
 <p className="m-note">{mode==='web'?'读取公开 HTML 正文，最长等待 20 秒；付费、登录、PDF 或无法提取的来源可自行阅读后粘贴。提取成功不表示内容已证实。':'记录原文或摘录，保留其阅读范围；不要把研判意见混入来源正文。保存时仅存本机；主动调用 Codex 时会发送当前事件材料用于研判。'}</p>
 <label>来源链接{mode==='manual'?'（可选）':''}<input type="url" required={mode==='web'} maxLength={2000} value={form.url} onChange={e=>change('url',e.target.value)} placeholder="https://…"/></label>
 {mode==='manual'&&<><label>材料标题<input required maxLength={200} value={form.title} onChange={e=>change('title',e.target.value)}/></label><div className="m-form-row"><label>来源名称<input required maxLength={160} value={form.sourceName} onChange={e=>change('sourceName',e.target.value)}/></label><label>来源日期（未知可留空）<input type="date" value={form.publishedAt} onChange={e=>change('publishedAt',e.target.value)}/></label></div><label>阅读范围<select value={form.scope} onChange={e=>change('scope',e.target.value)}><option value="excerpt">部分摘录</option><option value="user-supplied-text">人工提供正文</option></select></label><label>材料正文<textarea required rows={7} maxLength={80000} value={form.body} onChange={e=>change('body',e.target.value)}/><small>{form.body.length.toLocaleString()} / 80,000 字符</small></label></>}
 <EvidenceFields topic={topic} form={form} setForm={setForm}/>
 {base!==topic.version&&<p className="m-warning">研究已从 v{base} 更新到 v{topic.version}，输入仍保留。请查看历史，再明确核对后继续，或丢弃草稿载入最新版本。</p>}
 <div className="m-form-actions"><span>按实际获取时间入库 · 尚待核验</span><Button type="button" onClick={()=>{if(!busy&&!flight.current)editor.reset();}} disabled={locked}>丢弃材料草稿并载入最新版本</Button>{base!==topic.version&&<Button type="button" onClick={()=>{if(!busy&&!flight.current&&readReady&&!needsReview)editor.change(v=>v,topic.version);}} disabled={actionsBlocked}>已核对更新，保留材料草稿继续编辑</Button>}<Button primary type="submit" disabled={actionsBlocked||base!==topic.version}>{working==='save'?'读取 / 保存中…':mode==='web'?'读取并保存正文':'保存材料快照'}</Button></div>
 </fieldset></form></details>
 <h3>已关联材料 <small>{data?.materials.length??'…'} 份</small></h3>
 {!data?<p className="m-note">正在加载材料…</p>:!data.materials.length?<p className="m-note">目前只有已有线索，尚未保存正文材料。补充来源后可逐版复核。</p>:data.materials.map(m=><SourceMaterial key={`${topic.id}:${m.id}`} topicId={topic.id} material={m} busy={actionsBlocked}/>)}
 {data?.attempts.some(a=>a.state==='failed')&&<details className="source-failures" open><summary>读取失败记录</summary>{data.attempts.filter(a=>a.state==='failed').map((a,i)=><p key={`${a.at}:${i}`}><b>{time(a.at)}</b> · {a.error}<small>{a.url}</small></p>)}</details>}
 </div>;
}
