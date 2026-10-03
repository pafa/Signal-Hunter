import {randomUUID} from 'node:crypto';
import {fetchText,hash,newsUrl,parseReutersFeedResult} from './providers.mjs';
import {officialQueries,sourcePageUrl,parseOfficialPage,NEWS_ADAPTER_VERSION} from './news-sources.mjs';

export function newsQueries(settings,at=new Date().toISOString()){
 return [
  ...[{id:'discovery',label:'广泛事件发现',keywords:'',enabled:settings.newsDiscoveryEnabled!==false},{id:'tracking',label:'重点关键词跟踪',keywords:settings.keywords||'',enabled:settings.newsTrackingEnabled!==false&&!!settings.keywords?.trim()}].map(q=>({...q,url:newsUrl(q.keywords),provider:'google-news-rss',kind:'latest',scope:'Google News / Reuters聚合；最近7天查询不保证完整'})),
  ...officialQueries(settings,at),
 ];
}
export function openNewsIntake(store,{clock=()=>new Date().toISOString()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS news_intake_runs(id TEXT PRIMARY KEY,query_id TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS news_intake_observations(run_id TEXT NOT NULL,news_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(run_id,news_id));
 CREATE INDEX IF NOT EXISTS news_intake_query_time ON news_intake_runs(query_id,started_at);
 CREATE TABLE IF NOT EXISTS news_source_responses(hash TEXT PRIMARY KEY,body TEXT NOT NULL,bytes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS news_intake_pages(run_id TEXT NOT NULL,page INTEGER NOT NULL,url TEXT NOT NULL,response_hash TEXT,received_at TEXT,payload TEXT NOT NULL,PRIMARY KEY(run_id,page));`);
 const read=row=>{
  if(!row)return null;const result=JSON.parse(row.payload);
  if(result.state==='running'&&result.runToken){const operation=db.prepare('SELECT outcome FROM operation_runs WHERE token=?').get(result.runToken);if(operation&&operation.outcome!=='running')return {...result,state:'interrupted',error:'父任务已结束，此入口没有完成收取'};}
  return result;
 };
 const latest=(id,success=false)=>read(db.prepare("SELECT payload FROM news_intake_runs WHERE query_id=?"+(success?" AND json_extract(payload,'$.state')='ok'":'')+' ORDER BY started_at DESC,rowid DESC LIMIT 1').get(id));
 return {
  snapshot(){return {queries:newsQueries(store.getSettings(),clock()).map(q=>({...q,last:latest(q.id),lastSuccess:latest(q.id,true)})),recent:db.prepare('SELECT payload FROM news_intake_runs ORDER BY started_at DESC,rowid DESC LIMIT 30').all().map(read),coverage:'observed-only'};},
  detail(id){const row=read(db.prepare('SELECT payload FROM news_intake_runs WHERE id=?').get(id));if(!row)throw new Error('采集记录不存在');return {...row,pages:db.prepare('SELECT page,url,response_hash AS responseHash,received_at AS receivedAt,payload FROM news_intake_pages WHERE run_id=? ORDER BY page').all(id).map(p=>({...p,payload:JSON.parse(p.payload)}))};},
  async run(query,fetcher,context){
   context?.assertActive?.();
   const startedAt=clock(),last=latest(query.id,true),official=!!query.adapterVersion;
   const row={id:randomUUID(),runToken:context?.token||null,queryId:query.id,label:query.label,queryUrl:official?sourcePageUrl(query,1):query.url,keywords:query.keywords,kind:query.kind||'latest',provider:query.provider,adapterVersion:official?NEWS_ADAPTER_VERSION:'reuters-rss-1',configurationHash:hash(JSON.stringify(query)),startedAt,state:'running',requestedFrom:query.window?.from||new Date(Date.parse(startedAt)-7*86400000).toISOString(),requestedTo:query.window?.to||startedAt,previousSuccessAt:last?.finishedAt||null,unobservedSeconds:last?Math.max(0,(Date.parse(startedAt)-Date.parse(last.finishedAt))/1000):null,coverage:'observed-only',pages:0,rawCount:0,acceptedCount:0,rejectedCount:0,outsideWindow:0,duplicates:0,added:0,updated:0,ingestCommitted:false};
   db.prepare('INSERT INTO news_intake_runs VALUES(?,?,?,?,?)').run(row.id,row.queryId,startedAt,null,JSON.stringify(row));
   const save=value=>db.prepare('UPDATE news_intake_runs SET finished_at=?,payload=? WHERE id=?').run(value.finishedAt||null,JSON.stringify(value),row.id);
   const pageSave=(page,value)=>db.prepare('UPDATE news_intake_pages SET payload=? WHERE run_id=? AND page=?').run(JSON.stringify(value),row.id,page);
   const deadline=AbortSignal.timeout(30000),seenPages=new Set(),seenItems=new Set();let page=1;
   try{
    for(;page<=(query.id==='hkma'?3:1);page++){
     context?.assertActive?.();const url=official?sourcePageUrl(query,page):query.url;
     db.prepare('INSERT INTO news_intake_pages VALUES(?,?,?,NULL,NULL,?)').run(row.id,page,url,JSON.stringify({state:'requesting'}));
     const body=await fetchText(url,(u,options)=>fetcher(u,{...options,signal:AbortSignal.any([options.signal,deadline])})),receivedAt=clock();context?.assertActive?.();
     const responseHash=hash(body);
     db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR IGNORE INTO news_source_responses VALUES(?,?,?)').run(responseHash,body,Buffer.byteLength(body));db.prepare('UPDATE news_intake_pages SET response_hash=?,received_at=?,payload=? WHERE run_id=? AND page=?').run(responseHash,receivedAt,JSON.stringify({state:'received'}),row.id,page);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
     if(seenPages.has(responseHash))throw new Error('来源重复返回同一页，已停止补采；此前页保留');seenPages.add(responseHash);
     const parsed=official?parseOfficialPage(query,body,page):{...parseReutersFeedResult(body),hasMore:false,outsideWindow:0,duplicates:0,rejections:[]};
     const fresh=parsed.items.filter(n=>!seenItems.has(n.id));const overlap=parsed.items.length-fresh.length;
     if(page>1&&parsed.items.length&&fresh.length===0)throw new Error('分页没有新增条目，已停止；此前页保留');
     const times=fresh.map(i=>i.publishedAt).sort();
     const next={...row,pages:page,paginationOverlap:!!row.paginationOverlap||overlap>0,sourceObservedFrom:[row.sourceObservedFrom,parsed.sourceObservedFrom].filter(Boolean).sort()[0]||null,sourceObservedTo:[row.sourceObservedTo,parsed.sourceObservedTo].filter(Boolean).sort().at(-1)||null,rawCount:row.rawCount+parsed.rawCount,acceptedCount:row.acceptedCount+fresh.length,rejectedCount:row.rejectedCount+parsed.rejectedCount,outsideWindow:row.outsideWindow+(parsed.outsideWindow||0),duplicates:row.duplicates+(parsed.duplicates||0)+overlap,observedFrom:[row.observedFrom,times[0]].filter(Boolean).sort()[0]||null,observedTo:[row.observedTo,times.at(-1)].filter(Boolean).sort().at(-1)||null,responseHash,possiblyTruncated:official?parsed.hasMore:parsed.rawCount>=100,coverage:parsed.coverage||'observed-only'};
     const pageRecord={state:'committed',rawCount:parsed.rawCount,acceptedCount:fresh.length,rejectedCount:parsed.rejectedCount,outsideWindow:parsed.outsideWindow||0,duplicates:(parsed.duplicates||0)+overlap,rejections:parsed.rejections,hasMore:parsed.hasMore};
     store.ingest(fresh,receivedAt,result=>{
      Object.assign(next,{added:row.added+result.added,updated:row.updated+result.updated,ingestCommitted:true});save(next);pageSave(page,pageRecord);
      for(const item of fresh)db.prepare('INSERT OR IGNORE INTO news_intake_observations VALUES(?,?,?)').run(row.id,item.id,store.newsById(item.id).revision);
     });
     Object.assign(row,next);fresh.forEach(n=>seenItems.add(n.id));
     if(query.id!=='hkma'||!parsed.hasMore)break;
    }
    row.state='ok';row.finishedAt=clock();
    if(row.possiblyTruncated&&query.id==='hkma')row.coverage='page-budget-reached';
    if(row.paginationOverlap){row.state='partial';row.coverage='unstable-pagination';row.error='分页条目重叠，可能在收取期间变化；保留新增条目，完整性未证实';}
    save(row);return row;
   }catch(error){
    Object.assign(row,{state:context?.signal?.aborted?'cancelled':row.pages?'partial':'error',finishedAt:clock(),error:String(error.message||error).slice(0,200),coverage:'incomplete'});
    pageSave(page,{state:row.state,error:row.error});save(row);return row;
   }
  },
 };
}
