import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDaily} from '../server/daily.mjs';
import {instrument,yahooSymbol} from '../server/providers.mjs';
import {dailyWindowDates,dailyPriceObservations,dailyPriceRows} from '../server/daily-event-prices.mjs';
import {digest} from '../server/codex-research.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {classifyHeadline} from '../server/triage.mjs';
const decision='2026-10-01T14:00:00Z',asOf='2026-11-02T22:30:00Z';
const dates=['2026-10-02',...dailyWindowDates('AAPL.US','2026-10-02',20)];
const prices=dates.map((_,i)=>i===1?110:i===2?90:i===4?105:i===20?120:100);
function quote(symbol='AAPL.US',values=prices,days=dates,received=asOf){
 const spec=instrument(symbol);
 return parseDaily({chart:{result:[{meta:{symbol:yahooSymbol(spec),currency:spec.currency,exchangeTimezoneName:spec.marketTimezone,dataGranularity:'1d'},timestamp:days.map(d=>Date.parse(d+'T14:00:00Z')/1000),indicators:{quote:[{close:values,volume:values.map(()=>1000)}]}}]}},symbol,received);
}
function archive(q){const payload=JSON.stringify(q);return {symbol:q.symbol,hash:digest(payload),payload,received_at:q.receivedAt};}
const sample=(id='s',symbol='AAPL.US')=>({id,decisionAt:decision,input:{id:'n'+id,firstSeen:decision,availableAt:decision},triage:{bucket:'quiet',companies:symbol?[{symbol}]:[]}});
function analyze(archives,extra={}){const obs=dailyPriceObservations(archives,extra.asOf||asOf);return {...dailyPriceRows(extra.samples||[sample()],{},obs,extra.benchmarks||{},extra.asOf||asOf),diagnostics:obs.diagnostics};}

test('daily calendar counts actual market dates and refuses unknown years',()=>{
 assert.deepEqual(dailyWindowDates('002594.SZ','2026-09-30',2),['2026-10-08','2026-10-09']);
 assert.deepEqual(dailyWindowDates('00700.HK','2026-09-30',2),['2026-10-02','2026-10-05']);
 assert.deepEqual(dailyWindowDates('AAPL.US','2026-11-25',2),['2026-11-27','2026-11-30']);
 assert.equal(dailyWindowDates('AAPL.US','2026-12-31',1),null);assert.equal(dailyWindowDates('AAPL.US','2025-12-31',1),null);
 const s=sample();s.decisionAt=s.input.firstSeen=s.input.availableAt='2026-10-02T00:30:00Z';
 assert.equal(analyze([archive(quote())],{samples:[s]}).rows[0].baselineDate,'2026-10-02'); // Oct 1 in New York
});
test('daily returns, benchmarks and closing drawdowns preserve zero, losses and no-symbol samples',()=>{
 const bm=dates.map((_,i)=>i===1?202:i===20?220:200),r=analyze([archive(quote()),archive(quote('SPY.US',bm))],{benchmarks:{USD:'SPY.US'},samples:[sample(),sample('none',null)]});
 assert.equal(r.summary.samples,2);assert.equal(r.summary.samplesWithoutUsableSymbol,1);assert.equal(r.noSymbols.length,1);assert.equal(r.summary.priced,3);assert.equal(r.summary.pairedBenchmark,3);
 assert.deepEqual(r.rows.map(r=>r.targetAt),['2026-10-05','2026-10-09','2026-10-30']);assert.deepEqual(r.rows.map(r=>Math.round(r.returnPct)),[10,0,20]);assert.deepEqual(r.rows.map(r=>Math.round(r.excessPct)),[9,0,10]);
 assert.equal(r.rows[0].maxDrawdownPct,0);assert.ok(Math.abs(r.rows[1].maxDrawdownPct+100*20/110)<1e-9);
 const loss=analyze([archive(quote('AAPL.US',prices.map((p,i)=>i===1?90:p)))]).rows[0];assert.ok(Math.abs(loss.returnPct+10)<1e-9);assert.equal(loss.bucket,'quiet');
});
test('missing endpoints never move windows and missing intermediate closes leave drawdown unknown',()=>{
 let r=analyze([archive(quote('AAPL.US',prices.map((p,i)=>i===0?null:p)))]);assert.equal(r.summary.priced,0);assert.match(r.rows[0].reason,/不顺延起点/);
 r=analyze([archive(quote('AAPL.US',prices.map((p,i)=>i===1?null:p)))]);assert.equal(r.rows[0].returnPct,null);assert.match(r.rows[0].reason,/不顺延终点/);assert.equal(r.rows[1].returnPct,0);assert.equal(r.rows[1].maxDrawdownPct,null);assert.match(r.rows[1].pathReason,/中间交易日缺价/);
 r=analyze([archive(quote())],{asOf:'2026-10-05T20:15:00Z'});assert.match(r.rows[0].reason,/尚未到期/);assert.equal(r.summary.priced,0);
 r=analyze([archive(quote())],{asOf:'2027-01-03T22:30:00Z'});assert.equal(r.summary.priced,0);assert.match(r.rows[0].reason,/截止日期.*未覆盖/);
});
test('source identities and receipt/hash provenance are required and later corrections never replace first valid closes',()=>{
 const first=quote('AAPL.US',[100,110],dates.slice(0,2),'2026-10-05T22:30:00Z'),later=quote('AAPL.US',[999,999],dates.slice(0,2),'2026-10-06T22:30:00Z'),r=analyze([archive(later),archive(first)]);assert.equal(r.rows[0].baseline.price,100);assert.equal(r.rows[0].endpoint.price,110);
 for(const patch of [{currency:'HKD'},{marketTimezone:'UTC'},{provider:'unverified'},{interval:'1m'},{calendarVersion:'old'},{duplicateDates:[dates[0]]},{actionsParsed:false},{dailyQuality:null},{dailyQuality:{version:'daily-quality/1',sourceInterval:'1m',sourceTimezone:'America/New_York'}}])assert.equal(analyze([archive({...quote(),...patch})]).summary.priced,0);
 const changed=quote();changed.points[1].at='2026-10-06T14:00:00Z';assert.equal(analyze([archive(changed)]).summary.priced,0);assert.throws(()=>analyze([{...archive(first),hash:'bad'}]),/指纹/);
 assert.equal(analyze([archive(quote())],{asOf:'2026-10-06T22:30:00Z'}).summary.priced,0);
 const unknown=quote();unknown.receivedAt='2027-01-03T22:30:00Z';assert.match(analyze([archive(unknown)],{asOf:unknown.receivedAt}).diagnostics[0].reason,/接收日期.*未覆盖/);
});
test('corporate actions and different price bases block only affected comparisons',()=>{
 const q=quote();q.actions=[{kind:'splits',date:'2026-10-06'}];let r=analyze([archive(q)]);assert.notEqual(r.rows[0].returnPct,null);assert.equal(r.rows[1].returnPct,null);assert.match(r.rows[1].reason,/公司行动/);
 const bm=quote('SPY.US');bm.priceBasis='different basis';r=analyze([archive(quote()),archive(bm)],{benchmarks:{USD:'SPY.US'}});assert.equal(r.summary.priced,3);assert.equal(r.summary.pairedBenchmark,0);
 const base=quote('AAPL.US',[100],dates.slice(0,1),'2026-10-02T22:30:00Z'),end=quote();end.priceBasis='different basis';r=analyze([archive(base),archive(end)]);assert.equal(r.summary.priced,0);assert.match(r.rows[0].reason,/口径不同/);
});
test('daily evidence stays immutable across reopen, preserves legacy reports and does not change market books',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'daily-event-prices-')),path=join(dir,'fixture.sqlite');let store=openStore(path),at=decision,service=createService(store,{mode:'research',now:()=>Date.parse(at)});
 try{
  for(const [id,title] of [['a','Apple shares earnings guidance cut'],['b','Local office appoints manager']]){const n={id,revision:1,title,url:'https://example.org/synthetic',publisher:'Synthetic fixture',publishedAt:decision,articleFirstSeen:decision,revisionFirstSeen:decision};service.research.screenings.capture(n,classifyHeadline(n),decision);}
  at='2026-10-01T14:10:00Z';let b=service.evaluations.create({requestId:randomUUID(),version:0,title:'Synthetic daily price cohort',start:decision,end:'2026-10-01T14:05:00Z',rulesHash:service.research.screenings.rulesHash});
  for(const s of b.samples)b=service.evaluations.annotate(b.id,{requestId:randomUUID(),version:b.version,label:{sampleId:s.id,verdict:'ordinary',clusterId:'',reviewer:'Synthetic fixture',exposure:'already-seen',reason:'Not an independent label',novelty:'',scale:'',mechanism:''}});
  b=service.evaluations.seal(b.id,{requestId:randomUUID(),version:b.version,confirm:true});const old=service.evaluations.export(b.id),books=digest(Object.fromEntries(Object.entries(service.marketSimulations).map(([k,m])=>[k,m.snapshot()])));
  store.saveDaily(quote());at=asOf;const cmd={requestId:randomUUID(),basis:'daily',benchmarks:{}},r=service.eventPrices.freeze(b.id,cmd);
  assert.equal(r.format,'event-daily-prices/1');assert.equal(r.summary.samples,2);assert.equal(r.summary.priced,3);assert.equal(r.forwardEligible,false);const {hash,...value}=r;assert.equal(hash,digest(value));assert.equal(r.archives.length,1);
  assert.deepEqual(service.eventPrices.freeze(b.id,cmd),r);assert.throws(()=>service.eventPrices.freeze(b.id,{...cmd,basis:'minute'}),/请求标识/);assert.throws(()=>service.eventPrices.freeze(b.id,{...cmd,requestId:randomUUID(),basis:'weekly'}),/参数/);
  assert.equal(service.eventPrices.freeze(b.id,{requestId:randomUUID(),benchmarks:{}}).format,'event-prices/2');assert.deepEqual(service.evaluations.export(b.id),old);assert.equal(digest(Object.fromEntries(Object.entries(service.marketSimulations).map(([k,m])=>[k,m.snapshot()]))),books);
  await service.close();store.close();store=openStore(path);service=createService(store,{mode:'research'});assert.deepEqual(service.eventPrices.get(b.id,r.id),r);assert.equal(service.eventPrices.list(b.id).reports.find(p=>p.id===r.id).format,r.format);
  store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>service.eventPrices.freeze(b.id,{...cmd,requestId:randomUUID()}),/恢复副本/);
 }finally{await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
