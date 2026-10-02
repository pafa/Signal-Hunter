import test from 'node:test';import assert from 'node:assert/strict';
import {diagnoseMarketData,marketFailure,marketJson} from '../server/market-diagnostics.mjs';
import {fetchMinutes,parseYahooMinutes,instrument} from '../server/providers.mjs';
import {openStore} from '../server/store.mjs';import {createService} from '../server/service.mjs';
const payload={chart:{result:[{meta:{symbol:'MU',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp:[Date.parse('2026-09-30T14:00:00Z')/1000],indicators:{quote:[{close:[110]}]}}]}};
const quote={...parseYahooMinutes(payload,instrument('MU.US')),receivedAt:'2026-09-30T14:01:00Z'};
test('UTC bar time is distinct from receipt time and closed market is distinct from stale trading data',()=>{
 const recent=diagnoseMarketData('MU.US',quote,{state:'ok',receivedAt:quote.receivedAt,noNewBar:true},'2026-09-30T14:02:00Z');assert.equal(recent.dataAt,'2026-09-30T14:00:00.000Z');assert.equal(recent.dataAgeSeconds,120);assert.equal(recent.cacheAgeSeconds,60);assert.equal(recent.dataState,'recent-unverified');assert.equal(recent.noNewBar,true);assert.equal(recent.executable,false);assert.equal(recent.realtimeVerified,false);
 assert.equal(diagnoseMarketData('MU.US',quote,{},'2026-09-30T14:10:00Z').dataState,'stale');
 const close={...quote,providerTime:'2026-10-02 19:59'};assert.equal(diagnoseMarketData('MU.US',close,{},'2026-10-03T12:00:00Z').dataState,'closed-session-cache');
 assert.equal(diagnoseMarketData('MU.US',quote,{},'2026-10-03T12:00:00Z').dataState,'stale');
});
test('unknown timezone, malformed date, future bar and missing data remain explicit',()=>{
 assert.equal(diagnoseMarketData('MU.US',{...quote,providerTimezone:'unverified'},{},'2026-09-30T14:02:00Z').dataState,'time-unverified');
 assert.equal(diagnoseMarketData('MU.US',{...quote,providerTime:'2026-02-30 14:00'},{},'2026-09-30T14:02:00Z').dataState,'time-unverified');
 assert.equal(diagnoseMarketData('MU.US',{...quote,providerTime:'2026-09-30 14:10'},{},'2026-09-30T14:02:00Z').dataState,'future');
 assert.equal(diagnoseMarketData('MU.US',null,{},'2026-09-30T14:02:00Z').dataState,'missing');
 const daily=diagnoseMarketData('MU.US',{points:[{date:'2026-09-29',close:110}],lastDate:'2026-09-29',marketTimezone:'America/New_York'}, {},'2026-09-30T14:02:00Z',{interval:'1d'});assert.equal(daily.dataState,'aligned');assert.equal(daily.providerTimezone,'America/New_York');
});
test('empty, malformed, transport and timeout failures are classified separately per fallback source',async()=>{
 for(const [read,kind] of [[async()=>'', 'empty-response'],[async()=>'{', 'format']])try{await marketJson(read);assert.fail('must reject');}catch(error){assert.equal(marketFailure(error).kind,kind);}
 assert.equal(marketFailure(new Error('fetch failed')).kind,'network');assert.equal(marketFailure(new DOMException('timeout','TimeoutError')).kind,'timeout');assert.equal(marketFailure(new Error('上游 HTTP 429')).kind,'http');
 await assert.rejects(fetchMinutes('MU.US',async url=>{if(url.includes('eastmoney'))throw new DOMException('timeout','TimeoutError');return new Response('');}),error=>error.kind==='all-sources-failed'&&error.attempts[0].kind==='timeout'&&error.attempts[1].kind==='empty-response');
});
test('milliseconds and wrong exchange timezone are rejected instead of plausible minute prices',()=>{
 const bad=structuredClone(payload);bad.chart.result[0].timestamp[0]*=1000;assert.throws(()=>parseYahooMinutes(bad,instrument('MU.US')),/没有有效/);const zone=structuredClone(payload);zone.chart.result[0].meta.exchangeTimezoneName='Asia/Shanghai';assert.throws(()=>parseYahooMinutes(zone,instrument('MU.US')),/时区不匹配/);
});
test('source failure preserves cached data time, successful unchanged bars and paper ledger',async()=>{
 const store=openStore(':memory:');let at=Date.parse('2026-09-30T14:02:00Z'),fail=false;const service=createService(store,{mode:'research',now:()=>at,quoteCooldown:1,fetcher:async url=>{if(fail)throw new Error('fetch failed');if(url.includes('eastmoney'))return new Response('{}');return Response.json(payload);}});
 try{store.addWatch('MU.US');const book=JSON.stringify(service.paper.snapshot());await service.refreshQuote('MU.US');at+=1000;await service.refreshQuote('MU.US');assert.equal(service.snapshot().dataCapabilities[0].minutes.diagnostics.noNewBar,true);const cached=store.quote('MU.US');fail=true;at+=1000;await service.refreshQuote('MU.US');const diagnostic=service.snapshot().dataCapabilities[0].minutes.diagnostics;assert.equal(diagnostic.sourceState,'failed');assert.equal(diagnostic.failure.attempts[0].kind,'network');assert.equal(diagnostic.rawProviderTime,cached.providerTime);assert.equal(diagnostic.lastSuccessfulAt,cached.receivedAt);assert.equal(JSON.stringify(service.paper.snapshot()),book);
 }finally{service.close();store.close();}
});
