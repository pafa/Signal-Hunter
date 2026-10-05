import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchMinutes,parseMinutes,instrument} from '../server/providers.mjs';
import {diagnoseMarketData} from '../server/market-diagnostics.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
const at='2026-10-02T20:02:00.000Z';
const primary={data:{code:'AAPL',trends:['2026-10-03 04:00,0,100,0']}};
const backup={chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1m'},timestamp:[Date.parse('2026-10-02T19:59:00Z')/1000],indicators:{quote:[{close:[101],volume:[123]}]}}]}};
test('successful primary with unknown time tries existing UTC source without reinterpreting primary timestamps',async()=>{
 const frozen=JSON.stringify(primary),calls=[];
 const q=await fetchMinutes('AAPL.US',async url=>{calls.push(url);return Response.json(url.includes('eastmoney')?primary:backup);});
 assert.equal(calls.length,2);assert.equal(q.provider,'yahoo-public-chart');assert.equal(q.providerTimezone,'UTC');assert.equal(q.providerTime,'2026-10-02 19:59');assert.equal(q.points[0].volume,123);
 assert.equal(q.sourceSelection.primaryTime,'2026-10-03 04:00');assert.equal(q.sourceSelection.primaryTimezone,'unverified');assert.equal(q.sourceSelection.outcome,'backup-selected');assert.equal(JSON.stringify(primary),frozen);
 const d=diagnoseMarketData('AAPL.US',q,{state:'ok'},at);assert.equal(d.dataAt,'2026-10-02T19:59:00.000Z');assert.equal(d.dataState,'closed-session-cache');assert.equal(d.executable,false);assert.equal(d.realtimeVerified,false);
});
test('failed or mismatched backup retains unknown primary research data and never exposes provider exception text',async()=>{
 for(const variant of ['http','transport','identity','timezone','format']){
  const q=await fetchMinutes('AAPL.US',async url=>{
   if(url.includes('eastmoney'))return Response.json(primary);
   if(variant==='http')return new Response('denied',{status:403});
   if(variant==='transport')throw Error('PRIVATE_SOURCE_DIAGNOSTIC');
   if(variant==='format')return new Response('{');
   const b=structuredClone(backup);b.chart.result[0].meta[variant==='identity'?'symbol':'exchangeTimezoneName']='wrong';return Response.json(b);
  });
  assert.equal(q.provider,'eastmoney-public');assert.equal(q.last,100);assert.equal(q.providerTimezone,'unverified');assert.equal(q.sourceSelection.outcome,'backup-unavailable');assert(!JSON.stringify(q).includes('PRIVATE_SOURCE_DIAGNOSTIC'));
  assert.equal(diagnoseMarketData('AAPL.US',q,{state:'ok'},at).dataState,'time-unverified');
 }
});
test('known A/H primary times remain single-source requests',async()=>{
 for(const symbol of ['600519.SH','00700.HK']){let calls=0;const spec=instrument(symbol),q=await fetchMinutes(symbol,async()=>{calls++;return Response.json({data:{code:spec.code,trends:['2026-10-02 14:00,0,100,0']}});});assert.equal(calls,1);assert.equal(q.provider,'eastmoney-public');assert.equal(q.sourceSelection,undefined);}
});
test('service persists selection and old unknown history, rejects degradation and respects shared provider cooling',async()=>{
 const store=openStore(':memory:');let now=Date.parse(at),failure=false,yahooCalls=0;
 store.addWatch('AAPL.US');store.saveQuote(parseMinutes(primary,instrument('AAPL.US')),new Date(now-1000).toISOString());const original=store.quoteHistory('AAPL.US');
 const service=createService(store,{mode:'research',now:()=>now,quoteCooldown:1,fetcher:async url=>{if(url.includes('eastmoney'))return Response.json(primary);yahooCalls++;return failure?new Response('denied',{status:429}):Response.json(backup);}});
 try{
  const ledger=JSON.stringify(service.paper.snapshot());assert.equal((await service.refreshQuote('AAPL.US')).ok,true);const saved=store.quote('AAPL.US');assert.equal(saved.sourceSelection.outcome,'backup-selected');assert.equal(store.quoteHistory('AAPL.US').at(-1).hash,original[0].hash);
  failure=true;now+=1000;assert((await service.refreshQuote('AAPL.US')).error);assert.deepEqual(store.quote('AAPL.US'),saved);assert.equal(store.quoteHistory('AAPL.US')[0].reason,'minute-time-incomparable');assert.equal(store.quoteHistory('AAPL.US')[0].quote.sourceSelection.outcome,'backup-unavailable');
  now+=1000;await service.refreshQuote('AAPL.US');assert.equal(yahooCalls,2,'cooled backup must not be requested again');assert.deepEqual(store.quote('AAPL.US'),saved);assert.equal(JSON.stringify(service.paper.snapshot()),ledger);
 }finally{await service.close();store.close();}
});
