import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {evaluateObservation,validateObservationDefinition} from '../server/observation-rules.mjs';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {parseDaily} from '../server/daily.mjs';
import {anomalyQuote,anomalyAt} from './fixtures/daily-anomaly.mjs';
const topic={id:'stat-topic',title:'Synthetic daily statistics',version:1,status:'active',companies:[{symbol:'AAPL.US'}],evidence:[],hypothesis:{},claims:[]};
const condition=(patch={})=>({type:'daily-anomaly',symbol:'AAPL.US',metric:'return',windowSize:5,zThreshold:3,direction:'both',...patch});
const definition=c=>validateObservationDefinition({label:'Synthetic anomaly',join:'all',conditions:[c]},topic);
const evaluate=(c=condition(),q=anomalyQuote(),{at=anomalyAt,status='ok',offline=false,t=topic}={})=>evaluateObservation({definition:definition(c),binding:{topicVersion:1,counterevidence:[]}},t,{at,quote:()=>q,check:()=>({state:status}),offline});
const stats=result=>result.results[0].input.statistical;
test('statistical conditions require explicit bounded sample size, threshold, metric and associated security',()=>{
 for(const patch of [{windowSize:4},{windowSize:121},{windowSize:'5'},{zThreshold:0},{zThreshold:21},{zThreshold:NaN},{zThreshold:'3'},{metric:'price'},{direction:'up'},{symbol:'MSFT.US'},{interval:'1m'},{unexpected:true}])assert.throws(()=>definition(condition(patch)));
 assert.equal(definition(condition({windowSize:120,zThreshold:1})).conditions[0].currency,'USD');
});
test('daily return statistic excludes latest day and uses sample standard deviation with n minus one',()=>{
 const result=evaluate(),s=stats(result);assert.equal(result.state,'true');assert.equal(s.baselineCount,5);assert(Math.abs(s.mean)<1e-10);assert(Math.abs(s.std-Math.sqrt(2.5))<1e-10);assert(Math.abs(s.z-10/Math.sqrt(2.5))<1e-10);assert.equal(s.baselineTo,'2026-10-01');assert.equal(s.candidate.date,'2026-10-02');assert.equal(s.points.length,7);assert.equal(result.results[0].input.executable,false);
});
test('volume statistic uses reported counts without interpreting it as executable liquidity',()=>{
 const r=evaluate(condition({metric:'volume'})),s=stats(r);assert.equal(r.state,'true');assert.equal(s.mean,1000);assert.equal(s.candidate.value,2000);assert(Math.abs(s.std-Math.sqrt(5000))<1e-10);assert.equal(s.points.length,6);assert.match(s.volumeBasis,/未独立核验/);
});
test('high, low and both mean relative to the baseline, not price direction or a probability',()=>{
 const q=anomalyQuote();assert.equal(evaluate(condition({direction:'low'}),q).state,'false');assert.equal(evaluate(condition({direction:'high'}),q).state,'true');q.points.at(-1).close=q.points.at(-2).close*.9;
 assert.equal(evaluate(condition({direction:'low'}),q).state,'true');assert.equal(evaluate(condition({direction:'high'}),q).state,'false');assert.equal(evaluate(condition({direction:'both'}),q).state,'true');
 q.points.at(-1).close=q.points.at(-2).close*1.01;assert.equal(evaluate(condition(),q).state,'false');
});
test('exact threshold equality is inclusive and a larger threshold does not fire',()=>{
 const q=anomalyQuote(),z=stats(evaluate(condition(),q)).z;assert.equal(evaluate(condition({zThreshold:z}),q).state,'true');assert.equal(evaluate(condition({zThreshold:z+.0001}),q).state,'false');
});
test('sample shortage, null closes and missing sessions never get silently skipped or filled',()=>{
 for(const edit of [q=>q.points.shift(),q=>q.points[2].close=null,q=>q.points[3].date='2026-09-28',q=>q.points.reverse(),q=>q.points[3].date='2026-09-27',q=>q.points.at(-1).date='2026-10-03']){const q=anomalyQuote();edit(q);assert.equal(evaluate(condition(),q).state,'unknown');}
});
test('missing, fractional, negative and unsafe volume stay unknown; explicit zero remains a valid reported value',()=>{
 for(const v of [null,undefined,-1,1.5,Number.MAX_SAFE_INTEGER+1]){const q=anomalyQuote();q.points[2].volume=v;assert.equal(evaluate(condition({metric:'volume'}),q).state,'unknown');}
 const q=anomalyQuote();q.points.at(-1).volume=0;assert.equal(evaluate(condition({metric:'volume',direction:'low'}),q).state,'true');delete q.volumeBasis;assert.equal(evaluate(condition({metric:'volume'}),q).state,'unknown');
});
test('constant and near-zero variation baselines do not manufacture infinite standardized scores',()=>{
 const q=anomalyQuote();q.points.slice(0,-1).forEach(p=>p.close=100);assert.equal(evaluate(condition(),q).state,'unknown');q.points.forEach(p=>p.volume=1000);q.points.at(-1).volume=2000;assert.equal(evaluate(condition({metric:'volume'}),q).state,'unknown');
 const constantReturn=anomalyQuote();let price=100;constantReturn.points.forEach((p,i)=>{if(i)price*=i===6?1.2:1.01;p.close=price;});assert.equal(evaluate(condition(),constantReturn).state,'unknown');
});
test('corporate actions inside the window block both metrics, outside actions do not and invalid metadata is unknown',()=>{
 for(const metric of ['return','volume']){const q=anomalyQuote();q.actions=[{date:'2026-09-30',kind:'splits',ratio:'2:1'}];assert.equal(evaluate(condition({metric}),q).state,'unknown');assert.equal(stats(evaluate(condition({metric}),q)).actions.length,1);q.actions[0].date='2026-09-01';assert.equal(evaluate(condition({metric}),q).state,'true');}
 for(const actions of [undefined,null,[{date:'bad'}]]){const q=anomalyQuote();q.actions=actions;assert.equal(evaluate(condition(),q).state,'unknown');}
});
test('source failure, stale daily caches, future receipts, unknown provider and removed company cannot pass',()=>{
 assert.equal(evaluate(condition(),anomalyQuote(),{status:'error'}).state,'unknown');const q=anomalyQuote();q.lastDate='2026-10-01';assert.equal(evaluate(condition(),q).state,'unknown');q.lastDate='2026-10-02';q.receivedAt='2026-10-03T21:00:00Z';assert.equal(evaluate(condition(),q).state,'unknown');q.receivedAt=anomalyAt;q.provider='unknown';assert.equal(evaluate(condition(),q).state,'unknown');assert.equal(evaluate(condition(),anomalyQuote(),{t:{...topic,companies:[]}}).state,'unknown');
});
test('historical bars must have been complete when fetched, even in visibly synthetic offline mode',()=>{
 const q=anomalyQuote();q.receivedAt='2026-10-02T18:00:00Z';assert.equal(evaluate(condition(),q).state,'unknown');assert.equal(evaluate(condition(),q,{offline:true}).state,'unknown');
});
test('parser retains supplied volume and keeps unavailable values null in old-compatible daily histories',()=>{
 const p={chart:{result:[{meta:{symbol:'AAPL',currency:'USD'},timestamp:[Date.parse('2026-10-02T13:30Z')/1000],indicators:{quote:[{close:[100],volume:[0]}]}}]}};
 assert.equal(parseDaily(p,'AAPL.US',anomalyAt).points[0].volume,0);for(const x of [-1,1.5,undefined,Infinity]){p.chart.result[0].indicators.quote[0].volume=[x];assert.equal(parseDaily(p,'AAPL.US',anomalyAt).points[0].volume,null);}
});
test('statistics remain one clause in existing AND/OR logic without modifying old threshold rules',()=>{
 const r={definition:{...definition(condition()),conditions:[...definition(condition()).conditions,{type:'at',at:'2026-10-03T21:00:00Z'}]},binding:{topicVersion:1,counterevidence:[]}};
 const opts={at:anomalyAt,quote:()=>anomalyQuote(),check:()=>({state:'ok'})};assert.equal(evaluateObservation(r,topic,opts).state,'false');r.definition.join='any';assert.equal(evaluateObservation(r,topic,opts).state,'true');
});
function persistent(path=':memory:'){
 const store=openStore(path),inbox=openObservationInbox(store,{clock:()=>anomalyAt,getTopic:()=>topic});return {store,inbox,create:()=>inbox.rules.create(topic.id,{clientId:'daily-anomaly-rule',topicVersion:1,label:'Synthetic daily anomaly',join:'all',conditions:[condition()]}),sample(q=anomalyQuote()){store.saveDaily(q);store.status('daily:AAPL.US',{state:'ok',receivedAt:anomalyAt});return inbox.process([topic],{positions:[]});}};
}
test('frozen statistics survive quote corrections, receipts, rearming and a real database reopen',()=>{
 const directory=mkdtempSync(join(tmpdir(),'signal-anomaly-')),path=join(directory,'fixture.sqlite');let f=persistent(path);
 try{f.create();assert.equal(f.sample().added,1);const item=f.inbox.snapshot().items[0],frozen=JSON.stringify(item.input);assert.deepEqual(item.symbols,['AAPL.US']);f.inbox.respond(item.id,{revision:1,action:'complete',note:'Synthetic review'});const q=anomalyQuote();q.points.at(-1).close*=1.01;assert.equal(f.sample(q).added,0);assert.equal(JSON.stringify(f.inbox.snapshot().items[0].input),frozen);
 f.store.close();f=persistent(path);assert.equal(JSON.stringify(f.inbox.snapshot().items[0].input),frozen);assert.equal(f.inbox.receipts(item.id).length,1);f.inbox.rules.update('daily-anomaly-rule',{version:1,topicVersion:1,action:'rearm',note:'Review a new frozen version'});assert.equal(f.sample(q).added,1);assert.equal(f.inbox.rules.history('daily-anomaly-rule').length,2);
 }finally{f.store.close();rmSync(directory,{recursive:true,force:true});}
});
test('failed notification insertion rolls the rule check back and a retry keeps the statistical evidence',()=>{
 const f=persistent();try{f.create();f.store.db.exec("CREATE TRIGGER fail_anomaly BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'synthetic anomaly failure'); END");assert.throws(()=>f.sample(),/synthetic anomaly failure/);assert.equal(f.inbox.rules.list()[0].check,null);f.store.db.exec('DROP TRIGGER fail_anomaly');assert.equal(f.sample().added,1);assert.equal(f.inbox.snapshot().items[0].input.results[0].input.statistical.baselineCount,5);}finally{f.store.close();}
});
test('upstream duplicate dates remain visible after parser deduplication and block an affected window',()=>{
 const p={chart:{result:[{meta:{symbol:'AAPL',currency:'USD'},timestamp:[Date.parse('2026-10-02T13:30Z')/1000,Date.parse('2026-10-02T14:30Z')/1000],indicators:{quote:[{close:[100,101],volume:[1000,1100]}]}}]}};
 const parsed=parseDaily(p,'AAPL.US',anomalyAt);assert.equal(parsed.points.length,1);assert.deepEqual(parsed.duplicateDates,['2026-10-02']);
 const q=anomalyQuote();q.duplicateDates=parsed.duplicateDates;assert.equal(evaluate(condition(),q).state,'unknown');q.duplicateDates=['2026-08-03'];assert.equal(evaluate(condition(),q).state,'true');
});
