import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time,currentInstanceId} from './api';
import useEditorDraft from './useEditorDraft';
import SecurityDirectory from './SecurityDirectory';
import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';

const states={running:'身份识别中',candidate:'待核对',failed:'失败',cancelled:'已取消',interrupted:'中断'};
export function EntityReview({mention,index,history,directory,disabled,onDecision,note='',symbol='',onDraftChange=()=>{}}){
 const latest=history?.[0];
 return <article className="source-item" aria-label={`身份候选 ${index+1}`}><h4>{index+1}. {mention.name}</h4><p>{({company:'公司',subsidiary:'子公司',product:'产品或品牌',other:'其他实体或普通词',unclear:'类型不明'})[mention.entityType]} · {({candidate:'单一证券候选',ambiguous:'多个证券候选，需选择',unresolved:'未能对应目录', 'not-company':'未作为公司识别'})[mention.resolution]}</p><blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{mention.quote}</blockquote><small>引自{mention.quoteField==='body'?'正文':'标题'}；原文提及不等于上市主体已核实。</small><p>{mention.reason}</p>
 {latest?.action==='link'?<p role="status">已关联 {latest.symbol}，关系和影响仍待核验。可在公司关系中修订或撤销，原依据保留。</p>:<>{latest?.action==='reject'&&<p>已排除：{latest.note}</p>}{!!mention.symbols.length&&<label>候选 {index+1} 证券<select value={symbol} disabled={disabled} onChange={e=>onDraftChange({symbol:e.target.value})}><option value="">请选择核对后的证券</option>{mention.symbols.map(s=>{const c=directory.find(c=>c.symbol===s);return <option key={s} value={s}>{c.name} · {s} · {c.market} / {c.currency}</option>;})}</select></label>}{symbol&&<p>{directory.find(c=>c.symbol===symbol)?.identityBasis}</p>}
 <label>身份 {index+1} 核对说明<textarea maxLength={1200} rows={2} value={note} disabled={disabled} onChange={e=>onDraftChange({note:e.target.value})}/></label><div className="m-form-actions">{latest?.action==='reject'?<Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest.version,'reopen',note,'')}>重新核对身份</Button>:<>{!!mention.symbols.length&&<Button primary disabled={disabled||!note.trim()||!symbol} onClick={()=>onDecision(index,latest?.version||0,'link',note,symbol)}>确认证券并关联研究</Button>}<Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest?.version||0,'reject',note,'')}>排除此身份候选</Button></>}</div>{!mention.symbols.length&&<p className="m-note">保留未对应结果；如需补充目录外证券，可在公司关系中填写代码和核对来源。</p>}</>}
 {!!history?.length&&<details><summary>身份核对历史 · {history.length} 次</summary>{history.map(h=><p key={h.version}>v{h.version} · {h.actor?.kind==='system'?'系统处理':'本人处理'} · {time(h.at)} · {h.action} {h.symbol}：{h.note}</p>)}</details>}</article>;
}
const emptyIdentity=()=>({note:'',symbol:''});
const validIdentity=v=>typeof v?.note==='string'&&v.note.length<=1200&&typeof v.symbol==='string';
function IdentityEditor({topic,instance,run,index,disabled,onDecision}){
 const history=run.reviews[index]||[],version=history[0]?.version||0;
 const editor=useEditorDraft(topic,JSON.stringify(['company-identity',run.id,run.createdAt||'',run.packet.inputHash,index,version]),emptyIdentity,validIdentity,instance);
 const stale=editor.draft.base!==topic.version,locked=disabled||stale;
 return <><EntityReview mention={run.candidate.resolution.mentions[index]} directory={run.packet.input.directory} index={index} history={history} disabled={locked} {...editor.draft.value}
  onDraftChange={patch=>{if(!locked)editor.change(v=>({...v,...patch}));}}
  onDecision={(mentionIndex,decisionVersion,action,note,symbol)=>{if(!locked)onDecision({mentionIndex,version:decisionVersion,action,note,symbol,topicVersion:editor.draft.base},editor.draft,editor.ack);}}/>
  {stale&&<p className="m-warning">身份草稿基于研究 v{editor.draft.base}，当前为 v{topic.version}；请重新核对。<Button disabled={disabled} onClick={()=>{if(!disabled)editor.reset();}}>丢弃身份草稿并载入当前研究版本</Button></p>}
  {editor.draft.volatile&&<p className="m-warning">浏览器无法保存身份草稿，刷新页面前请保留输入。</p>}
 </>;
}
export default function CompanyEntities(props){
 const instance=props.instanceId??currentInstanceId();
 return <CompanyEntitiesBody key={JSON.stringify([instance,props.topic.id,props.topic.createdAt||''])} {...props} instance={instance}/>;
}
function CompanyEntitiesBody({topic,materials,busy,mutate,instance}){
 const [data,setData]=useState(null),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState(''),[listVersion,setListVersion]=useState(0),[detailVersion,setDetailVersion]=useState(0);
 const selection=useEditorDraft(topic,'company-entity-selection',()=>({id:''}),v=>typeof v?.id==='string',instance);
 const generation=useEditorDraft(topic,'company-entity-generation',()=>({materialId:'',revision:0,requestId:crypto.randomUUID()}),v=>typeof v?.materialId==='string'&&Number.isSafeInteger(v.revision)&&v.revision>=0&&typeof v.requestId==='string',instance);
 const selected=selection.draft.value.id,materialId=generation.draft.value.materialId;
 const alive=useRef(true),flight=useRef(false),selectionRef=useRef(selection),ready=useRef(false),base=`/api/research/${topic.id}/company-entities`;
 selectionRef.current=selection;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true,timer;setListVersion(0);async function load(){try{const d=await request(base);if(!active)return;setData(d);setListVersion(topic.version);if(!selectionRef.current.draft.value.id&&d.runs[0])selectionRef.current.change({id:d.runs[0].id});if(d.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);}catch(e){if(active){setListVersion(0);setError(e.message);}}}void load();return()=>{active=false;clearTimeout(timer);};},[base,refresh,topic.version]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{let active=true;ready.current=false;setDetailVersion(0);setDetail(old=>old?.id===selected?old:null);if(selected)request(`${base}/${selected}`).then(r=>{if(active){if(r.id!==selected||!r.packet?.input||!Array.isArray(r.reviews))throw new Error('未能核对身份记录，请刷新重试');setDetail(r);setDetailVersion(topic.version);ready.current=true;}}).catch(e=>{if(active){setDetailVersion(0);ready.current=false;setError(e.message);}});return()=>{active=false;};},[base,selected,selectedState,refresh,topic.version]);
 const disabled=busy||working,running=data?.runs.some(r=>r.status==='running'),listReady=listVersion===topic.version;
 const m=materials.find(v=>v.id===materialId),generationStale=!!materialId&&(generation.draft.base!==topic.version||!m||m.revision!==generation.draft.value.revision);
 const detailReady=detail?.id===selected&&detailVersion===topic.version&&ready.current;
 const begin=()=>{if(busy||flight.current)return false;flight.current=true;setWorking(true);setError('');return true;};
 const end=()=>{flight.current=false;if(alive.current)setWorking(false);};
 const reload=()=>{ready.current=false;setListVersion(0);setDetailVersion(0);setRefresh(n=>n+1);};
 async function generate(){
  if(!listReady||generationStale||!materialId||running||!data?.enabled||topic.status==='archived'||!begin())return;
  const submitted=generation.draft,input={version:submitted.base,materialId,revision:submitted.value.revision,requestId:submitted.value.requestId};
  try{const r=await request(base,'POST',input);if(!r?.id||r.topicId!==topic.id||r.materialId!==input.materialId||r.materialRevision!==input.revision)throw new Error('未能核对身份识别回执；草稿及请求标识保留，请刷新核对后重试');
   const ack=generation.ack(submitted,{...submitted.value,requestId:crypto.randomUUID()},input.version);
   if(alive.current&&!ack.retained){selection.change({id:r.id});reload();}
  }catch(e){if(alive.current)setError(e.message);}finally{end();}
 }
 async function decide(input,submitted,acknowledge){
  if(!listReady||!detailReady||detail.stale||input.topicVersion!==topic.version||!begin())return;
  const run=detail;
  try{const r=await mutate(`${base}/${run.id}/decision`,'POST',input);if(!r)return;
   const saved=r.companyEntityRun,receipt=saved?.reviews?.[input.mentionIndex]?.find(v=>v.version===input.version+1);
   if(saved?.id!==run.id||JSON.stringify(saved?.packet)!==JSON.stringify(run.packet)||JSON.stringify(saved?.candidate)!==JSON.stringify(run.candidate)||!receipt||receipt.action!==input.action||receipt.symbol!==input.symbol||receipt.note!==input.note.trim()||receipt.inputHash!==run.packet.inputHash)throw new Error('未能核对身份决定回执；草稿保留，请刷新记录后核对');
   const ack=acknowledge(submitted,emptyIdentity(),input.topicVersion);
   if(alive.current&&!ack.retained&&selectionRef.current.draft.value.id===run.id){setDetail(saved);reload();}
  }catch(e){if(alive.current)setError(e.message);}finally{end();}
 }
 async function cancel(){if(!listReady||!detailReady||detail.status!=='running'||!begin())return;try{await request(`${base}/${selected}/cancel`,'POST',{});if(alive.current)reload();}catch(e){if(alive.current)setError(e.message);}finally{end();}}
 const candidate=detail?.candidate?.resolution;
 return <section className="model-research material-events company-entities" aria-label="公司与证券身份识别">
  <h3>材料中的公司与证券身份</h3><p className="m-note">选择已保存材料，调用本机 Codex 区分公司、子公司和产品，并对照有限证券目录。多市场证券分别保留候选；未识别不代表未上市，目录候选也不证明在材料日期已上市。事项研究仅识别该事项原引用范围。</p>
  <SecurityDirectory/>
  <label>身份识别材料<select disabled={disabled} value={materialId} onChange={e=>{if(disabled)return;const material=materials.find(v=>v.id===e.target.value);generation.change({materialId:material?.id||'',revision:material?.revision||0,requestId:crypto.randomUUID()},topic.version);}}><option value="">请选择材料</option>{materials.map(m=><option key={m.id} value={m.id}>{m.title} · 材料 v{m.revision}</option>)}</select></label>
  <Button primary disabled={disabled||!listReady||generationStale||running||!data?.enabled||!materialId||topic.status==='archived'} onClick={generate}>使用 Codex 识别公司身份</Button>
  {generationStale&&<p className="m-warning">所选材料或研究版本已变化，原请求标识保留；重新选择材料后再调用。<Button disabled={disabled} onClick={()=>{if(!disabled)generation.reset();}}>丢弃识别请求草稿并重新选择材料</Button></p>}
  {generation.draft.volatile&&<p className="m-warning">浏览器无法保存识别请求，刷新页面前请核对是否已生成记录。</p>}
  <p className="m-note">{data?.enabled?`模型 ${data.model}；发送所选材料，消耗一次当前账号调用，并非离线推理。`:'当前未启用本机 Codex 身份识别。'}生成后逐项核对并选择证券；确认仅关联研究并尝试加入关注，不生成交易。</p>
  {error&&<p className="m-warning" role="alert">{error}</p>}
  <label>身份识别记录<select disabled={disabled} value={selected} onChange={e=>{if(!disabled){ready.current=false;selection.change({id:e.target.value});}}}><option value="">尚未选择</option>{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · 材料 v{r.materialRevision} · {states[r.status]}{r.stale?' · 旧输入':''}</option>)}</select></label><Button disabled={disabled} onClick={()=>{if(!disabled)reload();}}>刷新身份识别记录</Button>
  {selected&&!detail&&<p>正在读取身份识别记录…</p>}
  {detail&&<>
   <p role="status">{states[detail.status]} · {detail.packet.input.material.title} · 材料 v{detail.packet.input.material.revision}</p>
   {detail.packet.input.directorySnapshot&&<p className="m-note">官方目录生成日期 {detail.packet.input.directorySnapshot.sourceDates.map(s=>s.date||'未知').join(" / ")}；名称召回 {detail.packet.input.directorySnapshot.selected} 条 / 全库 {detail.packet.input.directorySnapshot.totalEligible} 条，超限省略 {detail.packet.input.directorySnapshot.omitted} 条。{detail.packet.input.directorySnapshot.limitation}</p>}
   {detail.stale&&<p className="m-warning">材料、事项或目录已变化，旧候选保留；请使用当前材料重新识别。</p>}
   {detail.status==='running'&&<Button disabled={disabled} onClick={cancel}>取消身份识别调用</Button>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}</p>}
   {candidate&&<><p>{candidate.scopeNote}</p>{!candidate.mentions.length&&<p>本次没有提取到可支持的身份提及；空结果仍已保存。</p>}{candidate.mentions.map((e,i)=><IdentityEditor key={JSON.stringify([detail.id,detail.createdAt||'',detail.packet.inputHash,i,detail.reviews[i]?.[0]?.version||0])} topic={topic} instance={instance} run={detail} index={i} disabled={disabled||!listReady||!detailReady||detail.stale} onDecision={decide}/>)}{!!candidate.missingEvidence.length&&<><h4>待补证据</h4><ul>{candidate.missingEvidence.map((s,i)=><li key={i}>{s}</li>)}</ul></>}</>}
   <details><summary>冻结材料与模型记录</summary><p>原研究 v{detail.packet.sourceResearchVersion} · 发布 {time(detail.packet.input.material.publishedAt)} · 本版获取 {time(detail.packet.input.material.availableAt)}</p><PublicationDateEvidence evidence={detail.packet.input.material.publicationDateEvidence}/><ArticleReadingScope evidence={detail.packet.input.material.extractionEvidence} showMissing={detail.packet.input.material.contentScope==='extracted-text'}/><pre className="source-body">{detail.packet.input.material.body}</pre><p style={{overflowWrap:'anywhere'}}>输入指纹 {detail.packet.inputHash}</p>{detail.candidate&&<p>提示词 {detail.candidate.trace.promptVersion} · 工具调用 {detail.candidate.trace.toolCallsObserved??'未知'} · 运行警告 {detail.candidate.trace.runtimeWarningCount??'未知'}</p>}</details>
  </>}
 </section>;
}
