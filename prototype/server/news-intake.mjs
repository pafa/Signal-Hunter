import {randomUUID} from 'node:crypto';
import {fetchText,hash,newsUrl,parseReutersFeedResult} from './providers.mjs';

export function newsQueries(settings){
 return [
  {id:'discovery',label:'广泛事件发现',keywords:'',enabled:settings.newsDiscoveryEnabled!==false},
  {id:'tracking',label:'重点关键词跟踪',keywords:settings.keywords||'',enabled:settings.newsTrackingEnabled!==false&&!!settings.keywords?.trim()},
 ].map(query=>({...query,url:newsUrl(query.keywords)}));
}

export function openNewsIntake(store,{clock=()=>new Date().toISOString()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS news_intake_runs(id TEXT PRIMARY KEY,query_id TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS news_intake_observations(run_id TEXT NOT NULL,news_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(run_id,news_id));
 CREATE INDEX IF NOT EXISTS news_intake_query_time ON news_intake_runs(query_id,started_at);`);
 const read=row=>{
  if(!row)return null;const result=JSON.parse(row.payload);
  if(result.state==='running'&&result.runToken){const operation=db.prepare('SELECT outcome FROM operation_runs WHERE token=?').get(result.runToken);if(operation&&operation.outcome!=='running')return {...result,state:'interrupted',error:'父任务已结束，此入口没有完成收取'};}
  return result;
 };
 return {
  snapshot(){
   const recent=db.prepare('SELECT payload FROM news_intake_runs ORDER BY started_at DESC,rowid DESC LIMIT 30').all().map(read);
   return {queries:newsQueries(store.getSettings()).map(query=>({...query,last:read(db.prepare('SELECT payload FROM news_intake_runs WHERE query_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(query.id)),lastSuccess:read(db.prepare("SELECT payload FROM news_intake_runs WHERE query_id=? AND json_extract(payload,'$.state')='ok' ORDER BY started_at DESC,rowid DESC LIMIT 1").get(query.id))})),recent,coverage:'observed-only'};
  },
  async run(query,fetcher,context){
   context?.assertActive?.();
   const startedAt=clock(),last=read(db.prepare("SELECT payload FROM news_intake_runs WHERE query_id=? AND json_extract(payload,'$.state')='ok' ORDER BY started_at DESC,rowid DESC LIMIT 1").get(query.id));
   const row={id:randomUUID(),runToken:context?.token||null,queryId:query.id,label:query.label,queryUrl:query.url,keywords:query.keywords,configurationHash:hash(JSON.stringify({id:query.id,url:query.url})),startedAt,state:'running',requestedFrom:new Date(Date.parse(startedAt)-7*86400000).toISOString(),requestedTo:startedAt,previousSuccessAt:last?.finishedAt||null,unobservedSeconds:last?Math.max(0,(Date.parse(startedAt)-Date.parse(last.finishedAt))/1000):null,coverage:'observed-only'};
   db.prepare('INSERT INTO news_intake_runs VALUES(?,?,?,?,?)').run(row.id,row.queryId,startedAt,null,JSON.stringify(row));
   const save=()=>db.prepare('UPDATE news_intake_runs SET finished_at=?,payload=? WHERE id=?').run(row.finishedAt,JSON.stringify(row),row.id);
   try{
    const text=await fetchText(query.url,fetcher),parsed=parseReutersFeedResult(text),finishedAt=clock();context?.assertActive?.();
    const times=parsed.items.map(i=>i.publishedAt).sort();
    Object.assign(row,{state:'ok',finishedAt,rawCount:parsed.rawCount,acceptedCount:parsed.acceptedCount,rejectedCount:parsed.rejectedCount,observedFrom:times[0]||null,observedTo:times.at(-1)||null,possiblyTruncated:parsed.rawCount>=100,responseHash:hash(text)});
    store.ingest(parsed.items,finishedAt,result=>{
     Object.assign(row,result,{ingestCommitted:true});save();
     for(const item of parsed.items)db.prepare('INSERT OR IGNORE INTO news_intake_observations VALUES(?,?,?)').run(row.id,item.id,store.newsById(item.id).revision);
    });
    return row;
   }catch(error){
    // A canceled worker cannot publish ingestion or a success result. Its run remains inspectable.
    Object.assign(row,{state:context?.signal?.aborted?'cancelled':'error',finishedAt:clock(),ingestCommitted:false,added:0,updated:0,error:String(error.message||error).slice(0,200)});save();return row;
   }
  },
 };
}
