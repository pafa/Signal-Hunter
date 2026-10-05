import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../server/store.mjs';import {hash} from '../server/providers.mjs';
import {historicalRows,openHistoricalRecall} from '../server/historical-recall.mjs';
import {describeNews,compareReports} from '../server/event-continuity.mjs';
import {createService} from '../server/service.mjs';import {createHandler} from '../server/index.mjs';
const at='2026-10-04T00:00:00Z',news=(id,title,publishedAt='2021-06-01T00:00:00Z')=>({id:hash(id),title,publishedAt,url:`https://example.invalid/${id}`,publisher:'Synthetic official-style test'});
const anchor=news('current','FDA approves Eli Lilly drug for obesity treatment','2026-10-03T00:00:00Z'),past=news('past','诺和诺德治疗肥胖的药物获批'),negative=news('negative','FDA rejects Novo Nordisk obesity drug application','2020-01-01T00:00:00Z');
const snapshot=n=>({...n,revision:1,firstSeen:at,availableAt:at});
const fixture=()=>{const store=openStore(':memory:');store.ingest([past,negative,anchor],at);return {store,history:openHistoricalRecall(store,{now:()=>Date.parse(at)}),close:()=>store.close()};};
test('historical analogies cross language, company and 90 day cutoff without weakening same-event matching',()=>{
 const rows=historicalRows(snapshot(anchor),[anchor,past,negative].map(snapshot),at);
 assert.equal(compareReports(describeNews({...anchor,revision:1,firstSeen:at}),describeNews({...past,revision:1,firstSeen:at})),null);
 assert.equal(rows.filter(r=>r.status==='candidate').length,2);assert.equal(rows[1].kind,'analogy');assert.equal(rows[1].sameIssuer,false);assert.match(rows[1].differences.join(' '),/发行人不同/);assert(rows[2].mechanisms.some(m=>m.id==='medical-access'));
});
test('earlier publication, current availability, duplicate and domain exclusions retain every input',()=>{
 const later=news('later',past.title,'2026-10-04T00:00:00Z'),unrelated=news('unrelated','Intel acquisition of a semiconductor processor company'),generic=news('generic','Novo Nordisk shares rise after analyst upgrade'),sameUrl={...past,id:hash('url'),url:anchor.url},sameTitle={...past,id:hash('title'),title:anchor.title},missing={...past,id:hash('missing'),publishedAt:null};
 const future={...snapshot(past),id:hash('future'),firstSeen:'2026-10-05T00:00:00Z',availableAt:'2026-10-05T00:00:00Z'};
 const rows=historicalRows(snapshot(anchor),[snapshot(anchor),...[later,unrelated,generic,sameUrl,sameTitle,missing].map(snapshot),future],at);
 assert.deepEqual(rows.map(r=>r.status),['anchor','not_earlier','no_mechanism','no_mechanism','same_source','duplicate_title','invalid_time','future_input']);
 assert.equal(historicalRows({...snapshot(anchor),availableAt:'2026-10-05T00:00:00Z'},[snapshot(past)],at)[0].status,'invalid_time');
 const deals=[news('left','Intel acquires a semiconductor processor business','2026-10-03T00:00:00Z'),news('right','Boeing acquires an aircraft parts business')].map(snapshot);assert.equal(historicalRows(deals[0],[deals[1]],at)[0].status,'no_context');
});
test('snapshot scans beyond recent inbox and continuity index without a silent top-N cutoff',()=>{
 const f=fixture();try{f.store.ingest(Array.from({length:2100},(_,i)=>news('filler'+i,'Unrelated daily weather bulletin '+i)),at);assert.equal(f.store.news().length,500);
  const report=f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()});assert.equal(report.coverage.total,2103);assert.equal(report.rows.length,2103);assert.equal(report.summary.candidate,2);assert(report.candidateIds.includes(past.id));assert.equal(report.coverage.ageLimitDays,null);assert.equal(report.forwardEligible,false);
 }finally{f.close();}
});
test('new source revisions append reports while old inputs, idempotency and results remain unchanged',()=>{
 const f=fixture();try{const request={revision:1,requestId:randomUUID()},old=f.history.freeze(anchor.id,request),original=JSON.stringify(old);
  f.store.ingest([{...past,title:'Novo Nordisk clinical trial fails primary endpoint'}],at);const next=f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()});assert.equal(next.summary.candidate,1);assert.equal(old.summary.candidate,2);assert.equal(JSON.stringify(f.history.get(anchor.id,old.id)),original);assert.equal(f.history.freeze(anchor.id,request).id,old.id);
  assert.throws(()=>f.history.freeze(negative.id,request),/已用于/);f.store.ingest([{...anchor,title:anchor.title+' updated'}],at);assert.throws(()=>f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()}),/已修订/);assert.equal(f.history.freeze(anchor.id,request).id,old.id);assert.equal(f.history.list(anchor.id).reports.length,2);
 }finally{f.close();}
});
test('strict input, corrupted current revision, failed write and restore guard cannot produce partial reports',()=>{
 const f=fixture();try{for(const data of [{revision:1,requestId:randomUUID(),prices:[]},{revision:0,requestId:randomUUID()},{revision:1,requestId:'bad'}])assert.throws(()=>f.history.freeze(anchor.id,data));
  f.store.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON historical_recall_reports BEGIN SELECT RAISE(ABORT,'fixture'); END");assert.throws(()=>f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()}));assert.equal(f.history.list(anchor.id).reports.length,0);f.store.db.exec('DROP TRIGGER fail_history');
  const r=f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()});f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()}),/恢复副本/);assert.equal(f.history.get(anchor.id,r.id).id,r.id);f.store.db.exec("DELETE FROM settings WHERE key='restore_review_required'");
  f.store.db.prepare('UPDATE revisions SET payload=? WHERE news_id=?').run('{}',past.id);assert.throws(()=>f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()}),/快照校验/);assert.equal(f.history.list(anchor.id).reports.length,1);
 }finally{f.close();}
});
test('oversized corpus explicitly fails rather than reporting coverage of an incomplete subset',()=>{
 const f=fixture();try{f.store.db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO news(id,payload,hash,first_seen,last_seen,revision) SELECT 'extra-'||x,'{}','x','2026-10-04','2026-10-04',1 FROM n");assert.throws(()=>f.history.freeze(anchor.id,{revision:1,requestId:randomUUID()}),/完整扫描上限/);assert.equal(f.history.list(anchor.id).reports.length,0);
 }finally{f.close();}
});
test('reports survive database reopen and reject altered report payloads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'history-report-'));let store=openStore(join(dir,'test.sqlite'));try{store.ingest([anchor,past],at);let history=openHistoricalRecall(store,{now:()=>Date.parse(at)});const report=history.freeze(anchor.id,{revision:1,requestId:randomUUID()});store.close();store=openStore(join(dir,'test.sqlite'));history=openHistoricalRecall(store);assert.deepEqual(history.get(anchor.id,report.id),report);
  const changed={...report,candidateIds:[]};store.db.prepare('UPDATE historical_recall_reports SET payload=? WHERE id=?').run(JSON.stringify(changed),report.id);assert.throws(()=>history.get(anchor.id,report.id),/校验失败/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP history recall freezes locally and does not change news, research, watches or simulation books',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'demo',now:()=>Date.parse(at)}),handler=createHandler(store,service);
 const call=async(method,url,data)=>{let status,body;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:s=>body=JSON.parse(s)});return {status,body};};
 try{store.ingest([past,negative,anchor],at);const old={news:store.db.prepare('SELECT * FROM news ORDER BY id').all(),research:service.research.list(),paper:service.paper.snapshot(),watches:store.watchlist()};
  const r=await call('POST',`/api/news/${anchor.id}/history-recall`,{revision:1,requestId:randomUUID()});assert.equal(r.status,200);assert.equal(r.body.mode,'demo');assert(r.body.candidateIds.includes(past.id));assert.equal((await call('GET',`/api/news/${anchor.id}/history-recall`)).body.reports.length,1);assert.equal((await call('GET',`/api/news/${anchor.id}/history-recall/${r.body.id}`)).body.hash,r.body.hash);assert.equal((await call('GET',`/api/news/${past.id}/history-recall/${r.body.id}`)).status,400);
  assert.deepEqual({news:store.db.prepare('SELECT * FROM news ORDER BY id').all(),research:service.research.list(),paper:service.paper.snapshot(),watches:store.watchlist()},old);
 }finally{await service.close();store.close();}
});
