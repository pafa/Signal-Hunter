import React,{useState} from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
const state=r=>!r?'未尝试':({ok:r.acceptedCount?'收取成功':'成功返回 · 0 条合格标题',error:'收取失败',cancelled:'已中止',running:'执行中',interrupted:'运行中断'})[r.state]||r.state;
export default function NewsCoverage({data,mutate,busy}){
 const [form,setForm]=useState(()=>({...data?.settings})),[dirty,setDirty]=useState(false);
 const settings=dirty?form:data?.settings||{};
 const update=(key,value)=>{setForm({...settings,[key]:value});setDirty(true);};
 return <details className="news-coverage"><summary>新闻入口与覆盖记录</summary>
 <p className="m-note">广泛发现与关键词跟踪分别收取；两路仍来自同一个 Google News / Reuters 聚合入口，不构成两个独立证据源。最近 7 天是查询窗口，以下只是实际返回范围，无法证明期间新闻完整。</p>
 {mutate&&<form className="m-form" onSubmit={async e=>{e.preventDefault();const result=await mutate('/api/settings','PATCH',settings);if(result)setDirty(false);}}>
 <label className="company-check"><input type="checkbox" checked={settings.newsDiscoveryEnabled!==false} onChange={e=>update('newsDiscoveryEnabled',e.target.checked)}/>广泛事件发现（不受下方关键词限制）</label>
 <label className="company-check"><input type="checkbox" checked={settings.newsTrackingEnabled!==false} onChange={e=>update('newsTrackingEnabled',e.target.checked)}/>重点关键词跟踪</label>
 <label>跟踪关键词<input value={settings.keywords||''} onChange={e=>update('keywords',e.target.value)} maxLength={120} placeholder="英文公司名、行业或主题；留空不运行此路"/></label>
 <Button type="submit" disabled={busy||!dirty}>保存订阅设置</Button>
 </form>}
 <div className="coverage-queries">{(data?.newsIntake?.queries||[]).map(q=>{const r=q.last,s=q.lastSuccess;return <article key={q.id}><header><b>{q.label}</b><span>{q.enabled?'已启用':'未启用'}</span></header>
 <p>{data?.runtime?.offline?'演示模式不发起采集':state(r)} · {q.keywords||(q.id==='tracking'?'关键词为空，不请求':'无关键词限制')}</p>
 <small>最近尝试 {time(r?.startedAt)} · 最后成功 {time(s?.finishedAt)}</small>
 {r?.error&&<p className="m-warning">{r.error} · 已有标题保留</p>}
 {s&&<><small>原始 {s.rawCount} · 接受 {s.acceptedCount} · 过滤 {s.rejectedCount} · 新增 {s.added} · 修订 {s.updated}</small><small>实际返回发布时间：{s.observedFrom?`${time(s.observedFrom)} — ${time(s.observedTo)}`:'没有合格条目'}</small>{s.possiblyTruncated&&<p className="m-warning">返回条目达到 100；可能截断，不能据此判断全量覆盖。</p>}{r?.unobservedSeconds>1800&&<p className="m-warning">距离此前成功收取约 {Math.ceil(r.unobservedSeconds/60)} 分钟；未采集间隔的覆盖待核对。</p>}</>}
 </article>;})}</div>
 <details><summary>最近 30 次入口记录</summary><div className="ops-scroll"><table className="i-table"><thead><tr><th>入口 / 开始</th><th>结果</th><th>新增 / 修订</th></tr></thead><tbody>{(data?.newsIntake?.recent||[]).map(r=><tr key={r.id}><td>{r.label}<small>{time(r.startedAt)}</small></td><td>{state(r)}<small>{r.error||''}</small></td><td>{r.added??'—'} / {r.updated??'—'}</td></tr>)}</tbody></table></div></details>
 </details>;
}
