import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDaily,fetchDaily} from '../server/daily.mjs';
import {dailyHealth} from '../shared/market-clock.mjs';
import {diagnoseMarketData} from '../server/market-diagnostics.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
const receivedAt='2026-10-02T18:00:00.000Z';
const payload=(close=null)=>({chart:{result:[{meta:{symbol:'0700.HK',currency:'HKD',exchangeTimezoneName:'Asia/Hong_Kong',dataGranularity:'1d',regularMarketPrice:999},timestamp:['2026-09-30T01:30:00Z','2026-10-02T01:30:00Z'].map(t=>Date.parse(t)/1000),indicators:{quote:[{close:[100,close],volume:[1000,2000]}]}}]}});
const parsed=close=>parseDaily(payload(close),'00700.HK',receivedAt);

test('HK null daily close stays missing despite volume and metadata price',()=>{
 const q=parsed(null),h=dailyHealth(q.symbol,q,receivedAt);
 assert.equal(q.points.at(-1).close,null);assert.equal(q.points.at(-1).volume,2000);assert.equal(q.incomplete,0);assert.equal(q.lastDate,'2026-09-30');
 assert.equal(h.status,'lagging');assert.equal(h.expectedDate,'2026-10-02');assert.equal(h.expectedBarStatus,'close-missing');assert.match(h.label,/2026-10-02 收盘价缺失/);
 const d=diagnoseMarketData(q.symbol,q,{state:'ok'},receivedAt,{interval:'1d'});
 assert.equal(d.sourceState,'last-attempt-succeeded');assert.equal(d.dataState,'lagging');assert.equal(d.dailyCoverage.expectedBarStatus,'close-missing');assert.equal(d.executable,false);
});
test('missing row, malformed close, holidays, buffer and unknown calendar stay distinct',()=>{
 const q=parsed(null);q.points.pop();assert.equal(dailyHealth(q.symbol,q,receivedAt).expectedBarStatus,'row-missing');
 for(const close of [0,-1,'100',NaN,Infinity]){const malformed=parsed(close);assert.equal(dailyHealth(q.symbol,malformed,receivedAt).expectedBarStatus,'close-missing');}
 for(const at of ['2026-10-01T18:00:00Z','2026-10-02T08:39:00Z']){const h=dailyHealth(q.symbol,q,at);assert.equal(h.expectedDate,'2026-09-30');assert.equal(h.status,'aligned');}
 assert.equal(dailyHealth(q.symbol,q,'2026-10-02T08:40:00Z').status,'lagging');
 assert.equal(dailyHealth(q.symbol,q,'2027-01-05T18:00:00Z').expectedBarStatus,'unknown');
});
test('daily fetch uses receipt clock after response and does not promote an unfinished bar',async()=>{
 let at='2026-10-02T08:39:00Z';const fetcher=async()=>{at='2026-10-02T08:40:00Z';return Response.json(payload(110));};
 const complete=await fetchDaily('00700.HK',fetcher,()=>at);assert.equal(complete.lastDate,'2026-10-02');assert.equal(complete.receivedAt,at);
 const early=await fetchDaily('00700.HK',async()=>Response.json(payload(110)),()=> '2026-10-02T08:39:00Z');assert.equal(early.lastDate,'2026-09-30');assert.equal(early.incomplete,1);
});
test('archive-only save preserves cache and both snapshots through a real reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-daily-integrity-')),path=join(dir,'test.sqlite');let s=openStore(path);
 try{const good=parsed(110),bad=parsed(null);s.saveDaily(good);s.saveDaily(bad,{activate:false});s.close();s=openStore(path);assert.deepEqual(s.daily(good.symbol),good);const rows=s.db.prepare('SELECT payload FROM daily_snapshots ORDER BY rowid').all();assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[1].payload),bad);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed archival transaction leaves both active quote and history intact',()=>{
 const s=openStore(':memory:');try{s.saveDaily(parsed(110));const before=s.daily('00700.HK');s.db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON daily_snapshots BEGIN SELECT RAISE(ABORT,'test archive failure'); END");assert.throws(()=>s.saveDaily(parsed(null),{activate:false}),/test archive failure/);assert.deepEqual(s.daily('00700.HK'),before);assert.equal(s.db.prepare('SELECT count(*) n FROM daily_snapshots').get().n,1);}finally{s.close();}
});
test('service archives regression, blocks healthy-source claim, then accepts same-day correction',async()=>{
 const s=openStore(':memory:');let at=Date.parse(receivedAt),value=null;const service=createService(s,{mode:'research',now:()=>at,fetcher:async()=>Response.json(payload(value))});
 try{s.addWatch('00700.HK');s.saveDaily(parsed(110));const book=JSON.stringify(service.paper.snapshot()),prior=s.daily('00700.HK');
 const result=await service.refreshDaily('00700.HK',true);assert.match(result.error,/已留档/);assert.deepEqual(s.daily('00700.HK'),prior);assert.equal(s.checks()['daily:00700.HK'].failure.kind,'daily-regression');assert.equal(s.db.prepare('SELECT count(*) n FROM daily_snapshots').get().n,2);
 const cap=service.snapshot().dataCapabilities[0];assert.equal(cap.daily.status,'error');assert.equal(cap.daily.diagnostics.sourceState,'failed');assert.equal(cap.daily.diagnostics.dataState,'aligned');assert.equal(cap.execution.enabled,false);
 value=111;at+=900001;assert.equal((await service.refreshDaily('00700.HK')).ok,true);assert.equal(s.daily('00700.HK').points.at(-1).close,111);assert.equal(s.daily('00700.HK').receivedAt,new Date(at).toISOString());assert.equal(s.checks()['daily:00700.HK'].state,'ok');assert.equal(s.db.prepare('SELECT count(*) n FROM daily_snapshots').get().n,3);assert.equal(JSON.stringify(service.paper.snapshot()),book);
 }finally{await service.close();s.close();}
});
test('first incomplete response remains visible with explicit upstream gap',async()=>{
 const s=openStore(':memory:'),service=createService(s,{mode:'research',now:()=>Date.parse(receivedAt),fetcher:async()=>Response.json(payload())});
 try{s.addWatch('00700.HK');assert.equal((await service.refreshDaily('00700.HK')).ok,true);const cap=service.snapshot().dataCapabilities[0];assert.equal(cap.daily.status,'lagging');assert.match(cap.daily.label,/收盘价缺失/);assert.equal(cap.daily.diagnostics.dailyCoverage.expectedBarStatus,'close-missing');}finally{await service.close();s.close();}
});
