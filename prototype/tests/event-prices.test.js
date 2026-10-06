import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {classifyHeadline} from '../server/triage.mjs';
import {digest} from '../server/codex-research.mjs';
import {parseYahooMinutes,instrument} from '../server/providers.mjs';
import {eventPriceObservations,eventPriceRows} from '../server/event-prices.mjs';
const decision='2026-10-01T14:00:00Z',asOf='2026-10-22T16:00:00Z';
const minute=t=>t.replace('T',' ').slice(0,16);
const quality={version:'minute-quality/1',invalidRows:0,duplicateTimes:[],roundedTimes:[],sourceInterval:'1m'};
function quote(symbol,at,price,extra={}){const points=[{time:minute(at),close:price},{time:minute(new Date(Date.parse(at)+60000).toISOString()),close:price}];return {symbol,provider:'yahoo-public-chart',providerTimezone:'UTC',market:'美股',currency:'USD',interval:'1m',adjustment:'none',lastBarMayBeIncomplete:true,minuteQuality:quality,points,providerTime:points.at(-1).time,...extra};}
function archive(id,q,received=new Date(Date.parse(q.points[0].time.replace(' ','T')+':00Z')+120000).toISOString(),extra={}){const payload=JSON.stringify({quote:q,receivedAt:received});return {id,symbol:q.symbol,payload,hash:digest(payload),received_at:received,activated:1,reason:'accepted',...extra};}
const sample=(id='s',symbol='AAPL.US')=>({id,decisionAt:decision,input:{id:'n'+id,firstSeen:decision,availableAt:decision},triage:{bucket:'quiet',companies:symbol?[{symbol}]:[]}});
const baseline=()=>archive(1,quote('AAPL.US','2026-10-01T14:01:00Z',100));
const endpoint=()=>archive(2,quote('AAPL.US','2026-10-01T15:01:00Z',110));
const analyze=(archives,extra={})=>{const obs=eventPriceObservations(archives,extra.asOf||asOf);return {...eventPriceRows(extra.samples||[sample()],{},obs.points,extra.benchmarks||{},extra.asOf||asOf),diagnostics:obs.diagnostics};};
test('fixed windows retain unknown endpoints and compute raw and exactly aligned benchmark changes separately',()=>{
 const r=analyze([baseline(),endpoint(),archive(3,quote('SPY.US','2026-10-01T14:01:00Z',200)),archive(4,quote('SPY.US','2026-10-01T15:01:00Z',204))],{benchmarks:{USD:'SPY.US'},samples:[sample(),sample('none',null)]});
 assert.equal(r.rows.length,4);assert.equal(r.noSymbols.length,1);assert.equal(r.summary.samples,2);assert.equal(r.summary.samplesWithoutUsableSymbol,1);assert.equal(r.summary.priced,1);assert.equal(r.summary.pairedBenchmark,1);
 const a=r.rows[0];assert.ok(Math.abs(a.returnPct-10)<1e-10);assert.ok(Math.abs(a.benchmarkReturnPct-2)<1e-10);assert.ok(Math.abs(a.excessPct-8)<1e-10);assert.equal(a.baseline.snapshotId,1);assert.equal(a.endpoint.snapshotId,2);assert.equal(r.rows[1].returnPct,null);assert.match(r.rows[1].reason,/不延展/);
});
test('all four natural-day windows are anchored to the same earliest baseline, including losing and zero changes',()=>{
 const rows=[baseline(),endpoint(),archive(3,quote('AAPL.US','2026-10-02T14:01:00Z',90)),archive(4,quote('AAPL.US','2026-10-06T14:01:00Z',100)),archive(5,quote('AAPL.US','2026-10-21T14:01:00Z',120))];
 const r=analyze(rows);assert.equal(r.summary.priced,4);assert.deepEqual(r.rows.map(r=>Math.round(r.returnPct)),[10,-10,0,20]);assert.equal(r.rows[2].returnPct,0);assert(r.rows.every(r=>r.baseline.snapshotId===1));
});
test('later corrections never replace the first complete observation and the last or rounded minute is excluded',()=>{
 const correction=archive(3,quote('AAPL.US','2026-10-01T14:01:00Z',999),'2026-10-01T16:00:00Z');const r=analyze([correction,endpoint(),baseline()]);assert.equal(r.rows[0].baseline.price,100);
 const q=quote('AAPL.US','2026-10-01T14:01:00Z',100);q.points=[q.points[0]];q.providerTime=q.points[0].time;assert.equal(analyze([archive(1,q)]).summary.priced,0);
 q.points.push({time:'2026-10-01 14:02',close:200});q.providerTime=q.points[1].time;q.minuteQuality={...quality,roundedTimes:['2026-10-01 14:01']};assert.equal(eventPriceObservations([archive(1,q)],asOf).points.length,0);
});
test('invalid time provenance, missing source quality, rejected snapshots and unknown zones remain unpriced',()=>{
 for(const extra of [{providerTimezone:'unverified'},{currency:'CNY'},{market:'港股'},{adjustment:'split-adjusted'},{minuteQuality:{...quality,invalidRows:1}},{provider:'fixture-unknown'}]){const r=analyze([archive(1,quote('AAPL.US','2026-10-01T14:01:00Z',100,extra)),endpoint()]);assert.equal(r.summary.priced,0);assert.match(r.rows[0].reason,/起点|判断后/);}
 assert.equal(analyze([{...baseline(),activated:0},endpoint()]).summary.priced,0);
 const s=sample();s.input.availableAt='2026-10-01T14:01:00Z';assert.match(analyze([baseline(),endpoint()],{samples:[s]}).rows[0].reason,/时间缺失/);
});
test('a different endpoint provider, delayed benchmark or next-session boundary never creates a comparable return',()=>{
 assert.equal(analyze([baseline(),archive(2,quote('AAPL.US','2026-10-01T15:01:00Z',110,{provider:'eastmoney-public'}))]).summary.priced,0);
 const r=analyze([baseline(),endpoint(),archive(3,quote('SPY.US','2026-10-01T14:02:00Z',200)),archive(4,quote('SPY.US','2026-10-01T15:02:00Z',204))],{benchmarks:{USD:'SPY.US'}});assert.equal(r.summary.priced,1);assert.equal(r.summary.pairedBenchmark,0);assert.match(r.rows[0].benchmarkReason,/同一时刻/);
 assert.equal(analyze([baseline(),archive(2,quote('AAPL.US','2026-10-01T15:07:00Z',110))]).summary.priced,0);
});
test('future receipts cannot fill past reports; unmatured windows and corrupt archives stay explicit',()=>{
 const r=analyze([baseline(),endpoint()],{asOf:'2026-10-01T14:30:00Z'});assert.match(r.rows[0].reason,/尚未到期/);assert(r.rows.every(r=>r.returnPct===null));assert(r.diagnostics.some(r=>/晚于/.test(r.reason)));
 assert.throws(()=>analyze([{...baseline(),hash:'bad'}]),/指纹/);assert.throws(()=>analyze([{...baseline(),received_at:'invalid'}]),/指纹/);
});
function fixture(path=':memory:',mode='research'){
 let at=decision;const store=openStore(path),service=createService(store,{mode,now:()=>Date.parse(at)}),e=service.evaluations;
 for(const [id,title] of [['a','Apple shares earnings guidance cut'],['b','Local office appoints manager']]){const n={id,revision:1,title,url:'https://example.org/synthetic',publisher:'Synthetic fixture',publishedAt:decision,articleFirstSeen:decision,revisionFirstSeen:decision};service.research.screenings.capture(n,classifyHeadline(n),decision);}
 at='2026-10-01T14:10:00Z';let b=e.create({requestId:randomUUID(),version:0,title:'Synthetic price cohort',start:decision,end:'2026-10-01T14:05:00Z',rulesHash:service.research.screenings.rulesHash});
 for(const s of b.samples)b=e.annotate(b.id,{requestId:randomUUID(),version:b.version,label:{sampleId:s.id,verdict:'ordinary',clusterId:'',reviewer:'Synthetic fixture',exposure:'already-seen',reason:'Not an independent label',novelty:'',scale:'',mechanism:''}});
 b=e.seal(b.id,{requestId:randomUUID(),version:b.version,confirm:true});
 for(const a of [baseline(),endpoint()]){const p=JSON.parse(a.payload);store.saveQuote(p.quote,p.receivedAt);}
 at=asOf;return {store,service,b,command:()=>({requestId:randomUUID(),benchmarks:{}}),setTime:t=>at=t,close:async()=>{await service.close();store.close();}};
}
test('freezing snapshots the entire sealed cohort and price archives; later prices or repeated requests cannot rewrite it',async()=>{
 const f=fixture();try{const old=f.service.evaluations.export(f.b.id),cmd=f.command(),r=f.service.eventPrices.freeze(f.b.id,cmd);assert.equal(r.summary.samples,2);assert.equal(r.summary.priced,1);assert.equal(r.forwardEligible,false);const {hash,...value}=r;assert.equal(hash,digest(value));
 f.store.saveQuote(quote('AAPL.US','2026-10-02T14:01:00Z',90),'2026-10-02T14:03:00Z');assert.deepEqual(f.service.eventPrices.freeze(f.b.id,cmd),r);assert.deepEqual(f.service.eventPrices.get(f.b.id,r.id),r);assert.deepEqual(f.service.evaluations.export(f.b.id),old);
 const next=f.service.eventPrices.freeze(f.b.id,f.command());assert.notEqual(next.id,r.id);assert.equal(next.summary.priced,2);assert.equal(f.service.eventPrices.list(f.b.id).reports.length,2);
 assert.throws(()=>f.service.eventPrices.freeze(f.b.id,{...cmd,benchmarks:{USD:'SPY.US'}}),/请求标识/);
 }finally{await f.close();}
});
test('strict inputs, immutable cohort hashes, restore guard and atomic failures prevent partial reports',async()=>{
 const f=fixture();try{for(const patch of [{prices:[]},{benchmarks:{USD:'00700.HK'}},{benchmarks:{GBP:'AAPL.US'}},{benchmarks:[]},{requestId:'x'}])assert.throws(()=>f.service.eventPrices.freeze(f.b.id,{...f.command(),...patch}),/参数/);
 f.store.db.exec("CREATE TRIGGER fail_price BEFORE INSERT ON event_price_reports BEGIN SELECT RAISE(ABORT,'fixture failure'); END");assert.throws(()=>f.service.eventPrices.freeze(f.b.id,f.command()),/fixture failure/);assert.equal(f.service.eventPrices.list(f.b.id).reports.length,0);f.store.db.exec('DROP TRIGGER fail_price');
 f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.service.eventPrices.freeze(f.b.id,f.command()),/恢复副本/);f.store.db.prepare("DELETE FROM settings WHERE key='restore_review_required'").run();
 f.store.db.exec("UPDATE evaluation_batches SET payload=json_set(payload,'$.samples[0].triage.companies[0].symbol','MSFT.US')");assert.throws(()=>f.service.eventPrices.freeze(f.b.id,f.command()),/指纹/);
 }finally{await f.close();}
});
test('reports survive actual database close/reopen and reject tampering without changing older cohorts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'event-prices-')),path=join(dir,'fixture.sqlite'),f=fixture(path);let store,service;
 try{const r=f.service.eventPrices.freeze(f.b.id,f.command());await f.close();store=openStore(path);service=createService(store,{mode:'research'});assert.deepEqual(service.eventPrices.get(f.b.id,r.id),r);store.db.exec("UPDATE event_price_reports SET payload=json_set(payload,'$.rows[0].returnPct',999)");assert.throws(()=>service.eventPrices.get(f.b.id,r.id),/指纹/);}finally{if(store){await service.close();store.close();}else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP only accepts report configuration, returns full persisted evidence and never accepts injected prices',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service),base=`/api/evaluations/${f.b.id}/prices`;const call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};};
 try{assert.equal((await call('POST',base,{...f.command(),quotes:{}})).status,400);const r=await call('POST',base,f.command());assert.equal(r.status,201);assert.equal((await call('GET',`${base}/${r.result.id}`)).result.hash,r.result.hash);assert.equal((await call('GET',base)).result.reports.length,1);}finally{await f.close();}
});
test('demo mode cannot freeze observation returns',async()=>{const f=fixture(':memory:','demo');try{assert.equal(f.service.eventPrices.list(f.b.id).enabled,false);assert.throws(()=>f.service.eventPrices.freeze(f.b.id,f.command()),/当前模式/);}finally{await f.close();}});

function sourceWithMissing(){return {chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1m'},timestamp:['2026-10-01T14:01:00Z','2026-10-01T14:02:00Z','2026-10-01T14:03:00Z','2026-10-01T15:01:00Z','2026-10-01T15:02:00Z'].map(t=>Date.parse(t)/1000),indicators:{quote:[{close:[100,null,101,110,111]}]}}]}};}
test('real-provider null closes preserve valid fixed endpoints without inventing prices at missing labels',()=>{
 const q=parseYahooMinutes(sourceWithMissing(),instrument('AAPL.US'));assert.equal(q.minuteQuality.invalidRows,1);assert.deepEqual(q.minuteQuality.missingCloseTimes,['2026-10-01 14:02']);assert.equal(q.minuteQuality.sourceInterval,'1m');
 const a=archive(1,q,'2026-10-01T15:03:00Z'),obs=eventPriceObservations([a],asOf);assert.equal(obs.points.length,3);assert.equal(obs.points.some(p=>p.providerTime==='2026-10-01 14:02'),false);assert.deepEqual(obs.diagnostics[0].missingPriceTimes,['2026-10-01 14:02']);
 const r=analyze([a]);assert.equal(r.summary.priced,1);assert.ok(Math.abs(r.rows[0].returnPct-10)<1e-10);
 const missingEnd=sourceWithMissing();missingEnd.chart.result[0].indicators.quote[0].close[3]=null;assert.equal(analyze([archive(1,parseYahooMinutes(missingEnd,instrument('AAPL.US')),'2026-10-01T15:03:00Z')]).summary.priced,0);
});
test('null-close evidence does not forgive bad timestamps, malformed prices, duplicates or source interval mismatch',()=>{
 const valid=parseYahooMinutes(sourceWithMissing(),instrument('AAPL.US'));
 for(const change of [q=>q.minuteQuality.invalidRows=2,q=>q.minuteQuality.missingCloseTimes=['bad'],q=>q.minuteQuality.missingCloseTimes=['2026-10-01 14:01'],q=>q.minuteQuality.missingCloseTimes=['2026-10-01 14:02','2026-10-01 14:02'],q=>q.minuteQuality.sourceInterval='5m',q=>q.minuteQuality.sourceInterval=null,q=>q.minuteQuality.duplicateTimes=['2026-10-01 14:02']]){
  const q=structuredClone(valid);change(q);assert.equal(eventPriceObservations([archive(1,q,'2026-10-01T15:03:00Z')],asOf).points.length,0);
 }
 for(const value of [0,-1,'100']){const p=sourceWithMissing();p.chart.result[0].indicators.quote[0].close[1]=value;const q=parseYahooMinutes(p,instrument('AAPL.US'));assert.equal(q.minuteQuality.invalidRows,1);assert.deepEqual(q.minuteQuality.missingCloseTimes,[]);assert.equal(eventPriceObservations([archive(1,q,'2026-10-01T15:03:00Z')],asOf).points.length,0);}
 const badTime=sourceWithMissing();badTime.chart.result[0].timestamp[1]+=30;const q=parseYahooMinutes(badTime,instrument('AAPL.US'));assert.deepEqual(q.minuteQuality.missingCloseTimes,[]);assert.equal(eventPriceObservations([archive(1,q,'2026-10-01T15:03:00Z')],asOf).points.length,0);
});
test('legacy Yahoo observations require retained provider interval and missing-price evidence is never inferred',()=>{
 const q=structuredClone(quote('AAPL.US','2026-10-01T14:01:00Z',100));delete q.minuteQuality.sourceInterval;
 assert.equal(eventPriceObservations([archive(1,q)],asOf).points.length,0);
 q.minuteVolume={interval:'1m'};assert.equal(eventPriceObservations([archive(1,q)],asOf).points.length,1);
 q.minuteQuality={...q.minuteQuality,invalidRows:1};assert.equal(eventPriceObservations([archive(1,q)],asOf).points.length,0);
});
