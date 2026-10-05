import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request} from './api';
import {historyStatusLabels,historyReviewEligible} from '../../shared/historical-recall.mjs';
import './historical-recall.css';
const SemanticEvents=lazy(()=>import('../integrated/SemanticEvents'));
const time=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return '未知';return /^\d{4}-\d{2}-\d{2}$/.test(value)?value+'（仅日期）':new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});};
const sourceUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const scopeNames={'headline-only':'仅标题',excerpt:'部分摘录','user-supplied-text':'人工提供正文','extracted-text':'网页提取正文 · 完整性待核'};
export function MaterialHistoricalRecall({material,busy}){const [open,setOpen]=useState(false);return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>正文历史类比 · 核对原文片段</summary>{open&&<HistoricalRecall key={material.id} material={material} busy={busy}/>}</details>;}
export default function HistoricalRecall({news:incoming,material,busy}){
 const news=material||incoming;
 const [catalog,setCatalog]=useState([]),[report,setReport]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[page,setPage]=useState(0);
 const [comparison,setComparison]=useState(null),[selection,setSelection]=useState('candidate');
 const [unavailable,setUnavailable]=useState('');
 const live=useRef(true),sequence=useRef(0),pending=useRef(null),base=`/api/${material?'materials':'news'}/${news.id}/history-recall`;
 useEffect(()=>{live.current=true;const token=++sequence.current;request(base).then(v=>{if(live.current&&token===sequence.current){setCatalog(v.reports);setUnavailable(v.enabled===false?v.unavailableReason||'当前安装不能保存新检索':'');}}).catch(e=>{if(live.current&&token===sequence.current)setError(e.message);}).finally(()=>{if(live.current&&token===sequence.current)setLoading(false);});return()=>{live.current=false;sequence.current++;};},[base]);
 async function load(id){const token=++sequence.current;setLoading(true);setError('');try{const value=await request(`${base}/${id}`);if(live.current&&token===sequence.current){setReport(value);setPage(0);setSelection('candidate');}}catch(e){if(live.current&&token===sequence.current)setError(e.message);}finally{if(live.current&&token===sequence.current)setLoading(false);}}
 async function freeze(){if(loading||busy||unavailable)return;const token=++sequence.current;pending.current??={revision:news.revision,requestId:crypto.randomUUID()};setLoading(true);setError('');try{const value=await request(base,'POST',pending.current);if(live.current&&token===sequence.current){pending.current=null;setReport(value);setPage(0);setSelection('candidate');setCatalog(old=>[{id:value.id,frozenAt:value.frozenAt,newsRevision:value.anchor.revision,candidates:value.summary.candidate,hash:value.hash},...old.filter(r=>r.id!==value.id)]);}}catch(e){if(live.current&&token===sequence.current)setError(e.message);}finally{if(live.current&&token===sequence.current)setLoading(false);}}
 function download(){if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`historical-recall-${report.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const inputs=new Map((report?.inputs||[]).map(i=>[i.id,i])),rows=new Map((report?.rows||[]).map(i=>[i.newsId,i])),candidateIds=report?.candidateIds||[],missedIds=(report?.rows||[]).filter(r=>r.status!=='candidate'&&historyReviewEligible(r)).map(r=>r.newsId),ids=selection==='missed'?missedIds:candidateIds,visible=ids.slice(page*25,(page+1)*25);
 if(comparison)return <Suspense fallback={<p>正在打开历史类比核对…</p>}><SemanticEvents key={`${report.id}:${comparison}`} historyContext={{reportId:report.id,reportHash:report.hash,candidateId:comparison,retrievalStatus:rows.get(comparison)?.status}} initialPair={Object.fromEntries(['left','right'].map((side,i)=>{const r=i?inputs.get(comparison):report.anchor;return [side,{...r,id:r.materialId||r.id,contentScope:r.contentScope||'headline-only'}];}))} onBack={()=>setComparison(null)}/></Suspense>;
 return <section className="historical-recall" aria-label="历史类比检索" aria-busy={loading}>
 <p className="m-note">{material?'从本机新闻标题和已存正文中查找更早的同机制案例，不限90天。正文按片段查找共现线索，并保留两侧原文；不自动确认机制、合并事件或套用历史收益。':'从本机已保存新闻中查找更早的同机制案例，不限90天。仅比较标题与领域线索；不会合并事件，也不会套用历史收益。'}</p>
 <Button type="button" disabled={busy||loading||!!unavailable} onClick={freeze}>{loading?'处理中…':pending.current?'重试本次检索':'检索并保存历史类比'}</Button>
 {unavailable&&<p className="m-warning">{unavailable}；已保存报告仍可读取。</p>}
 {error&&<p role="alert" className="m-warning">{error}</p>}
 {!!catalog.length&&<label className="m-form">已保存检索<select aria-label="历史类比版本" disabled={loading} value={report?.id||''} onChange={e=>{if(e.target.value)load(e.target.value);}}><option value="">选择一次已保存检索</option>{catalog.map(r=><option key={r.id} value={r.id}>{time(r.frozenAt)} · {material?'材料':'新闻'}v{r.newsRevision} · {r.candidates}个候选 · {r.id.slice(0,8)}</option>)}</select></label>}
 {report&&<>
 <p role="status">本次扫描 {report.coverage.scanned}/{report.coverage.total} 条，找到 {candidateIds.length} 个待核对类比；依据{report.anchor.kind==='material'?'材料':'新闻'} v{report.anchor.revision}。</p>
 {report.mode==='demo'&&<p className="m-warning">本报告来自离线演示库，数据仅供演示。</p>}
 <p className="m-note">检索时点 {time(report.frozenAt)}。较早的发布时间不代表当时已经获取；这是当前保存资料的回溯检索。</p>
 <details><summary>覆盖与未入选原因</summary><ul>{Object.entries(report.summary).map(([key,n])=><li key={key}>{historyStatusLabels[key]||key}：{n}</li>)}</ul><p>{report.coverage.inputScope}</p></details>
 <label className="m-form">历史结果范围<select aria-label="历史结果范围" disabled={loading} value={selection} onChange={e=>{setSelection(e.target.value);setPage(0);}}><option value="candidate">规则命中（{candidateIds.length}）</option><option value="missed">规则未命中，待复核（{missedIds.length}）</option></select></label>
 {selection==='missed'&&<p className="m-note">以下资料通过本次检索的时间与重复检查，但未命中共同机制或语境。未命中不等于不相关，可逐条交给 Codex 复核；原未命中原因保留，复核不会增加本报告的命中数。</p>}
 <div className="source-news-list">{visible.map(id=>{const input=inputs.get(id),row=rows.get(id),href=sourceUrl(input.url);return <article key={id}><h4>{input.title}</h4><p>{input.publisher||'来源未知'} · 发布 {time(input.publishedAt)} · 修订v{input.revision}</p><p className="m-note">首次获取 {time(input.firstSeen)} · 本版获取 {time(input.availableAt)}</p><p className="m-note">{scopeNames[input.contentScope]||'仅标题'}</p><p>原检索结果：{historyStatusLabels[row.status]||row.status}</p><ul>{(row.reasons||[]).map(r=><li key={r}>{r}</li>)}</ul><details><summary>关键差异与待核对事项</summary><ul>{(row.differences||['规则未提供共同机制依据；请阅读两侧原文后核对，不自动确认类比。']).map(r=><li key={r}>{r}</li>)}</ul></details>{row.quotes&&<details><summary>查看本条与历史的原文命中片段</summary>{Object.entries(row.quotes).map(([side,q])=><div key={side}><p>{side==='anchor'?'本条':'历史'} · {q.field==='body'?'正文':'标题'} · v{q.revision} · {scopeNames[q.contentScope]||q.contentScope}</p><blockquote style={{whiteSpace:'pre-wrap'}}>{q.text}</blockquote><small>原文字符位置 {q.start}–{q.end}（UTF-16，末端不含）</small></div>)}</details>}<Button disabled={busy||loading} onClick={()=>setComparison(id)}>{row.status==='candidate'?'用 Codex 核对这对类比':'用 Codex 核对这条未命中'}</Button>{href&&<a href={href} target="_blank" rel="noreferrer">打开历史来源 ↗</a>}</article>;})}</div>
 {!ids.length&&<p className="m-note">{selection==='missed'?'本报告没有可复核的规则未命中资料；时间或重复检查排除的资料仍保留在完整报告中。':'当前保存资料没有规则匹配的更早案例；不代表历史上没有同类事件。'}</p>}
 {!!ids.length&&<div className="source-pagination"><Button aria-disabled={loading||page===0} onClick={()=>{if(!loading&&page>0)setPage(n=>n-1);}}>上一页类比</Button><span>第{page+1}页 / {Math.ceil(ids.length/25)}页</span><Button aria-disabled={loading||(page+1)*25>=ids.length} onClick={()=>{if(!loading&&(page+1)*25<ids.length)setPage(n=>n+1);}}>下一页类比</Button></div>}
 <Button type="button" onClick={download}>导出本次完整检索</Button><details><summary>保存信息</summary><p style={{overflowWrap:'anywhere'}}>报告 {report.id}<br/>版本 {report.version}<br/>指纹 {report.hash}</p></details>
 </>}
 </section>;
}
