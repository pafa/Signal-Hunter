import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {evaluateObservation,validateObservationDefinition,observationInstant} from '../server/observation-rules.mjs';
import {createHandler} from '../server/index.mjs';
const at='2026-10-02T06:00:00Z';
const topic=()=>({id:'fixture-topic',title:'Synthetic observation',status:'active',version:1,companies:[{symbol:'00700.HK'}],evidence:[],claims:[]});
const rule=(conditions,join='all')=>({id:'fixture-rule',topicId:'fixture-topic',version:1,definition:{label:'Review',join,conditions},binding:{topicVersion:1,counterevidence:[]}});
const empty={positions:[],reviews:[]};
function setup(path=':memory:'){
 const store=openStore(path),t=topic();let clock=at;
 const inbox=openObservationInbox(store,{clock:()=>clock,getTopic:id=>id===t.id?t:null});
 return {store,t,inbox,setClock:value=>clock=value,create:(conditions,extra={})=>inbox.rules.create(t.id,{topicVersion:t.version,clientId:'fixture-rule',label:'Synthetic review',join:'all',conditions,...extra}),close:()=>store.close()};
}
const date=()=>({type:'at',at:'2026-10-02T05:00:00Z'});
const price=()=>({type:'price',symbol:'00700.HK',currency:'HKD',interval:'1m',operator:'gte',value:100});
const quote=()=>({symbol:'00700.HK',currency:'HKD',provider:'eastmoney-public',providerTimezone:'Asia/Hong_Kong',receivedAt:at,providerTime:'2026-10-02 14:00',points:[{time:'2026-10-02 14:00',close:105}]});
const context=q=>({at,quote:()=>q,check:()=>({state:'ok',receivedAt:at})});
test('condition validation rejects malformed times, silent coercion, unknown operators and unrelated securities',()=>{
 for(const value of ['2026-02-30T01:00:00Z','2026-10-02','2026-10-02T24:00:00Z','2026-10-02T12:00:00','garbage'])assert.equal(observationInstant(value),null);
 assert.equal(observationInstant('2026-10-02T14:00:00+08:00'),Date.parse(at));
 for(const condition of [{type:'at',at:'tomorrow'},{type:'price',symbol:'AAPL.US',interval:'1d',operator:'gte',value:10},{type:'price',symbol:'00700.HK',interval:'1d',operator:'gte',value:'100'},{type:'price',symbol:'00700.HK',interval:'1d',operator:'eval',value:100},{type:'counterevidence',command:'x'}])assert.throws(()=>validateObservationDefinition({label:'x',join:'all',conditions:[condition]},topic()));
 assert.throws(()=>validateObservationDefinition({label:'x',join:'all',conditions:[]},topic()));
});
test('all/any use three-valued logic: unknown is never a positive and a known OR hit stays explicit',()=>{
 const unknown=price(),yes=date(),no={type:'at',at:'2026-10-03T00:00:00Z'},evaluate=(c,join)=>evaluateObservation(rule(c,join),topic(),context(null));
 assert.equal(evaluate([yes,unknown],'all').state,'unknown');assert.equal(evaluate([no,unknown],'all').state,'false');
 const any=evaluate([yes,unknown],'any');assert.equal(any.state,'true');assert.equal(any.results[1].state,'unknown');assert.equal(evaluate([no,unknown],'any').state,'unknown');assert.equal(evaluate([no],'all').state,'false');
});
test('market conditions preserve price provenance and reject stale, failed, future, mismatched and unverified caches',()=>{
 const evaluate=(q,c=context(q))=>evaluateObservation(rule([price()]),topic(),c),valid=evaluate(quote());assert.equal(valid.state,'true');assert.equal(valid.results[0].input.price,105);assert.equal(valid.results[0].input.executable,false);assert.equal(valid.results[0].input.provider,'eastmoney-public');
 for(const q of [{...quote(),currency:'USD'},{...quote(),symbol:'OTHER.HK'},{...quote(),receivedAt:'2026-10-02T07:00:00Z'},{...quote(),providerTimezone:'unverified'},{...quote(),provider:'unrecognized-source'},{...quote(),providerTime:'2026-10-02 14:01',points:[{time:'2026-10-02 14:01',close:105}]},{...quote(),providerTime:'2026-09-30 16:10'}, {...quote(),points:[{time:'2026-10-02 13:59',close:105}]}])assert.equal(evaluate(q).state,'unknown');
 assert.equal(evaluate(quote(),{...context(quote()),check:()=>({state:'error'})}).state,'unknown');
 const low=quote();low.points[0].close=99;assert.equal(evaluate(low).state,'false');
 assert.equal(evaluate(quote(),{...context(quote()),offline:true}).results[0].input.synthetic,true);
 const delisted=topic();delisted.companies=[];assert.equal(evaluateObservation(rule([price()]),delisted,context(quote())).state,'unknown');
});
test('daily conditions use aligned completed close and explicit original currency; invalid dates do not pass',()=>{
 const daily={symbol:'00700.HK',currency:'HKD',provider:'yahoo-public-chart',marketTimezone:'Asia/Hong_Kong',receivedAt:at,lastDate:'2026-09-30',priceBasis:'supplier close',points:[{date:'2026-09-30',close:105}]};
 const r=rule([{...price(),interval:'1d'}]);assert.equal(evaluateObservation(r,topic(),context(daily)).state,'true');
 for(const q of [{...daily,lastDate:'2026-09-29'}, {...daily,lastDate:'2026-10-02'}, {...daily,points:[{date:'2026-09-29',close:105}]}])assert.equal(evaluateObservation(r,topic(),context(q)).state,'unknown');
});
test('one immutable hit per version survives completion/restart; explicit rearm makes a new independent hit',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'signal-rules-')),'fixture.sqlite');let f=setup(path);
 try{
  const created=f.create([date()]);assert.equal(created.version,1);assert.equal(f.create([date()]).id,created.id);assert.equal(f.inbox.rules.history(created.id).length,1);
  assert.throws(()=>f.create([date()],{label:'changed with same ID'}),/标识/);
  assert.equal(f.inbox.process([f.t],empty).added,1);const first=f.inbox.snapshot().items[0];f.inbox.respond(first.id,{revision:1,action:'complete',note:'Checked old trigger'});f.setClock('2026-10-02T06:01:00Z');assert.equal(f.inbox.process([f.t],empty).added,0);assert.equal(f.inbox.rules.get(created.id).version,1);
  f.close();f=setup(path);assert.equal(f.inbox.process([f.t],empty).added,0);const old=f.inbox.snapshot().items[0];assert.equal(old.input.evaluatedAt,at);assert.equal(old.state,'completed');
  f.inbox.rules.update(created.id,{version:1,topicVersion:1,action:'rearm',note:'Review again'});assert.equal(f.inbox.process([f.t],empty).added,1);assert.equal(f.inbox.snapshot().items.length,2);assert.equal(f.inbox.rules.history(created.id).length,2);assert.equal(f.inbox.snapshot().items.find(x=>x.id===first.id).state,'completed');
 }finally{f.close();}
});
test('pause/resume, concurrency and archived research cannot silently change versions or create orders',()=>{
 const f=setup();try{
  const r=f.create([date()]);f.inbox.rules.update(r.id,{version:1,action:'pause',note:'Pause'});assert.equal(f.inbox.process([f.t],empty).added,0);
  assert.throws(()=>f.inbox.rules.update(r.id,{version:1,topicVersion:1,action:'resume',note:'stale'}),/已更新/);
  f.t.version=2;assert.throws(()=>f.inbox.rules.update(r.id,{version:2,topicVersion:1,action:'resume',note:'old topic'}),/研究已更新/);
  f.inbox.rules.update(r.id,{version:2,topicVersion:2,action:'resume',note:'Reviewed latest topic'});assert.equal(f.inbox.process([f.t],empty).added,1);assert.equal(f.inbox.rules.get(r.id).binding.topicVersion,2);
  f.t.status='archived';assert.equal(f.inbox.process([f.t],empty).added,0);assert.equal(f.inbox.rules.list()[0].check.state,'unknown');
  assert.throws(()=>f.inbox.rules.update(r.id,{version:3,topicVersion:2,action:'rearm',note:'Archived'}),/归档/);
 }finally{f.close();}
});
test('research and counterevidence conditions freeze a baseline; source revisions are new observations',()=>{
 const f=setup();try{
  f.t.evidence=[{id:'old',claim:'Original risk',stance:'against',verification:'unverified'}];const r=f.create([{type:'research-change'},{type:'counterevidence'}]);assert.equal(f.inbox.process([f.t],empty).added,0);
  f.t.version=2;f.inbox.process([f.t],empty);assert.equal(f.inbox.rules.list()[0].check.state,'false');f.t.evidence[0].claim='Revised risk';assert.equal(f.inbox.process([f.t],empty).added,1);
  const hit=f.inbox.snapshot().items[0];assert.equal(hit.input.results[1].input.evidence[0].claim,'Revised risk');f.inbox.rules.update(r.id,{version:1,topicVersion:2,action:'rearm',note:'New baseline'});assert.equal(f.inbox.process([f.t],empty).added,0);
 }finally{f.close();}
});
test('a failed todo insert rolls back evaluation receipts; retry does not lose the notification',()=>{
 const f=setup();try{
  f.create([date()]);f.store.db.exec("CREATE TRIGGER fail_observation BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");assert.throws(()=>f.inbox.process([f.t],empty),/storage/);assert.equal(f.inbox.rules.list()[0].check,null);assert.equal(f.inbox.snapshot().items.length,0);
  f.store.db.exec('DROP TRIGGER fail_observation');assert.equal(f.inbox.process([f.t],empty).added,1);
 }finally{f.close();}
});
test('HTTP config/save/history and scheduler preserve research/book; GET performs no evaluation writes',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'demo',now:()=>Date.parse(at)}),handler=createHandler(store,service),t=service.research.list()[0];
 const call=async(method,url,body)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){if(body)yield JSON.stringify(body);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
 try{
  const before=JSON.stringify({research:service.research.list(),book:service.paper.snapshot()});
  const created=await call('POST',`/api/research/${t.id}/observation-rules`,{topicVersion:t.version,clientId:'http-rule-test',label:'Synthetic time reminder',join:'all',conditions:[date()]});assert.equal(created.status,200);assert.equal(created.result.observationInbox.rules[0].check,null);
  await call('GET','/api/data');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM observation_rule_checks').get().n,0);
  await service.runOperation('observations');assert(service.observations.snapshot().items.some(i=>i.kind==='configured'));assert.equal(JSON.stringify({research:service.research.list(),book:service.paper.snapshot()}),before);
  assert.equal((await call('PATCH','/api/observation-rules/http-rule-test',{version:1,topicVersion:t.version,action:'edit',note:'Rename',label:'Updated label',join:'any',conditions:[date()]})).status,200);
  const history=await call('GET','/api/observation-rules/http-rule-test/history');assert.equal(history.result.length,2);assert.equal(history.result[1].definition.label,'Synthetic time reminder');
  const stale=await call('PATCH','/api/observation-rules/http-rule-test',{version:1,action:'pause',note:'stale'});assert.equal(stale.result.error,'观察配置已更新，请刷新后再保存');
 }finally{await service.close();store.close();}
});

test('configuration history failure rolls back the current definition and cannot drop old research references',()=>{
 const f=setup();try{
  const r=f.create([date()]);f.store.db.exec("CREATE TRIGGER fail_rule_history BEFORE INSERT ON observation_rule_versions BEGIN SELECT RAISE(ABORT,'fixture history failure'); END");
  assert.throws(()=>f.inbox.rules.update(r.id,{version:1,topicVersion:1,action:'edit',note:'Must roll back',label:'New title',join:'any',conditions:[date()]}),/history failure/);
  assert.equal(f.inbox.rules.get(r.id).version,1);assert.equal(f.inbox.rules.get(r.id).definition.label,'Synthetic review');assert.equal(f.inbox.rules.history(r.id).length,1);
 }finally{f.close();}
});
