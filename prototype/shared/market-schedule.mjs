import {CALENDAR_VERSION,CALENDAR_SOURCES,localParts,marketKey,marketZone,sessionFor} from './market-clock.mjs';

// Read-only display. Do not use scheduled hours as a quote, halt check or execution permission.
export const SCHEDULE_VERSION='equity-hours-display/1';
const hhmm=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const nextDate=d=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
function instant(date,minute,zone){
 const target=Date.parse(`${date}T${hhmm(minute)}:00Z`);let value=target;
 for(let i=0;i<2;i++){const p=localParts(value,zone);value+=target-Date.parse(`${p.date}T${hhmm(p.minute)}:00Z`);}
 const p=localParts(value,zone);
 if(p.date!==date||p.minute!==minute)throw Error('Unresolved market time');
 return new Date(value).toISOString();
}
function point(date,minute,zone){const at=instant(date,minute,zone),p=localParts(at,'Asia/Shanghai');return {at,local:hhmm(minute),beijing:`${p.date} ${hhmm(p.minute)}`};}
function periods(s){
 if(!s.open)return [];
 if(s.market==='CN')return [['开盘集合竞价',555,565],['上午连续竞价',570,690],['下午连续竞价',780,897],['收盘集合竞价',897,900]];
 if(s.market==='HK')return [['开市前时段',540,570],['上午持续交易',570,720],...s.half?[]:[['下午持续交易',780,960]],['收市竞价（适用证券）',s.half?720:960,s.close,s.close-2]];
 return [['常规交易（含开收盘竞价）',570,s.close]];
}
function sources(symbol,market){
 if(market==='CN')return [{label:'交易时段',url:symbol.endsWith('.SZ')?'https://www.szse.cn/English/services/trading/tradOverview/index.html':'https://english.sse.com.cn/start/trading/schedule/'},{label:'休市日历',url:symbol.endsWith('.SZ')?CALENDAR_SOURCES.SZ:CALENDAR_SOURCES.CN}];
 if(market==='HK')return [{label:'交易时段',url:CALENDAR_SOURCES.HKHours},{label:'休市日历',url:CALENDAR_SOURCES.HK}];
 return [{label:'NYSE 时段及日历',url:CALENDAR_SOURCES.US},{label:'Nasdaq 日历',url:CALENDAR_SOURCES.Nasdaq}];
}
export function marketSchedule(symbol,at=new Date().toISOString()){
 const market=typeof symbol==='string'?marketKey(symbol):null,zone=marketZone[market],base={known:false,phase:'市场时段待核验',periods:[],nextOpening:null,sources:[],calendarVersion:CALENDAR_VERSION,version:SCHEDULE_VERSION};
 if(!zone||typeof at!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(at)||!Number.isFinite(Date.parse(at)))return base;
 const current=localParts(at,zone),today=sessionFor(symbol,current.date),common={...base,date:current.date,zone,checkedAt:new Date(at).toISOString(),localNow:hhmm(current.minute),sources:sources(symbol,market)};
 if(!today.known)return {...common,phase:'日历未覆盖'};
 let nextOpening=null,date=current.date;
 for(let i=0;i<20;i++,date=nextDate(date)){
  const s=sessionFor(symbol,date);if(!s.known)break;if(!s.open)continue;
  const minute=[570,...market!=='US'&&!s.half?[780]:[]].find(m=>date!==current.date||m>current.minute);
  if(minute!==undefined){nextOpening={date,kind:minute===780?'午后恢复':'常规开盘',...point(date,minute,zone)};break;}
 }
 const raw=periods(today),active=raw.find(([,start,end])=>current.minute>=start&&current.minute<end);
 let phase=!today.open?'休市':active?active[0]:current.minute>=today.close?'已收盘':current.minute>=690&&current.minute<780?'午间休市':'开盘前';
 if(market==='HK'&&active?.[3]!==undefined&&current.minute>=active[3])phase='收市竞价结束时间不定';
 const displayDate=today.open?current.date:nextOpening?.date,display=displayDate?sessionFor(symbol,displayDate):null;
 return {...common,known:true,phase,half:today.half,openDay:today.open,nextOpening,displayDate:displayDate||null,displayHalf:display?.half||false,periods:display?periods(display).map(([label,start,end,earliestEnd])=>({label,start:point(displayDate,start,zone),end:point(displayDate,end,zone),earliestEnd:earliestEnd===undefined?null:point(displayDate,earliestEnd,zone)})):[]};
}
