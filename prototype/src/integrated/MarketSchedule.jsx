import React,{useEffect,useState} from 'react';
import {marketSchedule} from '../../shared/market-schedule.mjs';

export default function MarketSchedule({symbol}){
 const [at,setAt]=useState(()=>new Date().toISOString());
 useEffect(()=>{const timer=setInterval(()=>setAt(new Date().toISOString()),30000);return()=>clearInterval(timer);},[]);
 const s=marketSchedule(symbol,at);
 return <details className="company-minute"><summary>市场时段 · {s.phase}（计划）</summary>
 <p>{s.zone||'时区待核验'}{s.date&&` · ${s.date} ${s.localNow}`} · 按本机时间更新</p>
 {s.known&&<><p><b>下一次{s.nextOpening?.kind||'常规开盘'}：</b>{s.nextOpening?`${s.nextOpening.date} ${s.nextOpening.local} 当地 · 北京 ${s.nextOpening.beijing}`:'日历未覆盖，时间待核验'}</p>
 {s.periods.length>0&&<><h4>{s.displayDate} {s.displayHalf?'半日市':'计划时段'}{s.displayDate!==s.date?' · 下一交易日':''}</h4><dl className="company-impact">{s.periods.map(p=><div key={p.label}><dt>{p.label}</dt><dd>当地 {p.start.local}–{p.earliestEnd?`${p.earliestEnd.local} 至 ${p.end.local} 随机结束`:p.end.local}<br/>北京 {p.start.beijing} → {p.earliestEnd?`${p.earliestEnd.beijing} 至 ${p.end.beijing}`:p.end.beijing}</dd></div>)}</dl></>}</>}
 <p className="m-note">仅覆盖已维护的2026年股票常规时段。港股延续早市及非收市竞价证券、盘前盘后和其他特别时段未列入；停牌与临时安排须另核对。计划时段不代表该证券当前可成交。</p>
 <p>{s.sources.map((source,i)=><React.Fragment key={source.url}>{i>0?' · ':''}<a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></React.Fragment>)}</p>
 </details>;
}
