import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scheduledMarketFixture} from './fixtures/scheduled-market.mjs';
import {processMarketAccounts} from '../server/market-execution.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
const book=(f,id='steady')=>f.service.marketSimulations[id].snapshot();
const resume=f=>f.service.controlOperation('execution','resume');

test('automatic execution defaults paused and never initializes accounts or processes approved orders by itself',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');const before=book(f);assert.equal(f.service.operations().tasks.execution.paused,true);f.set({at:'2026-10-02T14:00:10.000Z'});await f.service.tick();assert.equal(book(f).version,before.version);assert.equal(book(f).fills.length,0);assert.throws(()=>f.service.runOperation('execution'),/暂停/);}finally{await f.close();}
 const empty=scheduledMarketFixture(':memory:',{initialize:false});try{resume(empty);await empty.service.tick();assert.equal(empty.service.operations().tasks.execution.outcome,'skipped');for(const sim of Object.values(empty.service.marketSimulations))assert.equal(sim.snapshot().configured,false);}finally{await empty.close();}
});
test('scheduler advances both pools with partial fills, freezes run tokens and never consumes a snapshot twice',async()=>{
 const f=scheduledMarketFixture();try{for(const id of ['aggressive','steady'])f.propose(id);resume(f);await f.service.tick();assert.equal(book(f).fills.length,0);
 f.set({at:'2026-10-02T14:00:10.000Z',availableBuy:40});await f.service.tick();for(const id of ['aggressive','steady']){assert.equal(book(f,id).fills[0].qty,40);assert.equal(book(f,id).orders[0].status,'partial');const sim=f.service.marketSimulations[id],event=sim.event(book(f,id).version);assert.equal(event.detail.origin,'scheduler');assert.equal(event.detail.runToken,f.service.operations().history.find(r=>r.name==='execution').token??f.store.db.prepare("SELECT token FROM operation_runs WHERE name='execution' ORDER BY id DESC LIMIT 1").get().token);}
 await f.service.runOperation('execution');assert.equal(book(f).fills.length,1);assert.equal(book(f).orders[0].filledQty,40);
 f.set({at:'2026-10-02T14:00:20.000Z',availableBuy:60});await f.service.tick();for(const id of ['aggressive','steady']){assert.equal(book(f,id).orders[0].status,'filled');assert.equal(book(f,id).fills.length,2);}assert.equal(f.service.paper.snapshot().fills?.length||0,0);
 }finally{await f.close();}
});
test('unapproved orders cannot fill and source loss records a wait before expiry releases the budget',async()=>{
 const f=scheduledMarketFixture();try{f.propose('aggressive',{approve:false});f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z',missing:true});await f.service.tick();assert.equal(book(f,'aggressive').orders[0].status,'pending');assert.equal(book(f).orders[0].status,'approved');assert.match(book(f).orders[0].waitReason,/缺少可核验/);assert.equal(book(f).fills.length,0);
 f.set({at:'2026-10-02T14:10:00.000Z'});await f.service.tick();for(const id of ['aggressive','steady']){assert.equal(book(f,id).orders[0].status,'expired');assert.equal(book(f,id).reservedCents,0);assert.equal(book(f,id).fills.length,0);}
 }finally{await f.close();}
});
test('pause and partial fills survive reopen; fresh quotes resume without repeated historical fills',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-execution-')),path=join(dir,'test.sqlite');let f=scheduledMarketFixture(path);
 try{f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z',availableBuy:40});await f.service.tick();f.service.controlOperation('execution','pause');const before=JSON.stringify(book(f).fills);await f.close();f=scheduledMarketFixture(path);assert.equal(f.service.operations().tasks.execution.paused,true);f.set({at:'2026-10-02T14:00:20.000Z',availableBuy:60});await f.service.tick();assert.equal(JSON.stringify(book(f).fills),before);resume(f);await f.service.tick();assert.equal(book(f).orders[0].filledQty,100);assert.equal(JSON.stringify(book(f).fills.slice(0,1)),before);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('two live services cannot claim the same persisted execution cycle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-execution-two-')),path=join(dir,'test.sqlite'),a=scheduledMarketFixture(path),b=scheduledMarketFixture(path);
 try{a.propose('steady');resume(a);for(const f of [a,b])f.set({at:'2026-10-02T14:00:10.000Z',availableBuy:40});await Promise.all([a.service.tick(),b.service.tick()]);assert.equal(book(a).fills.length,1);assert.equal(book(a).orders[0].filledQty,40);assert.equal(a.store.db.prepare("SELECT count(*) n FROM operation_runs WHERE name='execution'").get().n,1);}finally{await a.close();await b.close();rmSync(dir,{recursive:true,force:true});}
});
test('one pool transaction failure rolls back fills but does not block the other pool',async()=>{
 const f=scheduledMarketFixture();try{f.propose('aggressive');f.propose('steady');f.store.db.exec("CREATE TRIGGER reject_aggressive BEFORE INSERT ON market_sim_events_aggressive BEGIN SELECT RAISE(ABORT,'PRIVATE_PROVIDER_TOKEN'); END");resume(f);f.set({at:'2026-10-02T14:00:10.000Z'});await f.service.tick();assert.equal(book(f,'aggressive').fills.length,0);assert.equal(book(f,'aggressive').cashCents,50000000);assert.equal(book(f).fills.length,1);assert.equal(f.service.operations().tasks.execution.outcome,'partial');assert.doesNotMatch(JSON.stringify(f.service.operations()),/PRIVATE_PROVIDER_TOKEN/);}finally{await f.close();}
});
test('pause during adapter read and guard failure before commit cannot debit cash or consume liquidity',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z',hook:()=>{f.service.controlOperation('execution','pause');f.set({hook:null});}});await f.service.tick();assert.equal(book(f).fills.length,0);assert.equal(f.service.operations().tasks.execution.outcome,'cancelled');let guards=0;assert.throws(()=>f.service.marketSimulations.steady.process({assertActive:()=>{if(++guards===3)throw Error('cancel before commit');},runToken:'test-run'}),/cancel before commit/);assert.equal(book(f).fills.length,0);assert.equal(book(f).cashCents,50000000);assert.equal(f.store.db.prepare('SELECT count(*) n FROM market_sim_liquidity').get().n,0);}finally{await f.close();}
});
test('restore review gates an enabled execution task and a restore flag introduced by the adapter',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z'});const before=book(f).version;f.store.db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1')").run();await f.service.tick();assert.equal(book(f).version,before);assert.throws(()=>f.service.controlOperation('execution','resume'),/恢复/);assert.throws(()=>f.service.marketSimulations.steady.process(),/恢复/);
 f.store.db.prepare("UPDATE settings SET value='0' WHERE key='restore_review_required'").run();f.set({hook:()=>{f.store.db.prepare("UPDATE settings SET value='1' WHERE key='restore_review_required'").run();f.set({hook:null});}});assert.throws(()=>f.service.marketSimulations.steady.process(),/恢复/);assert.equal(book(f).version,before);}finally{await f.close();}
});
test('pending restored lease recovers once and does not repeat already committed fills',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z',availableBuy:40});await f.service.tick();const run=f.store.db.prepare("SELECT token FROM operation_runs WHERE name='execution' ORDER BY id DESC LIMIT 1").get();f.store.db.prepare("UPDATE operation_runs SET outcome='running',completed_at=NULL WHERE token=?").run(run.token);f.store.db.prepare("UPDATE operation_tasks SET token=?,state='running',lease_until=1,next_run=0 WHERE name='execution'").run(run.token);await f.service.tick();assert.equal(book(f).fills.length,1);assert.equal(book(f).orders[0].filledQty,40);assert.equal(f.service.operations().history.filter(r=>r.name==='execution'&&r.outcome==='interrupted').length,1);}finally{await f.close();}
});
test('execution account ordering is deterministic by oldest outstanding approval then account id',()=>{
 const order=[],accounts={};for(const [id,stamp]of [['steady','2026-10-02T14:00:00Z'],['aggressive','2026-10-02T14:00:01Z']])accounts[id]={executionState:()=>({accountId:id,configured:true,version:1,oldestApproval:stamp}),process:()=>{order.push(id);return {version:1};}};
 processMarketAccounts(accounts,{assertActive(){},token:'fixture-token'});assert.deepEqual(order,['steady','aggressive']);
});
test('demo automatic cycle cannot initialize or fill accounts even if the lane is resumed',async()=>{
 const s=openStore(':memory:'),service=createService(s,{mode:'demo',marketInputs:()=>{throw Error('must not execute');}});try{service.controlOperation('execution','resume');await service.tick();assert.equal(service.operations().tasks.execution.outcome,'skipped');assert(Object.values(service.marketSimulations).every(sim=>!sim.snapshot().configured));}finally{await service.close();s.close();}
});
test('manual process remains available while automatic execution is paused; HTTP rejects injected input',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');f.set({at:'2026-10-02T14:00:10.000Z'});const handler=createHandler(f.store,f.service);let status,body;
 const call=async data=>{const req={method:'POST',url:'/api/market-simulation/process?account=steady',headers:{host:'127.0.0.1:4178','content-type':'application/json'},async*[Symbol.asyncIterator](){yield JSON.stringify(data);}};await handler(req,{writeHead:c=>status=c,end:t=>body=JSON.parse(t)});};
 await call({quotes:f.quotes()});assert.equal(status,400);assert.equal(book(f).fills.length,0);await call({});assert.equal(status,200);assert.equal(body.fills.length,1);assert.equal(f.service.operations().tasks.execution.paused,true);assert.equal(f.service.marketSimulations.steady.event(body.version).detail.origin,'manual');
 }finally{await f.close();}
});
test('an unreadable pool cannot hide the other pool from execution checks',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');f.store.db.prepare('UPDATE market_sim_book_aggressive SET payload=?').run('{');resume(f);f.set({at:'2026-10-02T14:00:10.000Z'});await f.service.runOperation('execution');assert.equal(book(f).fills.length,1);assert.equal(f.service.operations().tasks.execution.outcome,'partial');}finally{await f.close();}
});
test('automatic processing settles an approved sale exactly once even after execution inputs disappear',async()=>{
 const f=scheduledMarketFixture();try{f.propose('steady');resume(f);f.set({at:'2026-10-02T14:00:10.000Z'});await f.service.tick();assert.equal(book(f).fills.length,1);
 f.set({settlement:'2026-10-03T14:00:00.000Z'});f.propose('steady',{side:'sell',limitPrice:'99'});f.set({at:'2026-10-02T14:00:20.000Z'});await f.service.tick();assert.equal(book(f).fills.length,2);assert.equal(book(f).lots.length,0);const pending=book(f).unsettledCashCents,cash=book(f).cashCents;assert(pending>0);
 f.set({at:'2026-10-03T14:00:00.000Z',missing:true});await f.service.tick();assert.equal(book(f).cashCents,cash+pending);assert.equal(book(f).unsettledCashCents,0);const version=book(f).version;await f.service.runOperation('execution');assert.equal(book(f).version,version);assert.equal(book(f).fills.length,2);
 }finally{await f.close();}
});
test('abrupt process exit between pool commits preserves the first fill and recovers the unfinished cycle after lease expiry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-execution-exit-')),path=join(dir,'test.sqlite');let f;
 try{
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {scheduledMarketFixture} from ${JSON.stringify(new URL('./fixtures/scheduled-market.mjs',import.meta.url).href)};
   const f=scheduledMarketFixture(process.argv[1]);
   f.propose('aggressive');f.propose('steady');f.service.controlOperation('execution','resume');
   f.set({at:'2026-10-02T14:00:10.000Z',availableBuy:40});
   const sim=f.service.marketSimulations.aggressive,processPool=sim.process.bind(sim);
   sim.process=options=>{processPool(options);process.exit(73);};
   await f.service.tick();
   process.exit(74);
  `,path],{encoding:'utf8',timeout:15000});
  assert.equal(child.status,73,child.stderr);assert.equal(child.error,undefined);
  f=scheduledMarketFixture(path);
  const first=book(f,'aggressive'),frozenFill=JSON.stringify(first.fills),frozenEvent=JSON.stringify(f.service.marketSimulations.aggressive.event(first.version));
  assert.equal(first.fills.length,1);assert.equal(first.orders[0].filledQty,40);assert.equal(book(f).fills.length,0);
  const interrupted=f.store.db.prepare("SELECT * FROM operation_runs WHERE name='execution'").get();
  assert.equal(interrupted.outcome,'running');assert.equal(interrupted.completed_at,null);
  assert.equal(f.service.marketSimulations.aggressive.event(first.version).detail.runToken,interrupted.token);
  f.set({at:'2026-10-02T14:00:20.000Z'});await f.service.tick();
  assert.equal(book(f,'aggressive').version,first.version);assert.equal(book(f).fills.length,0);
  f.set({at:'2026-10-02T14:01:40.000Z',missing:true});await f.service.tick();
  assert.equal(JSON.stringify(book(f,'aggressive').fills),frozenFill);assert.equal(book(f).fills.length,0);
  assert.equal(f.store.db.prepare('SELECT outcome FROM operation_runs WHERE token=?').get(interrupted.token).outcome,'interrupted');
  f.set({at:'2026-10-02T14:01:50.000Z',missing:false});await f.service.tick();
  assert.equal(book(f,'aggressive').orders[0].filledQty,100);assert.equal(book(f).orders[0].filledQty,100);
  assert.deepEqual(book(f,'aggressive').fills.map(fill=>fill.qty),[40,60]);assert.deepEqual(book(f).fills.map(fill=>fill.qty),[100]);
  assert.equal(JSON.stringify(book(f,'aggressive').fills.slice(0,1)),frozenFill);
  assert.equal(JSON.stringify(f.service.marketSimulations.aggressive.event(first.version)),frozenEvent);
  const latest=f.service.marketSimulations.steady.event(book(f).version);assert.notEqual(latest.detail.runToken,interrupted.token);
  await f.service.runOperation('execution');assert.equal(book(f,'aggressive').fills.length,2);assert.equal(book(f).fills.length,1);
 }finally{if(f)await f.close();rmSync(dir,{recursive:true,force:true});}
});
