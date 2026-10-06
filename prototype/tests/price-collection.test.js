import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {parseYahooMinutes,instrument} from '../server/providers.mjs';
import {digest} from '../server/codex-research.mjs';
const start=Date.parse('2026-10-01T14:00:00Z'),iso=t=>new Date(t).toISOString();
function response(symbol,at,price=100){const t=Math.floor(at/60000)*60000;return {chart:{result:[{meta:{symbol:instrument(symbol).code,currency:instrument(symbol).currency,exchangeTimezoneName:'America/New_York',dataGranularity:'1m'},timestamp:[(t-60000)/1000,t/1000],indicators:{quote:[{close:[price,price+1],volume:[100,100]}]}}]}};}
function fixture(path=':memory:',options={}){
 let at=start-1000,price=100,fail=false,gate=null;const store=openStore(path),calls=[];
 const service=createService(store,{mode:'research',now:()=>at,fetcher:async(url,opts)=>{
  calls.push(url);if(gate)await gate(opts);if(fail)return new Response('',{status:429});
  if(url.includes('eastmoney'))return new Response('',{status:404});
  const code=new URL(url).pathname.split('/').at(-1),symbol=code+'.US';return Response.json(response(symbol,at,price));
 },...options});
 const add=(id,symbol='AAPL.US',bucket='quiet',decision=start)=>{const n={id,revision:1,title:'Synthetic '+id,url:'https://example.org/'+id,publisher:'Synthetic fixture',publishedAt:iso(decision),articleFirstSeen:iso(decision),revisionFirstSeen:iso(decision)};service.research.screenings.capture(n,{bucket,companies:symbol?[{symbol}]:[]},iso(decision));};
 return {store,service,calls,add,time:t=>at=t,price:v=>price=v,failure:v=>fail=v,gate:fn=>gate=fn,
  config:benchmarks=>service.priceCollection.configure({version:service.priceCollection.snapshot().config?.version||0,requestId:randomUUID(),benchmarks}),
  resume:()=>service.controlOperation('pricecollection','resume'),run:()=>service.runOperation('pricecollection'),
  close:async()=>{await service.close();store.close();}};
}
const details=f=>f.service.priceCollection.snapshot().recent.map(r=>f.service.priceCollection.get(r.id));
test('default paused, explicit activation excludes pre-existing samples and preserves all new buckets and no-symbol samples',async()=>{
 const f=fixture();try{
  f.add('old');assert.equal(f.service.operations().tasks.pricecollection.paused,true);assert.equal(f.service.priceCollection.snapshot().configured,false);assert.throws(()=>f.run(),/暂停/);
  f.resume();for(const [id,bucket] of [['new','candidate'],['watch','watch'],['quiet','quiet'],['none','noise']])f.add(id,id==='none'?null:'AAPL.US',bucket);
  f.time(start+120000);assert.equal((await f.run()).outcome,'ok');const list=details(f);
  assert.equal(list.length,4);assert(!list.some(r=>r.plan.sample.input.id==='old'));assert.equal(list.find(r=>r.plan.sample.input.id==='none').plan.reason,'no-usable-symbol');
  assert.equal(f.store.watchlist().length,0,'evaluation collection must not require or add watches');assert.equal(f.calls.length,2,'all three samples share one source request');
  assert(list.filter(r=>r.plan.symbols.length).every(r=>r.boundaries.find(b=>b.window==='baseline').state==='observed'));
  const before=JSON.stringify(list);await f.run();assert.equal(f.calls.length,2);assert.equal(JSON.stringify(details(f)),before);
 }finally{await f.close();}
});
test('all four future windows are durable and sampled at maturity, with negative prices retained as negative changes',async()=>{
 const f=fixture();try{f.resume();f.add('a');f.time(start+120000);await f.run();const before=details(f)[0],base=before.boundaries.find(b=>b.window==='baseline');assert.equal(base.point.price,100);
  assert.equal(before.boundaries.length,5);assert.equal(before.boundaries.find(b=>b.window==='1d').minAt,base.point.stamp+86400000);
  for(const [window,ms,price] of [['1h',3600000,110],['1d',86400000,90],['5d',432000000,100],['20d',1728000000,120]]){f.time(start+120000+ms);f.price(price);await f.run();const b=details(f)[0].boundaries.find(b=>b.window===window);assert.equal(b.state,'observed');assert.equal(b.point.price,price);assert.equal(b.source,JSON.stringify([base.point.provider,base.point.timezone,base.point.currency,base.point.adjustment]));}
  assert.deepEqual(details(f)[0].history.filter(b=>b.window==='baseline'),before.history.filter(b=>b.window==='baseline'));
  assert.equal(f.service.priceCollection.snapshot().forwardEligible,false);
 }finally{await f.close();}
});
test('receipt deadline prevents retrospective rescue and missing baseline closes all windows without price fabrication',async()=>{
 const f=fixture();try{f.resume();f.add('miss');f.time(start+480000);const q=parseYahooMinutes(response('AAPL.US',start+120000),instrument('AAPL.US'));f.store.saveQuote(q,iso(start+480000));await f.run();
  const p=details(f)[0];assert.equal(p.boundaries.find(b=>b.window==='baseline').state,'missed');assert.equal(p.boundaries.filter(b=>b.state==='no-baseline').length,4);assert(p.boundaries.every(b=>b.point===null));assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('exact benchmark is explicit and later configuration only affects new plans',async()=>{
 const f=fixture();try{f.config({USD:'SPY.US'});f.resume();f.add('a');f.time(start+120000);await f.run();const a=details(f)[0],base=a.boundaries.find(b=>b.window==='baseline');assert.equal(base.benchmarkState,'observed');assert.equal(base.benchmarkPoint.symbol,'SPY.US');assert.equal(base.point.stamp,base.benchmarkPoint.stamp);
  assert.throws(()=>f.config({}),/先暂停/);f.service.controlOperation('pricecollection','pause');f.config({});f.resume();f.add('b','AAPL.US','quiet',start+180000);f.time(start+300000);await f.run();
  const p=details(f);assert.equal(p.find(r=>r.plan.sample.input.id==='a').plan.configVersion,1);assert.equal(p.find(r=>r.plan.sample.input.id==='a').plan.benchmarks.USD,'SPY.US');assert.deepEqual(p.find(r=>r.plan.sample.input.id==='b').plan.benchmarks,{});
 }finally{await f.close();}
});
test('plans, immutable boundary history and pause state survive actual database close and reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'price-collection-reopen-')),path=join(dir,'fixture.sqlite');let f=fixture(path);
 try{f.resume();f.add('a');f.time(start+120000);await f.run();f.service.controlOperation('pricecollection','pause');const old=details(f);await f.close();f=fixture(path);f.time(start+3720000);assert.equal(f.service.operations().tasks.pricecollection.paused,true);assert.deepEqual(details(f),old);f.resume();f.price(110);await f.run();const next=details(f)[0];assert.equal(next.boundaries.find(b=>b.window==='1h').point.price,110);assert.deepEqual(next.plan,old[0].plan);assert.deepEqual(next.history.filter(b=>b.window==='baseline'),old[0].history.filter(b=>b.window==='baseline'));}
 finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('shared source cooling and per-symbol attempts persist without dropping failed samples',async()=>{
 const f=fixture();try{f.resume();f.add('a');f.failure(true);f.time(start+120000);assert.equal((await f.run()).outcome,'error');const calls=f.calls.length;await f.run();assert.equal(f.calls.length,calls);f.time(start+180000);await f.run();assert.equal(f.calls.length,calls,'provider 429 must remain cooled');f.time(start+480000);await f.run();assert.equal(details(f)[0].boundaries.find(b=>b.window==='baseline').state,'missed');assert(f.service.priceCollection.snapshot().attempts.some(r=>r.outcome==='failed'));}
 finally{await f.close();}
});
test('pause during an in-flight read prevents price commits and recovery preserves interrupted attempt cooldown',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(r=>entered=r);
 try{f.resume();f.add('a');f.time(start+120000);f.gate(()=>new Promise(r=>{release=r;entered();}));const run=f.run();await ready;f.service.controlOperation('pricecollection','pause');release();assert.equal((await run).outcome,'cancelled');assert.equal(f.store.db.prepare('SELECT count(*) n FROM quote_snapshots').get().n,0);
  f.gate(null);f.resume();await f.run();assert.equal(f.calls.length,1);assert(f.service.priceCollection.snapshot().attempts.some(r=>r.outcome==='interrupted'));f.time(start+180000);await f.run();assert.equal(details(f)[0].boundaries.find(b=>b.window==='baseline').state,'observed');
 }finally{await f.close();}
});
test('restore guard and demo mode never activate or issue price collection requests',async()=>{
 for(const mode of ['research','demo','legacy']){const f=fixture(':memory:',{mode});try{
  if(mode==='research'){f.config({});f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.resume(),/恢复副本/);assert.throws(()=>f.config({}),/恢复副本/);await f.service.tick();}
  else {assert.throws(()=>f.resume(),/当前模式/);assert.throws(()=>f.config({}),/当前模式/);}
  assert.equal(f.calls.length,0);
 }finally{await f.close();}}
});
test('configuration requests are idempotent, reject stale versions and cannot inject prices or invalid benchmark currencies',async()=>{
 const f=fixture();try{const cmd={version:0,requestId:randomUUID(),benchmarks:{}},a=f.service.priceCollection.configure(cmd);assert.deepEqual(f.service.priceCollection.configure(cmd),a);
  assert.throws(()=>f.service.priceCollection.configure({...cmd,benchmarks:{USD:'SPY.US'}}),/请求标识/);
  assert.throws(()=>f.service.priceCollection.configure({...cmd,requestId:randomUUID()}),/已更新/);
  for(const patch of [{prices:[]},{benchmarks:{USD:'00700.HK'}},{benchmarks:{GBP:'SPY.US'}},{benchmarks:[]},{version:-1},{requestId:'x'}])assert.throws(()=>f.service.priceCollection.configure({...cmd,...patch}),/参数/);
 }finally{await f.close();}
});
test('tampered screening stops enrollment atomically and historical boundaries reject altered payloads or indexes',async()=>{
 const f=fixture();try{f.resume();f.add('a');f.add('b');f.store.db.exec("UPDATE screening_samples SET payload=json_set(payload,'$.input.title','tampered') WHERE news_id='b'");f.time(start+120000);assert.equal((await f.run()).outcome,'error');assert.equal(details(f).length,0);assert.equal(f.calls.length,0);
  f.store.db.exec("DELETE FROM screening_samples WHERE news_id='b'");await f.run();const id=details(f)[0].plan.id;
  f.store.db.exec("UPDATE price_collection_boundaries SET deadline=deadline+1");assert.throws(()=>f.service.priceCollection.get(id),/指纹/);
 }finally{await f.close();}
});
test('enrollment capacity keeps the remainder and recorded ineligible times never become fresh inputs',async()=>{
 const f=fixture();try{f.resume();for(let i=0;i<201;i++)f.add('none'+i,null);f.add('old-time',null,'quiet',start-2000);f.add('future',null,'quiet',start+3600000);f.time(start+120000);await f.run();assert.equal(details(f).length,20);assert.equal(f.service.priceCollection.snapshot().plans,200);assert.equal(f.service.priceCollection.snapshot().pendingEnrollment,3);await f.run();assert.equal(f.service.priceCollection.snapshot().plans,203);assert.equal(f.service.priceCollection.snapshot().pendingEnrollment,0);assert.equal(f.calls.length,0);assert(f.service.priceCollection.snapshot().planReasons.some(r=>r.reason==='input-available-before-activation'));assert(f.service.priceCollection.snapshot().planReasons.some(r=>r.reason==='future-input-or-decision-time'));}
 finally{await f.close();}
});
test('API accepts only explicit configuration and serves original plans without mutating business data',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service);
 const call=async(method,url,data={})=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const before=JSON.stringify(f.service.paper.snapshot());assert.equal((await call('GET','/api/price-collection')).result.configured,false);assert.equal((await call('PATCH','/api/price-collection',{version:0,requestId:randomUUID(),benchmarks:{},prices:[]})).status,400);
  assert.equal((await call('PATCH','/api/price-collection',{version:0,requestId:randomUUID(),benchmarks:{}})).status,200);f.resume();f.add('a');f.time(start+120000);await f.run();const id=details(f)[0].plan.id,result=await call('GET','/api/price-collection/'+id);assert.equal(result.status,200);const {hash,...plan}=result.result.plan;assert.equal(hash,digest(plan));assert.equal(JSON.stringify(f.service.paper.snapshot()),before);
  f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('PATCH','/api/price-collection',{version:1,requestId:randomUUID(),benchmarks:{}})).status,409);assert.equal((await call('GET','/api/price-collection/'+id)).status,200);
 }finally{await f.close();}
});

test('request capacity defers whole symbols and cooldown on earlier symbols does not starve remaining plans',async()=>{
 const f=fixture();try{f.resume();const symbols=['AAPL','AMD','AMZN','BA','BABA','INTC','META','MSFT','MU','NVDA','NVS','ORCL','SPOT'].map(c=>c+'.US');for(const symbol of symbols)f.add(symbol,symbol);
  f.failure(true);f.time(start+120000);await f.run();assert.equal(f.store.db.prepare('SELECT count(*) n FROM price_collection_attempts').get().n,12);await f.run();assert.equal(f.store.db.prepare('SELECT count(*) n FROM price_collection_attempts').get().n,13,'the 13th symbol must not be starved by 12 cooled earlier symbols');assert.equal(f.service.priceCollection.snapshot().plans,13);
 }finally{await f.close();}
});
test('expired scheduler lease recovers durable plan and attempt without duplicate provider reads',async()=>{
 const f=fixture();try{f.resume();f.add('a');f.time(start+120000);await f.run();const before=details(f)[0],oldToken=randomUUID(),at=start+3720000;
  f.store.db.prepare("INSERT INTO operation_runs(name,token,started_at,outcome,input) VALUES('pricecollection',?,?,'running','null')").run(oldToken,iso(at-1000));
  f.store.db.prepare("UPDATE operation_tasks SET token=?,lease_until=?,state='running' WHERE name='pricecollection'").run(oldToken,at-1);
  f.store.db.prepare("INSERT INTO price_collection_attempts(token,symbol,attempted_at,outcome,payload) VALUES(?,'AAPL.US',?,'running','{}')").run(oldToken,at-1000);
  f.time(at);const calls=f.calls.length;await f.run();assert.equal(f.calls.length,calls);assert.equal(f.store.db.prepare('SELECT outcome FROM operation_runs WHERE token=?').get(oldToken).outcome,'interrupted');assert(f.service.priceCollection.snapshot().attempts.some(r=>r.outcome==='interrupted'));
  assert.deepEqual(details(f)[0].plan,before.plan);f.time(at+60000);await f.run();assert.equal(details(f)[0].boundaries.find(b=>b.window==='1h').state,'observed');
 }finally{await f.close();}
});
test('code revision cannot silently execute old plans; a new explicit configuration preserves original records',async()=>{
 const f=fixture();try{f.resume();f.add('a');f.time(start+120000);await f.run();f.service.controlOperation('pricecollection','pause');const original=details(f)[0];
  const oldConfig=f.store.db.prepare('SELECT * FROM price_collection_configs WHERE version=1').get(),config=JSON.parse(oldConfig.payload);config.sourceHash='simulated-previous-code';delete config.hash;f.store.db.prepare('UPDATE price_collection_configs SET payload=? WHERE version=1').run(JSON.stringify({...config,hash:digest(config)}));
  const oldPlan=f.store.db.prepare('SELECT * FROM price_collection_plans').get(),plan=JSON.parse(oldPlan.payload);plan.sourceHash=config.sourceHash;delete plan.hash;f.store.db.prepare('UPDATE price_collection_plans SET payload=? WHERE id=?').run(JSON.stringify({...plan,hash:digest(plan)}),oldPlan.id);
  assert.equal(f.service.priceCollection.snapshot().sourceCurrent,false);f.resume();f.time(start+3720000);const calls=f.calls.length;assert.equal((await f.run()).outcome,'error');assert.equal(f.calls.length,calls);f.service.controlOperation('pricecollection','pause');f.config({});f.resume();await f.run();assert.equal(f.calls.length,calls);assert.equal(f.service.priceCollection.snapshot().incompatiblePlans,1);assert.deepEqual(details(f)[0].boundaries,original.boundaries);assert.deepEqual(details(f)[0].history,original.history);
 }finally{await f.close();}
});
