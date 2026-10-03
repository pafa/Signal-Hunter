import React,{useEffect,useState} from 'react';
import useEditorDraft from './useEditorDraft';
import {Button} from './Primitives';
import {request,time} from './api';
import './screening.css';
const labels={major:'重大候选',ordinary:'普通资讯',unclear:'信息不足'};
const fields=[['novelty','新增了什么'],['scale','相对业务量级'],['mechanism','如何影响公司'],['expectations','市场已反映多少'],['duration','影响持续多久']];
export default function ScreeningReview({news,mutate,busy}){
 return <section className="screening-review" aria-label="重大性初筛与复核"><h3>重大性与紧急程度</h3>
 {news.triage.screening&&<><p className={news.triage.screening.urgency==='priority'?'m-warning':'m-note'}>{news.triage.screening.urgency==='priority'?'优先核验':'常规研判'} · {news.triage.screening.urgencyReason}</p><div className="screening-dimensions">{news.triage.screening.dimensions.map(d=><div key={d.key}><b>{d.label}<small>待核验</small></b><p>{d.question}</p></div>)}</div><p className="m-note">{news.triage.screening.nextAction}。事实概率与上涨概率均未估计。</p></>}
 <ScreeningHistory key={`${news.id}:${news.revision}`} news={news} mutate={mutate} busy={busy}/>
 </section>;
}
function ScreeningHistory({news,mutate,busy}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[selected,setSelected]=useState({}),[page,setPage]=useState({cursors:[null],ceiling:undefined});
 const before=page.cursors.at(-1),pageKey=before||'first';
 useEffect(()=>{let active=true;setData(null);setError('');const query=new URLSearchParams();if(before)query.set('before',before);if(page.ceiling!==undefined)query.set('ceiling',page.ceiling);request(`/api/news/${news.id}/screening${query.size?'?'+query:''}`).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[news.id,news.revision,before,page.ceiling,reload]);
 const current=data?.samples.find(s=>s.input.revision===news.revision&&s.rulesHash===data.currentRulesHash),sample=data?.samples.find(s=>s.id===selected[pageKey])||current||(before?data?.samples[0]:null);
 const latest=()=>{setPage({cursors:[null],ceiling:undefined});setSelected({});setReload(v=>v+1);};
 return <>
 {error&&<p className="m-warning" role="alert">{error}<Button onClick={()=>setReload(v=>v+1)}>重试样本读取</Button></p>}
 {!data&&!error&&<p className="m-note">读取初筛留样…</p>}
 {data&&!sample&&<p className="m-note">本页没有本版新闻的当前规则留样；可选择历史留样、翻页或回到最新留样核对。</p>}
 <div className="screening-pages"><Button type="button" disabled={busy||!data} onClick={()=>setReload(v=>v+1)}>刷新初筛复核</Button><Button type="button" disabled={busy} onClick={latest}>回到最新留样</Button></div>
 {data&&<><div className="screening-pages" aria-label="初筛留样分页"><span>共 {data.total??data.samples.length} 份 · 第 {page.cursors.length} 页</span><Button type="button" disabled={busy||page.cursors.length===1} onClick={()=>setPage(p=>({...p,cursors:p.cursors.slice(0,-1)}))}>上一页留样</Button><Button type="button" disabled={busy||!data.nextCursor} onClick={()=>setPage(p=>({ceiling:data.ceiling,cursors:[...p.cursors,data.nextCursor]}))}>下一页留样</Button></div><div className="m-form"><label>初筛留样版本<select disabled={busy} value={sample?.id||''} onChange={e=>setSelected(s=>({...s,[pageKey]:e.target.value}))}><option value="">请选择留样</option>{data.samples.map(s=><option key={s.id} value={s.id}>新闻 v{s.input.revision} · {s.rulesHash===data.currentRulesHash?'当前规则':'历史规则'} · {time(s.decisionAt)}</option>)}</select></label></div><p className="m-note">每页最多12份，保留当时标题与规则。翻页范围固定，新留样在回到最新后纳入；复核历史可刷新。</p></>}
 {sample&&<ReviewForm key={sample.id} sample={sample} mutate={mutate} busy={busy} onSaved={()=>setReload(v=>v+1)}/>}
 </>;
}
function ReviewForm({sample,mutate,busy,onSaved}){
 const latest=sample.reviews[0],version=latest?.version||0;
 const initial=()=>Object.fromEntries(Object.entries({verdict:'unclear',scope:'headline-only',sourceUrl:'',novelty:'',scale:'',mechanism:'',expectations:'',duration:'',note:''}).map(([k,v])=>[k,latest?.[k]??v]));
 // Review versions start at zero; the shared draft base uses positive versions.
 const editor=useEditorDraft({id:sample.id,createdAt:sample.decisionAt,version:version+1},'screening-review',initial,v=>v&&Object.keys(initial()).every(k=>typeof v[k]==='string')),{draft}=editor,form=draft.value,base=draft.base-1;
 const update=(key,value)=>editor.change(v=>({...v,[key]:value}));
 return <><p className="m-note">初筛留样 {time(sample.decisionAt)} · {sample.origin==='historical-diagnostic'?'历史材料诊断':'启用后首次入库'} · {sample.inputHash.slice(0,12)}。包含普通资讯，尚未完成独立样本审核。</p>
 <p className="m-note">本份留样标题：{sample.input.title} · 新闻 v{sample.input.revision}。复核仅绑定这一来源版本和当时规则。</p><details className="screening-edit" open={draft.dirty}><summary>{latest?`人工复核：${labels[latest.verdict]} · v${latest.version}`:'复核重大性 / 记录误报与漏报'}</summary><form className="m-form" onSubmit={async e=>{e.preventDefault();if(busy||base!==version)return;const submitted=draft;if(await mutate('/api/news/screening-review','POST',{...form,sampleId:sample.id,version:base})){editor.ack(submitted,form,submitted.base+1);onSaved();}}}>
 <p className="m-note">此复核已展示规则结果，属于辅助标注；不会覆盖原初筛或自动创建研究和订单。传闻可标为重大候选，尚不等于事实成立。</p>
 <p className="m-note">未保存复核保留在本标签页，关闭或刷新后可恢复；尚未进入复核历史。</p>{draft.volatile&&<p role="alert">会话存储不可用，草稿仅保留在当前页面。</p>}<fieldset className="m-editor-fields" disabled={busy}>{base!==version&&<p className="m-warning" role="alert">复核已有新版本：草稿基于 v{base}，当前为 v{version}。原输入仍保留，请查看下方历史，再丢弃草稿按最新版编辑。</p>}<div className="m-form-row"><label>重大性复核<select value={form.verdict} onChange={e=>update('verdict',e.target.value)}>{Object.entries(labels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><label>实际阅读范围<select value={form.scope} onChange={e=>update('scope',e.target.value)}><option value="headline-only">仅标题 / 摘要线索</option><option value="source-reviewed">已阅读来源正文</option></select></label></div>
 {form.scope==='source-reviewed'&&<label>实际阅读的来源<input type="url" required value={form.sourceUrl} onChange={e=>update('sourceUrl',e.target.value)}/></label>}
 {fields.map(([key,label])=><label key={key}>{label}<textarea rows={2} maxLength={1200} required={form.verdict==='major'&&['novelty','scale','mechanism'].includes(key)} value={form[key]} onChange={e=>update(key,e.target.value)} placeholder="未确定时写明缺口与核验方法"/></label>)}
 <label>复核依据与限制<textarea required rows={3} maxLength={1200} value={form.note} onChange={e=>update('note',e.target.value)}/></label><Button primary type="submit" disabled={busy||base!==version}>保存初筛复核</Button><Button type="button" onClick={()=>editor.reset()}>丢弃初筛复核草稿并载入最新版本</Button></fieldset>
 </form></details>
 {sample.reviews.length>0&&<details><summary>复核历史 {sample.reviews.length} 版</summary>{sample.reviews.map(r=><p className="m-note" key={r.version}>v{r.version} · {labels[r.verdict]} · {time(r.reviewedAt)}<br/>{r.note}</p>)}</details>}
 </>;
}
