import {parseReutersFeedResult} from './providers.mjs';
// Retrieval coverage is measured before acceptance and timestamp filtering.
export function parseCollectionWindow(xml,startAt,endAt){
 if(!Number.isFinite(Date.parse(startAt))||!Number.isFinite(Date.parse(endAt))||Date.parse(startAt)>Date.parse(endAt))throw new Error('采集窗口无效');
 const parsed=parseReutersFeedResult(xml),within=parsed.items.filter(item=>Date.parse(item.publishedAt)>=Date.parse(startAt)&&Date.parse(item.publishedAt)<=Date.parse(endAt));
 return {...parsed,inWindowCount:within.length,possiblyCapped:parsed.rawCount>=100};
}
