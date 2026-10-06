// A present-day directory can identify research candidates, but cannot prove
// that the same legal issuer or tradable security existed at a historical time.
export const DIRECTORY_TIME_VERSION='company-directory-time-1';
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&day(value.slice(0,10))&&Number.isFinite(Date.parse(value))?value:null;
const timezone=symbol=>symbol?.endsWith('.SH')||symbol?.endsWith('.SZ')?'Asia/Shanghai':symbol?.endsWith('.HK')?'Asia/Hong_Kong':symbol?.endsWith('.US')?'America/New_York':null;
function marketDay(value,zone){
 if(!zone)return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const get=type=>parts.find(p=>p.type===type).value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
export function companyDirectoryTime(identity,material){
 const zone=timezone(identity.symbol),published=material.datePrecision==='day'?day(material.publishedAt):material.datePrecision==='instant'?instant(material.publishedAt):null;
 const precision=published?material.datePrecision:'unknown',date=precision==='day'?published:precision==='instant'?marketDay(published,zone):null;
 const listing=day(identity.reportedListingDate),available=instant(material.availableAt),received=instant(identity.directoryReceivedAt);
 const relation=date&&listing?date<listing?'before':date>listing?'after':'same-day':'unknown';
 const availability=available&&received?Date.parse(received)<=Date.parse(available)?'observed-by-material-receipt':'observed-after-material-receipt':'unknown';
 const assessment={version:DIRECTORY_TIME_VERSION,materialPublishedAt:published,publicationPrecision:precision,materialAvailableAt:available,comparisonDate:date,comparisonTimezone:precision==='instant'?zone:null,comparisonBasis:precision==='day'?'source-calendar-date; publisher timezone unverified':precision==='instant'&&zone?'publication-instant-in-market-timezone':'unknown',reportedListingDate:listing,listingDateRelation:relation,directoryReceivedAt:received,directoryAvailability:availability,historicalIssuerValidity:'unverified',historicalTradingEligibility:'unverified'};
 const notes=[];
 if(relation!=='unknown')notes.push(`${precision==='day'?'来源日历日期（时区未核对）':'来源发布时刻的市场日期'} ${date} ${relation==='before'?'早于':relation==='after'?'晚于':'等于'}目录报告上市日 ${listing}`);
 else notes.push('来源日期或报告上市日缺失，无法比较上市时间');
 if(availability==='observed-after-material-receipt')notes.push('目录取得晚于材料获取，只可用于事后主体研究');
 else if(availability==='observed-by-material-receipt')notes.push('目录在材料获取时已留存；不证明在原文发布日期已可用');
 else notes.push('目录相对材料获取时的可用性未知');
 notes.push('发布日期不是事件生效时间；历史上市主体、当时可交易性均未核实');
 return {assessment,note:notes.join('；')};
}
