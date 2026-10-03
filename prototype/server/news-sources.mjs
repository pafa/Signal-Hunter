import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {hash} from './providers.mjs';

import {OFFICIAL_NEWS_SOURCES,NEWS_ADAPTER_VERSION} from '../shared/news-sources.mjs';
export {OFFICIAL_NEWS_SOURCES,NEWS_ADAPTER_VERSION};
const parser=new XMLParser({ignoreAttributes:false,processEntities:true,parseTagValue:false});
const array=x=>x?(Array.isArray(x)?x:[x]):[];
export function validNewsDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function newsWindow(input,at){
 if(!input||Object.keys(input).some(k=>!['sourceId','from','to'].includes(k))||input.sourceId!=='hkma'||!validNewsDate(input.from)||!validNewsDate(input.to)||input.from>input.to||input.to>at.slice(0,10)||(Date.parse(input.to)-Date.parse(input.from))/86400000>30)throw new Error('补采只支持金管局，日期不得晚于今天且一次最多31天');
 return {sourceId:input.sourceId,from:input.from,to:input.to};
}
export function officialQueries(settings,at=new Date().toISOString(),window=null){
 const from=window?.from||new Date(Date.parse(at)-6*86400000).toISOString().slice(0,10),to=window?.to||at.slice(0,10);
 return OFFICIAL_NEWS_SOURCES.filter(s=>!window||s.id===window.sourceId).map(s=>({...s,enabled:settings[s.setting]===true,keywords:'',kind:window?'backfill':'latest',window:{from,to},adapterVersion:NEWS_ADAPTER_VERSION}));
}
export function sourcePageUrl(query,page){
 const source=OFFICIAL_NEWS_SOURCES.find(s=>s.id===query.id);if(!source)throw new Error('未知新闻来源');
 if(!Number.isSafeInteger(page)||page<1||page>(source.id==='hkma'?3:1))throw new Error('来源页数超限');
 const url=new URL(source.url);
 if(source.id==='hkma')url.search=new URLSearchParams({lang:'en',pagesize:'100',offset:String((page-1)*100),choose:'date',from:query.window.from,to:query.window.to,sortby:'date',sortorder:'desc'});
 if(source.id==='csrc')url.search=new URLSearchParams({_isAgg:'true',_isJson:'true',_pageSize:'18',_template:'index',_rangeTimeGte:'',_channelName:'',page:'1'});
 return url.href;
}
function normalize(source,{title,link,date},rejections,index){
 const reject=reason=>{rejections.push({index,reason});return null;};
 if(typeof title!=='string'||!title.trim()||title.length>2000)return reject('invalid-title');
 if(typeof link!=='string'||!link.trim())return reject('invalid-link');
 let url;try{url=new URL(link,source.url);}catch{return reject('invalid-link');}
 const host={fed:'www.federalreserve.gov',hkma:'www.hkma.gov.hk',csrc:'www.csrc.gov.cn'}[source.id];
 if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password)return reject('untrusted-link');
 url.hash='';
 let publishedAt,datePrecision;
 if(source.id==='fed'){
  if(typeof date!=='string'||!/(?:GMT|UTC|[+-]\d{4})\s*$/.test(date)||!Number.isFinite(Date.parse(date)))return reject('invalid-publication-time');
  publishedAt=new Date(date).toISOString();datePrecision='instant';
 }else{
  if(typeof date!=='string'||!validNewsDate(date.slice(0,10)))return reject('invalid-publication-date');
  publishedAt=date.slice(0,10);datePrecision='day';
 }
 return {id:hash(source.provider+'\n'+url.href),title:title.trim(),url:url.href,publishedAt,datePrecision,sourcePublishedAt:date,publicationTimeNote:datePrecision==='day'?'仅采用来源页面显示日期；不推断精确时刻或历史可交易时间':'RSS带时区的发布时间',publisher:source.publisher,provider:source.provider,sourceId:source.id,originKey:host,contentScope:'headline-link'};
}
export function parseOfficialPage(query,text,page=1){
 const source=OFFICIAL_NEWS_SOURCES.find(s=>s.id===query.id);if(!source)throw new Error('未知新闻来源');
 let entries,hasMore=false,limit=null;
 if(source.id==='fed'){
  if(/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)throw new Error('官方RSS格式无效');
  const feed=parser.parse(text);if(!feed.rss?.channel)throw new Error('官方来源未返回RSS');
  entries=array(feed.rss.channel.item).map(x=>({title:x.title,link:x.link,date:x.pubDate}));
 }else{
  let value;try{value=JSON.parse(text);}catch{throw new Error('官方来源未返回JSON');}
  if(source.id==='hkma'){
   if(value.header?.success!==true||!Array.isArray(value.result?.records)||!Number.isSafeInteger(value.result.datasize)||value.result.datasize!==value.result.records.length||value.result.records.length>100)throw new Error('金管局响应结构不匹配');
   entries=value.result.records;limit=100;hasMore=entries.length===100;
  }else{
   const d=value.data;if(d?.channelId!=='a1a078ee0bc54721ab6b148884c784a8'||d.page!==page||!Array.isArray(d.results)||d.results.length>18||!Number.isSafeInteger(d.total)||d.total<d.results.length)throw new Error('证监会列表结构或栏目不匹配');
   entries=d.results.map(x=>({title:x.title,link:x.url,date:x.publishedTimeStr}));limit=18;hasMore=d.total>entries.length;
  }
 }
 const items=[],rejections=[],seen=new Set(),sourceTimes=[];let outsideWindow=0,duplicates=0;
 entries.forEach((entry,index)=>{
  const item=normalize(source,entry||{},rejections,index);if(!item)return;sourceTimes.push(item.publishedAt);
  const date=item.publishedAt.slice(0,10);if(date<query.window.from||date>query.window.to){outsideWindow++;return;}
  if(seen.has(item.id)){duplicates++;return;}seen.add(item.id);items.push(item);
 });
 sourceTimes.sort();
 return {items,rawCount:entries.length,acceptedCount:items.length,rejectedCount:rejections.length,outsideWindow,duplicates,rejections,hasMore,limit,sourceObservedFrom:sourceTimes[0]||null,sourceObservedTo:sourceTimes.at(-1)||null,coverage:source.id==='hkma'&&!hasMore?'api-range-exhausted':'observed-only'};
}
