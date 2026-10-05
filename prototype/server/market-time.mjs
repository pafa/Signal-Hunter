// Execution feeds may carry sub-millisecond timestamps. Do not let Date.parse
// truncate these before ordering quotes, releasing inventory or consuming depth.
export function marketTime(value){
 if(typeof value!=='string')return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!m)return null;
 const [,year,month,day,hour,minute,second,fraction='',zone,,offsetHour,offsetMinute]=m;
 const ms=Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`),days=[31,(+year%4===0&&(+year%100!==0||+year%400===0))?29:28,31,30,31,30,31,31,30,31,30,31][+month-1];
 if(!Number.isFinite(ms)||+month<1||+month>12||+day<1||+day>days||+hour>23||+minute>59||+second>59||(offsetHour&&(+offsetHour>23||+offsetMinute>59)))return null;
 return BigInt(ms)*1000000n+BigInt(fraction.padEnd(9,'0'));
}
export const isMarketInstant=value=>marketTime(value)!==null;
export function compareMarketTime(a,b){const x=marketTime(a),y=marketTime(b);return x===null||y===null?NaN:x<y?-1:x>y?1:0;}
export function canonicalMarketTime(value){
 const ns=marketTime(value);if(ns===null)throw Error('执行时间无效');
 const seconds=ns>=0n?ns/1000000000n:(ns-999999999n)/1000000000n;
 const fraction=String(ns-seconds*1000000000n).padStart(9,'0').replace(/0+$/,'').padEnd(3,'0');
 return new Date(Number(seconds*1000n)).toISOString().replace(/\.000Z$/,'.'+fraction+'Z');
}
