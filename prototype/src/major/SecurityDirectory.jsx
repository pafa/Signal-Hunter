import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time} from './api';
const states={running:'更新中',complete:'已保存',failed:'失败，保留原版',interrupted:'中断，未自动重试'};
export default function SecurityDirectory(){
 const [data,setData]=useState(null),[q,setQ]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[snapshotId,setSnapshotId]=useState(''),[refresh,setRefresh]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState('');
 const pending=useRef(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true,timer;setData(null);async function load(){try{const params=new URLSearchParams({q:query,offset:String(offset),...(snapshotId?{snapshotId}:{})}),r=await request('/api/security-directory?'+params);if(!active)return;setData(r);if(r.running)timer=setTimeout(load,2000);}catch(e){if(active)setError(e.message);}}void load();return()=>{active=false;clearTimeout(timer);};},[query,offset,snapshotId,refresh]);
 async function update(){setWorking(true);setError('');pending.current??={requestId:crypto.randomUUID()};try{await request('/api/security-directory/refresh','POST',pending.current);if(alive.current){pending.current=null;setRefresh(n=>n+1);}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}}
 const s=data?.search?.snapshot;
 return <details className="security-directory"><summary>证券目录 · {data?.current?`${data.current.counts.eligible} 条美股候选`:'尚无官方快照'}</summary>
 <p>手动获取 Nasdaq 官方两份证券目录，保留原文和旧版本。名称匹配只提供待核对候选；快照不证明实时可交易，也不证明历史日期已上市。</p>
 <p>A 股、港股仍为有限手工条目；美股剔除测试证券、ETF、代码或股票类型未确认的行。简称、译名、母子公司和重组关系可能遗漏。</p>
 <Button disabled={!data?.enabled||data?.running||working} onClick={update}>{data?.running?'正在获取官方目录…':'获取官方美股目录'}</Button>
 {data?.current&&<p>最近保存 {time(data.current.receivedAt)} · 距今 {data.ageDays.toFixed(1)} 天。新版本用于后续识别，旧模型候选保留并提示重新核对。</p>}
 {error&&<p className="m-warning" role="alert">{error}</p>}
 <label>目录快照<select value={snapshotId} onChange={e=>{setSnapshotId(e.target.value);setOffset(0);}}><option value="">当前版本</option>{data?.history.map(h=><option key={h.id} value={h.id}>{time(h.receivedAt)} · {h.id.slice(0,10)}</option>)}</select></label>
 <label>查询证券名称或代码<input value={q} maxLength={120} onChange={e=>setQ(e.target.value)}/></label><Button disabled={!data} onClick={()=>{setQuery(q);setOffset(0);setRefresh(n=>n+1);}}>查询目录</Button>
 {s&&<><p>{snapshotId?'正在查看选定历史快照':'当前快照'} · 原始 {s.counts.rows} 行 · 候选 {s.counts.eligible} 行 · 排除 {s.counts.excluded} 行</p>{s.sources.map(v=><p key={v.id}><a href={v.url} target="_blank" rel="noreferrer">{v.id} 官方来源</a> · 生成日期 {v.sourceDate}（时区未核实） · 获取 {time(v.receivedAt)}</p>)}</>}
 {!data?<p>正在读取目录…</p>:<><p role="status">匹配 {data.search.total} 条；第 {data.search.total?offset+1:0}–{Math.min(offset+20,data.search.total)} 条</p><ul>{data.search.items.map(c=><li key={c.symbol} style={{overflowWrap:'anywhere'}}>{c.name} · {c.symbol} · {c.venue} / {c.currency}</li>)}</ul><div className="m-form-actions"><Button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>目录上一页</Button><Button disabled={offset+20>=data.search.total} onClick={()=>setOffset(offset+20)}>目录下一页</Button></div></>}
 {!!data?.attempts.length&&<details><summary>目录更新记录</summary>{data.attempts.map(a=><p key={a.id}>{time(a.startedAt)} · {states[a.status]} {a.message||''}</p>)}</details>}
 </details>;
}
