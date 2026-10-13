import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exitFixture} from './helpers/market-exit-fixture.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openMarketSimulation} from '../server/market-simulation.mjs';
import {createHandler} from '../server/index.mjs';

test('risk automatically prepares a read-only exit, reaches the existing dashboard and preserves every ledger until a decision',async()=>{
 const f=exitFixture();try{f.buy();f.tick();f.quote('85');const version=f.sim.snapshot().version,changes=f.store.db.prepare('SELECT total_changes() n').get().n,c=f.candidate();
  assert.equal(c.eligible,true,c.reasons.join(';'));assert.equal(c.order.qty,100);assert.equal(c.order.limitPrice,'84.950000');assert.equal(c.order.expiresAt,'2026-10-06T15:00:02.000Z');assert.equal(c.estimate.grossCents,849500);assert.equal(c.estimate.feeCents,850);assert.equal(c.estimate.netCents,848650);
  const d=f.service.snapshot().overview.decisions.find(d=>d.orderId===`exit:${c.id}`);assert.equal(d.account,'steady');assert.equal(d.side,'sell');assert.equal(f.sim.snapshot().orders.length,1);assert.equal(f.sim.snapshot().version,version);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
 }finally{await f.close();}
});
test('one final approval freezes candidate evidence, waits for new quotes and exits only triggered lots with partial fills',async()=>{
 const f=exitFixture();try{const unaffected=f.buy('95'),target=f.buy('100');f.tick();f.quote('85',{availableSell:40});const c=f.candidate();assert.deepEqual(c.order.targetLotIds,[target.id]);const before=f.sim.snapshot();let b=f.decide(c);
  const o=b.orders.at(-1);assert.equal(o.status,'approved');assert.equal(o.qty,100);assert.equal(o.exitCandidate.fingerprint,c.fingerprint);assert.equal(b.fills.length,before.fills.length);assert.equal(b.cashCents,before.cashCents);assert.equal(f.service.snapshot().overview.decisions.length,0);
  b=f.sim.process();assert.equal(b.fills.length,2);assert.match(b.orders.at(-1).waitReason,/批准之后/);
  f.tick();f.quote('85',{availableSell:40});b=f.sim.process();assert.equal(b.orders.at(-1).status,'partial');assert.deepEqual(b.fills.at(-1).allocations.map(a=>a.lotId),[target.id]);assert.equal(b.lots.find(l=>l.id===unaffected.id).qty,100);
  f.tick();f.quote('85',{availableSell:60});b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.lots.length,1);assert.equal(b.lots[0].id,unaffected.id);assert.equal(b.exitDecisions.length,1);assert.equal(b.exitCandidates.length,0);
 }finally{await f.close();}
});
test('stale quotes, recovered risks, foreign accounts and missing simulation confirmation cannot approve a displayed candidate',async()=>{
 const f=exitFixture();try{f.buy();f.tick();f.quote('85');let c=f.candidate();const count=f.sim.snapshot().orders.length;
  f.tick();f.quote('84');assert.throws(()=>f.decide(c),/依据已变化/);c=f.candidate();assert.throws(()=>f.decide(c,'approve',{confirmSimulation:false}),/明确的模拟确认/);
  assert.throws(()=>f.service.marketSimulations.aggressive.decideExit(c.id,{requestId:randomUUID(),version:0,action:'approve',fingerprint:c.fingerprint,note:'Wrong pool',confirmSimulation:true}),/尚未配置/);
  f.quote('100');assert.throws(()=>f.decide(c),/依据已变化/);assert.equal(f.sim.snapshot().orders.length,count);assert.equal(f.sim.snapshot().exitDecisions,undefined);
 }finally{await f.close();}
});
test('declining an exit is durable and idempotent, removes it from new decisions and never clears risk or changes positions',async()=>{
 const f=exitFixture();try{f.buy();f.tick();f.quote('85');const c=f.candidate(),data=f.command({action:'reject',fingerprint:c.fingerprint,note:'Continue monitoring',confirmSimulation:false}),before=f.sim.snapshot();let b=f.sim.decideExit(c.id,data);
  assert.equal(b.orders.length,before.orders.length);assert.deepEqual(b.lots,before.lots);assert.equal(b.exitDecisions.length,1);assert.equal(b.strategyRisk.alerts.length,1);assert.equal(f.sim.decideExit(c.id,data).version,b.version);
  f.tick();f.quote('84');assert.equal(f.candidate().id,c.id);assert.equal(f.candidate().previousDecision.action,'reject');assert.equal(f.service.snapshot().overview.decisions.length,0);
  b=f.decide(f.candidate());assert.equal(b.orders.at(-1).status,'approved');assert.equal(b.exitDecisions.length,2);assert.equal(b.exitDecisions[0].action,'reject');
 }finally{await f.close();}
});
test('due positions retain blocked candidates for missing, closed, mismatched, unsellable, zero-capacity or stale inputs',async()=>{
 for(const change of [f=>f.setQuotes({}),f=>f.quotes()['AAPL.US'].halted=true,f=>f.quotes()['AAPL.US'].issuerId='other',f=>f.quotes()['AAPL.US'].availableSell=0,f=>f.quotes()['AAPL.US'].receivedAt='2026-10-06T15:00:00Z',f=>f.quotes()['AAPL.US'].priceLimitState='limit-down',f=>f.quotes()['AAPL.US'].sessionClose=f.at()]){
  const f=exitFixture();try{f.buy('100',{holdUntil:'2026-10-06T14:31:00Z'});f.setTime('2026-10-06T14:32:00Z');f.quote('100');change(f);const c=f.candidate();assert(c);assert.equal(c.eligible,false);assert(c.reasons.length);assert.throws(()=>f.decide(c),/风险检查未通过/);assert.equal(f.service.snapshot().overview.decisions.length,0);}finally{await f.close();}
 }
 const f=exitFixture();try{f.buy('100',{quote:{sellableAt:'2026-10-07T14:00:00Z'}});f.tick();f.quote('85');const c=f.candidate();assert.equal(c.sellableQty,0);assert.equal(c.eligible,false);assert.equal(c.remainderQty,100);}finally{await f.close();}
});
test('whole sell units and session close constrain suggestions without adding untriggered inventory',async()=>{
 const f=exitFixture();try{f.buy('100',{qty:105});f.setTime('2026-10-06T19:59:00Z');f.quote('85',{sellLot:10});const c=f.candidate();assert.equal(c.order.qty,100);assert.equal(c.remainderQty,5);assert.equal(c.order.expiresAt,'2026-10-06T20:00:00.000Z');f.decide(c);f.tick();f.quote('85',{sellLot:10});const b=f.sim.process();assert.equal(b.lots[0].qty,5);assert.equal(b.exitCandidates[0].eligible,false);assert.equal(b.exitCandidates[0].heldQty,5);}finally{await f.close();}
});
test('a changed research version or existing sell request blocks the shortcut without overwriting either',async()=>{
 const f=exitFixture();try{f.buy();f.tick();f.quote('85');const c=f.candidate();f.service.research.update(f.topic.id,{version:f.topic.version,nextEvidence:'Changed thesis'});assert.equal(f.candidate().eligible,false);assert.match(f.candidate().reasons.join(';'),/研究与当前版本不同/);assert.throws(()=>f.decide(c),/依据已变化/);}finally{await f.close();}
 const g=exitFixture();try{g.buy();g.tick();g.quote('85');const c=g.candidate();g.sim.propose(g.command({order:{...c.order,thesis:'Existing manual exit',trigger:'Original risk',invalidation:'Original expiry'}}));assert.equal(g.candidate().eligible,false);assert.equal(g.candidate().existingOrderIds.length,1);assert.equal(g.sim.snapshot().orders.at(-1).targetLotIds,undefined);}finally{await g.close();}
});
test('failed commits roll back decision and approved order together; restore locks and read retries never mutate a book',async()=>{
 const f=exitFixture();try{f.buy();f.tick();f.quote('85');const c=f.candidate(),before=f.sim.snapshot();f.store.db.exec("CREATE TRIGGER fail_exit BEFORE INSERT ON market_sim_events_steady BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");assert.throws(()=>f.decide(c),/storage failure/);assert.deepEqual(f.sim.snapshot(),before);f.store.db.exec('DROP TRIGGER fail_exit');f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.decide(c),/恢复副本/);assert.deepEqual(f.sim.snapshot(),before);}finally{await f.close();}
});
test('decision, frozen original basis and idempotency survive database reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-exit-')),path=join(dir,'fixture.sqlite'),f=exitFixture(path);let reopened;
 try{f.buy();f.tick();f.quote('85');const c=f.candidate(),data=f.command({action:'approve',note:'Final approval',fingerprint:c.fingerprint,confirmSimulation:true}),b=f.sim.decideExit(c.id,data),quotes=structuredClone(f.quotes()),at=f.at(),events=f.sim.history().map(e=>f.sim.event(e.version));await f.close();reopened=openStore(path);const sim=openMarketSimulation(reopened,openResearch(reopened,{seed:false}),{accountId:'steady',clock:()=>at,getInputs:()=>({quotes,reason:'仅限合成退出候选检查'})});assert.equal(sim.decideExit(c.id,data).version,b.version);assert.deepEqual(sim.snapshot().exitDecisions,b.exitDecisions);assert.deepEqual(sim.history().map(e=>sim.event(e.version)),events);assert.equal(sim.snapshot().orders.at(-1).status,'approved');}
 finally{if(reopened)reopened.close();else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP accepts only final decisions; injected quantities, prices and quotes cannot become candidate inputs',async()=>{
 const f=exitFixture(),handler=createHandler(f.store,f.service);try{f.buy();f.tick();f.quote('85');const c=f.candidate(),data=f.command({action:'approve',fingerprint:c.fingerprint,note:'Final UI decision',confirmSimulation:true});
  const call=async body=>{let status,result;await handler({method:'POST',url:`/api/market-simulation/exit-candidates/${c.id}?account=steady`,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
  for(const extra of [{qty:10000},{limitPrice:1},{quotes:{}}])assert.equal((await call({...data,...extra})).status,400);
  const r=await call(data);assert.equal(r.status,200);assert.equal(r.result.orders.at(-1).status,'approved');assert.equal(r.result.orders.at(-1).qty,100);assert.equal(r.result.fills.length,1);assert.equal(r.result.exitCandidates[0].alerts[0].message,c.alerts[0].message);assert.deepEqual(r.result.exitDecisions[0].basis.alerts,c.basis.alerts);
 }finally{await f.close();}
});
