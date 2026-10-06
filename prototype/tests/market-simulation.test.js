import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openMarketSimulation} from '../server/market-simulation.mjs';
import {amount,fee,quoteIssues,isInstant} from '../server/market-sim-risk.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
const config={issuerCapPct:25,themeCapPct:40,cashFloorPct:20,feeBps:10,slippageBps:10,maxHoldDays:5,maxOrderMinutes:60,quoteMaxAgeSeconds:120,allowOvernight:true};
const start='2026-10-02T14:00:00.000Z';
test('equivalent timestamp spellings cannot consume the same execution liquidity twice',()=>{
 const f=setup();try{const order=f.propose();f.approve(order.id);f.advance(1000,{availableBuy:40});f.sim.process();const first=f.sim.snapshot(),frozen=JSON.stringify(first.fills[0]),event=JSON.stringify(f.sim.event(first.version));
 f.market().quotes['AAPL.US'].asOf='2026-10-02T22:00:01+08:00';const next=f.sim.process();assert.equal(next.fills.length,1);assert.equal(next.orders[0].filledQty,40);assert.equal(next.cashCents,first.cashCents);assert.equal(JSON.stringify(next.fills[0]),frozen);assert.equal(JSON.stringify(f.sim.event(first.version)),event);
 }finally{f.close();}
});
function quote(symbol,at,extra={}){return {id:randomUUID(),symbol,kind:'market-simulation-input',verified:true,source:'synthetic-fixture-only',rulesVersion:'fixture-rules-1',issuerId:symbol,currency:symbol.endsWith('.HK')?'HKD':symbol.endsWith('.SH')?'CNY':'USD',asOf:at,receivedAt:at,validUntil:'2026-10-02T20:00:00Z',bid:'99.90',ask:'100.00',mark:'100.00',fx:{id:'fx-fixture',source:'synthetic-fixture-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-04T20:00:00Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-02T13:30:00Z',sessionClose:'2026-10-02T20:00:00Z',sellableAt:at,settlesAt:'2026-10-03T14:00:00Z',buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:1000,availableSell:1000,...extra};}
function setup(path=':memory:'){
 let now=start,market={quotes:{'AAPL.US':quote('AAPL.US',start)}};const store=openStore(path),research=openResearch(store,{seed:false,clock:()=>now});let topic=research.create({title:'Synthetic acquisition research',summary:'No real orders or market data'});topic=research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Test company association'});
 const sim=openMarketSimulation(store,research,{clock:()=>now,getInputs:()=>market});
 const command=extra=>({requestId:randomUUID(),version:sim.snapshot().version,...extra});
 sim.initialize(command({initialUSD:100000,config,confirmSimulation:true}));
 const f={store,research,sim,topic,command,setTime:v=>now=v,market:()=>market,setMarket:v=>market=v,advance(ms=1000,extra={}){now=new Date(Date.parse(now)+ms).toISOString();market={quotes:{'AAPL.US':quote('AAPL.US',now,extra)}};return now;},propose(extra={}){sim.propose(command({order:{topicId:topic.id,topicVersion:topic.version,symbol:'AAPL.US',side:'buy',qty:100,limitPrice:'101',budgetUSD:10200,expiresAt:'2026-10-02T14:30:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic mechanism',trigger:'Human reviewed trigger',invalidation:'Specific contrary evidence',...extra}}));return sim.snapshot().orders.at(-1);},approve(id){const review=sim.review(id);assert.equal(review.eligible,true,review.reasons.join(';'));return sim.decide(id,command({action:'approve',note:'Synthetic human approval',fingerprint:review.fingerprint,confirmSimulation:true}));},close(){store.close();}};
 return f;
}
test('decimal money calculations round once in USD cents and reject imprecise or overflowing values',()=>{
 assert.equal(amount(3,'0.1','1'),30);assert.equal(amount(100,'7.800000','0.128205'),10000);assert.equal(fee(1000000,10),1000);assert.throws(()=>amount(100000000,'99999999999','99999999999'));assert.throws(()=>amount(1,'0.1234567'));assert.throws(()=>amount(-1,'1'));
});
test('market account is opt-in, uses explicit parameters and never copies the existing scenario account',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research'});try{
  const old=service.paper.snapshot();assert.equal(service.marketSimulation.snapshot().configured,false);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM market_sim_events_aggressive').get().n,0);
  const data={requestId:randomUUID(),version:0,initialUSD:500000,config,confirmSimulation:true};service.marketSimulation.initialize(data);assert.deepEqual(service.paper.snapshot(),old);assert.equal(service.marketSimulation.snapshot().navCents,50000000);assert.equal(service.marketSimulation.snapshot().lots.length,0);
  assert.equal(service.marketSimulation.initialize(data).version,1);assert.throws(()=>service.marketSimulation.initialize({...data,initialUSD:200000}),/标识/);
 }finally{await service.close();store.close();}
});
test('approval freezes review evidence; old quotes cannot fill, partial fills consume liquidity once and cash is exact',()=>{
 const f=setup();try{
  const o=f.propose();f.approve(o.id);assert.equal(f.sim.snapshot().reservedCents,1020000);f.sim.process();assert.equal(f.sim.snapshot().fills.length,0);assert.match(f.sim.snapshot().orders[0].waitReason,/批准之后/);
  f.advance(1000,{availableBuy:40});let b=f.sim.process();assert.equal(b.orders[0].status,'partial');assert.equal(b.orders[0].filledQty,40);assert.equal(b.fills[0].price,'100.100000');assert.equal(b.cashCents,9599200);
  f.sim.process();const v=f.sim.snapshot().version;f.sim.process();assert.equal(f.sim.snapshot().version,v);assert.equal(f.sim.snapshot().fills.length,1);
  f.advance(1000,{availableBuy:100});b=f.sim.process();assert.equal(b.orders[0].status,'filled');assert.equal(b.fills.length,2);assert.equal(b.cashCents,8997999);assert.equal(b.feesCents,1001);assert.equal(b.navCents,9997999);assert.equal(b.reservedCents,0);assert.equal(b.lots.reduce((n,l)=>n+l.qty,0),100);
  assert.equal(b.fills[0].approvalFingerprint,b.orders[0].approval.fingerprint);assert.equal(b.fills[0].marketSnapshot.source,'synthetic-fixture-only');
 }finally{f.close();}
});
test('cancelled remainder preserves completed fills; rejection and expiry have no fills and release budget',()=>{
 const f=setup();try{
  const o=f.propose();f.approve(o.id);f.advance(1000,{availableBuy:40});f.sim.process();f.sim.decide(o.id,f.command({action:'cancel',note:'Cancel unfilled remainder'}));let b=f.sim.snapshot();assert.equal(b.orders[0].filledQty,40);assert.equal(b.orders[0].status,'cancelled');assert.equal(b.reservedCents,0);assert.equal(b.fills.length,1);
  const r=f.propose({qty:1,budgetUSD:102});f.sim.decide(r.id,f.command({action:'reject',note:'Reject new risk'}));
  const e=f.propose({qty:1,budgetUSD:102,expiresAt:'2026-10-02T14:00:03Z'});f.approve(e.id);f.setTime('2026-10-02T14:00:03Z');b=f.sim.process();assert.equal(b.orders.at(-1).status,'expired');assert.equal(b.reservedCents,0);assert.equal(b.fills.length,1);
 }finally{f.close();}
});
test('changed review inputs, stale book versions and changed research cannot execute an old approval',()=>{
 const f=setup();try{
  const o=f.propose(),r=f.sim.review(o.id);f.advance();assert.throws(()=>f.sim.decide(o.id,f.command({action:'approve',note:'Old quote',fingerprint:r.fingerprint,confirmSimulation:true})),/依据已变化/);
  f.approve(o.id);const before=f.sim.snapshot();assert.throws(()=>f.sim.decide(o.id,{...f.command({action:'cancel',note:'Stale writer'}),version:1}),/版本已变化/);
  f.research.update(f.topic.id,{version:f.topic.version,nextEvidence:'New evidence'});const b=f.sim.process();assert.equal(b.orders[0].status,'invalidated');assert.equal(b.cashCents,before.cashCents);assert.equal(b.fills.length,0);
 }finally{f.close();}
});
test('price limits, halted or closed state, future/stale data, unknown FX and zero liquidity never become fills',()=>{
 for(const change of [q=>q.halted=true,q=>q.tradable=false,q=>q.priceLimitState='limit-up',q=>q.receivedAt='2026-10-02T15:00:00Z',q=>q.asOf='2026-10-02T13:00:00Z',q=>q.fx=null,q=>q.availableBuy=0,q=>q.ask='105',q=>q.verified=false,q=>q.kind='bar-close-research-only']){
  const f=setup();try{const o=f.propose();f.approve(o.id);f.advance();change(f.market().quotes['AAPL.US']);const b=f.sim.process();assert.equal(b.fills.length,0);assert.equal(b.orders[0].status,'approved');assert.ok(b.orders[0].waitReason);assert.equal(b.cashCents,10000000);}finally{f.close();}
 }
});
test('partial fills below an order minimum are allowed when the verified execution increment permits them',()=>{
 const f=setup();try{f.market().quotes['AAPL.US'].minBuyQty=200;const o=f.propose({qty:200,budgetUSD:20400});f.approve(o.id);f.advance(1000,{minBuyQty:200,availableBuy:150});assert.equal(f.sim.process().orders[0].filledQty,150);f.advance(1000,{minBuyQty:200,availableBuy:50});assert.equal(f.sim.process().orders[0].status,'filled');}finally{f.close();}
});
test('sellability is distinct from settlement; fees, FIFO cost and pending cash remain attributable',()=>{
 const f=setup();try{
  const o=f.propose();f.approve(o.id);f.advance(1000,{sellableAt:'2026-10-03T14:00:00Z'});f.sim.process();let s=f.propose({side:'sell',qty:100,limitPrice:'109',expiresAt:'2026-10-02T14:30:00Z'});assert.equal(f.sim.review(s.id).eligible,false);assert.match(f.sim.review(s.id).reasons.join(';'),/可卖数量/);
  f.setTime('2026-10-03T14:00:01Z');f.sim.process();f.advance(0,{bid:'110',ask:'110.1',mark:'110',sessionOpen:'2026-10-03T13:30:00Z',sessionClose:'2026-10-03T20:00:00Z',validUntil:'2026-10-03T20:00:00Z',settlesAt:'2026-10-04T14:00:00Z'});
  s=f.propose({side:'sell',qty:100,limitPrice:'109',expiresAt:'2026-10-03T14:30:00Z'});f.approve(s.id);
  f.advance(1000,{bid:'110',ask:'110.1',mark:'110',sessionOpen:'2026-10-03T13:30:00Z',sessionClose:'2026-10-03T20:00:00Z',validUntil:'2026-10-03T20:00:00Z',settlesAt:'2026-10-04T14:00:00Z'});let b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.lots.length,0);assert.equal(b.cashCents,8997999);assert.equal(b.unsettledCashCents,1097801);assert.equal(b.realizedCents,95800);assert.equal(b.navCents,10095800);assert.equal(b.fills.at(-1).allocations[0].costCents,1002001);
  f.setTime('2026-10-04T14:00:00Z');b=f.sim.process();assert.equal(b.cashCents,10095800);assert.equal(b.unsettledCashCents,0);const version=b.version;f.sim.process();assert.equal(f.sim.snapshot().version,version);
 }finally{f.close();}
});
test('unknown marks keep position values and NAV unknown',()=>{
 const f=setup();try{const o=f.propose();f.approve(o.id);f.advance();f.sim.process();f.setMarket({quotes:{}});let b=f.sim.snapshot();assert.equal(b.navCents,null);assert.equal(b.pnlCents,null);assert.equal(b.positions[0].valueCents,null);assert.ok(b.missing.length);assert.equal(b.cashCents,8997999);}finally{f.close();}
});
test('risk caps combine issuer and theme exposure across currency snapshots and reserve all approved budgets',()=>{
 const f=setup();try{
  let t=f.research.addCompany(f.topic.id,{version:f.topic.version,symbol:'00700.HK',note:'Synthetic cross-market identity fixture'});f.topic.version=t.version;
  f.market().quotes['AAPL.US'].issuerId='same-fixture-issuer';f.market().quotes['00700.HK']=quote('00700.HK',start,{issuerId:'same-fixture-issuer',fx:{...f.market().quotes['AAPL.US'].fx,usdPerUnit:'0.128205'},buyLot:100,sellLot:100,minBuyQty:100});
  const a=f.propose({qty:150,budgetUSD:15300});f.approve(a.id);const h=f.propose({symbol:'00700.HK',qty:1000,budgetUSD:13000});assert.match(f.sim.review(h.id).reasons.join(';'),/发行人上限/);assert.equal(f.sim.snapshot().reservedCents,1530000);
  assert.equal(f.sim.review(h.id).eligible,false);assert.throws(()=>f.sim.decide(h.id,f.command({action:'approve',note:'Cannot pass',fingerprint:f.sim.review(h.id).fingerprint,confirmSimulation:true})),/风险检查未通过/);
 }finally{f.close();}
});
test('configuration changes invalidate pending approvals without changing fills; overnight and unit checks are explicit',()=>{
 const f=setup();try{
  const o=f.propose();f.approve(o.id);f.advance(1000,{availableBuy:40});f.sim.process();const fills=f.sim.snapshot().fills;f.sim.configure(f.command({config:{...config,allowOvernight:false},note:'Synthetic no overnight policy'}));assert.equal(f.sim.snapshot().orders[0].status,'invalidated');assert.equal(f.sim.snapshot().reservedCents,0);assert.deepEqual(f.sim.snapshot().fills,fills);
  const next=f.propose();assert.match(f.sim.review(next.id).reasons.join(';'),/交易时段/);f.market().quotes['AAPL.US'].buyLot=100;const odd=f.propose({qty:101,budgetUSD:10400});assert.match(f.sim.review(odd.id).reasons.join(';'),/申报单位/);
 }finally{f.close();}
});
test('transactional event log survives restart and storage failures cannot partially debit cash or fill',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-market-')),path=join(dir,'test.sqlite'),f=setup(path);let reopened;
 try{
  const o=f.propose();f.approve(o.id);f.advance();const before=f.sim.snapshot();f.store.db.exec("CREATE TRIGGER fail_market BEFORE INSERT ON market_sim_events BEGIN SELECT RAISE(ABORT,'storage failure'); END");assert.throws(()=>f.sim.process(),/storage failure/);assert.deepEqual(f.sim.snapshot(),before);f.store.db.exec('DROP TRIGGER fail_market');f.sim.process();const finished=f.sim.snapshot();
  const rows=f.store.db.prepare('SELECT payload,hash FROM market_sim_events ORDER BY version').all();let previous=null;for(const row of rows){const e=JSON.parse(row.payload);assert.equal(e.previousHash,previous);assert.equal(createHash('sha256').update(JSON.stringify(e)).digest('hex'),row.hash);previous=row.hash;}
  f.close();reopened=openStore(path);const sim=openMarketSimulation(reopened,f.research,{clock:()=>start,getInputs:()=>({quotes:{}})});assert.equal(sim.snapshot().cashCents,finished.cashCents);assert.equal(sim.snapshot().fills.length,1);assert.equal(sim.history().length,rows.length);assert.equal(sim.snapshot().navCents,null);
 }finally{if(reopened)reopened.close();else f.close();rmSync(dir,{recursive:true,force:true});}
});
test('restored copies cannot mutate market simulation before restore review is acknowledged',()=>{
 const f=setup();try{f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.propose(),/恢复副本/);assert.throws(()=>f.sim.process(),/恢复副本/);assert.equal(f.sim.snapshot().version,1);}finally{f.close();}
});
test('HTTP has no client-injected quote/fill path, and demo cannot initialize a market account',async()=>{
 for(const mode of ['demo','research']){
  const store=openStore(':memory:'),service=createService(store,{mode}),handler=createHandler(store,service);
  const call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
  try{
   const data={requestId:randomUUID(),version:0,initialUSD:500000,config,confirmSimulation:true};assert.equal((await call('GET','/api/market-simulation')).result.configured,false);
   assert.equal((await call('POST','/api/market-simulation/process',{quotes:{}})).status,400);assert.match((await call('POST','/api/market-simulation/__proto__',{})).result.error,/服务端适配器/);
   const response=await call('POST','/api/market-simulation/initialize',data);assert.equal(response.status,mode==='demo'?400:200);
   if(mode==='research'){assert.match(response.result.sourceNote,/尚未接入/);assert.equal((await call('GET','/api/market-simulation/history')).result.length,1);assert.equal((await call('GET','/api/market-simulation/history/1')).result.state.initialCents,50000000);assert.equal((await call('GET','/api/market-simulation?account=steady')).result.configured,false);assert.equal((await call('POST','/api/market-simulation/initialize?account=steady',data)).status,200);assert.equal((await call('GET','/api/market-simulation?account=__proto__')).status,400);}
  }finally{await service.close();store.close();}
 }
});

 test('timestamps reject normalized invalid dates and order budgets cannot create fractional cents',()=>{
  for(const value of ['2026-02-30T12:00:00Z','2026-10-02T24:00:00Z','2026-10-02T12:00:00','2026-10-02T12:00:00+00:99'])assert.equal(isInstant(value),false,value);
  assert.equal(isInstant('2024-02-29T12:00:00.123+08:00'),true);
  const f=setup();try{assert.throws(()=>f.propose({budgetUSD:100.001}),/申请参数无效/);}finally{f.close();}
 });

test('issuer changes after approval cannot execute an old approval or overwrite its frozen evidence',()=>{
 const f=setup();try{
  const order=f.propose();f.approve(order.id);const approval=JSON.stringify(f.sim.snapshot().orders[0].approval);
  f.advance(1000,{issuerId:'different-issuer'});const b=f.sim.process();
  assert.equal(b.fills.length,0);assert.equal(b.cashCents,10000000);assert.match(b.orders[0].waitReason,/发行人/);
  assert.equal(JSON.stringify(b.orders[0].approval),approval);
  f.advance();assert.equal(f.sim.process().fills.length,1);
 }finally{f.close();}
});
test('held issuer identity survives quote changes; valuation and sale stay blocked until original identity returns',()=>{
 const f=setup();try{
  const buy=f.propose();f.approve(buy.id);f.advance();f.sim.process();const frozen=JSON.stringify(f.sim.snapshot().fills),peak=f.sim.snapshot().lots[0].peakPrice;
  const sell=f.propose({side:'sell',limitPrice:'99'});f.approve(sell.id);
  f.advance(1000,{issuerId:'different-issuer',mark:'200'});let b=f.sim.process();
  assert.equal(b.navCents,null);assert.equal(b.positions[0].valueCents,null);assert.match(b.missing.join(';'),/发行人/);
  assert.equal(JSON.stringify(b.fills),frozen);assert.equal(b.lots[0].issuerId,'AAPL.US');assert.equal(b.lots[0].peakPrice,peak);
  assert.equal(f.sim.review(sell.id).eligible,false);
  f.advance();b=f.sim.process();assert.equal(b.fills.length,2);assert.equal(b.lots.length,0);assert.notEqual(b.navCents,null);
 }finally{f.close();}
});

 test('issuer mismatch blocks new buys against an existing holding without manufacturing valuation or risk peaks',()=>{
  const f=setup();try{
   const first=f.propose();f.approve(first.id);f.advance();f.sim.process();
   const next=f.propose({qty:1,budgetUSD:102});f.advance(1000,{issuerId:'changed',mark:'200'});
   const review=f.sim.review(next.id);assert.equal(review.eligible,false);assert.match(review.reasons.join(';'),/发行人/);
   assert.equal(review.valuation.navCents,null);assert.equal(f.sim.snapshot().fills.length,1);
  }finally{f.close();}
 });
 test('a mismatched outstanding buy cannot be reclassified to evade issuer caps on another pending order',()=>{
  const f=setup();try{
   let t=f.research.addCompany(f.topic.id,{version:f.topic.version,symbol:'MSFT.US',note:'Synthetic second issuer'});f.topic.version=t.version;
   const first=f.propose();f.approve(first.id);f.advance(1000,{issuerId:'changed'});
   f.market().quotes['MSFT.US']=quote('MSFT.US','2026-10-02T14:00:01.000Z');
   const next=f.propose({symbol:'MSFT.US',qty:1,budgetUSD:102});const review=f.sim.review(next.id);
   assert.equal(review.eligible,false);assert.match(review.reasons.join(';'),/AAPL.US.*发行人/);
   assert.equal(f.sim.snapshot().fills.length,0);
  }finally{f.close();}
 });
 test('persisted fills retain issuer identity across reopen and missing legacy identity stays unknown',()=>{
  const dir=mkdtempSync(join(tmpdir(),'signal-issuer-')),path=join(dir,'test.sqlite'),f=setup(path);let store;
  try{
   const first=f.propose();f.approve(first.id);f.advance();f.sim.process();const saved=f.sim.snapshot();f.close();
   store=openStore(path);const q=quote('AAPL.US','2026-10-02T14:00:02.000Z',{issuerId:'changed'});
   const sim=openMarketSimulation(store,null,{clock:()=>q.asOf,getInputs:()=>({quotes:{'AAPL.US':q}})});
   assert.equal(sim.snapshot().navCents,null);assert.deepEqual(sim.snapshot().fills,saved.fills);
   q.issuerId='AAPL.US';assert.notEqual(sim.snapshot().navCents,null);
   const b=JSON.parse(store.db.prepare('SELECT payload FROM market_sim_book').get().payload);delete b.lots[0].issuerId;
   store.db.prepare('UPDATE market_sim_book SET payload=?').run(JSON.stringify(b));
   assert.equal(sim.snapshot().navCents,null);assert.match(sim.snapshot().missing.join(';'),/发行人/);
   assert.deepEqual(sim.snapshot().fills,saved.fills);
  }finally{if(store)store.close();else f.close();rmSync(dir,{recursive:true,force:true});}
 });
test('sub-millisecond post-approval quotes fill separately while timezone aliases consume capacity only once',()=>{
 const f=setup();try{const o=f.propose();f.approve(o.id);f.advance(1,{asOf:'2026-10-02T14:00:00.000000100Z',availableBuy:40});let b=f.sim.process();assert.equal(b.fills.length,1);assert.equal(b.orders[0].filledQty,40);const first=JSON.stringify(b.fills[0]);
 f.market().quotes['AAPL.US'].asOf='2026-10-02T22:00:00.000000100+08:00';b=f.sim.process();assert.equal(b.fills.length,1);assert.equal(JSON.stringify(b.fills[0]),first);
 f.advance(0,{asOf:'2026-10-02T14:00:00.000000200Z',availableBuy:60});b=f.sim.process();assert.equal(b.orders[0].filledQty,100);assert.equal(b.fills.length,2);assert.equal(b.orders[0].status,'filled');assert.equal(JSON.stringify(b.fills[0]),first);
 }finally{f.close();}
});
test('sub-millisecond inventory release and cash settlement never occur early',()=>{
 const f=setup();try{
  const buy=f.propose();f.approve(buy.id);f.advance(1,{sellableAt:'2026-10-02T14:00:00.001000001Z'});f.sim.process();
  const sell=f.propose({side:'sell',qty:100,limitPrice:'99'});assert.equal(f.sim.review(sell.id).eligible,false);
  f.advance(1);f.approve(sell.id);f.advance(1,{settlesAt:'2026-10-02T14:00:00.003000001Z'});let b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.unsettled.length,1);const cash=b.cashCents,pending=b.unsettled[0].amountCents;
  b=f.sim.process();assert.equal(b.cashCents,cash);assert.equal(b.unsettled.length,1);f.advance(1);b=f.sim.process();assert.equal(b.unsettled.length,0);assert.equal(b.cashCents,cash+pending);
 }finally{f.close();}
});
test('nanosecond capacities and frozen quote text survive database reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-nanos-')),path=join(dir,'test.sqlite'),f=setup(path);let reopened;
 try{const o=f.propose();f.approve(o.id);f.advance(1,{asOf:'2026-10-02T14:00:00.000000100Z',availableBuy:40});const before=f.sim.process(),history=f.sim.history().map(r=>f.sim.event(r.version)),market=structuredClone(f.market()),fill=JSON.stringify(before.fills[0]);f.close();
 reopened=openStore(path);const research=openResearch(reopened,{seed:false}),sim=openMarketSimulation(reopened,research,{clock:()=> '2026-10-02T14:00:00.001Z',getInputs:()=>market});
 market.quotes['AAPL.US'].asOf='2026-10-02T22:00:00.000000100+08:00';const after=sim.process();assert.equal(after.fills.length,1);assert.equal(after.cashCents,before.cashCents);assert.equal(JSON.stringify(after.fills[0]),fill);assert.deepEqual(history.map(r=>sim.event(r.version)),history);assert.match(after.orders[0].waitReason,/当前可用数量不足/);assert.equal(sim.process().version,after.version);
 }finally{if(reopened)reopened.close();else f.close();rmSync(dir,{recursive:true,force:true});}
});
