import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openMarketSimulation} from '../server/market-simulation.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {strategyRisk} from '../server/strategy-risk.mjs';

// All timestamps, prices, queue capacities and market rules in this file are synthetic.
function fixture({profiles=true}={}){
 let now='2026-10-02T14:00:00.000Z',quotes={};
 const store=openStore(':memory:'),research=openResearch(store,{seed:false,clock:()=>now});
 let topic=research.create({title:'Synthetic strategy test',summary:'No market inference'});
 for(const symbol of ['AAPL.US','600519.SH'])topic=research.addCompany(topic.id,{version:topic.version,symbol,note:'Synthetic research association'});
 const accounts=Object.fromEntries(Object.entries(strategyProfiles).map(([accountId,profile])=>[accountId,openMarketSimulation(store,research,{accountId,profile:profiles?profile:null,clock:()=>now,getInputs:()=>({quotes})})]));
 const command=(a,data)=>({requestId:randomUUID(),version:accounts[a].snapshot().version,...data});
 for(const a of Object.keys(accounts))accounts[a].initialize(command(a,{initialUSD:500000,config:strategyProfiles[a].suggestedConfig,confirmSimulation:true}));
 const f={store,accounts,topic,now:()=>now,quotes:()=>quotes,command,
  tick(){now=new Date(Date.parse(now)+1000).toISOString();},
  quote(symbol,extra={}){const q={id:`${symbol}:${now}`,symbol,kind:'market-simulation-input',verified:true,source:'synthetic-only',rulesVersion:'fixture-1',issuerId:symbol,currency:symbol.endsWith('.SH')?'CNY':'USD',asOf:now,receivedAt:now,validUntil:'2026-10-02T20:00:00Z',bid:'99.99',ask:'100',mark:'100',fx:{id:'fixture-fx',source:'synthetic-only',usdPerUnit:'1',asOf:now,receivedAt:now,validUntil:'2026-10-02T20:00:00Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-02T13:00:00Z',sessionClose:'2026-10-02T20:00:00Z',sellableAt:now,settlesAt:now,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:100,availableSell:100,...extra};quotes[symbol]=q;return q;},
  limitUp(extra={}){return f.quote('600519.SH',{board:'CN_MAIN',securityType:'common-stock',riskWarning:false,listingStage:'regular',dailyLimitPct:10,priceLimitState:'limit-up',limitUpPrice:'100',queueVerified:true,liquidityBasis:'after-queue',...extra});},
  propose(a,extra={}){const sim=accounts[a];sim.propose(command(a,{order:{topicId:topic.id,topicVersion:topic.version,symbol:a==='aggressive'&&profiles?'600519.SH':'AAPL.US',side:'buy',qty:100,limitPrice:a==='aggressive'&&profiles?'100':'101',budgetUSD:10200,expiresAt:'2026-10-02T14:10:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic case',trigger:'Observed trigger',invalidation:'Counter evidence',...extra}}));return sim.snapshot().orders.at(-1);},
  approve(a,id){const sim=accounts[a],r=sim.review(id);assert.equal(r.eligible,true,r.reasons.join(';'));sim.decide(id,command(a,{action:'approve',note:'Synthetic human decision',fingerprint:r.fingerprint,confirmSimulation:true}));},
  close(){store.close();}
 };return f;
}

test('two 500k sleeves keep cash, configuration, requests, orders and decisions isolated',()=>{
 const f=fixture();try{
  const before=f.accounts.steady.snapshot();f.limitUp();const o=f.propose('aggressive');f.approve('aggressive',o.id);f.tick();f.limitUp();const a=f.accounts.aggressive.process();
  assert.equal(a.fills[0].price,'100');assert.equal(a.fills[0].feeCents,1000);assert.equal(a.cashCents,48999000);assert.deepEqual(f.accounts.steady.snapshot(),before);
  assert.equal(a.orders[0].approval.evidence.profile.version,strategyProfiles.aggressive.version);
  assert.throws(()=>f.accounts.steady.decide(o.id,f.command('steady',{action:'cancel',note:'Wrong account'})),/不存在/);
  assert.equal(f.accounts.steady.snapshot().version,1);assert.equal(f.accounts.aggressive.event(1).state.initialCents,50000000);
 }finally{f.close();}
});

test('limit-up entry requires main-board eligibility and verified after-queue capacity on every execution',()=>{
 for(const change of [{board:'STAR'},{riskWarning:true},{listingStage:'new-listing'},{dailyLimitPct:20},{queueVerified:false},{liquidityBasis:'traded-volume'},{priceLimitState:'normal'},{ask:'99.99'},{limitUpPrice:undefined}]){
  const f=fixture();try{
   f.limitUp();const o=f.propose('aggressive');f.approve('aggressive',o.id);f.tick();f.limitUp(change);const b=f.accounts.aggressive.process();assert.equal(b.fills.length,0,JSON.stringify(change));assert.ok(b.orders[0].waitReason);assert.equal(b.cashCents,50000000);
  }finally{f.close();}
 }
 const f=fixture();try{f.limitUp({availableBuy:0});const o=f.propose('aggressive');f.approve('aggressive',o.id);f.tick();f.limitUp({availableBuy:0});assert.equal(f.accounts.aggressive.process().fills.length,0);}finally{f.close();}
});

test('shared quote capacity cannot be consumed twice across independent accounts',()=>{
 const f=fixture({profiles:false});try{
  f.quote('AAPL.US');for(const a of ['aggressive','steady']){const o=f.propose(a);f.approve(a,o.id);}
  f.tick();f.quote('AAPL.US',{availableBuy:150});let a=f.accounts.aggressive.process(),s=f.accounts.steady.process();
  assert.equal(a.orders[0].filledQty,100);assert.equal(s.orders[0].filledQty,50);assert.equal(s.orders[0].status,'partial');
  f.accounts.aggressive.process();s=f.accounts.steady.process();assert.equal(s.orders[0].filledQty,50);
  f.tick();f.quote('AAPL.US',{availableBuy:50});assert.equal(f.accounts.steady.process().orders[0].filledQty,100);
 }finally{f.close();}
});

test('failed ledger commit rolls shared liquidity and cash back together',()=>{
 const f=fixture({profiles:false});try{
  f.quote('AAPL.US');const o=f.propose('aggressive');f.approve('aggressive',o.id);f.tick();f.quote('AAPL.US');
  f.store.db.exec("CREATE TRIGGER fail_market BEFORE INSERT ON market_sim_events_aggressive BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.throws(()=>f.accounts.aggressive.process(),/fixture failure/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM market_sim_liquidity').get().n,0);assert.equal(f.accounts.aggressive.snapshot().cashCents,50000000);
  f.store.db.exec('DROP TRIGGER fail_market');assert.equal(f.accounts.aggressive.process().orders[0].status,'filled');
 }finally{f.close();}
});

test('two pools share capacity across equivalent quote and FX time spellings, while changed prices stay blocked',()=>{
 const f=fixture({profiles:false});try{
  f.quote('AAPL.US');for(const a of ['aggressive','steady']){const o=f.propose(a);f.approve(a,o.id);}
  f.tick();const q=f.quote('AAPL.US',{availableBuy:150});f.accounts.aggressive.process();
  q.asOf='2026-10-02T22:00:01+08:00';q.receivedAt='2026-10-02T14:00:01Z';q.fx.asOf=q.asOf;q.fx.receivedAt=q.receivedAt;
  const b=f.accounts.steady.process();assert.equal(b.orders[0].filledQty,50);assert.equal(b.fills[0].liquidityVersion,2);
  q.asOf='2026-10-02T10:00:01-04:00';assert.equal(f.accounts.steady.process().fills.length,1);
  q.ask='100.01';const changed=f.accounts.steady.process();assert.equal(changed.fills.length,1);assert.match(changed.orders[0].waitReason,/内容发生变化/);
  assert.equal(f.accounts.aggressive.snapshot().fills[0].qty+b.fills[0].qty,150);
 }finally{f.close();}
});

test('price drawdown triggers exit review without an automatic sell or bypass of sellability',()=>{
 const f=fixture();try{
  f.limitUp();const o=f.propose('aggressive');f.approve('aggressive',o.id);f.tick();f.limitUp({sellableAt:'2026-10-03T14:00:00Z'});f.accounts.aggressive.process();
  f.tick();f.limitUp({mark:'110'});f.accounts.aggressive.process();f.tick();f.limitUp({mark:'105'});let b=f.accounts.aggressive.process();
  assert.ok(b.strategyRisk.alerts.some(a=>a.kind==='trailing-exit-review'));assert.equal(b.fills.length,1);assert.equal(b.orders.length,1);
  const add=f.propose('aggressive');assert.match(f.accounts.aggressive.review(add.id).reasons.join(';'),/退出或到期复核/);
  f.tick();f.quote('600519.SH',{mark:'94'});b=f.accounts.aggressive.process();assert.ok(b.strategyRisk.alerts.some(a=>a.kind==='loss-exit-review'));
  const sell=f.propose('aggressive',{side:'sell',limitPrice:'93'});assert.match(f.accounts.aggressive.review(sell.id).reasons.join(';'),/可卖数量/);assert.equal(b.lots[0].qty,100);
 }finally{f.close();}
});

test('pool drawdown pause latches until recovery and explicit review; the other sleeve stays independent',()=>{
 const f=fixture();try{
  f.quote('AAPL.US');const o=f.propose('steady');f.approve('steady',o.id);f.tick();f.quote('AAPL.US');f.accounts.steady.process();
  f.tick();f.quote('AAPL.US',{mark:'2000'});f.accounts.steady.process();f.tick();f.quote('AAPL.US',{mark:'100'});let b=f.accounts.steady.process();
  assert.equal(b.riskPaused,true);assert.ok(b.strategyRisk.drawdownPct>15);assert.equal(f.accounts.aggressive.snapshot().riskPaused,false);
  assert.throws(()=>f.accounts.steady.resume(f.command('steady',{note:'Cannot resume while breached'})),/风险检查未通过/);
  f.tick();f.quote('AAPL.US',{mark:'2000'});b=f.accounts.steady.process();assert.equal(b.riskPaused,true);
  b=f.accounts.steady.resume(f.command('steady',{note:'Recovered and reviewed'}));assert.equal(b.riskPaused,false);assert.equal(f.accounts.steady.history()[0].kind,'resume-risk');
 }finally{f.close();}
});

test('holding review survives missing marks, and unknown valuation cannot masquerade as zero drawdown',()=>{
 const f=fixture();try{
  f.quote('AAPL.US');const o=f.propose('steady');f.approve('steady',o.id);f.tick();f.quote('AAPL.US');const b=f.accounts.steady.process();
  const risk=strategyRisk(b,{},'2026-10-04T14:00:00Z');assert.equal(risk.navCents,null);assert.equal(risk.drawdownPct,null);assert.ok(risk.alerts.some(a=>a.kind==='holding-review'));
 }finally{f.close();}
});
