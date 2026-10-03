import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crossThemeCandidates} from '../server/cross-theme-observations.mjs';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {valuation} from '../server/market-sim-risk.mjs';
import {strategyRisk} from '../server/strategy-risk.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
const at='2026-10-02T14:00:00Z';
function fixture(){
 const topics=['a','b'].map(id=>({id,title:'虚构主题 '+id,version:1,status:'active',evidence:[],claims:[],hypothesis:{},companies:[{symbol:'AAPL.US'}]}));
 const quote={symbol:'AAPL.US',currency:'USD',id:'synthetic-q',source:'synthetic-only',kind:'market-simulation-input',verified:true,rulesVersion:'test',issuerId:'synthetic-issuer',asOf:at,receivedAt:at,validUntil:'2026-10-02T14:01:00Z',bid:'100',ask:'100',mark:'100',fx:{id:'synthetic-fx',source:'synthetic-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-02T14:01:00Z'}};
 const books=topics.map((t,i)=>({accountId:i?'steady':'aggressive',profile:strategyProfiles.steady,version:1,configVersion:1,config:structuredClone(strategyProfiles.steady.suggestedConfig),initialCents:50000000,cashCents:49990000,highWaterCents:50000000,lots:[{id:'same-id',topicId:t.id,topicVersion:1,symbol:'AAPL.US',issuerId:quote.issuerId,qty:1,costCents:10000,openedAt:at,holdUntil:'2026-10-03T14:00:00Z',entryPrice:'100'}],orders:[],fills:[],unsettled:[],feesCents:0,realizedCents:0}));
 const cluster={id:'synthetic-cluster',version:1,title:'共同虚构事件',status:'active',health:{current:true,reason:'合成成员匹配'},bindingCurrent:true,matchedMembers:[]};
 let missing=false;const snapshots=()=>books.map(book=>{const quotes=missing?{}:{'AAPL.US':quote};return {accountId:book.accountId,book,quotes,at,valuation:valuation(book,quotes,at),risk:strategyRisk(book,quotes,at)};});
 return {topics,quote,books,cluster,snapshots,missing:v=>missing=v,clusters:()=>[structuredClone(cluster)]};
}
const overlaps=cs=>cs.filter(c=>c.hit);
test('overlap joins distinct topics across pools without merging accounts or double-counting a lot',()=>{
 const f=fixture(),before=JSON.stringify(f.books),hits=overlaps(crossThemeCandidates(f.snapshots(),f.topics,f.clusters));assert.equal(hits.length,2);
 for(const c of hits){assert.equal(c.state,'hit');assert.equal(c.hit.input.metrics.valueCents,20000);assert.equal(c.hit.input.metrics.accountCount,2);assert.equal(c.hit.input.metrics.topicCount,2);assert.equal(new Set(c.hit.input.entries.map(e=>e.key)).size,2);}
 assert.equal(JSON.stringify(f.books),before);f.books[1].lots[0].topicId='a';assert.equal(overlaps(crossThemeCandidates(f.snapshots(),f.topics,f.clusters)).length,0);
});
test('approved and partially filled buys include only remaining quantity; pending, sell and cancelled orders excluded',()=>{
 const f=fixture();f.books[1].lots=[];const order={id:'order',topicId:'b',symbol:'AAPL.US',side:'buy',status:'partial',qty:10,filledQty:4,budgetCents:100000,spentCents:40000};f.books[1].orders=[order,{...order,id:'pending',status:'pending'},{...order,id:'sell',side:'sell'},{...order,id:'cancelled',status:'cancelled'}];
 const hit=overlaps(crossThemeCandidates(f.snapshots(),f.topics))[0].hit;assert.equal(hit.input.metrics.valueCents,70000);assert.equal(hit.input.metrics.buyOrderCount,1);assert.equal(hit.input.entries[1].qty,6);
});
test('stale issuer input does not change a filled issuer, and unknown valuations are never zero',()=>{
 const f=fixture();f.missing(true);let cs=overlaps(crossThemeCandidates(f.snapshots(),f.topics,f.clusters));assert.equal(cs.find(c=>c.hit.input.groupKind==='issuer').state,'unknown');const cluster=cs.find(c=>c.hit.input.groupKind==='event-cluster');assert.equal(cluster.state,'hit');assert.equal(cluster.hit.input.metrics.valueCents,null);
 f.missing(false);f.quote.issuerId='changed-issuer';cs=overlaps(crossThemeCandidates(f.snapshots(),f.topics));assert.equal(cs[0].hit.input.groupId,'synthetic-issuer');assert.equal(cs[0].state,'unknown');
});
test('stale or historical cluster bindings stay unknown; ungrouped topics never imply independence',()=>{
 const f=fixture();for(const change of [{health:{current:false}},{bindingCurrent:false},{status:'archived'}]){const cs=overlaps(crossThemeCandidates(f.snapshots(),f.topics,()=>[{...f.cluster,...change}]));assert.equal(cs.find(c=>c.hit.input.groupKind==='event-cluster').state,'unknown');}
 assert.match(crossThemeCandidates(f.snapshots(),f.topics).at(-1).reason,/不覆盖未识别/);
});
test('persisted episodes retain receipts and original records across unknown inputs, source changes and restart',()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),'cross-theme-')),path=join(dir,'test.sqlite');let s=openStore(path),inbox;
 const start=()=>inbox=openObservationInbox(s,{clock:()=>at,getMarketSnapshots:f.snapshots,clustersForTopic:f.clusters});const run=()=>inbox.process(f.topics,{positions:[]});start();
 try{run();const item=inbox.snapshot().items.find(i=>i.kind==='cross-theme-review'&&i.input.groupKind==='issuer'),frozen=JSON.stringify(item.input);inbox.respond(item.id,{revision:1,action:'complete',note:'Synthetic review'});assert.equal(run().added,0);f.missing(true);run();f.missing(false);assert.equal(run().added,0);assert.equal(JSON.stringify(inbox.snapshot().items.find(i=>i.id===item.id).input),frozen);
 s.close();s=openStore(path);start();assert.equal(inbox.receipts(item.id).length,1);assert.equal(run().added,0);f.topics[1].version++;run();assert.equal(inbox.snapshot().items.filter(i=>i.kind==='cross-theme-review'&&i.input.groupKind==='issuer').length,2);assert.equal(inbox.snapshot().items.find(i=>i.id===item.id).state,'completed');f.books.forEach(b=>b.lots=[]);run();assert(!inbox.snapshot().marketChecks.some(c=>c.accountId==='cross-theme'));assert.equal(inbox.receipts(item.id).length,1);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed insertion rolls back all cross-theme episode consumption and retry produces both conditions',()=>{
 const f=fixture(),s=openStore(':memory:'),inbox=openObservationInbox(s,{clock:()=>at,getMarketSnapshots:f.snapshots,clustersForTopic:f.clusters});try{
 s.db.exec("CREATE TRIGGER reject_cross BEFORE INSERT ON observation_todos WHEN json_extract(NEW.payload,'$.kind')='cross-theme-review' BEGIN SELECT RAISE(ABORT,'synthetic cross failure'); END");assert.throws(()=>inbox.process(f.topics,{positions:[]}),/synthetic cross failure/);assert.equal(inbox.snapshot().marketChecks.length,0);s.db.exec('DROP TRIGGER reject_cross');inbox.process(f.topics,{positions:[]});assert.equal(inbox.snapshot().items.filter(i=>i.kind==='cross-theme-review').length,2);
 }finally{s.close();}
});
test('losing the quote identity of a working buy cannot retire or rearm its previous overlap episode',()=>{
 const f=fixture();f.books[1].lots=[];f.books[1].orders=[{id:'pending-fill',topicId:'b',symbol:'AAPL.US',side:'buy',status:'approved',qty:1,filledQty:0,budgetCents:11000,spentCents:0}];
 const s=openStore(':memory:'),inbox=openObservationInbox(s,{clock:()=>at,getMarketSnapshots:f.snapshots});const run=()=>inbox.process(f.topics,{positions:[]});
 try{run();const item=inbox.snapshot().items.find(i=>i.kind==='cross-theme-review');assert(item);f.missing(true);run();assert(inbox.snapshot().marketChecks.some(c=>c.accountId==='cross-theme'&&c.active&&c.status==='unknown'));f.missing(false);run();assert.equal(inbox.snapshot().items.filter(i=>i.kind==='cross-theme-review').length,1);assert.equal(inbox.snapshot().items.find(i=>i.id===item.id).input.episode,1);}finally{s.close();}
});
