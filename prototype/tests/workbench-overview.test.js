import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkbenchOverview} from '../shared/workbench-overview.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';

const at='2026-10-08T08:00:00Z';
const topic={id:'one',status:'active',version:2,title:'Synthetic research',updatedAt:at,companies:[{symbol:'AAPL.US',name:'Fixture company'}],hypothesis:{action:'observe',holdingHorizon:'Review after evidence',invalidation:'Thesis fails',reviewAt:'2026-10-09T08:00:00Z'}};
const lot={id:'lot-1',topicId:'one',topicVersion:2,symbol:'AAPL.US',qty:10,costCents:100000,valueCents:101000,unrealizedCents:1000};
const order={id:'order-1',topicId:'one',topicVersion:2,configVersion:3,symbol:'AAPL.US',side:'buy',qty:10,status:'pending',createdAt:at,expiresAt:'2026-10-08T09:00:00Z'};
const state=(id='aggressive')=>({accountId:id,book:{version:1,configVersion:3,orders:[order]},valuation:{positions:[lot],navCents:201000,realizedCents:0,feesCents:20},risk:{drawdownPct:2,alerts:[]},quotes:{'AAPL.US':{mark:101,currency:'USD',asOf:at,source:'Synthetic execution fixture'}}});
const project=extra=>buildWorkbenchOverview({at,topics:[topic],...extra});
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const value of Object.values(v))freeze(value);}return v;}

test('read-only projection preserves source objects, account identity and integer units',()=>{
 const a=state(),s=state('steady');s.valuation.positions=[{...lot,unrealizedCents:-2000,valueCents:98000}];
 const input=freeze({marketAccounts:[a,s],paper:{version:2,nav:100,realized:2.01,fees:.04,positions:[{symbol:'AAPL.US',topicId:'one',researchVersion:1,lifecycleId:'paper-1',costUSD:12.34,valueUSD:13.57,unrealized:1.23,returnPct:9.96,scenarioPrice:1.357}]}});
 const before=JSON.stringify(input),result=project(input);
 assert.equal(JSON.stringify(input),before);assert.equal(result.accounts.length,3);
 assert.equal(new Set(result.accounts.flatMap(a=>a.positions.map(p=>p.id))).size,3);
 assert.equal(result.accounts[0].floatingProfitCents,1000);assert.equal(result.accounts[0].floatingLossCents,0);
 assert.equal(result.accounts[1].floatingLossCents,-2000);assert.equal(result.accounts[1].floatingProfitCents,0);
 assert.equal(result.accounts[2].positions[0].costCents,1234);assert.equal(result.accounts[2].unrealizedCents,123);
 assert.equal(result.accounts[2].realizedCents,201);assert.equal(result.accounts[2].kind,'scenario');
 assert.equal(result.accounts[0].currentDrawdownPct,2);assert.equal(result.accounts[0].maxDrawdownPct,null);
 assert.equal(result.accounts[0].dailyPnlCents,null);assert.equal(result.accounts[2].currentDrawdownPct,null);
});

test('uninitialized, partially valued and malformed inputs never masquerade as zero or fresh prices',()=>{
 const a=state();a.valuation.positions.push({...lot,id:'lot-2',valueCents:null,unrealizedCents:null});a.valuation.navCents=null;
 const output=project({marketAccounts:[a,{accountId:'steady',book:null}]}),[partial,empty]=output.accounts;
 assert.equal(partial.valuedPositions,1);assert.equal(partial.navCents,null);assert.equal(partial.unrealizedCents,null);assert.equal(partial.floatingProfitCents,null);assert.equal(partial.floatingLossCents,null);
 assert.equal(partial.positions[1].price,null,'a stale raw quote cannot become a valid display mark');assert(partial.positions[1].risks.some(r=>r.includes('过期')));
 assert.equal(empty.configured,false);assert.equal(empty.navCents,null);assert.equal(empty.realizedCents,null);assert.equal(empty.unrealizedCents,null);
 delete a.valuation.positions[1].unrealizedCents;delete a.valuation.positions[1].valueCents;
 const malformed=project({marketAccounts:[a]}).accounts[0];assert.equal(malformed.valuedPositions,1);assert.equal(malformed.positions[1].price,null);assert.equal(malformed.positions[1].returnPct,null);
 assert.throws(()=>project({at:'bad timestamp'}),/时间无效/);
});

test('only unexpired current-version pending requests appear; reading never cancels historical requests',()=>{
 const a=state();a.book.orders=[order,...[
  {id:'expired',expiresAt:at},{id:'unknown-expiry',expiresAt:null},{id:'stale',stale:true},{id:'old-topic',topicVersion:1},{id:'old-config',configVersion:2},{id:'filled',status:'filled'},{id:'orphan',topicId:'missing'}
 ].map(p=>({...order,...p})),{...order,id:'exit',side:'sell'}];
 const before=structuredClone(a),output=project({marketAccounts:[a]});
 assert.deepEqual(output.decisions.map(d=>d.orderId),['exit','order-1']);assert.deepEqual(a,before);
 assert.equal(project({topics:[{...topic,status:'archived'}],marketAccounts:[a]}).decisions.length,0);
});

test('all-account risks, monitoring and task activity remain global regardless of event ordering',()=>{
 const a=state(),s=state('steady');a.risk.alerts=[{key:'account-risk',message:'Account level drawdown'},{key:'lot-risk',lotId:lot.id,symbol:lot.symbol,message:'Exit condition'}];
 s.valuation.positions=[{...lot,topicVersion:1}];
 const output=project({topics:[{...topic,id:'unrelated',companies:[],updatedAt:'2026-10-09T08:00:00Z'},topic],marketAccounts:[a,s],operations:{news:{running:true,lastSuccessAt:at,nextRunAt:'2026-10-08T08:05:00Z'},model:{blocked:true,paused:false}}});
 assert.equal(output.risks.length,3);assert.equal(output.events[0].id,'one');assert.equal(output.monitoring.length,2);
 assert.equal(output.activity.state,'running');assert.deepEqual(output.activity.blocked,['model']);assert.equal(output.activity.latestTask,'news');
 assert.equal(project({operations:{news:{paused:true}}}).activity.state,'paused');
 assert.equal(project({operations:{news:{blocked:true}}}).activity.state,'degraded');
});

test('repeated real service snapshots do not write any database row or alter ledger/history versions',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'demo',now:()=>Date.parse(at),fetcher:()=>{throw Error('No external input in projection test');}});
 try{
  const writes=()=>store.db.prepare('SELECT total_changes() n').get().n;
  const before=writes(),first=service.snapshot(),second=service.snapshot();
  assert.equal(writes(),before);assert.deepEqual(second.overview,first.overview);assert.deepEqual(second.paper,first.paper);
  assert.equal(first.overview.defaultAccount,'scenario');assert(first.overview.accounts.find(a=>a.id==='scenario').positions.length>0);
  assert(first.overview.accounts.filter(a=>a.kind==='market-simulation').every(a=>!a.configured&&a.navCents===null));
 }finally{await service.close();store.close();}
});
