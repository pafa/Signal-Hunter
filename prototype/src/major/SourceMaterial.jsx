import {marketDataStateName} from '../integrated/MarketSourceStatus';
import React,{useEffect,useState} from 'react';
import {Button} from './Primitives';
import {request,time,stanceNames} from './api';
import {MaterialHistoricalRecall} from './HistoricalRecall';
import ArticleSourceLinks from './ArticleSourceLinks';
import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';
const scopes={'extracted-text':'来源提取文字 · 完整性待核','user-supplied-text':'人工提供正文 · 完整性未保证',excerpt:'摘录 · 仅此范围'};

// The parent keys this component by topic and immutable material id.
export default function SourceMaterial({topicId,material:m,busy,label}){
 const [open,setOpen]=useState(false),[requested,setRequested]=useState(false),[detail,setDetail]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const {id,revision,contentHash,documentId}=m;
 useEffect(()=>{
  if(!requested)return;
  let current=true;setError('');
  request(`/api/research/${topicId}/materials/${id}`).then(value=>{
   if(value.id!==id||value.revision!==revision||value.contentHash!==contentHash||value.documentId!==documentId||typeof value.body!=='string')throw Error('材料版本不匹配，请关闭后重新打开');
   if(current)setDetail(value);
  }).catch(e=>{if(current)setError(e.message);});
  return()=>{current=false;};
 },[topicId,id,revision,contentHash,documentId,requested,retry]);
 return <details className="source-item" onToggle={e=>{const opened=e.currentTarget.open;setOpen(opened);if(opened)setRequested(true);}}>
  <summary><strong>{label||m.title}</strong><small>材料 v{m.revision} · {scopes[m.scope]} · {stanceNames[m.stance]}</small></summary>
  {open&&<>
   {label&&label!==m.title&&<p className="m-note">通知中的附件名：{label} · 原归档标题：{m.title}</p>}
   <p className="m-note">{m.sourceName} · 来源 {m.publishedAt||'日期未知'}{m.datePrecision==='day'?'（仅日期）':''}<br/>本版获取 {time(m.availableAt)} · {m.verification==='unverified'?'内容未证实':'核验状态见证据链'}</p>
   {m.url&&<a href={m.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}<p className="m-note">与事件的关系：{m.interpretation}</p>
   {error?<div role="alert"><p>{error}</p><Button onClick={()=>setRetry(n=>n+1)}>重试读取此版材料</Button></div>:!detail?<p role="status">正在读取材料 v{m.revision}…</p>:<>
    <PublicationDateEvidence evidence={detail.publicationDateEvidence} showMissing={m.scope==='extracted-text'&&detail.extractionEvidence?.schema!=='pdf-text-layer/1'}/><ArticleReadingScope evidence={detail.extractionEvidence} showMissing={m.scope==='extracted-text'}/>
    {detail.marketSource&&<p className="m-note">冻结价量 · {detail.marketSource.symbol} · {detail.marketSource.interval==='1d'?'日线':'分钟'} · {detail.marketSource.currency} · {detail.marketSource.marketTimezone}<br/>数据时点 {detail.marketSource.diagnostics.dataAt||'未知'} · 来源获取 {time(detail.marketSource.source.receivedAt)} · 读取时：{marketDataStateName(detail.marketSource.diagnostics.dataState)}<br/>本次选取 {detail.marketSource.coverage.selectedRows} 行；价格、成交量口径与未读范围见下方。原始响应已留存，后续行情刷新不改此版材料；不作为可成交报价。</p>}
    {detail.financialSource&&<p className="m-note">官方财务数据选摘 · {detail.financialSource.issuer.symbol} · CIK {detail.financialSource.issuer.cik}。已留存证券映射和完整 API 响应；选摘不是完整财报，当前映射不证明历史身份，未覆盖指标不能当作零。申报编号、期间与币种见下方原始选摘。</p>}
    {detail.filingSource&&<p className="m-note">官方申报{detail.filingSource.exhibit?'附件':'原文'}选段 · {detail.filingSource.filing.form} · {detail.filingSource.filing.accession}。完整HTML原件与申报目录已留存；研判只收到 {detail.filingSource.selection.retainedCharacters.toLocaleString('zh-CN')} / {detail.filingSource.selection.fullTextCharacters.toLocaleString('zh-CN')} 字符，未选 {detail.filingSource.selection.omittedBlocks} 块。提取位置和原表格结构见下文，{detail.filingSource.exhibit?'主申报链接已核对；附件内链接与未选内容尚未分析。':'附件与未选内容尚未分析。'}</p>}
    <ArticleSourceLinks links={detail.sourceLinks}/><pre className="source-body">{detail.body}</pre><small>内容指纹 {m.contentHash.slice(0,20)} · 旧版保留</small><MaterialHistoricalRecall material={detail} busy={busy}/>
   </>}
  </>}
 </details>;
}
