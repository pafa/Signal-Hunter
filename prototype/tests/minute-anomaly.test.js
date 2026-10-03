import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {evaluateObservation,validateObservationDefinition} from '../server/observation-rules.mjs';
import {parseMinutes,parseYahooMinutes,instrument} from '../server/providers.mjs';
import {evaluateMinuteAnomaly} from '../server/minute-anomaly.mjs';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
const at='2026-10-02T14:07:30Z',topic={id:'minute-stat',title:'Synthetic minute statistics',version:1,status:'active',companies:[{symbol:'AAPL.US'}],evidence:[],hypothesis:{},claims:[]};
const condition=(patch={})=>({type:'minute-anomaly',symbol:'AAPL.US',metric:'return',windowSize:5,zThreshold:3,direction:'both',...patch});
function payload(){let price=100;const close=[price];for(const r of [-.2,-.1,0,.1,.2,1,50]){price*=1+r/100;close.push(price);}return {chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp:close.map((_,i)=>Date.parse('2026-10-02T14:00:00Z')/1000+60*i),indicators:{quote:[{close}]}}]}};}
const quote=()=>({...parseYahooMinutes(payload(),instrument('AAPL.US')),receivedAt:at});
const definition=c=>validateObservationDefinition({label:'Synthetic minute anomaly',join:'all',conditions:[c]},topic);
const evaluate=(q=quote(),c=condition(),extra={})=>evaluateObservation({definition:definition(c),binding:{topicVersion:1,counterevidence:[]}},topic,{at,quote:()=>q,check:()=>({state:'ok'}),...extra});
const stats=r=>r.results[0].input.statistical;
test('minute anomaly requires explicit associated security and bounded return-only parameters',()=>{
 for(const patch of [{metric:'volume'},{windowSize:4},{windowSize:121},{windowSize:'5'},{zThreshold:0},{zThreshold:21},{direction:'up'},{symbol:'MSFT.US'},{interval:'1d'},{unexpected:true}])assert.throws(()=>definition(condition(patch)));
 assert.equal(definition(condition()).conditions[0].interval,'1m');assert.equal(definition(condition()).conditions[0].currency,'USD');
});
test('minute returns exclude current sample and candidate from baseline with n-1 deviation',()=>{
 const r=evaluate(),s=stats(r);assert.equal(r.state,'true');assert.equal(s.baselineCount,5);assert(Math.abs(s.mean)<1e-10);assert(Math.abs(s.std-Math.sqrt(.025))<1e-10);assert(Math.abs(s.candidate.value-1)<1e-10);assert.equal(s.candidate.date,'2026-10-02T14:06:00.000Z');assert.equal(s.excludedLatest,'2026-10-02 14:07');assert.equal(s.points.length,7);assert.equal(r.results[0].input.executable,false);
 const q=quote();q.points.at(-1).close=1;assert.deepEqual(stats(evaluate(q)),s,'incomplete last sample must not affect statistic');
});
test('high/low/both and inclusive thresholds use relative return deviations',()=>{
 const q=quote(),z=stats(evaluate(q)).z;assert.equal(evaluate(q,condition({zThreshold:z})).state,'true');assert.equal(evaluate(q,condition({zThreshold:z+.001})).state,'false');assert.equal(evaluate(q,condition({direction:'low'})).state,'false');q.points.at(-2).close=q.points.at(-3).close*.99;assert.equal(evaluate(q,condition({direction:'low'})).state,'true');assert.equal(evaluate(q,condition({direction:'high'})).state,'false');
});
test('invalid rows, duplicates, unknown provenance and legacy caches never silently become valid statistics',()=>{
 for(const edit of [q=>delete q.minuteQuality,q=>q.minuteQuality.invalidRows=1,q=>q.minuteQuality.duplicateTimes=['2026-10-02 14:02'],q=>q.adjustment='unknown',q=>q.providerTimezone='unverified',q=>q.lastBarMayBeIncomplete=false,q=>q.provider='unknown']){const q=quote();edit(q);assert.equal(evaluate(q).state,'unknown');}
});
test('gaps, sorting errors, short windows and malformed prices stay unknown',()=>{
 for(const edit of [q=>q.points.splice(2,1),q=>q.points.reverse(),q=>q.points[3].time=q.points[2].time,q=>q.points[2].close=0,q=>q.points[2].close=null,q=>q.providerTime='2026-10-02 14:08']){const q=quote();edit(q);assert.equal(evaluate(q).state,'unknown');}
 const q=quote();q.points.slice(0,-2).forEach(p=>p.close=100);assert.equal(evaluate(q).state,'unknown');
});
test('future, stale and failed source inputs cannot trigger even if cached prices deviate',()=>{
 assert.equal(evaluate(quote(),condition(),{check:()=>({state:'error'})}).state,'unknown');assert.equal(evaluate(quote(),condition(),{at:'2026-10-02T14:20:00Z'}).state,'unknown');const q=quote();q.receivedAt='2026-10-02T14:08:00Z';assert.equal(evaluate(q).state,'unknown');q.receivedAt=at;q.points.at(-1).time='2026-10-02 14:08';q.providerTime=q.points.at(-1).time;assert.equal(evaluate(q).state,'unknown');
});
test('same-session requirement excludes lunch, overnight, holidays and closing auctions',()=>{
 const c=condition({symbol:'00700.HK'}),q=quote();const direct=(time)=>evaluateMinuteAnomaly(c,q,{at:time,provenance:{}});
 for(const time of ['2026-10-02T04:30:00Z','2026-10-02T08:01:00Z','2026-10-03T02:00:00Z']){q.receivedAt=time;assert.equal(direct(time).state,'unknown');}
 q.points=quote().points.map((p,i)=>({...p,time:`2026-10-02 ${i<4?'03:':'05:'}${String(56+i%4).padStart(2,'0')}`}));q.providerTime=q.points.at(-1).time;q.receivedAt='2026-10-02T06:00:00Z';assert.equal(direct(q.receivedAt).state,'unknown');
 assert.equal(evaluate(quote(),condition(),{at:'2026-10-02T20:00:00Z',offline:true}).state,'unknown');
});
test('both minute parsers expose duplicate and discarded source rows while retaining legacy chart projections',()=>{
 const p=payload(),d=p.chart.result[0];d.timestamp[2]=d.timestamp[1];d.indicators.quote[0].close[3]=null;const y=parseYahooMinutes(p,instrument('AAPL.US'));assert.equal(y.minuteQuality.invalidRows,1);assert.equal(y.minuteQuality.duplicateTimes.length,1);assert.equal(y.points.length,6);assert.equal(evaluate({...y,receivedAt:at}).state,'unknown');
 const nonAligned=payload();nonAligned.chart.result[0].timestamp[7]+=30;const fractional=parseYahooMinutes(nonAligned,instrument('AAPL.US'));assert.equal(fractional.points.length,8);assert.equal(fractional.minuteQuality.invalidRows,0);assert.deepEqual(fractional.minuteQuality.roundedTimes,['2026-10-02 14:07']);assert.equal(evaluate({...fractional,receivedAt:at}).state,'true');
 nonAligned.chart.result[0].timestamp[2]+=30;assert.equal(evaluate({...parseYahooMinutes(nonAligned,instrument('AAPL.US')),receivedAt:at}).state,'unknown');
 const e=parseMinutes({data:{code:'00700',trends:['2026-10-02 10:00,1,100','2026-10-02 10:00,1,101','bad,1,102','2026-10-02 10:01,1,103']}},instrument('00700.HK'));assert.equal(e.minuteQuality.invalidRows,1);assert.deepEqual(e.minuteQuality.duplicateTimes,['2026-10-02 10:00']);assert.equal(e.points[0].close,101);
});
test('AND/OR composition and old price rules retain existing semantics',()=>{
 const r={definition:{...definition(condition()),conditions:[...definition(condition()).conditions,{type:'at',at:'2026-10-02T15:00:00Z'}]},binding:{topicVersion:1,counterevidence:[]}},opts={at,quote,check:()=>({state:'ok'})};assert.equal(evaluateObservation(r,topic,opts).state,'false');r.definition.join='any';assert.equal(evaluateObservation(r,topic,opts).state,'true');
});
function persistent(path=':memory:'){const store=openStore(path),inbox=openObservationInbox(store,{clock:()=>at,getTopic:()=>topic});return {store,inbox,create:()=>inbox.rules.create(topic.id,{clientId:'minute-anomaly-rule',topicVersion:1,label:'Synthetic minute anomaly',join:'all',conditions:[condition()]}),sample(q=quote()){store.saveQuote(q,at);store.status('AAPL.US',{state:'ok',receivedAt:at});return inbox.process([topic],{positions:[]});}};}
test('frozen minute windows and receipts survive revisions, rearm and SQLite reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'minute-anomaly-')),path=join(dir,'fixture.sqlite');let f=persistent(path);try{f.create();assert.equal(f.sample().added,1);const item=f.inbox.snapshot().items[0],frozen=JSON.stringify(item.input);assert.deepEqual(item.symbols,['AAPL.US']);f.inbox.respond(item.id,{revision:1,action:'complete',note:'Synthetic review'});const q=quote();q.points.at(-2).close*=1.01;assert.equal(f.sample(q).added,0);assert.equal(JSON.stringify(f.inbox.snapshot().items[0].input),frozen);f.store.close();f=persistent(path);assert.equal(JSON.stringify(f.inbox.snapshot().items[0].input),frozen);assert.equal(f.inbox.receipts(item.id).length,1);f.inbox.rules.update('minute-anomaly-rule',{version:1,topicVersion:1,action:'rearm',note:'Synthetic new check'});assert.equal(f.sample(q).added,1);assert.equal(f.store.quoteHistory('AAPL.US').length,2);}finally{f.store.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed todo insertion rolls back the check and preserves retry evidence',()=>{
 const f=persistent();try{f.create();f.store.db.exec("CREATE TRIGGER fail_stat BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.throws(()=>f.sample(),/synthetic failure/);assert.equal(f.inbox.rules.list()[0].check,null);f.store.db.exec('DROP TRIGGER fail_stat');assert.equal(f.sample().added,1);}finally{f.store.close();}
});

test('known mainland and Hong Kong local timezones compare a valid same-session window',()=>{
 for(const symbol of ['600519.SH','00700.HK']){
  const q=quote();q.symbol=symbol;q.currency=symbol.endsWith('HK')?'HKD':'CNY';q.providerTimezone=symbol.endsWith('HK')?'Asia/Hong_Kong':'Asia/Shanghai';q.points=q.points.map(p=>({...p,time:p.time.replace('2026-10-02 14:','2026-09-30 10:')}));q.providerTime=q.points.at(-1).time;q.receivedAt='2026-09-30T02:07:30Z';assert.equal(evaluateMinuteAnomaly(condition({symbol}),q,{at:q.receivedAt,provenance:{}}).state,'true');
 }
});
