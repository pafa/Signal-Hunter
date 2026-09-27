import React,{useEffect,useState} from 'react';
import {Button} from './Primitives';
import {request,time} from './api';
import './screening.css';
const labels={major:'重大候选',ordinary:'普通资讯',unclear:'信息不足'};
const fields=[['novelty','新增了什么'],['scale','相对业务量级'],['mechanism','如何影响公司'],['expectations','市场已反映多少'],['duration','影响持续多久']];
export default function ScreeningReview({news,mutate,busy}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');request(`/api/news/${news.id}/screening`).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[news.id,news.revision,reload]);
 const sample=data?.samples.find(s=>s.input.revision===news.revision&&s.rulesHash===data.currentRulesHash);
 return <section className="screening-review" aria-label="重大性初筛与复核"><h3>重大性与紧急程度</h3>
 {news.triage.screening&&<><p className={news.triage.screening.urgency==='priority'?'m-warning':'m-note'}>{news.triage.screening.urgency==='priority'?'优先核验':'常规研判'} · {news.triage.screening.urgencyReason}</p><div className="screening-dimensions">{news.triage.screening.dimensions.map(d=><div key={d.key}><b>{d.label}<small>待核验</small></b><p>{d.question}</p></div>)}</div><p className="m-note">{news.triage.screening.nextAction}。事实概率与上涨概率均未估计。</p></>}
 {error&&<p className="m-warning" role="alert">{error}<Button onClick={()=>setReload(v=>v+1)}>重试样本读取</Button></p>}
 {!data&&!error&&<p className="m-note">读取初筛留样…</p>}
 {data&&!sample&&<p className="m-note">本版新闻尚未生成当前规则留样，等待下一次初筛。</p>}
 {sample&&<ReviewForm key={`${sample.id}:${sample.reviews[0]?.version||0}`} sample={sample} mutate={mutate} busy={busy} onSaved={()=>setReload(v=>v+1)}/>}
 </section>;
}
function ReviewForm({sample,mutate,busy,onSaved}){
 const latest=sample.reviews[0];
 const [form,setForm]=useState({verdict:'unclear',scope:'headline-only',sourceUrl:'',novelty:'',scale:'',mechanism:'',expectations:'',duration:'',note:'',...latest});
 const update=(key,value)=>setForm(v=>({...v,[key]:value}));
 return <><p className="m-note">初筛留样 {time(sample.decisionAt)} · {sample.origin==='historical-diagnostic'?'历史材料诊断':'启用后首次入库'} · {sample.inputHash.slice(0,12)}。包含普通资讯，尚未完成独立样本审核。</p>
 <details className="screening-edit"><summary>{latest?`人工复核：${labels[latest.verdict]} · v${latest.version}`:'复核重大性 / 记录误报与漏报'}</summary><form className="m-form" onSubmit={async e=>{e.preventDefault();if(await mutate('/api/news/screening-review','POST',{...form,sampleId:sample.id,version:latest?.version||0}))onSaved();}}>
 <p className="m-note">此复核已展示规则结果，属于辅助标注；不会覆盖原初筛或自动创建研究和订单。传闻可标为重大候选，尚不等于事实成立。</p>
 <div className="m-form-row"><label>重大性复核<select value={form.verdict} onChange={e=>update('verdict',e.target.value)}>{Object.entries(labels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><label>实际阅读范围<select value={form.scope} onChange={e=>update('scope',e.target.value)}><option value="headline-only">仅标题 / 摘要线索</option><option value="source-reviewed">已阅读来源正文</option></select></label></div>
 {form.scope==='source-reviewed'&&<label>实际阅读的来源<input type="url" required value={form.sourceUrl} onChange={e=>update('sourceUrl',e.target.value)}/></label>}
 {fields.map(([key,label])=><label key={key}>{label}<textarea rows={2} maxLength={1200} required={form.verdict==='major'&&['novelty','scale','mechanism'].includes(key)} value={form[key]} onChange={e=>update(key,e.target.value)} placeholder="未确定时写明缺口与核验方法"/></label>)}
 <label>复核依据与限制<textarea required rows={3} maxLength={1200} value={form.note} onChange={e=>update('note',e.target.value)}/></label><Button primary type="submit" disabled={busy}>保存初筛复核</Button>
 </form></details>
 {sample.reviews.length>0&&<details><summary>复核历史 {sample.reviews.length} 版</summary>{sample.reviews.map(r=><p className="m-note" key={r.version}>v{r.version} · {labels[r.verdict]} · {time(r.reviewedAt)}<br/>{r.note}</p>)}</details>}
 </>;
}
