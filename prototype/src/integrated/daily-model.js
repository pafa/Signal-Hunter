export const chartColors=['#61cbbd','#e6b874','#8eaef4','#d99cdb','#ed9b78','#99c27a'];
export function periodBounds(quotes,months=3){
 const dates=quotes.flatMap(q=>q?.points?.map(p=>p.date)||[]).sort(),end=dates.at(-1);
 if(!end)return {start:null,end:null};
 const d=new Date(end+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,max));
 return {start:d.toISOString().slice(0,10),end};
}
export const inWindow=(q,bounds)=>(q?.points||[]).filter(p=>(!bounds.start||p.date>=bounds.start)&&(!bounds.end||p.date<=bounds.end));
export function dailySummary(points){const valid=points.filter(p=>Number.isFinite(p.close)&&p.close>0),first=valid[0],last=valid.at(-1);return {first,last,count:valid.length,change:valid.length>1?(last.close/first.close-1)*100:null};}
export function movingAverage(points,n=20){return points.map((p,i)=>{const span=points.slice(i-n+1,i+1);return {...p,close:i>=n-1&&span.every(p=>p.close>0)?span.reduce((s,p)=>s+p.close,0)/n:null};});}
export function comparisonModel(rows,bounds){
 if(rows.length<2)return {error:'至少需要两家公司才能比较。',series:[]};
 if(rows.some(r=>!r.quote?.points?.some(p=>p.close>0)))return {error:'部分公司缺少日线，补齐后再做共同基准比较。',series:[]};
 const maps=rows.map(r=>new Map(inWindow(r.quote,bounds).map(p=>[p.date,p]))),dates=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort();
 const common=dates.filter(d=>maps.every(m=>m.get(d)?.close>0));
 if(common.length<2)return {error:'当前区间没有至少两个共同有效收盘日期。',series:[]};
 const start=common[0],end=common.at(-1),axis=dates.filter(d=>d>=start&&d<=end),commonSet=new Set(common);
 return {start,end,count:common.length,excluded:axis.length-common.length,series:rows.map((r,i)=>({...r,points:axis.map(date=>({date,close:commonSet.has(date)?(maps[i].get(date).close/maps[i].get(start).close-1)*100:null})),change:(maps[i].get(end).close/maps[i].get(start).close-1)*100}))};
}
export function eventDate(topic,timezone='Asia/Shanghai'){if(topic.eventPublishedAt)return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(topic.eventPublishedAt));return topic.evidence?.map(e=>e.publishedAt?.slice(0,10)).filter(Boolean).sort()[0]||null;}
export const plotPath=(points,x,y)=>{let drawing=false,last=null;return points.map(p=>{if(!Number.isFinite(p.close)){drawing=false;last=p.date;return '';}const gap=last&&(Date.parse(p.date)-Date.parse(last))/86400000>4;const cmd=drawing&&!gap?'L':'M';drawing=true;last=p.date;return `${cmd}${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`;}).join(' ');};
