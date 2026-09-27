// Research-display calendar, not an execution permission. Only 2026 is maintained.
export const CALENDAR_VERSION='equity-calendar/2026-09-25';
export const CALENDAR_SOURCES={CN:'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml',SZ:'https://investor.szse.cn/English/services/trading/calendar/index.html',HK:'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf',US:'https://www.nyse.com/trade/hours-calendars',Nasdaq:'https://www.nasdaqtrader.com/Trader.aspx?id=Calendar',HKHours:'https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en'};
const holidays={CN:['01-01','01-02','02-16','02-17','02-18','02-19','02-20','02-23','04-06','05-01','05-04','05-05','06-19','09-25','10-01','10-02','10-05','10-06','10-07'],HK:['01-01','02-17','02-18','02-19','04-03','04-06','04-07','05-01','05-25','06-19','07-01','10-01','10-19','12-25'],US:['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25']};
const halfDays={CN:[],HK:['02-16','12-24','12-31'],US:['11-27','12-24']};
export const marketKey=s=>/\.(SH|SZ)$/.test(s)?'CN':s?.endsWith('.HK')?'HK':s?.endsWith('.US')?'US':null;
export const marketZone={CN:'Asia/Shanghai',HK:'Asia/Hong_Kong',US:'America/New_York'};
export function localParts(at,zone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};}
export function sessionFor(symbol,date){
 const market=marketKey(symbol);if(!market||!/^2026-\d{2}-\d{2}$/.test(date))return {known:false,reason:'日历未覆盖',market};
 const instant=new Date(date+'T12:00:00Z');if(!Number.isFinite(+instant)||instant.toISOString().slice(0,10)!==date)return {known:false,reason:'日期无效',market};
 const day=instant.getUTCDay(),closed=day===0||day===6||holidays[market].includes(date.slice(5));
 const half=halfDays[market].includes(date.slice(5)),close=market==='CN'?900:market==='HK'?(half?730:970):(half?780:960);
 return {known:true,market,date,open:!closed,half,close,reason:closed?'休市':half?'半日市':'正常交易日',version:CALENDAR_VERSION};
}
const previousDate=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
export function marketClock(symbol,at=new Date().toISOString()){
 const market=marketKey(symbol),zone=marketZone[market];if(!zone)return {known:false,label:'市场待核验',expectedDate:null};
 const {date,minute}=localParts(at,zone),session=sessionFor(symbol,date);
 if(!session.known)return {known:false,label:session.reason,expectedDate:null,zone,date};
 let label=!session.open?'休市':minute<570?'未开盘':minute>=session.close?(minute<session.close+30?'已收盘 · 等待日线':'已收盘'):!session.half&&market!=='US'&&minute>=(market==='CN'?690:720)&&minute<780?'午间休市':'交易中';
 let expectedDate=session.open&&minute>=session.close+30?date:previousDate(date);
 for(let i=0;i<20;i++){const s=sessionFor(symbol,expectedDate);if(!s.known){expectedDate=null;break;}if(s.open)break;expectedDate=previousDate(expectedDate);}
 return {known:true,label,expectedDate,zone,date,minute,session,version:CALENDAR_VERSION};
}
export function dailyEligibility(symbol,date,receivedAt){
 const clock=marketClock(symbol,receivedAt),s=sessionFor(symbol,date);
 if(!s.known||!clock.known)return {complete:date<(clock.date||localParts(receivedAt,marketZone[marketKey(symbol)]||'UTC').date),basis:'日历未覆盖：仅接受此前日期'};
 return {complete:s.open&&!!clock.expectedDate&&date<=clock.expectedDate,basis:'交易日历 + 收盘后30分钟研究缓冲；非成交规则'};
}
export function dailyHealth(symbol,quote,at=new Date().toISOString()){
 const clock=marketClock(symbol,at),last=quote?.lastDate||quote?.points?.filter(p=>p.close>0).at(-1)?.date;
 return {...clock,lastDate:last||null,status:!last?'missing':!clock.expectedDate?'unknown':last<clock.expectedDate?'lagging':last>clock.expectedDate?'ahead':'aligned',label:!last?'无日线':!clock.expectedDate?'日期待核验':last<clock.expectedDate?'落后应有交易日':last>clock.expectedDate?'日线日期异常':'日期已对齐'};
}
