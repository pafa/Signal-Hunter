// The date and release clock are separate, literal fields in the verified
// Federal Reserve press-release heading. Never use body or last-update dates.
export function fedReleaseDate(candidates, parseDate) {
 const clocks=candidates.filter(c=>c.source==='fed:release-time');
 if(!clocks.length)return undefined;
 const dates=candidates.filter(c=>c.source==='fed:heading-date');
 if(clocks.length!==1||dates.length!==1)return null;
 const day=parseDate(dates[0].raw);
 if(!day||day.length!==10)return null;
 const raw=clocks[0].raw.trim().replace(/\s+/g,' ');
 const clock=/^For release at (0?[1-9]|1[0-2]):([0-5]\d) ([ap])\.m\.(?: (EDT|EST))?$/.exec(raw);
 if(!clock)return null;
 // An explicit day remains useful when the publisher omits a timezone. Do
 // not infer one from our machine, the URL, or Washington's usual offset.
 if(!clock[4])return day;
 const hour=String(Number(clock[1])%12+(clock[3]==='p'?12:0)).padStart(2,'0');
 const offset=clock[4]==='EDT'?'-04:00':'-05:00';
 const value=`${day}T${hour}:${clock[2]}${offset}`;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 // A stated offset that conflicts with the date's clock rules stays unknown.
 if(`${parts.year}-${parts.month}-${parts.day}`!==day||parts.hour!==hour||parts.minute!==clock[2])return null;
 return value;
}
