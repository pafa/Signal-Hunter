import {dailyHealth} from '../../shared/market-clock.mjs';
export function orderedTopics(topics,workflow){
 const byId=new Map(workflow.map(w=>[w.topicId,w]));
 return [...topics].sort((a,b)=>(byId.get(a.id)?.priorityRank??6)-(byId.get(b.id)?.priorityRank??6)||(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id));
}
export function dataHealth(data,now=Date.now()){
 const news=data?.checks?.news,watches=data?.watchlist||[];
 const rssAt=news?.receivedAt,age=rssAt?now-Date.parse(rssAt):Infinity;
 const rssState=news?.state==='disabled'?'订阅关闭':news?.state==='partial'?'部分失败':news?.state==='error'?'更新失败':!rssAt?'等待采集':age>Math.max(1800000,(data?.newsIntervalSeconds||600)*3000)?'采集待刷新':'已收取';
 const daily=watches.filter(w=>w.daily),failed=watches.filter(w=>data?.checks?.['daily:'+w.symbol]?.state==='error'),old=daily.filter(w=>now-Date.parse(w.daily.receivedAt)>21600000);
 const laggingCount=daily.filter(w=>['lagging','ahead'].includes(dailyHealth(w.symbol,w.daily,new Date(now).toISOString()).status)).length;
 return {laggingCount,rssState,rssAt,dailyCount:daily.length,total:watches.length,failedCount:failed.length,oldCount:old.length,issue:laggingCount>0||rssState!=='已收取'||failed.length>0||daily.length<watches.length||old.length>0};
}
