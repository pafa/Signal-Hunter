import React,{useEffect,useRef,useState} from 'react';
import {plotPath} from './daily-model';
const fmt=v=>Math.abs(v)>=1000?v.toFixed(0):v.toFixed(1);
export default function DailyChart({series,range,eventAt,percent=false,height=140,focusDate,onFocusDate}){
 const host=useRef(null),[width,setWidth]=useState(300);
 useEffect(()=>{const ob=new ResizeObserver(([entry])=>setWidth(Math.max(160,entry.contentRect.width)));if(host.current)ob.observe(host.current);return()=>ob.disconnect();},[]);
 const visible=series.flatMap(s=>s.points.filter(p=>Number.isFinite(p.close))),dates=[...new Set(series.flatMap(s=>s.points.map(p=>p.date)))].sort();
 if(!visible.length)return <div className="daily-empty" ref={host}>当前区间无有效日线</div>;
 const start=range?.start||dates[0],end=range?.end||dates.at(-1),lo=Math.min(...visible.map(p=>p.close),...(percent?[0]:[])),hi=Math.max(...visible.map(p=>p.close),...(percent?[0]:[])),pad=Math.max((hi-lo)*.09,Math.abs(hi)*.002,0.01);
 const left=width<300?40:46,right=10,top=18,bottom=24,span=Math.max(86400000,Date.parse(end)-Date.parse(start));
 const x=date=>left+(Date.parse(date)-Date.parse(start))/span*(width-left-right),y=v=>height-bottom-(v-lo+pad)/(hi-lo+pad*2)*(height-top-bottom);
 const ticks=[hi,(hi+lo)/2,lo],dateTicks=width<270?[start,end]:[start,new Date(Date.parse(start)+span/2).toISOString().slice(0,10),end];
 const shown=focusDate&&focusDate>=start&&focusDate<=end?focusDate:null;
 function inspect(clientX){const px=clientX-host.current.getBoundingClientRect().left;const nearest=dates.reduce((a,d)=>Math.abs(x(d)-px)<Math.abs(x(a)-px)?d:a,dates[0]);onFocusDate?.(nearest);}
 function key(e){if(e.key==='Escape'){if(shown&&onFocusDate){e.preventDefault();onFocusDate(null);}return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=dates.indexOf(focusDate);if(i<0)i=dates.length-1;i=e.key==='Home'?0:e.key==='End'?dates.length-1:Math.max(0,Math.min(dates.length-1,i+(e.key==='ArrowLeft'?-1:1)));onFocusDate?.(dates[i]);}
 return <div ref={host} className="daily-chart"><svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map(s=>s.name).join('、')} ${percent?'共同基准变化百分比':'日线收盘价'} ${start} 至 ${end}。左右键查看每日数据，Escape清除选中日期。`} tabIndex={0} onKeyDown={key} onPointerMove={e=>{if(e.pointerType==='mouse')inspect(e.clientX);}} onPointerDown={e=>inspect(e.clientX)} onPointerLeave={e=>{if(e.pointerType==='mouse')onFocusDate?.(null);}}>
 <title>{percent?'共同日期起点归零的原币价格变化':'原币日线收盘；虚线为20条有效连续日线均值'}</title>
 {ticks.map((v,i)=><g key={i}><line x1={left} y1={y(v)} x2={width-right} y2={y(v)} className="daily-gridline"/><text x={left-6} y={y(v)+3} textAnchor="end">{fmt(v)}{percent?'%':''}</text></g>)}
 {percent&&<line x1={left} x2={width-right} y1={y(0)} y2={y(0)} className="daily-zero"/>}
 {dateTicks.map((date,i)=><text key={i} x={x(date)} y={height-5} textAnchor={i===0?'start':i===dateTicks.length-1?'end':'middle'}>{date.slice(5).replace('-','/')}</text>)}
 {eventAt&&eventAt>=start&&eventAt<=end&&<g className="daily-event"><line x1={x(eventAt)} x2={x(eventAt)} y1={top} y2={height-bottom}/><text x={Math.max(left,Math.min(x(eventAt)+4,width-66))} y={10}>来源 {eventAt.slice(5)}</text></g>}
 {series.map(s=><path key={s.name} d={plotPath(s.points,x,y)} fill="none" stroke={s.color||'#61cbbd'} strokeWidth={s.secondary?1:1.7} strokeDasharray={s.secondary?'3 3':undefined} opacity={s.secondary?0.6:1} vectorEffect="non-scaling-stroke"/>)}
 {shown&&<g><line x1={x(shown)} x2={x(shown)} y1={top} y2={height-bottom} stroke="#8fa2b9" strokeDasharray="2 3"/>{series.filter(s=>!s.secondary).map(s=>{const p=s.points.find(p=>p.date===shown);return Number.isFinite(p?.close)?<circle key={s.name} cx={x(shown)} cy={y(p.close)} r="3" fill={s.color||'#61cbbd'}/>:null;})}</g>}
 </svg></div>;
}
