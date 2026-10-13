import test from 'node:test';
import assert from 'node:assert/strict';
import {marketSchedule} from '../shared/market-schedule.mjs';
import {marketClock} from '../shared/market-clock.mjs';

test('US opening uses the opening date DST offset, including a weekend transition and Beijing rollover',()=>{
 const summer=marketSchedule('AAPL.US','2026-03-06T22:00:00Z');
 assert.equal(summer.nextOpening.at,'2026-03-09T13:30:00.000Z');
 assert.equal(summer.nextOpening.beijing,'2026-03-09 21:30');
 const winter=marketSchedule('AAPL.US','2026-10-30T21:00:00Z');
 assert.equal(winter.nextOpening.at,'2026-11-02T14:30:00.000Z');
 assert.equal(winter.nextOpening.beijing,'2026-11-02 22:30');
 assert.equal(marketSchedule('AAPL.US','2026-11-02T15:00:00Z').periods[0].end.beijing,'2026-11-03 05:00');
});

test('US holidays and early closes do not produce a holiday opening or a normal full-day close',()=>{
 const s=marketSchedule('AAPL.US','2026-11-26T17:00:00Z');
 assert.equal(s.phase,'休市');assert.equal(s.nextOpening.date,'2026-11-27');assert(s.displayHalf);
 assert.equal(s.periods[0].end.at,'2026-11-27T18:00:00.000Z');
 assert.equal(marketSchedule('AAPL.US','2026-11-27T18:00:00Z').nextOpening.date,'2026-11-30');
});

test('mainland morning, lunch, closing auction and national holiday follow the original calendar',()=>{
 for(const symbol of ['600519.SH','000001.SZ']){
  const lunch=marketSchedule(symbol,'2026-10-12T03:30:00Z');assert.equal(lunch.phase,'午间休市');assert.equal(lunch.nextOpening.kind,'午后恢复');assert.equal(lunch.nextOpening.at,'2026-10-12T05:00:00.000Z');
  assert.equal(marketSchedule(symbol,'2026-10-12T06:57:00Z').phase,'收盘集合竞价');
  assert.equal(marketSchedule(symbol,'2026-09-30T07:00:00Z').nextOpening.date,'2026-10-08');
  assert.equal(marketSchedule(symbol,'2026-10-12T01:15:00Z').phase,'开盘集合竞价');
 }
});

test('Hong Kong half-day has no afternoon reopening and shows random closing as a range',()=>{
 const s=marketSchedule('0700.HK','2026-12-24T03:59:00Z');assert(s.half);assert.equal(s.periods.length,3);
 const close=s.periods.at(-1);assert.equal(close.start.local,'12:00');assert.equal(close.earliestEnd.local,'12:08');assert.equal(close.end.local,'12:10');
 assert.equal(s.nextOpening.date,'2026-12-28');
 assert.equal(marketSchedule('0700.HK','2026-12-24T04:09:00Z').phase,'收市竞价结束时间不定');
 assert.equal(marketSchedule('0700.HK','2026-12-24T04:10:00Z').phase,'已收盘');
});

test('Hong Kong normal day separates lunch and afternoon from the closing auction',()=>{
 const lunch=marketSchedule('0700.HK','2026-10-12T04:00:00Z');assert.equal(lunch.phase,'午间休市');assert.equal(lunch.nextOpening.local,'13:00');
 const s=marketSchedule('0700.HK','2026-10-12T08:00:00Z');assert.equal(s.phase,'收市竞价（适用证券）');assert.equal(s.periods.at(-1).earliestEnd.local,'16:08');assert.equal(s.periods.at(-1).end.local,'16:10');
});

test('unsupported market, invalid instant and calendar end stay unknown instead of guessing',()=>{
 for(const [symbol,at] of [['x','2026-10-12T00:00:00Z'],[null,'2026-10-12T00:00:00Z'],['AAPL.US','invalid'],['AAPL.US','2026-10-12T00:00:00'],['AAPL.US','2027-01-04T14:00:00Z']]){const s=marketSchedule(symbol,at);assert.equal(s.known,false);assert.equal(s.nextOpening,null);assert.deepEqual(s.periods,[]);}
 const last=marketSchedule('AAPL.US','2026-12-31T21:00:00Z');assert.equal(last.known,true);assert.equal(last.nextOpening,null);
});

test('display cannot mutate the existing calendar or returned sources and does not grant execution',()=>{
 const at='2026-10-12T02:00:00Z',before=marketClock('600519.SH',at),s=marketSchedule('600519.SH',at);
 s.periods[0].start.at='changed';s.sources[0].url='changed';
 assert.deepEqual(marketClock('600519.SH',at),before);assert.notEqual(marketSchedule('600519.SH',at).sources[0].url,'changed');
 assert.equal(s.executable,undefined);assert.equal(s.quote,undefined);
});
