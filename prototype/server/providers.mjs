import {marketJson,marketFailure} from './market-diagnostics.mjs';
import {validProviderMinute} from '../shared/provider-time.mjs';
import {instrument} from '../shared/securities.mjs';
export {instrument} from '../shared/securities.mjs';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {createHash} from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
const parser = new XMLParser({ignoreAttributes:false, processEntities:true, parseTagValue:false});
const array = value => value ? (Array.isArray(value) ? value : [value]) : [];

export function newsUrl(keywords='') {
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({q:`site:reuters.com when:7d ${keywords}`.trim(),hl:'en-US',gl:'US',ceid:'US:en'});
  return url.href;
}

export function parseReutersFeed(xml) {
  return parseReutersFeedResult(xml).items;
}

export function parseReutersFeedResult(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true) throw new Error('RSS 格式无效');
  const feed=parser.parse(xml);
  if (!feed.rss || !Object.hasOwn(feed.rss,'channel')) throw new Error('上游没有返回 RSS');
  const items=[];
  for (const item of array(feed.rss.channel.item)) {
    const source=item.source;
    if (String(source?.['#text']||'').trim()!=='Reuters') continue;
    let sourceUrl,link;
    try { sourceUrl=new URL(source['@_url']);link=new URL(item.link); } catch { continue; }
    if (!['reuters.com','www.reuters.com'].includes(sourceUrl.hostname)) continue;
    if (link.protocol!=='https:' || !['news.google.com','reuters.com','www.reuters.com'].includes(link.hostname) || link.username || link.password) continue;
    const title=String(item.title||'').replace(/\s+- Reuters$/,'').trim().slice(0,1000);
    const timestamp=Date.parse(item.pubDate);
    if (!title || !Number.isFinite(timestamp)) continue;
    const guid=typeof item.guid==='object'?item.guid['#text']:item.guid;
    items.push({id:hash(String(guid||link.href)),title,url:link.href,publishedAt:new Date(timestamp).toISOString(),publisher:'Reuters',provider:'google-news-rss',contentScope:'headline-link'});
  }
  return {items,rawCount:array(feed.rss.channel.item).length,acceptedCount:items.length,rejectedCount:array(feed.rss.channel.item).length-items.length};
}


export function minuteUrl(secid) {
  const url=new URL('https://push2his.eastmoney.com/api/qt/stock/trends2/get');
  url.search=new URLSearchParams({fields1:'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',fields2:'f51,f52,f53,f54,f55,f56,f57,f58',iscr:'0',ndays:'1',secid});
  return url.href;
}

export function parseMinutes(payload, spec) {
  const data=payload?.data;
  if (!data || String(data.code).toUpperCase()!==spec.code) throw new Error('行情未返回匹配的股票');
  const points=[],minuteQuality={version:'minute-quality/1',invalidRows:0,duplicateTimes:[],roundedTimes:[]},seen=new Set();
  for (const row of data.trends||[]) {
    const [time,,close]=String(row).split(',');const price=Number(close);
    if (!validProviderMinute(time) || !Number.isFinite(price) || price<=0){minuteQuality.invalidRows++;continue;}
    if(seen.has(time))minuteQuality.duplicateTimes.push(time);seen.add(time);
    points.push({time,close:price});
  }
  if (!points.length) throw new Error('行情没有有效分钟数据');
  const unique=[...new Map(points.map(point=>[point.time,point])).values()].sort((a,b)=>a.time.localeCompare(b.time));
  return {symbol:spec.symbol,name:String(data.name||spec.code),market:spec.market,currency:spec.currency,marketTimezone:spec.marketTimezone,providerTimezone:spec.providerTimezone,provider:'eastmoney-public',interval:'1m',deliveryDelay:'unverified',adjustment:'none',lastBarMayBeIncomplete:true,minuteQuality,points:unique,providerTime:unique.at(-1).time,last:unique.at(-1).close};
}

export async function fetchText(url, fetcher=fetch) {
  const response=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{Accept:'application/rss+xml, application/json, text/xml'}});
  if (!response.ok) throw new Error(`上游 HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await (const chunk of response.body) {size+=chunk.length;if(size>2_000_000) throw new Error('上游数据超过大小限制');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchEastmoneyMinutes(symbol, fetcher=fetch) {
  const spec=instrument(symbol);
  for (const id of spec.ids) {
    const payload=await marketJson(()=>fetchText(minuteUrl(id),fetcher));
    if (!payload.data) continue;
    return parseMinutes(payload,spec);
  }
  throw new Error('未找到该股票的分钟数据');
}

// Unauthenticated public chart fallback; availability and delivery delay are not guaranteed.
export function yahooSymbol(spec){return spec.symbol.endsWith('.US')?spec.code:spec.symbol.endsWith('.HK')?spec.code.replace(/^0/,'')+'.HK':spec.code+(spec.symbol.endsWith('.SH')?'.SS':'.SZ');}
export function parseYahooMinutes(payload,spec){
 const data=payload?.chart?.result?.[0],meta=data?.meta;
 if(!meta||meta.symbol?.toUpperCase()!==yahooSymbol(spec)||meta.currency!==spec.currency)throw new Error('备用行情证券或币种不匹配');
 if(meta.exchangeTimezoneName&&meta.exchangeTimezoneName!==spec.marketTimezone)throw new Error('备用行情交易所时区不匹配');
 const closes=data.indicators?.quote?.[0]?.close||[],points=[],minuteQuality={version:'minute-quality/1',invalidRows:0,duplicateTimes:[],roundedTimes:[]},seen=new Set();
 if(closes.length!==(data.timestamp||[]).length)minuteQuality.invalidRows++;
 for(const [i,t] of (data.timestamp||[]).entries()){
  if(!Number.isInteger(t)||t<=0||t>4102444800||!Number.isFinite(closes[i])||closes[i]<=0){minuteQuality.invalidRows++;continue;}
  const time=new Date(t*1000).toISOString().slice(0,16).replace('T',' ');if(t%60!==0)minuteQuality.roundedTimes.push(time);if(seen.has(time))minuteQuality.duplicateTimes.push(time);seen.add(time);points.push({time,close:closes[i]});
 }
 const unique=[...new Map(points.map(p=>[p.time,p])).values()].sort((a,b)=>a.time.localeCompare(b.time));
 if(!unique.length)throw new Error('备用行情没有有效分钟数据');
 return {symbol:spec.symbol,name:meta.longName||meta.shortName||spec.code,market:spec.market,currency:spec.currency,marketTimezone:meta.exchangeTimezoneName||spec.marketTimezone,providerTimezone:'UTC',provider:'yahoo-public-chart',interval:'1m',deliveryDelay:'unverified',adjustment:'none',lastBarMayBeIncomplete:true,minuteQuality,points:unique,providerTime:unique.at(-1).time,last:unique.at(-1).close};
}
export async function fetchMinutes(symbol,fetcher=fetch){
 try{return await fetchEastmoneyMinutes(symbol,fetcher);}catch(primaryError){
  const spec=instrument(symbol),url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol(spec))+'?interval=1m&range=1d';
  try{return {...parseYahooMinutes(await marketJson(()=>fetchText(url,fetcher)),spec),fallbackReason:primaryError.message.slice(0,120)};}catch(backupError){const error=new Error('主源与备用源均失败：'+backupError.message);error.kind='all-sources-failed';error.attempts=[{source:'eastmoney-public',...marketFailure(primaryError)},{source:'yahoo-public-chart',...marketFailure(backupError)}];throw error;}
 }
}
