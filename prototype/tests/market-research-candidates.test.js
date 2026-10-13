import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {createHandler} from '../server/index.mjs';
const valid=c=>assert.equal(c.eligible,true,c.reasons.join(';'));
test('automatic sizing is opt-in, fits integer lots and fee-inclusive issuer allocation; reads never write',async()=>{
 const f=await marketResearchFixture();try{let b=f.sim.snapshot();assert.deepEqual(b.autoPolicy,{enabled:false,targetIssuerPct:null,reducePct:null});assert.deepEqual(b.researchCandidates,[]);assert.throws(()=>f.sim.autoPolicy(f.command({policy:{enabled:true,targetIssuerPct:5,reducePct:50},note:'test'})),/模拟确认/);
 for(const policy of [{enabled:true,targetIssuerPct:null,reducePct:50},{enabled:true,targetIssuerPct:5,reducePct:0},{enabled:true,targetIssuerPct:5.001,reducePct:50},{enabled:true,targetIssuerPct:5,reducePct:50,approved:true}])assert.throws(()=>f.enable(policy),/参数无效/);
 f.enable();const changes=f.store.db.prepare('SELECT total_changes() n').get().n,c=f.candidate();valid(c);assert.equal(c.order.qty,249);assert(c.order.budgetCents>c.estimate.netCents);assert(c.order.budgetCents<=2500000);assert.equal(c.basis.targetCents,2500000);assert.equal(c.order.limitPrice,'100.050000');assert.equal(c.order.holdUntil,'2026-10-09T14:00:00Z');const d=f.service.snapshot().overview.decisions;assert.equal(d.length,1);assert.equal(d[0].orderId,'research:'+c.id);assert.equal(f.sim.snapshot().orders.length,0);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
 }finally{await f.close();}
});
test('one final approval freezes the plan, waits for new quotes, fills partially and reaches original holdings overview',async()=>{
 const f=await marketResearchFixture();try{f.enable();const c=f.candidate();valid(c);let b=f.decide(c);assert.equal(b.orders.length,1);assert.equal(b.orders[0].status,'approved');assert.equal(b.fills.length,0);assert.deepEqual(b.orders[0].researchCandidate.basis,c.basis);b=f.sim.process();assert.equal(b.fills.length,0);assert.match(b.orders[0].waitReason,/批准之后/);f.tick();f.quote('100',{availableBuy:100});b=f.sim.process();assert.equal(b.orders[0].status,'partial');assert.equal(b.lots[0].qty,100);assert.deepEqual(b.lots[0].researchBinding,c.researchBinding);assert.equal(f.service.snapshot().overview.decisions.length,0);f.tick();f.quote('100',{availableBuy:149});b=f.sim.process();assert.equal(b.orders[0].status,'filled');assert.equal(b.lots.reduce((n,l)=>n+l.qty,0),249);assert.equal(f.candidate().id,c.id);assert.equal(f.candidate().eligible,false);const p=f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0];assert.equal(p.topicTitle,'NVDA 合成研究方案');assert.equal(p.currentVersion,c.topicVersion);assert.match(p.judgement,/考虑买入/);assert.equal(p.risks.length,0);
 }finally{await f.close();}
});
test('declines survive quote refresh and exact command replay cannot create duplicate decisions',async()=>{
 const f=await marketResearchFixture();try{f.enable();const c=f.candidate(),data=f.command({action:'reject',fingerprint:c.fingerprint,note:'继续观察',confirmSimulation:false}),b=f.sim.decideResearch(c.id,data);assert.equal(f.sim.decideResearch(c.id,data).version,b.version);f.tick();f.quote('99');assert.equal(f.candidate().id,c.id);assert.equal(f.candidate().previousDecision.action,'reject');assert.equal(f.service.snapshot().overview.decisions.length,0);assert.throws(()=>f.decide(f.candidate()),/依据已变化/);assert.equal(f.sim.snapshot().orders.length,0);
 }finally{await f.close();}
});
test('changed quote, research, policy, expired checks or pause reject stale approvals without orders',async()=>{
 for(const change of [f=>{f.tick();f.quote('101');},f=>f.service.controlOperation('observations','pause'),f=>f.tick(121000),f=>f.service.research.update(f.topic.id,{version:f.topic.version,nextEvidence:'研究变化'}),f=>f.enable({enabled:true,targetIssuerPct:6,reducePct:50})]){const f=await marketResearchFixture();try{f.enable();const c=f.candidate();valid(c);change(f);assert.throws(()=>f.decide(c),/依据已变化/);assert.equal(f.sim.snapshot().orders.length,0);}finally{await f.close();}}
});
test('closed market, future or missing quotes, zero capacity and holding constraints block plans',async()=>{
 for(const change of [f=>f.setQuotes({}),f=>f.quote('100',{sessionClose:f.at()}),f=>f.quote('100',{receivedAt:'2026-10-08T15:00:00Z'}),f=>f.quote('100',{availableBuy:0}),f=>f.quote('100',{halted:true}),f=>f.sim.configure(f.command({config:{...f.sim.snapshot().config,allowOvernight:false},note:'No overnight'}))]){const f=await marketResearchFixture();try{f.enable();change(f);const c=f.candidate();assert.equal(c.eligible,false);assert(c.reasons.length);assert.equal(f.service.snapshot().overview.decisions.length,0);}finally{await f.close();}}
});
test('new research stops unfilled quantities but preserves opening basis and current holding judgement',async()=>{
 const f=await marketResearchFixture();try{f.enable();const c=f.candidate();f.decide(c);f.tick();f.quote('100',{availableBuy:100});f.sim.process();await f.save('hold');f.tick();f.quote();const b=f.sim.process();assert.equal(b.orders[0].status,'invalidated');assert.equal(b.fills.length,1);assert.equal(b.lots[0].topicVersion,c.topicVersion);const p=f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0];assert.match(p.judgement,/持有/);assert(p.risks.some(r=>r.includes('版本不同')));await f.observe();assert(f.service.observations.snapshot().items.some(i=>i.kind==='market-review'&&i.input.reviewKind==='research-version'));
 }finally{await f.close();}
});
test('explicit reduce sizes only corresponding lots, obeys sell units and never recursively reduces after fills',async()=>{
 const f=await marketResearchFixture();try{f.enable();f.decide(f.candidate());f.tick();f.quote();f.sim.process();await f.save('reduce');f.quote('100',{sellLot:10});const c=f.candidate();valid(c);assert.equal(c.heldQty,249);assert.equal(c.order.qty,120);assert.equal(c.order.side,'sell');assert(c.order.targetLotIds.length);f.decide(c);f.tick();f.quote('100',{sellLot:10,availableSell:50});let b=f.sim.process();assert.equal(b.orders.at(-1).status,'partial');f.tick();f.quote('100',{sellLot:10,availableSell:70});b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.lots.reduce((n,l)=>n+l.qty,0),129);assert.equal(f.candidate().id,c.id);assert.equal(f.candidate().eligible,false);assert.equal(f.service.snapshot().overview.decisions.length,0);
 }finally{await f.close();}
});
test('exit without corresponding holdings cannot short and accounts cannot borrow each other approvals',async()=>{
 const f=await marketResearchFixture();try{f.enable();await f.save('exit');assert.equal(f.candidate().eligible,false);assert.match(f.candidate().reasons.join(';'),/没有持仓/);await f.save('buy');const c=f.candidate();assert.throws(()=>f.service.marketSimulations.aggressive.decideResearch(c.id,{requestId:randomUUID(),version:0,action:'approve',fingerprint:c.fingerprint,note:'wrong',confirmSimulation:true}),/尚未配置/);assert.equal(f.sim.snapshot().orders.length,0);
 }finally{await f.close();}
});
test('composite wins over members, owns filled lots and remains observable under its own identity',async()=>{
 const f=await marketResearchFixture({composite:true});try{f.enable();const b=f.sim.snapshot(),c=f.candidate();valid(c);assert.equal(b.researchCandidates.length,3);assert.equal(b.researchCandidates.filter(c=>c.eligible).length,1);assert.match(c.topicId,/^event-cluster:/);assert(b.researchCandidates.filter(c=>c.researchBinding.kind==='research').every(c=>c.reasons.some(r=>r.includes('成员研究'))));f.decide(c);f.tick();f.quote();f.sim.process();await f.observe();const p=f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0];assert.equal(p.researchBinding.id,f.cluster.id);assert.equal(p.risks.length,0);assert(!f.service.observations.snapshot().items.some(i=>i.kind==='market-review'&&i.input.reviewKind==='research-status'));f.auto.revise(1);assert.equal(f.candidate().eligible,false);assert.equal(f.sim.snapshot().researchCandidates.filter(c=>c.researchBinding.kind==='research'&&c.eligible).length,0);
 }finally{await f.close();}
});
test('strategy exits still cover composite lots without requiring model sell intent',async()=>{
 const f=await marketResearchFixture({composite:true});try{f.enable();f.decide(f.candidate());f.tick();f.quote();f.sim.process();f.tick();f.quote('85');const c=f.sim.snapshot().exitCandidates[0];valid(c);assert.equal(c.order.researchBinding.kind,'event-cluster');f.sim.decideExit(c.id,f.command({action:'approve',fingerprint:c.fingerprint,note:'risk exit',confirmSimulation:true}));f.tick();f.quote('85');const b=f.sim.process();assert.equal(b.lots.length,0);assert.equal(b.orders.at(-1).status,'filled');
 }finally{await f.close();}
});
test('failed ledger write rolls back approval and order together; restore state blocks final decisions',async()=>{
 const f=await marketResearchFixture();try{f.enable();const c=f.candidate(),b=f.sim.snapshot();f.store.db.exec("CREATE TEMP TRIGGER fail_plan BEFORE INSERT ON market_sim_events_steady BEGIN SELECT RAISE(ABORT,'fixture failure'); END");assert.throws(()=>f.decide(c),/fixture failure/);assert.deepEqual(f.sim.snapshot(),b);f.store.db.exec('DROP TRIGGER fail_plan');f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.decide(c),/恢复副本/);assert.equal(f.sim.snapshot().orders.length,0);
 }finally{await f.close();}
});
test('HTTP permits final decisions only and rejects client-provided quantity, price, quotes and policy',async()=>{
 const f=await marketResearchFixture(),handler=createHandler(f.store,f.service);try{f.enable();const c=f.candidate(),data=f.command({action:'approve',fingerprint:c.fingerprint,note:'final decision',confirmSimulation:true});const call=async body=>{let status,result;await handler({method:'POST',url:`/api/market-simulation/research-candidates/${c.id}?account=steady`,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};for(const extra of [{qty:10000},{limitPrice:1},{quotes:{}},{policy:{targetIssuerPct:100}}])assert.equal((await call({...data,...extra})).status,400);const r=await call(data);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.result.orders[0].qty,249);assert.equal((await call(data)).result.orders.length,1);
 }finally{await f.close();}
});
test('disabling policy invalidates remaining automatic quantity without changing fills or enabling an implicit fallback',async()=>{
 const f=await marketResearchFixture();try{f.enable();f.decide(f.candidate());f.tick();f.quote('100',{availableBuy:100});const before=f.sim.process();f.enable({enabled:false,targetIssuerPct:5,reducePct:50});f.tick();f.quote();const after=f.sim.process();assert.equal(after.orders[0].status,'invalidated');assert.deepEqual(after.fills,before.fills);assert.equal(after.researchCandidates.length,0);assert.equal(after.lots[0].qty,100);}finally{await f.close();}
});
test('issuer target subtracts existing holdings, and tighter risk limits reduce lot sizing before approval',async()=>{
 const f=await marketResearchFixture();try{f.enable();f.decide(f.candidate());f.tick();f.quote();f.sim.process();await f.save('buy');const c=f.candidate();assert.equal(c.eligible,false);assert(c.reasons.some(r=>r.includes('最小买入单位')));f.enable({enabled:true,targetIssuerPct:10,reducePct:50});let next=f.candidate();valid(next);assert(next.order.qty<500);assert.equal(next.basis.existingIssuerCents,2490000);const config={...f.sim.snapshot().config,issuerCapPct:6};f.sim.configure(f.command({config,note:'Tighter issuer limit'}));next=f.candidate();valid(next);assert(next.order.qty<60);}finally{await f.close();}
});
test('observation pause waits after approval, and restart with valid checks resumes only on a fresh quote',async()=>{
 const f=await marketResearchFixture();try{f.enable();f.decide(f.candidate());f.service.controlOperation('observations','pause');f.tick();f.quote();let b=f.sim.process();assert.equal(b.fills.length,0);assert.equal(b.orders[0].status,'approved');assert.match(b.orders[0].waitReason,/后台检查/);f.service.controlOperation('observations','resume');await f.observe();f.tick();f.quote();b=f.sim.process();assert.equal(b.orders[0].status,'filled');}finally{await f.close();}
});
test('a buy quote at or above every valuation scenario is contradictory and cannot become a final plan',async()=>{
 const f=await marketResearchFixture();try{f.enable();for(const price of ['180','200']){f.quote(price);const c=f.candidate();assert.equal(c.eligible,false);assert(c.reasons.some(r=>r.includes('全部估值情景')));assert.throws(()=>f.decide(c),/风险检查未通过/);assert.equal(f.sim.snapshot().orders.length,0);}}finally{await f.close();}
});
test('oversized market minimums and missing aggressive limit price stay blocked without crashing read-only snapshots',async()=>{
 const f=await marketResearchFixture();try{f.enable();f.quote('0.000001',{tickSize:'0.000001',minBuyQty:100000001});assert.equal(f.candidate().eligible,false);assert.equal(f.sim.snapshot().orders.length,0);
  const {strategyProfiles}=await import('../shared/strategy-profiles.mjs'),sim=f.service.marketSimulations.aggressive;sim.initialize({requestId:randomUUID(),version:0,initialUSD:500000,config:strategyProfiles.aggressive.suggestedConfig,confirmSimulation:true});f.quote();sim.autoPolicy({requestId:randomUUID(),version:sim.snapshot().version,policy:{enabled:true,targetIssuerPct:5,reducePct:50},note:'synthetic aggressive missing input',confirmSimulation:true});const c=sim.snapshot().researchCandidates[0];assert.equal(c.eligible,false);assert(c.reasons.some(r=>r.includes('策略限价')));assert.equal(sim.snapshot().orders.length,0);
 }finally{await f.close();}
});
