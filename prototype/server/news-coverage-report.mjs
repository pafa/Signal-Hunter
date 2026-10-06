import {createHash} from 'node:crypto';
import {validNewsDate} from './news-sources.mjs';
const counters=['rawCount','acceptedCount','rejectedCount','outsideWindow','duplicates','added','updated'];
const states=['ok','partial','failed','cancelled','running','interrupted'];
const fail=()=>{throw Error('覆盖报告窗口无效，请选择不晚于今天的连续1至31个UTC日期');};
// A report measures recorded intake attempts, not publication-time archive completeness.
export function newsCoverageReport(db,queries,input,at,readRun=JSON.parse){
 if(!input||Object.keys(input).some(k=>!['from','to'].includes(k))||!validNewsDate(input.from)||!validNewsDate(input.to)||input.from>input.to||input.to>at.slice(0,10))fail();
 const start=Date.parse(input.from+'T00:00:00Z'),end=Date.parse(input.to+'T00:00:00Z')+86400000,cutoff=Math.min(end,Date.parse(at));
 if(!Number.isFinite(cutoff)||end-start>31*86400000)fail();
 const days=Array.from({length:(end-start)/86400000},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
 const make=q=>({queryId:q.id,label:q.label||q.id,currentEnabled:q.enabled??null,attempts:0,states:Object.fromEntries([...states,'unknown'].map(k=>[k,0])),counts:Object.fromEntries(counters.map(k=>[k,{observedSum:0,unknownRuns:0}])),truncatedRuns:0,overlapRuns:0,emptySuccessfulRuns:0,configurations:new Map(),days:new Map(days.map(day=>[day,{day,attempts:0,successfulAttempts:0}])),lastTime:start,longestNoAttemptSeconds:0,observedItems:new Set(),observedRevisions:new Set()});
 const groups=new Map(queries.map(q=>[q.id,make(q)])),hash=createHash('sha256');
 hash.update(JSON.stringify({schema:'news-intake-coverage/1',from:input.from,to:input.to,observedThrough:new Date(cutoff).toISOString(),queries:queries.map(q=>({id:q.id,label:q.label,enabled:q.enabled}))}));
 let runCount=0,observationCount=0;
 db.exec('BEGIN');
 try{
  const rows=db.prepare('SELECT id,query_id,started_at,payload FROM news_intake_runs WHERE julianday(started_at)>=julianday(?) AND julianday(started_at)<julianday(?) AND julianday(started_at)<=julianday(?) ORDER BY julianday(started_at),rowid');
  for(const row of rows.iterate(new Date(start).toISOString(),new Date(end).toISOString(),at)){
   if(++runCount>250000)throw Error('覆盖报告记录过多，请缩小日期窗口');
   const r=readRun(row.payload);hash.update(JSON.stringify([row.id,row.query_id,row.started_at,r]));
   if(!groups.has(row.query_id))groups.set(row.query_id,make({id:row.query_id,label:r.label}));const g=groups.get(row.query_id),t=Date.parse(row.started_at),day=g.days.get(new Date(t).toISOString().slice(0,10));
   g.attempts++;g.states[r.state==='error'?'failed':states.includes(r.state)?r.state:'unknown']++;day.attempts++;if(r.state==='ok')day.successfulAttempts++;
   g.longestNoAttemptSeconds=Math.max(g.longestNoAttemptSeconds,(t-g.lastTime)/1000);g.lastTime=t;
   for(const k of counters){if(Number.isSafeInteger(r[k])&&r[k]>=0)g.counts[k].observedSum+=r[k];else g.counts[k].unknownRuns++;}
   if(r.possiblyTruncated===true)g.truncatedRuns++;if(r.paginationOverlap===true)g.overlapRuns++;if(r.state==='ok'&&r.acceptedCount===0)g.emptySuccessfulRuns++;
   const config={provider:r.provider??null,adapterVersion:r.adapterVersion??null,keywords:r.keywords??null,kind:r.kind??null},key=JSON.stringify(config);if(!g.configurations.has(key))g.configurations.set(key,{...config,attempts:0});g.configurations.get(key).attempts++;
  }
  for(const o of db.prepare('SELECT o.run_id,o.news_id,o.revision,r.query_id FROM news_intake_observations o JOIN news_intake_runs r ON r.id=o.run_id WHERE julianday(r.started_at)>=julianday(?) AND julianday(r.started_at)<julianday(?) AND julianday(r.started_at)<=julianday(?) ORDER BY o.run_id,o.news_id').iterate(new Date(start).toISOString(),new Date(end).toISOString(),at)){
   if(++observationCount>1000000)throw Error('覆盖报告记录过多，请缩小日期窗口');hash.update(JSON.stringify(o));const g=groups.get(o.query_id);g.observedItems.add(o.news_id);g.observedRevisions.add(JSON.stringify([o.news_id,o.revision]));
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {schema:'news-intake-coverage/1',generatedAt:at,from:input.from,to:input.to,toExclusive:new Date(end).toISOString(),observedThrough:new Date(cutoff).toISOString(),inputHash:hash.digest('hex'),runCount,observationCount,coverage:'unverified',sources:[...groups.values()].map(g=>{
  const {lastTime,observedItems,observedRevisions,...rest}=g;
  return {...rest,longestNoAttemptSeconds:Math.max(g.longestNoAttemptSeconds,(cutoff-lastTime)/1000),uniqueObservedItems:observedItems.size,uniqueObservedRevisions:observedRevisions.size,configurations:[...g.configurations.values()],days:[...g.days.values()]};
 }),limitations:['按采集开始时间统计UTC日期窗口，结束日期包含在内；不是按新闻发布日期统计。','当前启停状态不代表窗口内历史配置，零次尝试和无成功日期不能证明当日没有新闻。','各次计数相加包含重复返回，唯一条目与修订只计持久观察记录；旧记录缺字段显示未知，不能补零。','最长无尝试间隔含窗口边界，截至报告生成时刻；不代表实际缺失新闻数量或服务可用率。','两路Reuters查询共享聚合源；API翻页结束、多个入口及成功响应均不能证明来源完整或证据独立。']};
}
