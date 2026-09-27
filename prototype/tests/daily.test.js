import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDaily} from '../server/daily.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {comparisonModel,periodBounds,movingAverage,plotPath,dailySummary} from '../src/integrated/daily-model.js';
import {eventProfile} from '../src/integrated/event-view.js';
const at=d=>Date.parse(d)/1000;
const payload=()=>({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d'},timestamp:[at('2026-09-22T13:30Z'),at('2026-09-23T13:30Z'),at('2026-09-24T13:30Z')],indicators:{quote:[{close:[100,null,103]}]},events:{dividends:{x:{date:at('2026-09-22T13:30Z'),amount:.25}}}}]}});
const q=(values)=>({points:values.map(([date,close])=>({date,close}))});
test('daily data accepts completed local day after buffer, keeps gaps and company action',()=>{
 const r=parseDaily(payload(),'AAPL.US','2026-09-24T20:45:00Z');assert.equal(r.points.length,3);assert.equal(r.points[1].close,null);assert.equal(r.missing,1);assert.equal(r.incomplete,0);assert.equal(r.lastDate,'2026-09-24');assert.equal(r.actions[0].date,'2026-09-22');
});
test('daily validation rejects incorrect identity, currency and timeframe',()=>{
 for(const [k,v]of[['symbol','MSFT'],['currency','HKD'],['dataGranularity','1m'],['exchangeTimezoneName','Asia/Shanghai']]){const p=payload();p.chart.result[0].meta[k]=v;assert.throws(()=>parseDaily(p,'AAPL.US'));}
});
test('daily boundary uses exchange calendar rather than UTC date',()=>{const p=payload();p.chart.result[0].timestamp=[at('2026-09-23T13:30Z')];p.chart.result[0].indicators.quote[0].close=[100];assert.throws(()=>parseDaily(p,'AAPL.US','2026-09-23T18:00Z'));assert.equal(parseDaily(p,'AAPL.US','2026-09-24T01:00Z').points.length,1);assert.equal(parseDaily(p,'AAPL.US','2026-09-24T05:00Z').points.length,1);});
test('daily cache is separate from minute quote and retains old snapshots',()=>{const s=openStore(':memory:');try{s.saveQuote({symbol:'AAPL.US',points:[{time:'2026-09-24 14:00',close:9}]});const d=parseDaily(payload(),'AAPL.US','2026-09-24T20:45Z');s.saveDaily(d);s.saveDaily({...d,receivedAt:'2026-09-25T20:45Z'});assert.equal(s.quote('AAPL.US').points[0].close,9);assert.equal(s.daily('AAPL.US').interval,'1d');assert.equal(s.db.prepare('SELECT count(*) n FROM daily_snapshots').get().n,2);}finally{s.close();}});
test('daily refresh is watch-only and coalesces concurrent requests',async()=>{const s=openStore(':memory:');let calls=0;const service=createService(s,{fetcher:async()=>{calls++;return Response.json(payload());}});try{await assert.rejects(service.refreshDaily('AAPL.US'));s.addWatch('AAPL.US');await Promise.all([service.refreshDaily('AAPL.US'),service.refreshDaily('AAPL.US')]);await service.refreshDaily('AAPL.US',true);assert.equal(calls,1);assert.ok(s.daily('AAPL.US'));}finally{s.close();}});
test('failed daily refresh keeps cached chart and marks error',async()=>{const s=openStore(':memory:');s.addWatch('AAPL.US');s.saveDaily(parseDaily(payload(),'AAPL.US','2026-09-24T20:45Z'));const service=createService(s,{fetcher:async()=>{throw new Error('fetch failed');}});try{await service.refreshDaily('AAPL.US',true);assert.equal(s.daily('AAPL.US').points[0].close,100);assert.equal(s.checks()['daily:AAPL.US'].state,'error');}finally{s.close();}});
test('compare starts and ends on common valid dates, never forward fills',()=>{
 const rows=[{symbol:'US',quote:q([['2026-09-01',100],['2026-09-02',102],['2026-09-03',null],['2026-09-04',110],['2026-09-07',120]])},{symbol:'HK',quote:q([['2026-09-02',200],['2026-09-03',210],['2026-09-04',220]])}];
 const c=comparisonModel(rows,{});assert.equal(c.start,'2026-09-02');assert.equal(c.end,'2026-09-04');assert.equal(c.count,2);assert.equal(c.excluded,1);assert.equal(c.series[0].points[1].close,null);assert.equal(c.series[1].points[0].close,0);assert.ok(Math.abs(c.series[1].change-10)<1e-10);
});
test('comparison refuses partial data and insufficient intersection',()=>{assert.ok(comparisonModel([{quote:q([['2026-09-01',10]])},{quote:null}],{}).error);assert.ok(comparisonModel([{quote:q([['2026-09-01',10]])},{quote:q([['2026-09-02',20]])}],{}).error);});
test('period selection clamps month ends and no data remains empty',()=>{assert.deepEqual(periodBounds([q([['2026-03-31',100]])],1),{start:'2026-02-28',end:'2026-03-31'});assert.equal(periodBounds([],3).end,null);assert.equal(dailySummary([]).change,null);});
test('moving average does not bridge null observations or insufficient history',()=>{const p=q([['a',1],['b',null],['c',3],['d',4],['e',5]]).points;assert.deepEqual(movingAverage(p,3).map(p=>p.close),[null,null,null,null,4]);});
test('SVG geometry breaks missing values and long date gaps',()=>{const p=q([['2026-09-01',1],['2026-09-02',null],['2026-09-03',3],['2026-09-10',4]]).points;assert.equal(plotPath(p,d=>Date.parse(d)/86400000,v=>v).match(/M/g).length,3);});
test('daily refresh API rejects bulk and unwatched symbols before any fetch',async()=>{const s=openStore(':memory:');let calls=0;const handler=createHandler(s,{refreshDaily:()=>{calls++;}});try{let status;const req={headers:{host:'127.0.0.1:4179','content-type':'application/json'},method:'POST',url:'/api/daily/refresh',async*[Symbol.asyncIterator](){yield JSON.stringify({symbols:['NOT-WATCHED.US']});}};await handler(req,{writeHead:c=>{status=c},end:()=>{}});assert.equal(status,400);assert.equal(calls,0);}finally{s.close();}});
test('event lens uses explicit category and provides neutral fallback',()=>{assert.equal(eventProfile({label:'重大订单'}).id,'order');assert.equal(eventProfile({label:'传闻与反证'}).id,'denial');assert.equal(eventProfile({label:'未知'}).id,'general');});
