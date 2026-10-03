import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time} from './api';
import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';

const states={running:'身份识别中',candidate:'待核对',failed:'失败',cancelled:'已取消',interrupted:'中断'};
export function EntityReview({mention,index,history,directory,disabled,onDecision}){
 const [note,setNote]=useState(''),[symbol,setSymbol]=useState(''),latest=history?.[0];
 return <article className="source-item" aria-label={`身份候选 ${index+1}`}><h4>{index+1}. {mention.name}</h4><p>{({company:'公司',subsidiary:'子公司',product:'产品或品牌',other:'其他实体或普通词',unclear:'类型不明'})[mention.entityType]} · {({candidate:'单一证券候选',ambiguous:'多个证券候选，需选择',unresolved:'未能对应目录', 'not-company':'未作为公司识别'})[mention.resolution]}</p><blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{mention.quote}</blockquote><small>引自{mention.quoteField==='body'?'正文':'标题'}；原文提及不等于上市主体已核实。</small><p>{mention.reason}</p>
 {latest?.action==='link'?<p role="status">已关联 {latest.symbol}，关系和影响仍待核验。可在公司关系中修订或撤销，原依据保留。</p>:<>{latest?.action==='reject'&&<p>已排除：{latest.note}</p>}{!!mention.symbols.length&&<label>候选 {index+1} 证券<select value={symbol} disabled={disabled} onChange={e=>setSymbol(e.target.value)}><option value="">请选择核对后的证券</option>{mention.symbols.map(s=>{const c=directory.find(c=>c.symbol===s);return <option key={s} value={s}>{c.name} · {s} · {c.market} / {c.currency}</option>;})}</select></label>}{symbol&&<p>{directory.find(c=>c.symbol===symbol)?.identityBasis}</p>}
 <label>身份 {index+1} 核对说明<textarea maxLength={1200} rows={2} value={note} disabled={disabled} onChange={e=>setNote(e.target.value)}/></label><div className="m-form-actions">{latest?.action==='reject'?<Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest.version,'reopen',note,'')}>重新核对身份</Button>:<>{!!mention.symbols.length&&<Button primary disabled={disabled||!note.trim()||!symbol} onClick={()=>onDecision(index,latest?.version||0,'link',note,symbol)}>确认证券并关联研究</Button>}<Button disabled={disabled||!note.trim()} onClick={()=>onDecision(index,latest?.version||0,'reject',note,'')}>排除此身份候选</Button></>}</div>{!mention.symbols.length&&<p className="m-note">保留未对应结果；如需补充目录外证券，可在公司关系中填写代码和核对来源。</p>}</>}
 {!!history?.length&&<details><summary>身份核对历史 · {history.length} 次</summary>{history.map(h=><p key={h.version}>v{h.version} · {time(h.at)} · {h.action} {h.symbol}：{h.note}</p>)}</details>}</article>;
}
export default function CompanyEntities({topic,materials,busy,mutate}){
 const [data,setData]=useState(null),[materialId,setMaterialId]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),pending=useRef(null),base=`/api/research/${topic.id}/company-entities`;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true,timer;async function load(){try{const d=await request(base);if(!active)return;setData(d);setSelected(v=>v||d.runs[0]?.id||'');if(d.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);}catch(e){if(active)setError(e.message);}}void load();return()=>{active=false;clearTimeout(timer);};},[base,refresh,topic.version]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{let active=true;setDetail(old=>old?.id===selected?old:null);if(selected)request(`${base}/${selected}`).then(r=>{if(active)setDetail(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[base,selected,selectedState,refresh,topic.version]);
 async function generate(){
  const m=materials.find(v=>v.id===materialId);if(!m)return;const input={version:topic.version,materialId:m.id,revision:m.revision},key=JSON.stringify(input);
  if(pending.current?.key!==key)pending.current={key,input:{...input,requestId:crypto.randomUUID()}};
  setWorking(true);setError('');try{const r=await request(base,'POST',pending.current.input);if(alive.current){pending.current=null;setSelected(r.id);setRefresh(n=>n+1);}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}
 }
 async function decide(mentionIndex,version,action,note,symbol){setWorking(true);setError('');try{const r=await mutate(`${base}/${selected}/decision`,'POST',{mentionIndex,version,action,note,symbol,topicVersion:topic.version});if(r&&alive.current){setDetail(r.companyEntityRun);setRefresh(n=>n+1);}}finally{if(alive.current)setWorking(false);}}
 async function cancel(){setWorking(true);setError('');try{await request(`${base}/${selected}/cancel`,'POST',{});if(alive.current)setRefresh(n=>n+1);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}}
 const disabled=busy||working,running=data?.runs.some(r=>r.status==='running'),candidate=detail?.candidate?.resolution;
 return <section className="model-research material-events company-entities" aria-label="公司与证券身份识别">
  <h3>材料中的公司与证券身份</h3><p className="m-note">选择已保存材料，调用本机 Codex 区分公司、子公司和产品，并对照有限证券目录。多市场证券分别保留候选；未识别不代表未上市，目录候选也不证明在材料日期已上市。事项研究仅识别该事项原引用范围。</p>
  <label>身份识别材料<select value={materialId} onChange={e=>setMaterialId(e.target.value)}><option value="">请选择材料</option>{materials.map(m=><option key={m.id} value={m.id}>{m.title} · 材料 v{m.revision}</option>)}</select></label>
  <Button primary disabled={disabled||running||!data?.enabled||!materialId||topic.status==='archived'} onClick={generate}>使用 Codex 识别公司身份</Button>
  <p className="m-note">{data?.enabled?`模型 ${data.model}；发送所选材料，消耗一次当前账号调用，并非离线推理。`:'当前未启用本机 Codex 身份识别。'}生成后逐项核对并选择证券；确认仅关联研究并尝试加入关注，不生成交易。</p>
  {error&&<p className="m-warning" role="alert">{error}</p>}
  <label>身份识别记录<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">尚未选择</option>{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · 材料 v{r.materialRevision} · {states[r.status]}{r.stale?' · 旧输入':''}</option>)}</select></label><Button disabled={disabled} onClick={()=>setRefresh(n=>n+1)}>刷新身份识别记录</Button>
  {selected&&!detail&&<p>正在读取身份识别记录…</p>}
  {detail&&<>
   <p role="status">{states[detail.status]} · {detail.packet.input.material.title} · 材料 v{detail.packet.input.material.revision}</p>
   {detail.stale&&<p className="m-warning">材料、事项或目录已变化，旧候选保留；请使用当前材料重新识别。</p>}
   {detail.status==='running'&&<Button disabled={disabled} onClick={cancel}>取消身份识别调用</Button>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}</p>}
   {candidate&&<><p>{candidate.scopeNote}</p>{!candidate.mentions.length&&<p>本次没有提取到可支持的身份提及；空结果仍已保存。</p>}{candidate.mentions.map((e,i)=><EntityReview key={`${detail.id}:${i}`} mention={e} directory={detail.packet.input.directory} index={i} history={detail.reviews[i]} disabled={disabled||detail.stale} onDecision={decide}/>)}{!!candidate.missingEvidence.length&&<><h4>待补证据</h4><ul>{candidate.missingEvidence.map((s,i)=><li key={i}>{s}</li>)}</ul></>}</>}
   <details><summary>冻结材料与模型记录</summary><p>原研究 v{detail.packet.sourceResearchVersion} · 发布 {time(detail.packet.input.material.publishedAt)} · 本版获取 {time(detail.packet.input.material.availableAt)}</p><PublicationDateEvidence evidence={detail.packet.input.material.publicationDateEvidence}/><ArticleReadingScope evidence={detail.packet.input.material.extractionEvidence} showMissing={detail.packet.input.material.contentScope==='extracted-text'}/><pre className="source-body">{detail.packet.input.material.body}</pre><p style={{overflowWrap:'anywhere'}}>输入指纹 {detail.packet.inputHash}</p>{detail.candidate&&<p>提示词 {detail.candidate.trace.promptVersion} · 工具调用 {detail.candidate.trace.toolCallsObserved??'未知'} · 运行警告 {detail.candidate.trace.runtimeWarningCount??'未知'}</p>}</details>
  </>}
 </section>;
}
