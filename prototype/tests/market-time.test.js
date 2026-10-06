import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';
import {marketTime,canonicalMarketTime,compareMarketTime,isMarketInstant} from '../server/market-time.mjs';
import {liquidityIdentity} from '../server/market-liquidity.mjs';
import {quoteIssues} from '../server/market-sim-risk.mjs';
test('execution timestamps preserve nanoseconds across timezone aliases, trailing zeros and the epoch',()=>{
 const a='2026-10-02T14:00:00.000000123Z',b='2026-10-02T22:00:00.000000123+08:00';
 assert.equal(marketTime(a),marketTime(b));assert.equal(compareMarketTime(a,b),0);assert.equal(compareMarketTime(a,'2026-10-02T14:00:00.000000124Z'),-1);
 assert.equal(canonicalMarketTime(b),a);assert.equal(canonicalMarketTime('2026-10-02T14:00:00.123000000Z'),'2026-10-02T14:00:00.123Z');
 assert.equal(canonicalMarketTime('1969-12-31T23:59:59.999999999Z'),'1969-12-31T23:59:59.999999999Z');assert.equal(marketTime('1970-01-01T00:00:00Z'),0n);
 for(const s of ['2026-02-29T00:00:00Z','2026-10-02T24:00:00Z','2026-10-02T00:00:00.1234567891Z','2026-10-02T00:00:00','2026-10-02T00:00:00+08:60','2026-10-02T00:00:60Z']){assert.equal(isMarketInstant(s),false);assert(Number.isNaN(compareMarketTime(s,a)));assert.throws(()=>canonicalMarketTime(s));}
});
test('sub-millisecond quotes get distinct capacity identities while aliases and old millisecond keys remain stable',()=>{
 const q={symbol:'AAPL.US',source:'fixture',asOf:'2026-10-02T14:00:00.000000100Z'},alias={...q,asOf:'2026-10-02T22:00:00.000000100+08:00'};
 assert.deepEqual(liquidityIdentity(q),liquidityIdentity(alias));assert.notEqual(liquidityIdentity(q).key,liquidityIdentity({...q,asOf:'2026-10-02T14:00:00.000000200Z'}).key);
 const legacy={...q,asOf:'2026-10-02T14:00:00Z'},hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');assert.equal(liquidityIdentity(legacy).key,hash({version:2,symbol:legacy.symbol,source:legacy.source,at:Date.parse(legacy.asOf)}));assert.equal(liquidityIdentity(legacy).fingerprint,hash({...legacy,asOf:new Date(legacy.asOf).toISOString()}));
 assert.deepEqual(liquidityIdentity({...q,asOf:'2026-10-02T14:00:00Z'}),liquidityIdentity({...q,asOf:'2026-10-02T14:00:00.000000000Z'}));
});
test('future, expired, pre-session and FX boundaries are enforced below a millisecond',()=>{
 const at='2026-10-02T14:00:00.001Z',q={symbol:'AAPL.US',currency:'USD',kind:'market-simulation-input',verified:true,source:'fixture',rulesVersion:'fixture',id:'q',issuerId:'a',asOf:'2026-10-02T14:00:00.000000100Z',receivedAt:at,validUntil:at,bid:'1',ask:'1',mark:'1',fx:{id:'fx',source:'fixture',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:at},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-02T13:00:00Z',sessionClose:'2026-10-02T15:00:00Z',sellableAt:at,settlesAt:at,buyLot:1,sellLot:1,minBuyQty:1,availableBuy:10,availableSell:10,tickSize:'0.01'};
 const issues=x=>quoteIssues('AAPL.US',x,{quoteMaxAgeSeconds:120},at,{execution:true});assert.deepEqual(issues(q),[]);
 for(const change of [x=>x.asOf='2026-10-02T14:00:00.001000001Z',x=>x.validUntil='2026-10-02T14:00:00.000999999Z',x=>x.sessionOpen='2026-10-02T14:00:00.001000001Z',x=>x.sellableAt='2026-10-02T14:00:00.000000099Z',x=>x.fx.receivedAt='2026-10-02T14:00:00.001000001Z',x=>x.fx.validUntil='2026-10-02T14:00:00.000999999Z',x=>x.asOf='2026-10-02T13:58:00.000999999Z']){const x=structuredClone(q);change(x);assert(issues(x).length>0);}
});
