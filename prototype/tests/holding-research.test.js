import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {holdingResearchLinks,holdingOrderIssues} from '../server/holding-research.mjs';
import {assessOrder,orderLots} from '../server/market-sim-risk.mjs';
const valid=c=>assert.equal(c.eligible,true,c.reasons.join(';'));
const position=f=>f.service.snapshot().overview.accounts.find(a=>a.id==='steady').positions[0];
async function firstHolding(f){
 const t=f.service.research.list().find(t=>t.eventExtraction);assert(t);
 f.quote();f.sim.propose(f.command({order:{topicId:t.id,topicVersion:t.version,symbol:'NVDA.US',side:'buy',qty:100,limitPrice:'101',budgetUSD:15000,expiresAt:'2026-10-08T14:30:00Z',holdUntil:'2026-10-09T14:00:00Z',thesis:'原单篇建仓',trigger:'合成买入',invalidation:'原始风险条件'}}));
 const o=f.sim.snapshot().orders.at(-1),review=f.sim.review(o.id);valid(review);f.sim.decide(o.id,f.command({action:'approve',note:'合成手工建仓',fingerprint:review.fingerprint,confirmSimulation:true}));f.tick();f.quote();const b=f.sim.process();assert.equal(b.lots.length,1);return structuredClone(b.lots[0]);
}
test('a legacy single-research holding follows the later composite without rewriting opening records or requiring intermediate adoption',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  const original=await firstHolding(f),opening=structuredClone(f.sim.snapshot().orders[0]);f.setAction('exit');await f.addMember(2);f.quote();f.enable();
  const changes=f.store.db.prepare('SELECT total_changes() n').get().n,c=f.candidate();valid(c);assert.equal(c.action,'exit');assert.equal(c.heldQty,100);assert.deepEqual(c.order.targetLotIds,[original.id]);assert.equal(c.basis.holdingResearchLinks[0].relation.kind,'event-member');assert.deepEqual(f.sim.snapshot().lots,[original]);assert.deepEqual(f.sim.snapshot().orders[0],opening);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
  const p=position(f);assert.equal(p.topicId,original.topicId);assert.equal(p.currentBinding.kind,'event-cluster');assert.equal(p.monitoringTopicId,'event-cluster:'+f.cluster.id);assert.match(p.judgement,/退出/);await f.observe();assert(f.service.observations.snapshot().items.some(i=>i.input?.reviewKind==='research-continuity'&&i.input.metrics.holdingResearchLink.lotId===original.id));
  f.decide(c);f.tick();f.quote();const b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.lots.length,0);assert.equal(b.fills[0].topicId,original.topicId);assert.equal(b.fills.at(-1).topicId,c.topicId);assert.deepEqual(b.fills.at(-1).allocations.map(a=>a.lotId),[original.id]);assert.equal(b.fills.at(-1).costCents,original.costCents);
 }finally{await f.close();}
});
test('historical member succession continues monitoring and current composite risk exits retain the original lot identity',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  const original=await firstHolding(f);await f.addMember(2);f.auto.revise(1);await f.auto.until(()=>f.service.eventClusters.get(f.cluster.id).version>f.cluster.version);await f.auto.drive();f.quote('85');await f.observe();
  const p=position(f);assert.equal(p.monitoringLink.status,'current',p.monitoringLink.reason);assert.equal(p.monitoringLink.relation.kind,'event-succession');assert.notEqual(p.monitoringLink.relation.currentTopicId,original.topicId);assert.equal(f.sim.snapshot().lots[0].topicId,original.topicId);
  const c=f.sim.snapshot().exitCandidates[0];valid(c);assert.equal(c.topicId,'event-cluster:'+f.cluster.id);assert.equal(c.order.holdingResearchLinks[0].opening.topicId,original.topicId);
  f.sim.decideExit(c.id,f.command({action:'approve',fingerprint:c.fingerprint,note:'核对原始批次与当前风险',confirmSimulation:true}));f.tick();f.quote('85');const b=f.sim.process();assert.equal(b.orders.at(-1).status,'filled');assert.equal(b.lots.length,0);assert.equal(b.fills.at(-1).allocations[0].lotId,original.id);
 }finally{await f.close();}
});
test('stale composite leaves holdings and price risks visible, without falling back to a member action or accepting an old plan',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{await firstHolding(f);f.setAction('exit');await f.addMember(2);f.enable();f.quote();const c=f.candidate();valid(c);f.auto.revise(1);f.quote('85');const p=position(f);assert.equal(p.monitoringLink.status,'waiting');assert.match(p.judgement,/待更新/);assert(p.risks.length);assert.equal(f.candidate().eligible,false);assert.equal(f.sim.snapshot().exitCandidates.some(c=>c.eligible),false);assert.throws(()=>f.decide(c),/依据已变化/);assert.equal(f.sim.snapshot().orders.length,1);}finally{await f.close();}
});
test('a research association changed after partial sell invalidates the remainder, preserving fills and opening costs',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{await firstHolding(f);f.setAction('exit');await f.addMember(2);f.quote();f.enable();f.decide(f.candidate());f.tick();f.quote('100',{availableSell:40});let b=f.sim.process();assert.equal(b.orders.at(-1).status,'partial');const fills=structuredClone(b.fills),lots=structuredClone(b.lots);f.service.eventClusters.archive(f.cluster.id,{version:f.cluster.version,requestId:randomUUID(),note:'合成撤销关联'});f.tick();f.quote();b=f.sim.process();assert.equal(b.orders.at(-1).status,'invalidated');assert.deepEqual(b.fills,fills);assert.deepEqual(b.lots,lots);}finally{await f.close();}
});
test('ambiguous, invalid and unresolved historical associations never borrow a subject, and exact exchange identity is required',()=>{
 const lot={id:'lot',topicId:'old',topicVersion:2,symbol:'NVDA.US'},subject={kind:'event-cluster',id:'event',runId:'run',version:1,ready:true,fresh:true,changed:false,current:{companies:[{symbol:'NVDA.US'}]}},cluster={id:'event',version:2,status:'active',health:{current:true},topicIds:['new'],history:[{topicId:'old',currentTopicId:'new'}]},ctx={subjects:[subject],holdingClusters:[cluster]};
 const good=holdingResearchLinks({lots:[lot]},ctx)[0];assert.equal(good.status,'current');
 for(const input of [{...ctx,reason:'读取研究依赖失败'},{...ctx,holdingClusters:[cluster,{...cluster,id:'other'}]},{...ctx,holdingClusters:[{...cluster,health:{current:false}}]},{...ctx,holdingClusters:[],holdingClusterRefs:{old:[{id:'event',status:'active'}]}},{...ctx,subjects:[{...subject,current:{companies:[{symbol:'09988.HK'}]}}]}])assert.equal(holdingResearchLinks({lots:[lot]},input)[0].status,'waiting');
 const order={side:'sell',targetLotIds:['lot'],researchBinding:good.current,holdingResearchLinks:[good]};assert.deepEqual(holdingOrderIssues({lots:[lot]},order,ctx),[]);assert(holdingOrderIssues({lots:[{...lot,topicVersion:3}]},order,ctx).length);
});
test('cross-research sell reservations share exact lots and cannot consume another topic or forged opening identity',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{const original=await firstHolding(f);f.setAction('exit');await f.addMember(2);f.quote();f.enable();const c=f.candidate();valid(c);const b=f.sim.snapshot(),unrelated={...original,id:'unrelated',topicId:'unrelated'};b.lots.push(unrelated);assert.deepEqual(orderLots(b,c.order).map(l=>l.id),[original.id]);const forged=structuredClone(c.order);forged.holdingResearchLinks[0].opening.topicId='unrelated';assert.deepEqual(orderLots(b,forged),[]);
  b.orders.push({...c.order,id:'reserved',topicId:original.topicId,researchBinding:undefined,holdingResearchLinks:undefined,status:'approved',qty:40,filledQty:0,approval:{evidence:{quotes:f.quotes()}}});assert(assessOrder(b,c.order,f.quotes(),f.at()).reasons.some(r=>r.includes('可卖数量')));
  f.store.db.exec("CREATE TEMP TRIGGER fail_continuity BEFORE INSERT ON market_sim_events_steady BEGIN SELECT RAISE(ABORT,'continuity write failure'); END");const before=f.sim.snapshot();assert.throws(()=>f.decide(c),/continuity write failure/);assert.deepEqual(f.sim.snapshot(),before);
 }finally{await f.close();}
});
test('a newly formed composite stops an earlier member buy approval, without creating another order',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{f.enable();const c=f.sim.snapshot().researchCandidates.find(c=>c.eligible);valid(c);f.decide(c);f.tick();f.quote('100',{availableBuy:40});let b=f.sim.process();assert.equal(b.orders[0].status,'partial');const fills=structuredClone(b.fills);await f.addMember(2);f.tick();f.quote();b=f.sim.process();assert.equal(b.orders[0].status,'invalidated');assert.equal(b.orders.length,1);assert.deepEqual(b.fills,fills);assert.equal(position(f).currentBinding.kind,'event-cluster');}finally{await f.close();}
});
test('a continued holding counts against the same event allocation instead of reopening its original topic allowance',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{await firstHolding(f);await f.addMember(2);f.quote();f.enable();const c=f.candidate();valid(c);const snapshot=f.sim.observationSnapshot();const book={...snapshot.book,config:{...snapshot.book.config,issuerCapPct:100,themeCapPct:4}};const review=assessOrder(book,c.order,f.quotes(),f.at(),snapshot.holdingResearchLinks);assert(review.reasons.includes('超过主题仓位上限'));assert.equal(assessOrder(book,c.order,f.quotes(),f.at()).eligible,true);assert.notEqual(snapshot.book.lots[0].topicId,c.topicId);}finally{await f.close();}
});
