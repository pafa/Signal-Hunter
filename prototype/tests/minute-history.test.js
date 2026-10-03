import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {safeDiagnosticPayload} from '../shared/safe-errors.mjs';
import {createService} from '../server/service.mjs';
import {parseMinutes,instrument,hash} from '../server/providers.mjs';
const at='2026-10-02T06:01:00.000Z';
const q=(time='2026-10-02 14:00',close=100)=>parseMinutes({data:{code:'00700',trends:[`${time},0,${close},0`]}},instrument('00700.HK'));
const tables=s=>Object.fromEntries(['quotes','bars','quote_bars','quote_snapshots'].map(t=>[t,s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
test('regressed minute replies are archived without changing active quotes or bar values',()=>{
 const s=openStore(':memory:');try{s.saveQuote(q(),at);const before=s.quote('00700.HK');
 const result=s.saveQuote(q('2026-10-02 13:59',99),'2026-10-02T06:02:00Z');
 assert.equal(s.quote('00700.HK').providerTime,before.providerTime);
 assert.equal(result.activated,false);assert.equal(result.reason,'minute-regression');
 assert.deepEqual(s.quote('00700.HK'),before);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM quote_bars').get().n,1);
 assert.equal(s.quoteHistory('00700.HK')[0].quote.last,99);
 }finally{s.close();}
});
test('same-minute revisions and repeat polls retain immutable snapshots across restart and watch removal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-minute-history-')),path=join(dir,'test.sqlite');let s=openStore(path);
 try{s.addWatch('00700.HK');s.saveQuote(q(),at);s.saveQuote(q(undefined,101),'2026-10-02T06:02:00Z');s.saveQuote(q(undefined,101),'2026-10-02T06:03:00Z');s.saveQuote(q(undefined,101),'2026-10-02T06:03:00Z');
 const history=s.quoteHistory('00700.HK');assert.equal(history.length,3);assert.deepEqual(history.map(r=>r.quote.last),[101,101,100]);
 for(const r of history)assert.equal(r.hash,hash(JSON.stringify({quote:r.quote,receivedAt:r.receivedAt})));
 s.removeWatch('00700.HK');const before=tables(s);s.close();s=openStore(path);assert.deepEqual(tables(s),before);assert.deepEqual(s.quoteHistory('00700.HK'),history);
 assert.throws(()=>s.quoteHistory('00700.HK',101));
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('known zones compare actual instants across sources; future and incomparable replies only archive',()=>{
 const s=openStore(':memory:');try{s.saveQuote(q(),at);
 const utc={...q('2026-10-02 05:59'),provider:'yahoo-public-chart',providerTimezone:'UTC'};
 assert.equal(s.saveQuote(utc,at).reason,'minute-regression');
 assert.equal(s.saveQuote({...utc,providerTime:'2026-10-02 06:00',points:[{time:'2026-10-02 06:00',close:100}]},at).activated,true);
 const old=s.quote('00700.HK');assert.equal(s.saveQuote({...q(),providerTimezone:'unverified'},at).reason,'minute-time-incomparable');assert.deepEqual(s.quote('00700.HK'),old);
 assert.equal(s.saveQuote(q('2026-10-03 14:00'),at).reason,'minute-future');assert.deepEqual(s.quote('00700.HK'),old);
 }finally{s.close();}
});
test('legacy cache survives first update and a failed snapshot write rolls the complete update back',()=>{
 const s=openStore(':memory:');try{const old=q();s.db.prepare('INSERT INTO quotes VALUES(?,?,?)').run(old.symbol,JSON.stringify(old),at);
 s.saveQuote(q(undefined,101),'2026-10-02T06:02:00Z');assert.equal(s.quoteHistory(old.symbol).at(-1).reason,'legacy-cache');assert.equal(s.quoteHistory(old.symbol).at(-1).quote.last,100);
 const before=tables(s);s.db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON quote_snapshots BEGIN SELECT RAISE(ABORT,'snapshot failure'); END");
 assert.throws(()=>s.saveQuote(q(undefined,102),'2026-10-02T06:03:00Z'),/snapshot failure/);assert.deepEqual(tables(s),before);
 }finally{s.close();}
});
test('service reports retained cache as a failed refresh and preserves last successful time',async()=>{
 const s=openStore(':memory:');s.addWatch('00700.HK');s.saveQuote(q(),at);s.status('00700.HK',{state:'ok',receivedAt:at});
 const service=createService(s,{mode:'research',now:()=>Date.parse('2026-10-02T06:02:00Z'),fetcher:async()=>Response.json({data:{code:'00700',trends:['2026-10-02 13:59,0,99,0']}})});
 try{const result=await service.refreshQuote('00700.HK');assert.ok(result.error);assert.match(safeDiagnosticPayload(result).error,/时间倒退/);assert.equal(s.checks()['00700.HK'].failure.kind,'minute-regression');assert.equal(s.checks()['00700.HK'].receivedAt,at);assert.equal(s.quote('00700.HK').last,100);assert.equal(s.quoteHistory('00700.HK').length,2);}
 finally{await service.close();s.close();}
});
test('unknown zone comparisons stay within one source and legacy future cache can recover',()=>{
 const s=openStore(':memory:');try{
 const unknown={...q(),providerTimezone:'unverified'};s.saveQuote(unknown,at);
 assert.equal(s.saveQuote({...unknown,providerTime:'2026-10-02 13:59'},at).reason,'minute-regression');
 assert.equal(s.saveQuote({...q(),provider:'yahoo-public-chart',providerTimezone:'UTC'},'2026-10-02T15:00:00Z').reason,'replaces-unverified-time');
 const future=q('2026-10-03 14:00');s.db.prepare('UPDATE quotes SET payload=? WHERE symbol=?').run(JSON.stringify(future),future.symbol);
 assert.equal(s.saveQuote({...q(),providerTimezone:'unverified'},at).reason,'minute-time-incomparable');
 assert.equal(s.saveQuote(q(),at).reason,'replaces-future-cache');assert.equal(s.quote(future.symbol).last,100);
 }finally{s.close();}
});
test('refresh compares against the committed cache after fetch, not the pre-fetch cache',async()=>{
 const s=openStore(':memory:');s.addWatch('00700.HK');s.saveQuote(q('2026-10-02 13:58'),at);
 const service=createService(s,{mode:'research',now:()=>Date.parse('2026-10-02T06:02:00Z'),fetcher:async()=>{s.saveQuote(q(),at);return Response.json({data:{code:'00700',trends:['2026-10-02 13:59,0,99,0']}});}});
 try{assert.ok((await service.refreshQuote('00700.HK')).error);assert.equal(s.quote('00700.HK').providerTime,'2026-10-02 14:00');}
 finally{await service.close();s.close();}
});
