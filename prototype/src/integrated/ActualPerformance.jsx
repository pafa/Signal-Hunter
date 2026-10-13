import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
const money=(v,c)=>v==null?'未知':new Intl.NumberFormat('zh-CN',{style:'currency',currency:c}).format(v/100);
const percent=v=>v==null?'未知':`${v.toFixed(2)}%`;
export function PerformanceChart({items}){
 const rows=[...items].reverse(),valid=rows.filter(p=>p.index!==null&&p.eligible);if(valid.length<2)return <p className="m-note">至少两个有效采样后显示资金流调整指数；不填充缺失曲线。</p>;
 const lo=Math.min(...valid.map(p=>p.index)),hi=Math.max(...valid.map(p=>p.index)),span=Math.max(hi-lo,1),x=i=>25+i*950/Math.max(1,rows.length-1),y=v=>155-(v-lo)*125/span,paths=[];let path='',window='';
 rows.forEach((p,i)=>{if(!p.eligible||p.index===null){if(path)paths.push(path);path='';window='';return;}if(window!==p.windowStart){if(path)paths.push(path);path='';}path+=`${path?' L':'M'}${x(i)},${y(p.index)}`;window=p.windowStart;});if(path)paths.push(path);
 return <figure className="actual-performance-chart"><figcaption>资金流调整参考指数 · 每段窗口首点为100</figcaption><svg viewBox="0 0 1000 180" role="img" aria-label="已记录资金流调整指数；缺口与重建窗口不连线"><text x="25" y="16">{hi.toFixed(2)}</text><text x="25" y="175">{lo.toFixed(2)}</text>{paths.map((d,i)=><path key={i} d={d}/>)}{rows.map((p,i)=>p.eligible&&p.index!==null&&<circle key={p.id} cx={x(i)} cy={y(p.index)} r="3"><title>{time(p.at)} · 指数 {p.index.toFixed(4)} · 净值 {money(p.navCents,p.currency)}</title></circle>)}</svg><small>仅本页{rows.length}个采样；指标按完整历史核算。历史修订和缺价保持可见，不代表期间连续行情。</small></figure>;
}
export default function ActualPerformance({account}){
 const [expanded,setExpanded]=useState(false),[loaded,setPage]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[pageIndex,setPageIndex]=useState(0);const tickets=useRef(0),flight=useRef(false),queries=useRef([]);
 const summary=account?.performance,page=loaded?.accountId===account?.id?loaded:null;
 async function load(query={},index=0){const n=++tickets.current;flight.current=true;setLoading(true);setError('');try{const p=await request(`/api/actual-performance/${account.id}${Object.keys(query).length?'?'+new URLSearchParams(query):''}`);if(n!==tickets.current)return;queries.current[index]={...query,ceiling:String(p.ceiling)};queries.current.length=index+1;setPage(p);setPageIndex(index);}catch(e){if(n===tickets.current){setError(e.message);setPage(null);}}finally{if(n===tickets.current){flight.current=false;setLoading(false);}}}
 useEffect(()=>{if(expanded&&account)void load();return()=>{tickets.current++;flight.current=false;};},[expanded,account?.id]);
 if(!account)return null;
 const p=page?.summary||summary,changed=page&&(summary?.lastId!==page.summary.lastId||summary?.ledgerVersion!==page.summary.ledgerVersion);
 return <section className="actual-performance" aria-label={`净值与收益：${account.label}`}>
  <h3>参考净值与收益</h3><p>{summary?.reason||'后台尚未记录净值采样'} · 记录至 {time(summary?.asOf)}。</p>
  <p>区间参考收益 <b>{percent(summary?.referenceReturnPct)}</b> · 采样当前 / 最大回撤 <b>{percent(summary?.currentDrawdownPct)} / {percent(summary?.maxDrawdownPct)}</b></p>
  <p className="m-note">{summary?.windowStart?`比较窗口 ${time(summary.windowStart)} → ${time(summary.asOf)}，${summary.windowSamples}个有效采样。`:'尚未形成比较窗口。'} 今日变化从账户当地首个有效采样起，不等于完整交易日收益。</p>
  <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>查看净值路径、资金流和核算依据</summary>
   <p>{summary?.basis}</p><p className="m-note">{summary?.limit}</p>
   {error&&<p role="alert" className="m-warning">{error}；读取失败时不显示旧页为最新数据。</p>}{loading&&<p role="status">读取已保存的净值采样…</p>}
   {changed&&<p className="m-note">后台采样或账本已有变化；本页保留读取时状态，刷新可核对当前记录。</p>}
   {page&&<><p>第{pageIndex+1}页 · 本次范围{page.total}个记录 · 读取时账本 v{p.ledgerVersion} 可用{p.eligibleSamples}个，缺价 / 修订等缺口{p.gapSamples}个。账户时区 {p.timeZone}。</p><p className="m-note">{page.note}</p><PerformanceChart items={page.items}/><div className="actual-table-scroll"><table className="i-table"><thead><tr><th>采样时间</th><th>净值 / 现金 {page.currency}</th><th>区间资金流 / 损益</th><th>参考指数 / 回撤</th><th>有效性与依据</th></tr></thead><tbody>{page.items.map(r=><tr key={r.id}><td>{time(r.at)}</td><td>{money(r.navCents,page.currency)}<small>现金 {money(r.cashCents,page.currency)}</small></td><td>{money(r.interval?.netFlowCents,page.currency)}<small>损益 {money(r.interval?.pnlCents,page.currency)}</small></td><td>{r.index==null?'未知':r.index.toFixed(4)}<small>{percent(r.drawdownPct)}</small></td><td>{r.issue||r.resetReason||r.interval?.reason||'有效采样'}<details><summary>原始采样依据</summary><p>账本 v{r.ledgerVersion} · 记录 #{r.id} · {r.eligible?'当前账本核对一致':'仅保留历史，不参与当前收益'}</p><p>{r.interval?.weightedCapitalCents!=null?`区间时间加权资金 ${money(r.interval.weightedCapitalCents,page.currency)}`:''}</p>{r.interval?.flows?.map(f=><p key={f.id}>{time(f.at)} · 净资金流 {money(f.cents,page.currency)} · 原记录 {f.id} / 修订 {f.revision}</p>)}{r.quotes.map(q=><p key={q.symbol}>{q.symbol} · {q.quantity}股 · 标记价 {q.price??'未知'} · {time(q.priceAt)} · {q.provenance?.source||'无合格行情'}<small>报价指纹 {q.provenance?.quoteHash||'未知'}</small></p>)}</details></td></tr>)}</tbody></table></div></>}
   <div className="m-form-actions"><Button disabled={loading||pageIndex===0} onClick={()=>{if(!flight.current&&pageIndex>0)void load(queries.current[pageIndex-1],pageIndex-1);}}>较新采样</Button><Button disabled={loading||!page?.nextCursor} onClick={()=>{if(!flight.current&&page?.nextCursor)void load({ceiling:String(page.ceiling),before:page.nextCursor},pageIndex+1);}}>较早采样</Button><Button disabled={loading} onClick={()=>{if(!flight.current)void load();}}>刷新净值记录</Button></div>
  </details>
 </section>;
}
