import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {marketReviewFixture} from './fixtures/market-review.mjs';
const accountRows=f=>['aggressive','steady'].map(id=>f.store.db.prepare(`SELECT payload FROM market_sim_book_${id}`).get().payload);
test('real observation scheduler inspects both simulation accounts while GET and receipts leave execution state untouched',async()=>{
 const f=marketReviewFixture();try{const before=accountRows(f);f.service.snapshot();assert.equal(f.service.observations.snapshot().items.length,0);
 f.set({price:'125'});await f.service.runOperation('observations');f.set({price:'110'});await f.service.runOperation('observations');
 let items=f.service.observations.snapshot().items;assert.equal(items.length,2);assert(items.every(i=>i.input.reviewKind==='price-exit'));assert.equal(new Set(items.map(i=>i.accountId)).size,2);assert.deepEqual(accountRows(f),before);
 for(const item of items)f.service.observations.respond(item.id,{revision:1,action:'complete',note:'Synthetic review only'});
 await f.service.runOperation('observations');assert.equal(f.service.observations.snapshot().pending,0);assert.deepEqual(accountRows(f),before);assert.equal(f.service.observations.snapshot().marketChecks.filter(c=>c.status==='hit').length,2);
 }finally{await f.close();}
});
test('paused or recovery-gated observation task cannot consume market risks',async()=>{
 const f=marketReviewFixture();try{f.set({price:'80'});f.service.controlOperation('observations','pause');assert.throws(()=>f.service.runOperation('observations'),/暂停/);assert.equal(f.service.observations.snapshot().items.length,0);
 f.store.db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1')").run();assert.throws(()=>f.service.runOperation('observations'),/恢复/);assert.equal(f.service.observations.snapshot().marketChecks.length,0);
 }finally{await f.close();}
});
test('market observation details render safe frozen inputs, account identity, unknown status and no phantom research version',async()=>{
 const f=marketReviewFixture(),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{f.set({missing:true});await f.service.runOperation('observations');const {default:Inbox}=await vite.ssrLoadModule('/src/integrated/ObservationInbox.jsx');
 const html=renderToStaticMarkup(React.createElement(Inbox,{data:f.service.snapshot()}));assert.match(html,/双策略持仓巡检状态/);assert.match(html,/稳健长期池/);assert.match(html,/无法判断/);assert.match(html,/查看策略池巡检依据/);assert.doesNotMatch(html,/vnull/);assert.match(html,/不执行交易/);
 const {default:Details}=await vite.ssrLoadModule('/src/integrated/MarketObservationDetails.jsx');const input=f.service.observations.snapshot().items[0].input;input.evidence=[{id:'escape',claim:'<script>bad</script>',verification:'unverified'}];const safe=renderToStaticMarkup(React.createElement(Details,{input}));assert.match(safe,/&lt;script&gt;/);assert.doesNotMatch(safe,/<script>/);
 }finally{await vite.close();await f.close();}
});
test('existing order risk checks honor monitoring peaks even when the execution ledger has not advanced',async()=>{
 const f=marketReviewFixture();try{
 f.set({price:'125'});await f.service.runOperation('observations');f.set({price:'110'});await f.service.runOperation('observations');
 const sim=f.service.marketSimulations.steady;sim.propose({version:sim.snapshot().version,requestId:crypto.randomUUID(),order:{topicId:f.topic.id,topicVersion:f.topic.version,symbol:'AAPL.US',side:'buy',qty:1,limitPrice:'111',budgetUSD:120,expiresAt:'2026-10-02T14:10:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic follow-up',trigger:'Fixture',invalidation:'Fixture'}});
 assert.match(sim.review(sim.snapshot().orders.at(-1).id).reasons.join(';'),/退出或到期复核/);
 assert.equal(sim.snapshot().lots[0].peakPrice,'100.050000');assert(sim.snapshot().strategyRisk.alerts.some(a=>a.kind==='trailing-exit-review'));
 }finally{await f.close();}
});
test('approval fingerprints bind observed peaks even when quotes and ledger versions are unchanged',async()=>{
 const f=marketReviewFixture();try{const sim=f.service.marketSimulations.steady;
 sim.propose({version:sim.snapshot().version,requestId:crypto.randomUUID(),order:{topicId:f.topic.id,topicVersion:f.topic.version,symbol:'AAPL.US',side:'buy',qty:1,limitPrice:'101',budgetUSD:110,expiresAt:'2026-10-02T14:10:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic fingerprint',trigger:'Fixture',invalidation:'Fixture'}});
 const order=sim.snapshot().orders.at(-1),before=sim.review(order.id);assert(before.eligible);
 f.set({price:'110'});await f.service.runOperation('observations');f.set({price:'100'});const after=sim.review(order.id);assert(after.eligible);assert.deepEqual(before.evidence.quotes,after.evidence.quotes);assert.equal(before.evidence.bookVersion,after.evidence.bookVersion);assert.notEqual(before.fingerprint,after.fingerprint);
 assert.throws(()=>sim.decide(order.id,{version:sim.snapshot().version,requestId:crypto.randomUUID(),action:'approve',note:'Stale synthetic review',confirmSimulation:true,fingerprint:before.fingerprint}));assert.equal(sim.snapshot().orders.at(-1).status,'pending');
 }finally{await f.close();}
});
