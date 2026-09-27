import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fetchText,parseReutersFeed,hash} from '../server/providers.mjs';
import {classifyHeadline,RULES_VERSION} from '../server/triage.mjs';

// Explicit fixed window; fetching history today is never recorded as historical discovery.
const [startDate,endDate,outputArg]=process.argv.slice(2);
if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(endDate||'')||!outputArg)throw new Error('Usage: node scripts/collect-recent-news.mjs START_DATE END_DATE OUTPUT_DIR');
const output=resolve(outputArg),startedAt=new Date().toISOString(),startAt=new Date(startDate+'T00:00:00+08:00').toISOString(),endAt=new Date(Math.min(Date.parse(endDate+'T23:59:59.999+08:00'),Date.now())).toISOString();
if(startAt>endAt||(Date.parse(endAt)-Date.parse(startAt))>32*86400000)throw new Error('Invalid or excessive window');
await mkdir(output,{recursive:true});
const baselineSource=await readFile(new URL('../server/triage.mjs',import.meta.url),'utf8');
const protocol={startedAt,startAt,endAt,timezone:'Asia/Shanghai',rulesVersion:RULES_VERSION,rulesHash:hash(baselineSource),queryPolicy:'One Reuters domain query per calendar day; no company, sector or return filter. Adjacent boundary day fetched for timezone overlap.',limitations:['Google News RSS has incomplete historical coverage and a result cap. This is a retrieval sample, not the full Reuters archive.','First acquisition occurs now, not at publication time. No historical actionable signal or trading profit is asserted.','Baseline runs unchanged; any later tuning on this sample is in-sample, not validation.'],manualAudit:'Inspect priority candidates, plus a deterministic hash sample from quiet and clue buckets; retain non-signals and unverifiable items.',outcomes:'Price changes separately from simulated fills. No order approvals or portfolio changes.'};
await writeFile(output+'/protocol.json',JSON.stringify(protocol,null,2),{flag:'wx'});
await writeFile(output+'/baseline-triage.mjs',baselineSource,{flag:'wx'});
const days=[];
// Google date boundaries are not documented as Shanghai time; exact timestamp filter below is authoritative.
for(let t=Date.parse(startDate+'T00:00:00Z')-86400000;t<=Date.parse(endDate+'T00:00:00Z');t+=86400000)days.push(new Date(t).toISOString().slice(0,10));
const queries=[],rows=new Map();
for(let offset=0;offset<days.length;offset+=3){
 const results=await Promise.all(days.slice(offset,offset+3).map(async day=>{
  const next=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10),url=new URL('https://news.google.com/rss/search');
  url.search=new URLSearchParams({q:`site:reuters.com after:${day} before:${next}`,hl:'en-US',gl:'US',ceid:'US:en'});
  const requestAt=new Date().toISOString();
  try{const xml=await fetchText(url.href),receivedAt=new Date().toISOString(),items=parseReutersFeed(xml);await writeFile(output+'/'+day+'.xml',xml);
   return {query:{day,url:url.href,requestAt,receivedAt,returned:items.length,possiblyCapped:items.length>=100,sha256:hash(xml)},items};
  }catch(e){return {query:{day,url:url.href,requestAt,error:e.message},items:[]};}
 }));
 for(const result of results){queries.push(result.query);for(const item of result.items){
  if(item.publishedAt<startAt||item.publishedAt>endAt)continue;
  const old=rows.get(item.id);if(old){old.queryDays.push(result.query.day);continue;}
  rows.set(item.id,{...item,firstSeen:result.query.receivedAt,queryDays:[result.query.day],baseline:classifyHeadline(item)});
 }console.log(JSON.stringify(result.query));}
}
const items=[...rows.values()].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)||a.id.localeCompare(b.id));
const buckets=Object.fromEntries(['review','clue','quiet'].map(b=>[b,items.filter(n=>n.baseline.bucket===b).length]));
const auditIds=[...items.filter(n=>n.baseline.bucket==='review').map(n=>n.id),...['clue','quiet'].flatMap(b=>items.filter(n=>n.baseline.bucket===b).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,30).map(n=>n.id))];
await writeFile(output+'/news.json',JSON.stringify({protocol,queries,items,buckets,auditIds,finishedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({output,unique:items.length,buckets,failed:queries.filter(q=>q.error).length,capped:queries.filter(q=>q.possiblyCapped).length}));
