import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openExecutionInputs} from '../server/execution-inputs.mjs';
import {createService} from '../server/service.mjs';
import {actualReferenceValuation} from '../server/actual-valuation.mjs';
import {projectActualAccounts} from '../server/actual-holdings.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';

const at='2026-10-06T14:00:00.000Z';
const row={account:'Synthetic A',symbol:'AAPL.US',quantity:'1.5',unitCost:'90',price:'80',asOf:'2026-10-06T13:59:00Z',source:'Synthetic manual record',feeBasis:'included'};
const record={...row,currency:'USD',id:'fixture-record',version:1};
function fixture(run){const f=executionFeedFixture(),store=openStore(':memory:');try{
 f.write([f.quote(at),f.quote(at,{mark:'80'},'00700.HK')]);const feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(at)});assert.equal(feed.refresh().accepted,2);
 return run({f,store,feed,inputs:feed.inputs()});
}finally{store.close();f.close();}}
test('qualified mark uses exact fractional quantity, native currency and original cost without modifying records',()=>fixture(({inputs})=>{
 const before=structuredClone(record),v=actualReferenceValuation(record,{at,inputs});assert.equal(v.state,'available');assert.equal(v.valueCents,15000);assert.equal(v.unrealizedCents,1500);assert.equal(v.price,'100');assert.equal(v.provenance.frameHash,inputs.frameHash);assert.equal(v.provenance.quoteHash.length,64);assert.deepEqual(record,before);
 const zero=actualReferenceValuation({...record,unitCost:'0'},{at,inputs});assert.equal(zero.unrealizedCents,15000);assert.equal(zero.returnPct,null);
 const unknown=actualReferenceValuation({...record,unitCost:null},{at,inputs});assert.equal(unknown.valueCents,15000);assert.equal(unknown.unrealizedCents,null);
}));
test('public close caches, arbitrary simulation adapters and malformed identity never qualify as actual reference inputs',()=>fixture(({inputs})=>{
 for(const change of [{executionFeed:false},{provenance:{}},{symbol:'MSFT.US'},{currency:'HKD'},{verified:false},{kind:'bar-close-research-only'},{mark:'1.1234567'},{authorization:{}},{authorization:{...inputs.quotes['AAPL.US'].authorization,validUntil:'2026-10-06T13:59:00Z'}}]){
  const packet=structuredClone(inputs);Object.assign(packet.quotes['AAPL.US'],change);const v=actualReferenceValuation(record,{at,inputs:packet});assert.equal(v.state,'unavailable',JSON.stringify(change));assert.equal(v.price,null);assert.equal(v.unrealizedCents,null);assert.equal(v.provenance,null);
 }
 const missing=actualReferenceValuation(record,{at});assert.equal(missing.valueCents,null);assert.equal(missing.price,null);
}));
test('expiry, future input, quote before quantity snapshot, clock rollback and unsafe arithmetic fail closed',()=>fixture(({inputs})=>{
 for(const [r,now] of [[record,'2026-10-06T14:01:00.001Z'],[record,'2026-10-06T13:59:59Z'],[{...record,asOf:'2026-10-06T14:00:00.001Z'},'2026-10-06T14:00:00.002Z'],[{...record,quantity:'99999999999'},at]]){
  const p=structuredClone(inputs);if(r.quantity==='99999999999')p.quotes['AAPL.US'].mark='99999999999';
  const v=actualReferenceValuation(r,{at:now,inputs:p});assert.equal(v.state,'unavailable');assert.equal(v.valueCents,null);
 }
 assert.equal(actualReferenceValuation(record,{at:'2026-10-06T14:01:00Z',inputs}).state,'available');
}));
test('pause, failure and restoration immediately hide current values without erasing source records',()=>fixture(({inputs})=>{
 for(const state of [{operation:{paused:true}},{operation:{blocked:true}},{operation:{outcome:'error'}},{restorePending:true}])assert.equal(actualReferenceValuation(record,{at,inputs,...state}).state,'unavailable');
 assert.equal(actualReferenceValuation(record,{at,inputs,operation:{paused:false,outcome:'ok'}}).state,'available');
}));
test('account projections never mix record-time prices with current marks or FX, and retain original snapshots',()=>fixture(({inputs})=>{
 const records=[record,{...record,id:'hk',symbol:'00700.HK',currency:'HKD'},{...record,id:'other',account:'Synthetic B'}];
 const accounts=projectActualAccounts({records,version:1},[],at,{}, {inputs});assert.equal(accounts.length,3);
 const us=accounts.find(a=>a.positions[0].recordId==='fixture-record'),hk=accounts.find(a=>a.currency==='HKD');assert.equal(us.floatingProfitCents,1500);assert.equal(hk.floatingLossCents,-1500);assert.equal(us.positions[0].recordValuation.unrealizedCents,-1500);
 assert.equal(us.navCents,null);assert.equal(us.realizedCents,null);assert.equal(us.maxDrawdownPct,null);assert.equal(us.dailyPnlCents,null);
 const partial=projectActualAccounts({records:[record,{...record,id:'missing',symbol:'MSFT.US'}],version:1},[],at,{}, {inputs})[0];assert.equal(partial.floatingProfitCents,null);assert.equal(partial.valuedPositions,1);assert.match(partial.positions[1].referenceValuation.issues[0],/缺少 MSFT.US/);assert.equal(partial.recordValuation.floatingLossCents,-3000);
}));
test('current price range is explicit and old quantity record times cannot masquerade as a broker account baseline',()=>fixture(({inputs})=>{
 const second={...record,id:'second',symbol:'MSFT.US',asOf:'2026-10-06T13:00:00Z'},p=structuredClone(inputs);
 p.quotes['MSFT.US']={...p.quotes['AAPL.US'],symbol:'MSFT.US',asOf:'2026-10-06T21:59:50+08:00'};
 const a=projectActualAccounts({records:[record,second],version:1},[],at,{}, {inputs:p})[0];assert.equal(a.floatingProfitCents,3000);assert.deepEqual(a.priceTimeRange,['2026-10-06T21:59:50+08:00',at]);assert.equal(a.recordValuation.unrealizedCents,null);assert.match(a.recordValuation.issue,/时间不一致/);
}));
test('service reads only the qualified private bridge; resume, fresh frame, stale frame and restore preserve holdings and books',async()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');let now=Date.parse(at);const service=createService(store,{mode:'research',executionConfig:f.config,now:()=>now,fetcher:()=>{throw Error('No network in synthetic test');}});
 try{
  for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');
  const p=service.actualHoldings.preview({rows:[row]});service.actualHoldings.apply({id:p.id,hash:p.hash});f.write([f.quote(at)]);service.executionInputs.refresh();
  const account=()=>service.snapshot().overview.accounts.find(a=>a.kind==='actual');assert.equal(account().positions[0].price,null);
  service.controlOperation('execution','resume');const before=store.db.prepare('SELECT total_changes() n').get().n,history=service.actualHoldings.history(service.actualHoldings.snapshot().records[0].id),books=Object.values(service.marketSimulations).map(m=>m.snapshot());
  assert.equal(account().positions[0].price,'100');assert.equal(account().floatingProfitCents,1500);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  now+=61000;assert.equal(account().positions[0].price,null);assert.equal(account().positions[0].recordValuation.price,'80');
  f.write([f.quote(new Date(now).toISOString(),{mark:'95'})]);service.executionInputs.refresh();assert.equal(account().floatingProfitCents,750);
  store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal(account().positions[0].price,null);assert.deepEqual(service.actualHoldings.history(history[0].id),history);assert.deepEqual(Object.values(service.marketSimulations).map(m=>m.snapshot()),books);
 }finally{await service.close();store.close();f.close();}
});
test('source rejection and expired permissions remove current reference valuation rather than reusing the last accepted frame',()=>fixture(({f,feed})=>{
 f.write([{symbol:'AAPL.US'}]);feed.refresh();const v=actualReferenceValuation(record,{at,inputs:feed.inputs()});assert.equal(v.state,'unavailable');assert.equal(v.price,null);
}));
