import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseYahooMinutes,instrument} from '../server/providers.mjs';
import {evaluateObservation,validateObservationDefinition} from '../server/observation-rules.mjs';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
const at='2026-10-02T14:07:30Z',topic={id:'synthetic-volume',title:'Synthetic volume',version:1,status:'active',companies:[{symbol:'AAPL.US'}],claims:[],evidence:[],hypothesis:{}};
const c={type:'minute-anomaly',symbol:'AAPL.US',metric:'volume',windowSize:5,zThreshold:3,direction:'high'};
function payload(){return {chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1m'},timestamp:Array.from({length:8},(_,i)=>Date.parse('2026-10-02T14:00:00Z')/1000+60*i),indicators:{quote:[{close:Array.from({length:8},(_,i)=>100+i),volume:[9999,80,90,100,110,120,300,999999]}]}}]}};}
const quote=(p=payload())=>({...parseYahooMinutes(p,instrument('AAPL.US')),receivedAt:at});
const definition=(condition=c)=>validateObservationDefinition({label:'Synthetic volume',join:'all',conditions:[condition]},topic);
const evaluate=(q=quote(),condition=c,extra={})=>evaluateObservation({definition:definition(condition),binding:{topicVersion:1,counterevidence:[]}},topic,{at,quote:()=>q,check:()=>({state:'ok'}),...extra});
const stat=r=>r.results[0].input.statistical;
test('minute volume uses direct bar values, excludes latest sample and candidate from the n-1 baseline',()=>{
 const r=evaluate(),s=stat(r);assert.equal(r.state,'true');assert.equal(s.engine,'minute-volume/1');assert.equal(s.metric,'volume');assert.equal(s.mean,100);assert.equal(s.std,Math.sqrt(250));assert.equal(s.candidate.value,300);assert.equal(s.baselineCount,5);assert.equal(s.points.length,6);assert.equal(s.z,200/Math.sqrt(250));assert.equal(r.results[0].input.executable,false);
 const q=quote();q.points.at(-1).volume=null;assert.deepEqual(stat(evaluate(q)),s);q.points[0].volume=null;assert.deepEqual(stat(evaluate(q)),s);
 assert.equal(evaluate(quote(),{...c,zThreshold:s.z}).state,'true');assert.equal(evaluate(quote(),{...c,zThreshold:s.z+.001}).state,'false');
 q.points.at(-2).volume=0;assert.equal(evaluate(q,{...c,direction:'low'}).state,'true');assert.equal(evaluate(q,{...c,direction:'high'}).state,'false');assert.equal(evaluate(q,{...c,direction:'both'}).state,'true');
});
test('missing, invalid and misaligned volume cannot become zero or cumulative deltas and does not break price parsing',()=>{
 for(const bad of [null,undefined,-1,1.5,'100',Number.MAX_SAFE_INTEGER+1]){const p=payload();p.chart.result[0].indicators.quote[0].volume[3]=bad;const q=quote(p);assert.equal(q.points[3].volume,null);assert.equal(q.points.length,8);assert.equal(evaluate(q).state,'unknown');}
 for(const edit of [p=>delete p.chart.result[0].indicators.quote[0].volume,p=>p.chart.result[0].indicators.quote[0].volume.pop(),p=>delete p.chart.result[0].meta.dataGranularity,p=>p.chart.result[0].meta.dataGranularity='5m']){const p=payload();edit(p);assert.equal(evaluate(quote(p)).state,'unknown');}
 for(const edit of [q=>delete q.minuteVolume,q=>q.minuteVolume.basis='cumulative',q=>q.minuteVolume.field='regularMarketVolume',q=>q.provider='eastmoney-public',q=>q.minuteVolume.aligned=false]){const q=quote();edit(q);assert.equal(evaluate(q).state,'unknown');}
});
test('zero baseline variance, gaps, lunch/closed sessions, stale data and parser damage remain unknown',()=>{
 for(const edit of [q=>q.points.forEach(p=>p.volume=0),q=>q.points.splice(2,1),q=>q.minuteQuality.duplicateTimes.push(q.points[3].time),q=>q.minuteQuality.roundedTimes.push(q.points[3].time),q=>q.minuteQuality.invalidRows=1]){const q=quote();edit(q);assert.equal(evaluate(q).state,'unknown');}
 assert.equal(evaluate(quote(),c,{at:'2026-10-02T14:30:00Z'}).state,'unknown');assert.equal(evaluate(quote(),c,{at:'2026-10-03T14:07:30Z'}).state,'unknown');assert.equal(evaluate(quote(),c,{check:()=>({state:'error'})}).state,'unknown');
});
test('volume alerts keep original samples through cache revisions, receipts, rearm and restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'minute-volume-')),path=join(dir,'db.sqlite');let store=openStore(path),inbox=openObservationInbox(store,{clock:()=>at,getTopic:()=>topic});
 try{
  inbox.rules.create(topic.id,{clientId:'minute-volume-test',topicVersion:1,label:'Synthetic volume',join:'all',conditions:[c]});const q=quote();store.saveQuote(q,at);store.status('AAPL.US',{state:'ok',receivedAt:at});assert.equal(inbox.process([topic],{positions:[]}).added,1);const item=inbox.snapshot().items[0],frozen=JSON.stringify(item.input);assert.equal(item.input.results[0].input.statistical.candidate.value,300);
  inbox.respond(item.id,{revision:1,action:'complete',note:'Synthetic review'});q.points.at(-2).volume=900;store.saveQuote(q,at);assert.equal(inbox.process([topic],{positions:[]}).added,0);assert.equal(JSON.stringify(inbox.snapshot().items[0].input),frozen);
  store.close();store=openStore(path);inbox=openObservationInbox(store,{clock:()=>at,getTopic:()=>topic});assert.equal(JSON.stringify(inbox.snapshot().items[0].input),frozen);assert.equal(inbox.receipts(item.id).length,1);assert.equal(store.quoteHistory('AAPL.US').length,2);assert.equal(store.quote('AAPL.US').points.at(-2).volume,900);
  inbox.rules.update('minute-volume-test',{version:1,topicVersion:1,action:'rearm',note:'Synthetic new sample'});assert.equal(inbox.process([topic],{positions:[]}).added,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
