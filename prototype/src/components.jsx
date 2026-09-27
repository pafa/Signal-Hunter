import React, { useId, useState } from 'react';
import {periodLabels,pct} from './data';

const paths={
 home:['m3 10 9-7 9 7','M5 9v11h5v-6h4v6h5V9'],
 file:['M14 3H5v18h14V8Z','M14 3v5h5','M8 12h8M8 16h6'],
 user:['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','M4 21v-2a8 8 0 0 1 16 0v2Z'],
 chart:['M11 3a9 9 0 1 0 10 10H11Z','M15 2v7h7a9 9 0 0 0-7-7Z'],
 star:['m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L2.5 9.5l6.3-.9Z'],
 book:['M4 3h16v18H4Z','M8 7h8M8 11h8M8 15h5'],
 settings:['m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3l-2-2 2-4 3 1 3-1Z','M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
 arrow:['M4 12h15m-6-6 6 6-6 6'],
 down:['m6 9 6 6 6-6'],
 close:['m6 6 12 12M6 18 18 6'],
 reset:['M3 10a9 9 0 0 1 16-5l2 3M21 3v5h-5','M21 14a9 9 0 0 1-16 5l-2-3M3 21v-5h5'],
 list:['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
 search:['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z','m15 15 6 6'],
 check:['m5 12 4 4L19 6'],
 clock:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z','M12 7v5l3 2'],
 bolt:['m13 2-9 12h7l-1 8 10-12h-7Z'],
 info:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z','M12 11v6M12 7h.01'],
 trend:['m3 17 6-6 4 4 8-10','M15 5h6v6'],
 external:['M14 3h7v7m0-7L10 14','M10 3H3v18h18v-7'],
 inbox:['M4 4h16l2 12v5H2v-5Z','M2 15h6l2 3h4l2-3h6'],
 shield:['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z','m8 12 3 3 5-6'],
};
export function Icon({name,size=18,...props}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{(paths[name]||paths.file).map((d,i)=><path key={i} d={d}/>)}</svg>;}
export function Button({children,variant='secondary',icon,className='',...props}){return <button className={`button ${variant} ${className}`} {...props}>{icon&&<Icon name={icon}/>}<span>{children}</span></button>;}
export function Market({market}){return <span className={`market market-${market==='A股'?'a':market==='港股'?'hk':'us'}`}>{market==='A股'?'A':market==='港股'?'HK':'US'}</span>;}
export function Badge({children,tone}){const color=tone||({'持仓中':'green','待审批':'purple','观察中':'gray','已同意':'green','已拒绝':'gray','待复盘':'amber'})[children]||'gray'; return <span className={`badge ${color}`}>{children}</span>;}
export function Segmented({items,value,onChange,label='筛选'}){return <div className="segmented" role="group" aria-label={label}>{items.map(item=><button key={item} aria-pressed={value===item} className={value===item?'selected':''} onClick={()=>onChange(item)}>{item}</button>)}</div>;}
export function Panel({title,subtitle,action,children,className=''}){return <section className={`panel ${className}`}>{title&&<div className="panel-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}{children}</section>;}
export function Empty({title='没有匹配的内容',text='试试其他筛选条件。',action}){return <div className="empty"><span className="empty-icon"><Icon name="inbox" size={26}/></span><h3>{title}</h3><p>{text}</p>{action}</div>;}
export function Sparkline({data,color}){const min=Math.min(...data)-.5,max=Math.max(...data)+.5;const points=data.map((v,i)=>`${i*104/(data.length-1)},${32-(v-min)/(max-min)*28}`).join(' ');return <svg className="sparkline" viewBox="0 0 104 36" role="img" aria-label={`示例走势 ${pct(data.at(-1))}`}><polyline fill="none" stroke={color||(data.at(-1)>=0?'var(--green)':'var(--red)')} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" points={points}/></svg>;}

export function TrendChart({data,period='1月',height=235,benchmark=false,annotation=false,label='示例走势'}){
 const uid=useId().replaceAll(':',''); const [hover,setHover]=useState(null);
 const w=720,h=240,left=40,right=16,top=18,bottom=36;
 const min=Math.floor(Math.min(...data,-.5)/2)*2, max=Math.ceil((Math.max(...data)+.3)/2)*2;
 const x=i=>left+i*(w-left-right)/(data.length-1),y=v=>top+(max-v)*(h-top-bottom)/(max-min);
 const line=data.map((v,i)=>`${i?'L':'M'}${x(i)},${y(v)}`).join(' ');
 const dates=periodLabels[period];const highlight=hover===null?Math.round(data.length*.4):hover;
 return <div className="trend-chart" onMouseLeave={()=>setHover(null)}>
  <svg viewBox={`0 0 ${w} ${h}`} style={{height}} role="img" aria-label={`${label}，区间变化 ${pct(data.at(-1)-data[0])}`} onMouseMove={e=>{const rect=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(data.length-1,Math.round(((e.clientX-rect.left)/rect.width*w-left)/(w-left-right)*(data.length-1)))));}}>
   <defs><linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#525bd4" stopOpacity=".12"/><stop offset="100%" stopColor="#525bd4" stopOpacity=".01"/></linearGradient></defs>
   {Array.from({length:5},(_,i)=>min+(max-min)*i/4).map(t=><g key={t}><line x1={left} y1={y(t)} x2={w-right} y2={y(t)} stroke="#eaeef4"/><text x={left-3} y={y(t)+4} textAnchor="end">{Number.isInteger(t)?t:t.toFixed(1)}%</text></g>)}
   {dates.map((date,i)=><g key={date}><line x1={left+i*(w-left-right)/(dates.length-1)} y1={top} x2={left+i*(w-left-right)/(dates.length-1)} y2={h-bottom} stroke="#f1f3f7"/><text x={left+i*(w-left-right)/(dates.length-1)} y={h-10} textAnchor={i===dates.length-1?'end':i===0?'start':'middle'}>{date}</text></g>)}
   <path d={`${line}L${x(data.length-1)},${h-bottom}L${left},${h-bottom}Z`} fill={`url(#fill-${uid})`}/>
   {benchmark&&<path d={data.map((v,i)=>`${i?'L':'M'}${x(i)},${y((v-data[0])*.29-.45)}`).join(' ')} stroke="#a5adbb" strokeDasharray="5 5" strokeWidth="1.6" fill="none"/>}
   <path d={line} stroke="var(--accent)" strokeWidth="2.6" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
   {(annotation||hover!==null)&&<g><line x1={x(highlight)} y1={y(data[highlight])} x2={x(highlight)} y2={h-bottom} stroke="#adb1de" strokeDasharray="3 4"/><circle cx={x(highlight)} cy={y(data[highlight])} r="5" fill="var(--accent)" stroke="white" strokeWidth="2"/><text x={Math.max(68,Math.min(w-60,x(highlight)))} y={Math.max(12,y(data[highlight])-13)} textAnchor="middle" className="chart-label">{hover===null?'模拟买入':pct(data[highlight])}</text></g>}
  </svg>
 </div>;
}
