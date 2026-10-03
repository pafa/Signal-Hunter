import React from 'react';
import {Button} from './Primitives';
import {MATERIALITY_VALUES,calculateMateriality} from '../../shared/company-materiality.mjs';
import './company-materiality.css';

const format=(v,percent=false)=>v==null?'无法计算':`${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:4}).format(v)}${percent?'%':''}`;
const empty=()=>({id:crypto.randomUUID(),label:'',scope:'',period:'',unit:'',basis:'',comparable:false,eventAt:'',expectationAt:'',baseline:null,affected:null,expected:null,observed:null});

export function CompanyMaterialityEditor({rows=[],evidence,onChange,busy}){
 const update=(id,patch)=>onChange(rows.map(row=>row.id===id?{...row,...patch}:row));
 return <details className="company-materiality"><summary>量级、敞口与预期差 · {rows.length} 项</summary>
 <p className="m-note">每项只比较同一主体、期间、单位与业务口径。材料数值需引用证据；估计值请选择假设。未知可留空，系统不会填零、换汇、年化或把订单额当收入。</p>
 {rows.map((row,index)=><fieldset key={row.id} disabled={busy}><legend>量级记录 {index+1}</legend>
 <div className="materiality-fields">{[['label','指标名称','如收入、产能或订单额',120],['scope','主体及业务口径','如某公司合并口径营业收入',200],['period','比较期间','如2026全年；不可将单季直接与全年比较',160],['unit','共同单位','如百万USD、万台；所有数值使用此单位',80]].map(([key,label,placeholder,max])=><label key={key}>{label}<input required maxLength={max} value={row[key]} placeholder={placeholder} onChange={e=>update(row.id,{[key]:e.target.value})}/></label>)}</div>
 {Object.entries(MATERIALITY_VALUES).map(([key,label])=><div className="materiality-value" key={key}>
 <label>{label}<input type="number" step="any" min={-1e12} max={1e12} value={row[key]?.value??''} placeholder="未知留空" onChange={e=>update(row.id,{[key]:e.target.value===''?null:{kind:'assumption',evidenceIds:[],...row[key],value:Number(e.target.value)}})}/></label>
 {row[key]!=null&&<><label>{label}的性质<select aria-label={`${label}的性质`} value={row[key].kind} onChange={e=>update(row.id,{[key]:{...row[key],kind:e.target.value}})}><option value="assumption">人工假设 / 情景值</option><option value="source">材料数值（需核对）</option></select></label><label>{label}引用证据<select aria-label={`${label}引用证据`} multiple required={row[key].kind==='source'} value={row[key].evidenceIds} onChange={e=>update(row.id,{[key]:{...row[key],evidenceIds:Array.from(e.target.selectedOptions,o=>o.value)}})}>{evidence.map(e=><option key={e.id} value={e.id}>{e.claim}</option>)}</select></label></>}
 </div>)}
 <p className="m-note">“涉及规模”需为比较基准中的非负子集；超过基准或基准不为正时不计算敞口比例。负基准的相对变化使用其绝对值作分母；基准为零时只报告差额。</p>
 <div className="materiality-fields"><label>原预期形成时刻<input value={row.expectationAt||''} placeholder="可留空；如2026-10-01T09:00:00+08:00" onChange={e=>update(row.id,{expectationAt:e.target.value})}/></label><label>事件 / 结果时刻<input value={row.eventAt||''} placeholder="可留空；须含时区" onChange={e=>update(row.id,{eventAt:e.target.value})}/></label></div>
 <label>数值依据、假设及不可比风险<textarea required rows={3} maxLength={1200} value={row.basis} onChange={e=>update(row.id,{basis:e.target.value})}/></label>
 <label className="company-check"><input type="checkbox" checked={row.comparable===true} onChange={e=>update(row.id,{comparable:e.target.checked})}/>我已核对这些数值使用相同主体、期间、单位与业务口径</label>
 <p className="m-note">未保存的计算预览；来源与时序在保存时重新核对。</p><MaterialityResults result={calculateMateriality(row)} unit={row.unit}/>
 <Button type="button" onClick={()=>onChange(rows.filter(r=>r.id!==row.id))}>移除此量级记录</Button>
 </fieldset>)}
 <Button type="button" disabled={busy||rows.length>=8} onClick={()=>onChange([...rows,empty()])}>添加量级记录</Button>
 <p className="m-note">随“保存关系新版本”一起保存，旧版本继续保留。计算不生成重要性分数、上涨概率或交易决定。</p>
 </details>;
}

function MaterialityResults({result:r,unit}){return <dl className="materiality-results">{[['变化差额',format(r.delta)+(r.delta==null?'':` ${unit}`)],['相对基准变化',format(r.relativeChange,true)],['涉及规模占基准',format(r.exposure,true)],['相对原预期差额',format(r.expectationDelta)+(r.expectationDelta==null?'':` ${unit}`)],['相对原预期偏差',format(r.expectationGap,true)]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;}

export function CompanyMaterialityView({value}){
 if(!value?.rows?.length)return <p className="m-note">尚无结构化量级计算，可在“完善公司分析”补充基准、涉及规模与原预期。</p>;
 return <section className="company-materiality" aria-label="公司量级与预期差"><h3>量级、敞口与预期差</h3>
 {value.rows.map(row=><article key={row.id}><h4>{row.label} · {row.period}</h4><p>{row.scope} · 单位：{row.unit}</p>
 <dl>{Object.entries(MATERIALITY_VALUES).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{row[key]==null?'未知':`${format(row[key].value)} · ${row[key].kind==='source'?'材料数值（未自动核验）':'人工假设'}`}</dd></div>)}</dl>
 <MaterialityResults result={row.result} unit={row.unit}/><p className="m-note">差额＝新值－基准；相对变化＝差额÷基准绝对值。预期偏差同理。缺值或零分母不计算比例；涉及规模须介于零与正基准之间。显示最多四位小数，保存原始数值。</p><p>{row.basis}</p>
 <p className="m-note">{row.result.expectationBasis==='pre-event-source-available'?'原预期所引材料在所填事件时点前已获取；数值及预期含义仍需核对。':'原预期缺失、属于假设或事前可用时间未证实；仅可作回溯 / 情景比较。'} 这不是独立前向验证，也不证明价格尚未反映。</p>
 <details><summary>数值来源与保存口径</summary><p>原预期时刻：{row.expectationAt||'未填'} · 事件 / 结果时刻：{row.eventAt||'未填'}</p>{Object.entries(MATERIALITY_VALUES).map(([key,label])=><div key={key}><b>{label}</b>{row[key]?.references.length?row[key].references.map(e=><p key={e.id}>{e.claim}<br/>获取：{e.availableAt||'未知'} · {e.newsRevision?`新闻 v${e.newsRevision}`:e.materialRevision?`材料 v${e.materialRevision}`:'人工证据'}{e.url&&<> · <a href={e.url} target="_blank" rel="noreferrer">查看来源</a></>}</p>):<p>无材料引用；数值如有填写，按人工假设处理。</p>}</div>)}</details>
 </article>)}<small>计算规则：{value.version} · 保存：{value.savedAt}。不合计跨公司或同发行人证券的比例。</small>
 </section>;
}
