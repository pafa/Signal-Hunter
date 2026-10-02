import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {evaluateObservation,validateObservationDefinition} from '../server/observation-rules.mjs';
const start='2026-10-02T06:00:00.000Z',stamp=minutes=>new Date(Date.parse(start)+minutes*60000).toISOString();
const topic={id:'temporal-topic',title:'Synthetic temporal test',version:1,status:'active',companies:[{symbol:'00700.HK'}],evidence:[]};
const condition=(patch={})=>({type:'price',symbol:'00700.HK',interval:'1m',operator:'gte',value:100,mode:'cross',maxGapSeconds:180,...patch});
const rule=(c=condition(),others=[])=>({id:'temporal-rule',version:1,updatedAt:start,definition:validateObservationDefinition({label:'Synthetic',join:'all',conditions:[c,...others]},topic),binding:{topicVersion:1,counterevidence:[]}});
const quote=(at,value,patch={})=>({symbol:'00700.HK',currency:'HKD',provider:'eastmoney-public',providerTimezone:'UTC',providerTime:at.slice(0,16).replace('T',' '),receivedAt:at,points:[{time:at.slice(0,16).replace('T',' '),close:value}],...patch});
function run(r=rule()){
 let previous=null;return {step(minute,value,{time=stamp(minute),q=quote(stamp(minute),value),status='ok',t=topic}={}){previous=evaluateObservation(r,t,{at:time,previous,quote:()=>q,check:()=>({state:status})});return previous;},get last(){return previous;}};
}
test('temporal parameters require minute data and explicit bounded intervals without changing legacy thresholds',()=>{
 for(const patch of [{interval:'1d'},{maxGapSeconds:59},{maxGapSeconds:601},{maxGapSeconds:'180'},{holdSeconds:60},{mode:'held'},{mode:'held',holdSeconds:59},{mode:'held',holdSeconds:21601},{mode:'held',holdSeconds:'120'},{mode:'level',maxGapSeconds:180},{mode:'code'}])assert.throws(()=>rule(condition(patch)));
 const c=condition();delete c.mode;delete c.maxGapSeconds;assert.equal(rule(c).definition.conditions[0].mode,undefined);
 assert.equal(rule(condition({mode:'held',holdSeconds:21600})).definition.conditions[0].holdSeconds,21600);
});
test('crossing requires a strict prior side, includes equality and never triggers from the first high sample',()=>{
 const f=run();assert.equal(f.step(0,105).state,'unknown');assert.equal(f.step(1,106).state,'false');assert.equal(f.step(2,99).state,'false');const hit=f.step(3,100);assert.equal(hit.state,'true');assert.deepEqual(hit.results[0].input.temporal.samples.map(s=>s.price),[99,100]);assert.equal(f.step(4,101).state,'false');
 const down=run(rule(condition({operator:'lte'})));down.step(0,101);assert.equal(down.step(1,100).state,'true');assert.equal(down.step(2,99).state,'false');
});
test('held windows measure distinct source timestamps, not polling time or repeated responses',()=>{
 const f=run(rule(condition({mode:'held',holdSeconds:120})));assert.equal(f.step(0,105).state,'false');const repeated=f.step(0,105,{time:stamp(.5)});assert.equal(repeated.state,'false');assert.equal(repeated.temporal[0].samples.length,1);
 assert.equal(f.step(1,105).state,'false');const hit=f.step(2,104);assert.equal(hit.state,'true');assert.equal(hit.results[0].input.temporal.observedSeconds,120);assert.equal(hit.results[0].input.temporal.samples.length,3);
 assert.equal(f.step(2,104,{time:stamp(2.5)}).state,'false');assert.equal(f.last.temporal[0].samples.length,3);
});
test('delayed cached bars cannot count time before the first actual observation',()=>{
 const f=run(rule(condition({mode:'held',holdSeconds:120})));f.step(0,105,{time:stamp(2),q:quote(stamp(0),105,{receivedAt:stamp(2)})});
 const next=f.step(2,105,{time:stamp(2+1/6)});assert.equal(next.state,'false');assert.equal(next.results[0].input.temporal.sourceSpanSeconds,120);assert.equal(next.results[0].input.temporal.observedSeconds,10);
 assert.equal(f.step(3,105).state,'false');assert.equal(f.step(4,105).state,'true');
});
test('below-threshold samples and failed requests reset duration and cannot bridge unavailable prices',()=>{
 const f=run(rule(condition({mode:'held',holdSeconds:120})));f.step(0,105);f.step(1,105);assert.equal(f.step(2,99).state,'false');assert.equal(f.step(3,105).results[0].input.temporal.observedSeconds,0);
 assert.equal(f.step(4,105,{status:'error'}).state,'unknown');assert.equal(f.step(5,105).results[0].input.temporal.observedSeconds,0);assert.equal(f.step(6,105).state,'false');assert.equal(f.step(7,105).state,'true');
});
test('gaps, provider switches and same-time price revisions cannot fabricate a crossing',()=>{
 const gap=run(rule(condition({maxGapSeconds:60})));gap.step(0,99);assert.equal(gap.step(2,101).state,'unknown');assert.equal(gap.step(3,102).state,'false');
 const provider=run();provider.step(0,99);assert.equal(provider.step(1,101,{q:quote(stamp(1),101,{provider:'yahoo-public-chart'})}).state,'unknown');
 const revision=run();revision.step(0,99);assert.equal(revision.step(0,101).state,'unknown');assert.equal(revision.step(1,102).state,'unknown');assert.equal(revision.step(2,103).state,'false');
});
test('out-of-order, future and pre-arming samples cannot rewind the observation watermark',()=>{
 const f=run();f.step(0,99);f.step(1,99);assert.equal(f.step(0,101,{time:stamp(1.5)}).state,'unknown');assert.equal(f.last.temporal[0].watermark,stamp(1));assert.equal(f.step(1,101,{time:stamp(1.5)}).state,'unknown');assert.equal(f.step(2,102).state,'unknown');
 const pre=run();assert.equal(pre.step(-1,99,{time:start}).state,'unknown');assert.equal(pre.step(0,101).state,'unknown');
 assert.equal(run().step(1,101,{time:start}).state,'unknown');assert.equal(run().step(0,101,{q:quote(start,101,{receivedAt:stamp(-1)})}).state,'unknown');
});
test('stale repeated bars and backward checking clocks break continuity',()=>{
 const f=run();f.step(0,99);assert.equal(f.step(0,99,{time:stamp(4)}).state,'unknown');assert.equal(f.step(4,101).state,'unknown');
 const rollback=run();rollback.step(0,99,{time:stamp(.5)});assert.equal(rollback.step(0,99,{time:start}).state,'unknown');assert.equal(rollback.step(1,101).state,'unknown');
});
test('lunch and closed sessions cannot accumulate a duration even when offline examples are synthetic',()=>{
 const r=rule(condition({mode:'held',holdSeconds:120}));r.updatedAt='2026-10-02T03:58:00Z';let previous=null;
 for(const at of ['2026-10-02T03:58:00Z','2026-10-02T03:59:00Z','2026-10-02T04:00:00Z'])previous=evaluateObservation(r,topic,{at,previous,offline:true,quote:()=>quote(at,105),check:()=>({state:'ok'})});
 assert.equal(previous.state,'unknown');assert.equal(previous.temporal[0].samples.length,0);
 const at='2026-10-02T05:00:00Z';previous=evaluateObservation(r,topic,{at,previous,quote:()=>quote(at,105),check:()=>({state:'ok'})});assert.equal(previous.state,'false');assert.equal(previous.results[0].input.temporal.observedSeconds,0);
});
test('AND conditions do not latch old crossing events until another condition later becomes true',()=>{
 const f=run(rule(condition(),[{type:'at',at:stamp(2)}]));f.step(0,99);const crossed=f.step(1,101);assert.equal(crossed.results[0].state,'true');assert.equal(crossed.state,'false');assert.equal(f.step(1,101,{time:stamp(2)}).state,'false');assert.equal(f.step(2,102).state,'false');
});

function persistent(path=':memory:'){
 const store=openStore(path);let time=start;const inbox=openObservationInbox(store,{clock:()=>time,getTopic:()=>topic});
 const sample=(minute,value)=>{time=stamp(minute);store.saveQuote(quote(time,value),time);store.status('00700.HK',{state:'ok',receivedAt:time});return inbox.process([topic],{positions:[]});};
 return {store,inbox,sample,setTime:t=>time=t,create:(c=condition())=>inbox.rules.create(topic.id,{clientId:'temporal-integration',topicVersion:1,label:'Synthetic review',join:'all',conditions:[c]})};
}
test('a restart retains the pre-crossing sample and one immutable notification per version',()=>{
 const directory=mkdtempSync(join(tmpdir(),'signal-temporal-')),path=join(directory,'fixture.sqlite');let f=persistent(path);
 try{f.create();f.sample(0,99);f.store.close();f=persistent(path);assert.equal(f.sample(1,101).added,1);const hit=f.inbox.snapshot().items[0];assert.deepEqual(hit.input.results[0].input.temporal.samples.map(s=>s.price),[99,101]);
  f.inbox.respond(hit.id,{revision:1,action:'complete',note:'Reviewed synthetic crossing'});f.sample(2,99);assert.equal(f.sample(3,101).added,0);assert.equal(f.inbox.snapshot().items[0].state,'completed');assert.deepEqual(f.inbox.snapshot().items[0].input,hit.input);
  f.inbox.rules.update('temporal-integration',{version:1,topicVersion:1,action:'rearm',note:'Fresh baseline'});assert.equal(f.sample(3,101).added,0);assert.equal(f.inbox.rules.list()[0].check.state,'unknown');f.sample(4,99);assert.equal(f.sample(5,101).added,1);
 }finally{f.store.close();rmSync(directory,{recursive:true,force:true});}
});
test('notification failures roll back the consumed crossing so a retry can still produce it',()=>{
 const f=persistent();try{f.create();f.sample(0,99);const before=JSON.stringify(f.inbox.rules.list()[0].check);f.store.db.exec("CREATE TRIGGER temporal_failure BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'temporal fixture fault'); END");
  assert.throws(()=>f.sample(1,101),/fixture fault/);assert.equal(JSON.stringify(f.inbox.rules.list()[0].check),before);assert.equal(f.inbox.snapshot().items.length,0);f.store.db.exec('DROP TRIGGER temporal_failure');assert.equal(f.sample(1,101).added,1);
 }finally{f.store.close();}
});
test('pause/resume starts a new sampling window and historical conditions remain readable',()=>{
 const f=persistent();try{f.create(condition({mode:'held',holdSeconds:120}));f.sample(0,105);f.sample(1,105);f.inbox.rules.update('temporal-integration',{version:1,action:'pause',note:'Pause'});assert.equal(f.sample(2,105).added,0);
  f.inbox.rules.update('temporal-integration',{version:2,topicVersion:1,action:'resume',note:'Resume'});assert.equal(f.sample(2,105).added,0);assert.equal(f.sample(3,105).added,0);assert.equal(f.sample(4,105).added,1);assert.equal(f.inbox.rules.history('temporal-integration').length,3);
 }finally{f.store.close();}
});
