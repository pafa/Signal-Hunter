import NewsCoverageReport from './NewsCoverageReport';
import {OFFICIAL_NEWS_SOURCES} from '../../shared/news-sources.mjs';
import {safeErrorText} from '../../shared/safe-errors.mjs';
import React,{useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
const state=r=>!r?'未尝试':({ok:r.acceptedCount?'收取成功':'成功返回 · 0 条窗口内标题',partial:'部分收取 · 完整性未确认',error:'收取失败',cancelled:'已中止',running:'执行中',interrupted:'运行中断'})[r.state]||r.state;
const official=OFFICIAL_NEWS_SOURCES.map(s=>[s.setting,s.label]);
export default function NewsCoverage({data,mutate,busy}){
 const [form,setForm]=useState(()=>({...data?.settings})),[dirty,setDirty]=useState(false),[window,setWindow]=useState({from:'',to:''}),[receipt,setReceipt]=useState(null),[error,setError]=useState(''),[backfillError,setBackfillError]=useState('');
 const settings=dirty?form:data?.settings||{};
 const update=(key,value)=>{setForm({...settings,[key]:value});setDirty(true);};
 return <details className="news-coverage"><summary>新闻入口与覆盖记录</summary>
 <p className="m-note">Reuters两路共用聚合源；官方入口独立收取，但多个发布者不自动等于同一事实有独立佐证。只保存标题、来源与原始响应，不代表阅读全文或全市场覆盖。旧实例的新来源默认关闭。</p>
 {mutate&&<><form className="m-form" onSubmit={async e=>{e.preventDefault();const result=await mutate('/api/settings','PATCH',settings);if(result)setDirty(false);}}>
 <label className="company-check"><input type="checkbox" checked={settings.newsDiscoveryEnabled!==false} onChange={e=>update('newsDiscoveryEnabled',e.target.checked)}/>广泛事件发现（不受下方关键词限制）</label>
 <label className="company-check"><input type="checkbox" checked={settings.newsTrackingEnabled!==false} onChange={e=>update('newsTrackingEnabled',e.target.checked)}/>重点关键词跟踪</label>
 <label>跟踪关键词<input value={settings.keywords||''} onChange={e=>update('keywords',e.target.value)} maxLength={120} placeholder="英文公司名、行业或主题；留空不运行此路"/></label>
 {official.map(([key,label])=><label className="company-check" key={key}><input type="checkbox" checked={settings[key]===true} onChange={e=>update(key,e.target.checked)}/>{label}（不受关键词限制）</label>)}
 <Button type="submit" disabled={busy||!dirty}>保存订阅设置</Button>
 </form><form className="m-form" onSubmit={async e=>{e.preventDefault();setBackfillError('');await mutate('/api/news/backfill','POST',{sourceId:'hkma',...window},{onError:setBackfillError});}}>
 <h4>按日期补采 · 香港金管局</h4><p className="m-note">最多31天、3页共300条；超限、重复页和失败会保留记录。首次获取仍记本次时间，发布日期不代表当时已经掌握。美联储与证监会当前入口不能保证补回历史。</p>
 <label>补采开始日期<input type="date" required value={window.from} onChange={e=>setWindow({...window,from:e.target.value})}/></label><label>补采结束日期<input type="date" required value={window.to} onChange={e=>setWindow({...window,to:e.target.value})}/></label>
 <Button type="submit" disabled={busy||data?.runtime?.offline||data?.settings?.newsHkmaEnabled!==true||data?.operations?.news?.paused||data?.operations?.news?.running}>补采所选日期</Button>
 {backfillError&&<p className="m-warning" role="alert">{backfillError}</p>}
 </form></>}
 <div className="coverage-queries">{(data?.newsIntake?.queries||[]).map(q=>{const r=q.last,s=q.lastSuccess;return <article key={q.id}><header><b>{q.label}</b><span>{q.enabled?'已启用':'未启用'}</span></header>
 <p>{data?.runtime?.offline?'演示模式不发起采集':state(r)} · {q.keywords||(q.id==='tracking'?'关键词为空，不请求':'无关键词限制')}</p><small>{q.scope}</small>
 <small>最近尝试 {time(r?.startedAt)} · 最后成功 {time(s?.finishedAt)}</small>
 {r&&<small>{r.kind==='backfill'?'补采':'近期收取'}：{time(r.requestedFrom)} — {time(r.requestedTo)}</small>}
 {r?.sourceObservedTo&&<small>来源本次最新发布日期：{time(r.sourceObservedTo)}</small>}
 {r?.error&&<p className="m-warning">{safeErrorText(r.error)} · 已保存的页和旧标题保留</p>}
 {r&&<><small>原始 {r.rawCount??'—'} · 接受 {r.acceptedCount??'—'} · 不合格 {r.rejectedCount??'—'} · 窗口外 {r.outsideWindow??0} · 重复 {r.duplicates??0} · 新增 {r.added??'—'} · 修订 {r.updated??'—'}</small><small>窗口内发布时间：{r.observedFrom?`${time(r.observedFrom)} — ${time(r.observedTo)}`:'没有合格条目'}</small>{r.possiblyTruncated&&<p className="m-warning">入口或页数存在上限；只代表本次返回内容，不能判断完整覆盖。</p>}{r.coverage==='api-range-exhausted'&&<small>API日期范围已翻页至末页；不证明全市场或独立新闻覆盖。</small>}{r.unobservedSeconds>1800&&<p className="m-warning">距离此前成功收取约 {Math.ceil(r.unobservedSeconds/60)} 分钟；间隔内覆盖待核对。</p>}</>}
 </article>;})}</div>
 <NewsCoverageReport serverTime={data?.serverTime}/>
 <details><summary>最近 30 次入口记录</summary><div className="ops-scroll"><table className="i-table"><thead><tr><th>入口 / 开始</th><th>结果</th><th>新增 / 修订</th><th>留档</th></tr></thead><tbody>{(data?.newsIntake?.recent||[]).map(r=><tr key={r.id}><td>{r.label}<small>{time(r.startedAt)}</small></td><td>{state(r)}<small>{safeErrorText(r.error)}</small></td><td>{r.added??'—'} / {r.updated??'—'}</td><td><Button onClick={async()=>{try{setReceipt(await request(`/api/news/intake/${r.id}`));setError('');}catch(e){setError(e.message);}}}>逐页记录</Button></td></tr>)}</tbody></table></div></details>
 {error&&<p role="alert">{error}</p>}{receipt&&<section aria-label="采集逐页记录"><h4>{receipt.label} · 原始响应指纹</h4><p className="m-note">原始响应保存在本机数据库中。旧版没有留档时不补造。</p>{receipt.pages.map(p=><p key={p.page}>第 {p.page} 页 · {p.payload.state} · {time(p.receivedAt)}<br/>指纹 {p.responseHash?.slice(0,20)||'未收到响应'}<br/>接受 {p.payload.acceptedCount??'—'} · 不合格 {p.payload.rejectedCount??'—'}{p.payload.error&&<small>{safeErrorText(p.payload.error)}</small>}</p>)}{!receipt.pages.length&&<p>此旧记录没有逐页响应留档。</p>}</section>}
 </details>;
}
