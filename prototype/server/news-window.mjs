import {parseReutersFeedResult} from './providers.mjs';
const validWindow=(start,end)=>Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))&&Date.parse(start)<=Date.parse(end);
// Counts describe returned samples, never the completeness of the source archive.
export function parseCollectionWindow(xml,startAt,endAt,{sliceStartAt,sliceEndAt}={}){
 if(!validWindow(startAt,endAt))throw new Error('采集窗口无效');
 if((sliceStartAt||sliceEndAt)&&(!validWindow(sliceStartAt,sliceEndAt)||sliceStartAt===sliceEndAt))throw new Error('日期切片无效');
 const parsed=parseReutersFeedResult(xml),start=Date.parse(startAt),end=Date.parse(endAt);
 const within=parsed.items.filter(item=>Date.parse(item.publishedAt)>=start&&Date.parse(item.publishedAt)<=end);
 const times=parsed.items.map(item=>item.publishedAt).sort();
 const ids=new Set(parsed.items.map(item=>item.id));
 const outsideSliceCount=sliceStartAt?parsed.items.filter(item=>Date.parse(item.publishedAt)<Date.parse(sliceStartAt)||Date.parse(item.publishedAt)>=Date.parse(sliceEndAt)).length:null;
 return {...parsed,inWindowCount:within.length,outsideWindowCount:parsed.items.length-within.length,uniqueReturnedCount:ids.size,duplicateWithinQueryCount:parsed.items.length-ids.size,actualPublishedStartAt:times[0]??null,actualPublishedEndAt:times.at(-1)??null,outsideSliceCount,possiblyCapped:parsed.rawCount>=100};
}
export function summarizeCollectionCoverage(results){
 const seen=new Set();let duplicateAcrossQueriesCount=0,returnedOccurrences=0;
 const successful=results.filter(result=>!result.query.error);
 for(const result of successful){const current=new Set(result.items.map(item=>item.id));returnedOccurrences+=result.items.length;for(const id of current){if(seen.has(id))duplicateAcrossQueriesCount++;seen.add(id);}}
 return {queryCount:results.length,successfulQueryCount:successful.length,failedQueryCount:results.length-successful.length,emptyQueryCount:successful.filter(r=>r.items.length===0).length,cappedQueryCount:successful.filter(r=>r.query.possiblyCapped).length,returnedOccurrences,uniqueReturnedCount:seen.size,duplicateWithinQueriesCount:successful.reduce((sum,r)=>sum+(r.query.duplicateWithinQueryCount??0),0),duplicateAcrossQueriesCount,outsideWindowCount:successful.reduce((sum,r)=>sum+(r.query.outsideWindowCount??0),0),outsideSliceCount:successful.reduce((sum,r)=>sum+(r.query.outsideSliceCount??0),0),coverageStatus:'unverified',historicalBackfillComplete:false,limitations:['Counts measure accepted returned headlines; rejected entries do not have a verified timestamp range.','Date query boundaries may be ignored or interpreted differently by the RSS source. Empty slices do not prove absence of news.','Repeated items, out-of-slice results and caps diagnose retrieval limitations; this sample cannot prove complete historical coverage.']};
}
