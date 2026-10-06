import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';
test('private server frame → human approval → fresh partial fills → sale and settlement survives restart',async()=>{
 const f=executionFeedFixture(),path=join(f.dir,'isolated.sqlite');let now=Date.parse('2026-10-06T14:00:00Z'),store=openStore(path),service;
 const start=()=>{service=createService(store,{mode:'research',executionConfig:f.config,now:()=>now,fetcher:async()=>{throw Error('Synthetic integration must not request live data');}});for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');};
 start();const call=async(method,url,data={})=>{let status,result;await createHandler(store,service)({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
 const at=()=>new Date(now).toISOString(),write=(extra={})=>{const q=f.quote(at(),extra);q.fees.components[0].minimum='15';f.write([q]);return q;};
 const sim=()=>service.marketSimulations.steady,command=extra=>({requestId:randomUUID(),version:sim().snapshot().version,...extra});
 let topic;
 const propose=async(extra={})=>{const r=await call('POST','/api/market-simulation/orders?account=steady',command({order:{topicId:topic.id,topicVersion:topic.version,symbol:'AAPL.US',side:'buy',qty:100,limitPrice:'101',budgetUSD:10200,expiresAt:'2026-10-06T14:30:00Z',holdUntil:'2026-10-07T14:00:00Z',thesis:'Synthetic only',trigger:'Fixture',invalidation:'Fixture',...extra}}));assert.equal(r.status,200,JSON.stringify(r.result));return sim().snapshot().orders.at(-1);};
 const approve=async order=>{const review=sim().review(order.id);assert.equal(review.eligible,true,review.reasons.join(';'));const r=await call('POST',`/api/market-simulation/orders/${order.id}?account=steady`,command({action:'approve',note:'Synthetic human approval',confirmSimulation:true,fingerprint:review.fingerprint}));assert.equal(r.status,200,JSON.stringify(r.result));};
 try{
  write();assert.equal((await call('POST','/api/execution-feed/refresh')).result.accepted,1);
  assert.equal((await call('POST','/api/execution-feed/refresh',{quotes:{}})).status,400);
  assert.equal(service.operations().tasks.execution.paused,true);assert.equal(service.operations().tasks.discovery.paused,true);
  const init=await call('POST','/api/market-simulation/initialize?account=steady',command({initialUSD:500000,config:{...strategyProfiles.steady.suggestedConfig,slippageBps:0},confirmSimulation:true}));assert.equal(init.status,200);
  topic=service.research.create({title:'Synthetic execution bridge',summary:'No real vendor data'});topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Fixture'});
  const buy=await propose();await call('POST','/api/market-simulation/process?account=steady');assert.equal(sim().snapshot().fills.length,0);
  await approve(buy);await call('POST','/api/market-simulation/process?account=steady');assert.equal(sim().snapshot().fills.length,0);
  now+=1000;write({availableBuy:40});await call('POST','/api/market-simulation/process?account=steady');let b=sim().snapshot();assert.equal(b.orders[0].status,'partial');assert.equal(b.fills[0].feeCents,1500);assert.equal(b.cashCents,49598500);
  const first=JSON.stringify(b.fills[0]);await call('POST','/api/market-simulation/process?account=steady');assert.equal(sim().snapshot().fills.length,1);
  await service.close();store.close();store=openStore(path);start();assert.equal(sim().snapshot().orders[0].feeAccrual.qty,40);
  now+=1000;write({availableBuy:60});await call('POST','/api/market-simulation/process?account=steady');b=sim().snapshot();assert.equal(b.orders[0].status,'filled');assert.equal(b.fills[1].feeCents,0);assert.equal(b.cashCents,48998500);assert.equal(JSON.stringify(b.fills[0]),first);
  assert.equal(b.fills[0].marketSnapshot.provenance.frameHash.length,64);assert.equal(b.fills[0].feeBreakdown.profileId,'synthetic-fees');
  const sell=await propose({side:'sell',limitPrice:'99'});await approve(sell);now+=1000;write();await call('POST','/api/market-simulation/process?account=steady');b=sim().snapshot();assert.equal(b.orders[1].status,'filled');assert.equal(b.unsettledCashCents,998500);assert.equal(b.cashCents,48998500);
  now=Date.parse('2026-10-06T15:00:00Z');await call('POST','/api/market-simulation/process?account=steady');b=sim().snapshot();assert.equal(b.cashCents,49997000);assert.equal(b.unsettledCashCents,0);assert.equal(b.feesCents,3000);
  const version=b.version;await call('POST','/api/market-simulation/process?account=steady');assert.equal(sim().snapshot().version,version);
 }finally{await service.close();store.close();f.close();}
});
test('changed fee or rules block an old approval and a fill storage failure rolls back fees and liquidity',async()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');let now=Date.parse('2026-10-06T14:00:00Z');const service=createService(store,{mode:'research',executionConfig:f.config,now:()=>now});
 const sim=service.marketSimulations.steady,cmd=extra=>({requestId:randomUUID(),version:sim.snapshot().version,...extra});
 try{
  f.write([f.quote(new Date(now).toISOString())]);service.executionInputs.refresh();sim.initialize(cmd({initialUSD:500000,config:{...strategyProfiles.steady.suggestedConfig,slippageBps:0},confirmSimulation:true}));
  let topic=service.research.create({title:'Synthetic approved input',summary:'Fixture only'});topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Fixture'});
  sim.propose(cmd({order:{topicId:topic.id,topicVersion:topic.version,symbol:'AAPL.US',side:'buy',qty:100,limitPrice:'101',budgetUSD:10200,expiresAt:'2026-10-06T14:30:00Z',holdUntil:'2026-10-07T14:00:00Z',thesis:'Fixture',trigger:'Fixture',invalidation:'Fixture'}}));const order=sim.snapshot().orders[0],review=sim.review(order.id);assert.equal(review.eligible,true);sim.decide(order.id,cmd({action:'approve',fingerprint:review.fingerprint,note:'Fixture human approval',confirmSimulation:true}));const approval=JSON.stringify(sim.snapshot().orders[0].approval);
  now+=1000;const changed=f.quote(new Date(now).toISOString());changed.fees.version='2';f.write([changed]);service.executionInputs.refresh();assert.equal(sim.process().fills.length,0);assert.match(sim.snapshot().orders[0].waitReason,/费用方案/);
  now+=1000;f.write([f.quote(new Date(now).toISOString(),{rulesVersion:'rules-2'})]);service.executionInputs.refresh();assert.equal(sim.process().fills.length,0);assert.match(sim.snapshot().orders[0].waitReason,/规则版本/);assert.equal(JSON.stringify(sim.snapshot().orders[0].approval),approval);
  now+=1000;f.write([f.quote(new Date(now).toISOString())]);service.executionInputs.refresh();const before=sim.snapshot();
  store.db.exec("CREATE TRIGGER fail_feed_fill BEFORE INSERT ON market_sim_events_steady BEGIN SELECT RAISE(ABORT,'fixture failure'); END");assert.throws(()=>sim.process(),/fixture failure/);assert.deepEqual(sim.snapshot(),before);
  store.db.exec('DROP TRIGGER fail_feed_fill');assert.equal(sim.process().fills.length,1);assert.equal(sim.snapshot().orders[0].feeAccrual.qty,100);
 }finally{await service.close();store.close();f.close();}
});
