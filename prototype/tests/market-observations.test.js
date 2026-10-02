import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {marketReviewCandidates} from '../server/market-observations.mjs';
import {valuation} from '../server/market-sim-risk.mjs';
import {strategyRisk} from '../server/strategy-risk.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
const at='2026-10-02T14:00:00Z';
function fixture(){
 const t={id:'t',title:'Synthetic holding review',status:'active',version:1,companies:[{symbol:'AAPL.US'}],evidence:[],hypothesis:{},claims:[]};
 const q={id:'fixture-price',symbol:'AAPL.US',currency:'USD',kind:'market-simulation-input',verified:true,source:'synthetic-only',rulesVersion:'fixture',issuerId:'apple',asOf:at,receivedAt:at,validUntil:'2026-10-02T14:01:00Z',bid:'99',ask:'101',mark:'100',fx:{id:'fixture-fx',source:'synthetic',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-02T14:01:00Z'}};
 const lot={id:'lot-1',symbol:'AAPL.US',topicId:t.id,topicVersion:1,issuerId:'apple',qty:100,costCents:1000000,openedAt:at,holdUntil:'2026-10-03T14:00:00Z',entryPrice:'100',peakPrice:'100'};
 const b={accountId:'steady',version:5,initialCents:50000000,cashCents:49000000,highWaterCents:50000000,configVersion:1,config:structuredClone(strategyProfiles.steady.suggestedConfig),profile:strategyProfiles.steady,lots:[lot],orders:[{id:'order-1',status:'filled',researchSnapshot:structuredClone(t)}],fills:[{id:lot.id,orderId:'order-1'}],unsettled:[],realizedCents:0,feesCents:0};
 let quotes={'AAPL.US':q};return {t,q,b,setQuotes:v=>quotes=v,snapshot:()=>({accountId:b.accountId,book:structuredClone(b),quotes:structuredClone(quotes),at,valuation:valuation(b,quotes,at),risk:strategyRisk(b,quotes,at)}),candidates(){return marketReviewCandidates(this.snapshot(),[t]);}};
}
const hitKinds=cs=>cs.filter(c=>c.state==='hit').map(c=>c.hit.input.reviewKind);
function inbox(f,path=':memory:') {const s=openStore(path),i=openObservationInbox(s,{clock:()=>at,getMarketSnapshots:()=>[f.snapshot()]});return {s,i,run:()=>i.process([f.t],{positions:[]})};}
test('healthy market holdings remain clear and snapshot evaluation cannot mutate the account',()=>{const f=fixture(),before=JSON.stringify(f.b);assert.deepEqual(hitKinds(f.candidates()),[]);assert.equal(JSON.stringify(f.b),before);assert.deepEqual(marketReviewCandidates({book:null},[]),[]);});
test('research version, changed counterevidence, archived and missing research are distinct frozen conditions',()=>{
 const f=fixture();f.t.version=2;f.t.evidence=[{id:'e',stance:'against',claim:'Synthetic risk',verification:'unverified'}];assert.deepEqual(hitKinds(f.candidates()),['research-version','counterevidence']);
 f.t.status='archived';assert(hitKinds(f.candidates()).includes('research-status'));const missing=marketReviewCandidates(f.snapshot(),[]);assert(hitKinds(missing).includes('research-status'));assert.equal(missing.find(c=>c.hit.input.reviewKind==='counterevidence').state,'unknown');
 f.t.status='active';f.b.orders[0].researchSnapshot=structuredClone(f.t);assert(!hitKinds(f.candidates()).includes('counterevidence'));f.t.evidence[0].claim='Revised risk';assert(hitKinds(f.candidates()).includes('counterevidence'));
});
test('missing and stale inputs produce review tasks and unknown risk without losing known holding deadlines',()=>{
 const f=fixture();f.b.lots[0].holdUntil=at;f.setQuotes({});const cs=f.candidates();assert.deepEqual(hitKinds(cs),['holding-review','market-input']);
 for(const kind of ['price-exit','drawdown','cash-floor','issuer-cap','theme-cap'])assert.equal(cs.find(c=>c.hit.input.reviewKind===kind).state,'unknown');
 f.setQuotes({'AAPL.US':{...f.q,asOf:'2026-10-01T14:00:00Z'}});assert(hitKinds(f.candidates()).includes('market-input'));
});
test('existing loss, trailing and pool thresholds form review tasks without executing or pausing orders',()=>{
 const f=fixture(),before=JSON.stringify(f.b);f.q.mark='85';assert(hitKinds(f.candidates()).includes('price-exit'));assert.equal(JSON.stringify(f.b),before);
 f.q.mark='110';f.b.lots[0].peakPrice='125';assert.equal(f.candidates().find(c=>c.hit.input.reviewKind==='price-exit').hit.input.metrics.alert.kind,'trailing-exit-review');
 f.b.highWaterCents=65000000;const alert=f.candidates().find(c=>c.hit.input.reviewKind==='drawdown');assert.equal(alert.state,'hit');assert.equal(alert.hit.input.metrics.alert.kind,'pool-stop');assert.equal(f.b.riskPaused,undefined);
});
test('current cross-market issuer and topic concentration plus reserved cash use existing pool limits',()=>{
 const f=fixture();f.b.config.issuerCapPct=1;f.b.config.themeCapPct=1;f.b.orders.push({id:'pending-budget',status:'approved',side:'buy',budgetCents:45000000,spentCents:0});
 assert.deepEqual(hitKinds(f.candidates()),['cash-floor','issuer-cap','theme-cap']);
 f.q.issuerId='different-issuer';assert.equal(f.candidates().find(c=>c.hit.input.reviewKind==='issuer-cap').state,'unknown');
 f.b.orders.at(-1).status='pending';assert(!hitKinds(f.candidates()).includes('cash-floor'));
});
test('sustained risks deduplicate despite fluctuating prices and complete receipts do not clear current risk',()=>{
 const f=fixture();f.q.mark='85';const {s,i,run}=inbox(f);try{assert.equal(run().added,1);const item=i.snapshot().items[0],frozen=JSON.stringify(item.input);i.respond(item.id,{revision:1,action:'complete',note:'Synthetic reviewed'});
 f.q.mark='84';assert.equal(run().added,0);assert.equal(JSON.stringify(i.snapshot().items[0].input),frozen);assert.equal(i.snapshot().items[0].state,'completed');assert(i.snapshot().marketChecks.some(c=>c.status==='hit'));assert.equal(f.b.riskPaused,undefined);
 }finally{s.close();}
});
test('observed recovery then relapse creates a new episode; unknown data does not impersonate recovery',()=>{
 const f=fixture();f.q.mark='85';const {s,i,run}=inbox(f);try{run();f.setQuotes({});run();f.setQuotes({'AAPL.US':f.q});assert.equal(run().added,0);f.q.mark='100';run();f.q.mark='85';assert.equal(run().added,1);const items=i.snapshot().items.filter(i=>i.input.reviewKind==='price-exit');assert.equal(items.length,2);assert.deepEqual(items.map(i=>i.input.episode).sort(),[1,2]);}finally{s.close();}
});
test('new research revisions, config changes and reopened lots are not suppressed by old completed tasks',()=>{
 const f=fixture();f.t.version=2;const {s,i,run}=inbox(f);try{run();const old=i.snapshot().items[0];i.respond(old.id,{revision:1,action:'complete',note:'Old version reviewed'});f.t.version=3;assert.equal(run().added,1);f.b.configVersion++;assert.equal(run().added,1);f.b.lots[0].id='lot-reopened';assert.equal(run().added,1);assert.equal(i.snapshot().items.find(x=>x.id===old.id).state,'completed');}finally{s.close();}
});
test('closed lots retire their live conditions while immutable tasks and receipts remain',()=>{
 const f=fixture();f.q.mark='85';const {s,i,run}=inbox(f);try{run();const item=i.snapshot().items[0];i.respond(item.id,{revision:1,action:'read',note:'Synthetic'});f.b.lots=[];run();assert.equal(i.snapshot().items.length,1);assert.equal(i.receipts(item.id).length,1);assert(!i.snapshot().marketChecks.some(c=>c.reason.includes('相对成交价')));}finally{s.close();}
});
test('two account identities do not collide for the same lot and research',()=>{
 const f=fixture();f.q.mark='85';const s=openStore(':memory:'),i=openObservationInbox(s,{clock:()=>at,getMarketSnapshots:()=>[f.snapshot(),{...f.snapshot(),accountId:'aggressive'}]});try{i.process([f.t],{positions:[]});assert.equal(i.snapshot().items.length,2);assert.equal(new Set(i.snapshot().items.map(x=>x.id)).size,2);assert.deepEqual(i.snapshot().items.map(x=>x.accountId).sort(),['aggressive','steady']);}finally{s.close();}
});
test('failure inserting a market task rolls back the episode and permits a complete retry',()=>{
 const f=fixture();f.q.mark='85';const {s,i,run}=inbox(f);try{s.db.exec("CREATE TRIGGER fail_market_todo BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");assert.throws(run,/synthetic write failure/);assert.equal(i.snapshot().marketChecks.length,0);s.db.exec('DROP TRIGGER fail_market_todo');assert.equal(run().added,1);assert.equal(i.snapshot().items[0].input.episode,1);}finally{s.close();}
});
test('restart retains episodes, frozen evidence, current checks and receipt history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-market-review-')),path=join(dir,'test.sqlite'),f=fixture();f.q.mark='125';let h=inbox(f,path);
 try{h.run();f.q.mark='110';h.run();const item=h.i.snapshot().items[0];h.i.respond(item.id,{revision:1,action:'complete',note:'Synthetic complete'});const before=h.i.snapshot();h.s.close();h=inbox(f,path);assert.deepEqual(h.i.snapshot(),before);assert.equal(h.run().added,0);assert.equal(h.i.receipts(item.id).length,1);}finally{h.s.close();rmSync(dir,{recursive:true,force:true});}
});
test('monitoring persists observed peaks without executing the account, then detects a later trailing decline',()=>{
 const f=fixture(),before=JSON.stringify(f.b);f.q.mark='125';const {s,i,run}=inbox(f);try{run();f.q.mark='110';assert.equal(run().added,1);const hit=i.snapshot().items.find(x=>x.input.reviewKind==='price-exit');assert.equal(hit.input.metrics.alert.kind,'trailing-exit-review');assert.equal(hit.input.metrics.recordedPeak,'125');assert.equal(JSON.stringify(f.b),before);const peaks=JSON.parse(s.db.prepare('SELECT payload FROM market_observation_peaks').get().payload);assert.equal(peaks.prices['lot-1'].price,'125');assert.equal(peaks.highWaterCents,50250000);assert.equal(peaks.prices['lot-1'].quote.mark,'125');assert.equal(peaks.navPeak.quotes['AAPL.US'].mark,'125');assert.equal(peaks.navPeak.positions[0].valueCents,1250000);}finally{s.close();}
});
test('failed task insertion also rolls monitoring peaks back, and stale clocks cannot consume conditions',()=>{
 const f=fixture();f.q.mark='2000';const {s,i,run}=inbox(f);try{s.db.exec("CREATE TRIGGER fail_peak_todo BEFORE INSERT ON observation_todos BEGIN SELECT RAISE(ABORT,'synthetic peak failure'); END");assert.throws(run,/synthetic peak failure/);assert.equal(s.db.prepare('SELECT count(*) n FROM market_observation_peaks').get().n,0);s.db.exec('DROP TRIGGER fail_peak_todo');run();const before=i.snapshot();s.db.prepare('UPDATE market_observation_peaks SET payload=json_set(payload,\'$.checkedAt\',?)').run('2026-10-03T14:00:00Z');assert.throws(run,/时钟倒退/);assert.deepEqual(i.snapshot(),before);}finally{s.close();}
});
test('multiple market symbols sharing verified issuer identity aggregate before the concentration check',()=>{
 const f=fixture(),h={...f.b.lots[0],id:'synthetic-hk-lot',symbol:'09988.HK'};f.b.lots.push(h);f.b.cashCents-=1000000;f.b.config.issuerCapPct=3;
 f.setQuotes({'AAPL.US':f.q,'09988.HK':{...f.q,id:'synthetic-hk-quote',symbol:'09988.HK',currency:'HKD'}});
 const hits=f.candidates().filter(c=>c.state==='hit'&&c.hit.input.reviewKind==='issuer-cap');assert.equal(hits.length,1);assert.equal(hits[0].hit.input.metrics.observedPct,4);assert.equal(hits[0].hit.input.lots.length,2);assert.equal(hits[0].hit.symbols.length,2);
});
