import React,{useEffect,useRef,useState} from 'react';
import {money,pct} from '../data';
import {Pane} from './Primitives';

export default function PriceChart({stock,position}){
 const [period,setPeriod]=useState('1分'),[size,setSize]=useState({w:600,h:270}),[hover,setHover]=useState(null);const ref=useRef(null);
 useEffect(()=>{setHover(null);},[stock.id,period]);
 useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({w:entry.contentRect.width,h:entry.contentRect.height}));observer.observe(ref.current);return()=>observer.disconnect();},[]);
 const trend=period==='1月'?stock.trend:stock.trend.slice(period==='5分'?4:0);
 const values=trend.map(v=>stock.price*(1+v/100)/(1+stock.trend.at(-1)/100));
 const points=period==='1月'?values:values.flatMap((v,i)=>i===values.length-1?[v]:[v,v+(values[i+1]-v)*.32+(i%2?.025:-.018)*stock.price/10,v+(values[i+1]-v)*.67]);
 const w=Math.max(250,size.w),h=Math.max(140,size.h),left=14,right=64,top=24,bottom=34;
 const baseMin=Math.min(...points,position?.price??Infinity),baseMax=Math.max(...points,position?.price??-Infinity),pad=(baseMax-baseMin)*.15||1;
 const lo=baseMin-pad,hi=baseMax+pad,x=i=>left+i*(w-left-right)/(points.length-1),y=v=>top+(hi-v)/(hi-lo)*(h-top-bottom);
 const d=points.map((v,i)=>`${i?'L':'M'}${x(i)},${y(v)}`).join(' '),down=points.at(-1)<points[0],color=down?'var(--t-loss)':'var(--t-accent)';
 const labels=period==='1月'?['08/26','09/02','09/09','09/16','09/24']:['09:30','10:30','11:30','13:00','14:32'];const eventIndex=Math.floor(points.length*.73);
 return <Pane title={stock.name} meta={`${stock.symbol} · ${stock.market}`} className="price-pane" tools={<span className="sample-label">示例走势</span>}><div className="quote-line"><div><span className="quote-currency">{stock.currency}</span><strong className="num">{stock.price.toFixed(2)}</strong><span className={`quote-change num ${stock.trend.at(-1)<0?'loss':'profit'}`}>{pct(stock.trend.at(-1))}<small>近月变化</small></span></div><div className="chart-tabs" role="group" aria-label="走势周期">{['1分','5分','1月'].map(p=><button key={p} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p}</button>)}</div></div><div className="price-canvas" ref={ref}><svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${stock.name} ${period}示例价格走势，${stock.currency}`} onMouseLeave={()=>setHover(null)} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(points.length-1,Math.round((e.clientX-r.left-left)/(w-left-right)*(points.length-1)))));}}>
 <defs><linearGradient id="terminal-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".12"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
 {[0,1,2,3,4].map(i=>{const v=lo+(hi-lo)*i/4;return <g key={i}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} className="chart-grid"/><text x={w-right+10} y={y(v)+4}>{v.toFixed(2)}</text></g>;})}
 {labels.map((label,i)=><g key={label}><line className="chart-grid vertical" x1={left+i*(w-left-right)/4} x2={left+i*(w-left-right)/4} y1={top} y2={h-bottom}/><text x={left+i*(w-left-right)/4} y={h-10} textAnchor={i===0?'start':i===4?'end':'middle'}>{label}</text></g>)}
 <path d={`${d}L${x(points.length-1)},${h-bottom}L${left},${h-bottom}Z`} fill="url(#terminal-area)"/><path d={d} stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none"/>
 {position&&<g><line x1={left} x2={w-right} y1={y(position.price)} y2={y(position.price)} className="cost-line"/><text x={left+4} y={y(position.price)-7}>持仓成本 {position.price.toFixed(2)}</text></g>}
 <g><line x1={x(eventIndex)} x2={x(eventIndex)} y1={top+20} y2={h-bottom} className="event-line"/><circle cx={x(eventIndex)} cy={y(points[eventIndex])} r="4" fill={color}/><text x={x(eventIndex)-8} y={top+12} textAnchor="end">事件标记 · 示例</text></g>
 <circle cx={x(points.length-1)} cy={y(points.at(-1))} r="3" fill={color}/>
 {hover!==null&&<g><line x1={x(hover)} x2={x(hover)} y1={top} y2={h-bottom} className="cost-line"/><circle cx={x(hover)} cy={y(points[hover])} r="4" fill="var(--t-text)"/><rect x={Math.min(w-right-108,Math.max(left,x(hover)-54))} y={h-bottom-30} width="108" height="25" rx="3" fill="var(--t-border)"/><text x={Math.min(w-right-54,Math.max(left+54,x(hover)))} y={h-bottom-13} textAnchor="middle" className="chart-tooltip">{money(points[hover],stock.currency)}</text></g>}
 </svg></div><footer className="terminal-chart-legend"><span><i style={{background:color}}/>价格</span>{position&&<span><i className="dash"/>持仓成本</span>}<span className="chart-note">价格与时间均为演示 · 非实时</span></footer></Pane>;
}
