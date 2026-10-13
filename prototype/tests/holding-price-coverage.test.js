import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {openHoldingPriceScope} from '../server/holding-price-scope.mjs';
import {marketReviewFixture} from './fixtures/market-review.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

const instant='2026-10-02T14:00:00.000Z';
const holding=(extra={})=>({account:'Synthetic only',symbol:'NVDA.US',quantity:'1',unitCost:'90',price:'100',asOf:instant,source:'Synthetic fixture',feeBasis:'included',topicId:'',topicVersion:'',...extra});
function setup(path=':memory:',intercept){
 const store=openStore(path);let at=instant;const requests=[];
 const fetcher=async url=>{requests.push(String(url));const u=new URL(url);if(u.hostname!=='query1.finance.yahoo.com')return Response.json({data:null});const code=decodeURIComponent(u.pathname.split('/').at(-1)),daily=u.searchParams.get('interval')==='1d';return Response.json({chart:{result:[{meta:{symbol:code,currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:daily?'1d':'1m'},timestamp:[Date.parse(daily?'2026-10-01T13:30:00Z':at)/1000],indicators:{quote:[{close:[101],volume:[100]}]}}]}});};
 const service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:async(u,o)=>{await intercept?.(u,o);return fetcher(u,o);}});
 for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');
 const save=rows=>{const p=service.actualHoldings.preview({rows:Array.isArray(rows)?rows:[rows]});assert(p.canApply);service.actualHoldings.apply({id:p.id,hash:p.hash});};
 return {store,service,requests,save,setAt:v=>at=v,async close(){await service.close();store.close();}};
}
test('full visible watchlist does not leave a held security without daily or minute collection',async()=>{
 const f=setup();try{
  for(let n=0;n<40;n++)f.store.addWatch(`F${n}.US`);f.save(holding());f.service.syncWatches();
  const account=JSON.stringify(f.store.db.prepare('SELECT * FROM actual_holding_records').all());
  for(const lane of ['daily','minutes']){f.service.controlOperation(lane,'resume');await f.service.runOperation(lane);}
  assert(f.store.daily('NVDA.US'),'Held symbol must be included without freeing a watch slot');
  assert(f.store.quote('NVDA.US'),'Held symbol must get minute observations');
  assert.equal(f.store.watchlist().length,40);assert(!f.store.watchlist().some(w=>w.symbol==='NVDA.US'));
  assert.equal(f.service.actualHoldings.snapshot().watching[0].state,'watching');
  const before=f.store.db.prepare('SELECT total_changes() n').get().n,snapshot=f.service.snapshot();assert.equal(snapshot.holdingPrices.find(w=>w.symbol==='NVDA.US').daily.lastDate,'2026-10-01');assert(snapshot.dataCapabilities.find(c=>c.symbol==='NVDA.US').minutes.available);assert.equal(snapshot.watchlist.length,40);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
  const calls=f.requests.filter(u=>new URL(u).searchParams.get('interval')==='1d');assert.equal(calls.length,40);
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT * FROM actual_holding_records').all()),account);
 }finally{await f.close();}
});
test('bounded rounds cover every holding and watch, deduplicate accounts and persist independent cursors',()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-price-scope-')),path=join(dir,'test.sqlite');let store=openStore(path);
 try{
  for(let n=0;n<40;n++)store.addWatch(`W${n}.US`);
  const held=Array.from({length:85},(_,n)=>`H${String(n).padStart(3,'0')}.US`),symbols=()=>[...held,...held];
  let scope=openHoldingPriceScope(store,{enabled:true,holdingSymbols:symbols,clock:()=>instant});
  const a=scope.batch('daily'),m=scope.batch('minutes');assert.deepEqual(a,m);assert(a.every(x=>held.includes(x.symbol)));
  store.close();store=openStore(path);scope=openHoldingPriceScope(store,{enabled:true,holdingSymbols:symbols,clock:()=>instant});
  const b=scope.batch('daily'),c=scope.batch('daily'),d=scope.batch('daily');
  assert([a,b,c,d].every(x=>x.length===40));assert.equal(new Set([...a,...b,...c,...d].map(x=>x.symbol)).size,125);
  const before=store.db.prepare('SELECT total_changes() n').get().n;scope.states();scope.allows(held[0]);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  assert.throws(()=>scope.batch('daily',held),/最多40/);assert.equal(store.watchlist().length,40);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('manual removal survives new research and accounts, restart and background holdings; explicit add resumes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-price-optout-')),path=join(dir,'test.sqlite');let f=setup(path);
 try{
  f.save(holding());f.service.syncWatches();f.store.removeWatch('nvda.us');
  f.save(holding({account:'Second synthetic account'}));let t=f.service.research.create({title:'Synthetic new relation',summary:'Synthetic'});f.service.research.addCompany(t.id,{version:t.version,symbol:'NVDA.US',note:'Synthetic'});f.service.syncWatches();
  assert(!f.store.watchlist().some(w=>w.symbol==='NVDA.US'));assert(f.service.actualHoldings.snapshot().watching.every(w=>w.state==='removed'));
  f.service.controlOperation('daily','resume');await assert.rejects(f.service.refreshDaily('NVDA.US'),/仅获取/);assert.equal(f.requests.length,0);
  await f.close();f=setup(path);f.service.syncWatches();assert(!f.store.watchlist().some(w=>w.symbol==='NVDA.US'));
  f.store.addWatch('NVDA.US');f.service.controlOperation('daily','resume');assert.deepEqual(await f.service.refreshDaily('NVDA.US'),{ok:true});assert(f.store.daily('NVDA.US'));
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('older missing watch links are preserved as manual removals before automatic synchronization',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-price-legacy-')),path=join(dir,'test.sqlite');let f=setup(path);
 try{
  f.save(holding());f.service.syncWatches();f.store.db.prepare('DELETE FROM watches WHERE symbol=?').run('NVDA.US');assert.equal(f.store.watchRemoved('NVDA.US'),false);
  const history=f.store.db.prepare('SELECT * FROM actual_holding_records').all();await f.close();f=setup(path);
  assert(f.store.watchRemoved('NVDA.US'));assert.deepEqual(f.store.db.prepare('SELECT * FROM actual_holding_records').all(),history);
  f.save(holding({account:'New synthetic account'}));f.service.syncWatches();assert(!f.store.watchlist().some(w=>w.symbol==='NVDA.US'));
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('simulation holdings enter research price scope without mutating books or using research prices for execution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-price-sim-')),path=join(dir,'test.sqlite');const seed=marketReviewFixture(path);await seed.close();const f=setup(path);
 try{
  // No explicit sync runs in this fixture before the real fill. The new service
  // may register known associations; fill remaining slots and use an unlisted lot.
  const sim=f.service.marketSimulations.steady,book=f.store.db.prepare('SELECT payload FROM market_sim_book_steady').get().payload;
  f.store.db.prepare('DELETE FROM watches WHERE symbol=?').run('AAPL.US');f.store.db.prepare('DELETE FROM research_watch_links WHERE symbol=?').run('AAPL.US');
  for(let n=0;f.store.watchlist().length<40;n++)f.store.addWatch(`W${n}.US`);
  f.service.controlOperation('daily','resume');await f.service.runOperation('daily');assert(f.store.daily('AAPL.US'));
  assert.equal(f.store.db.prepare('SELECT payload FROM market_sim_book_steady').get().payload,book);
  assert.equal(sim.snapshot().positions[0].valueCents,null);assert.equal(f.service.executionInputs.status().configured,false);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('paused or restore-gated lanes do not select batches, fetch or advance cursors',async()=>{
 const f=setup();try{f.save(holding());const before=f.store.db.prepare('SELECT * FROM price_scope_cursors').all();assert.throws(()=>f.service.runOperation('daily'),/暂停/);assert.deepEqual(f.store.db.prepare('SELECT * FROM price_scope_cursors').all(),before);
  f.service.controlOperation('daily','resume');f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.service.runOperation('daily'),/恢复/);await f.service.tick();assert.equal(f.requests.length,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM price_scope_cursors').all(),before);
 }finally{await f.close();}
});
test('closing or removing a background holding while reading suppresses late caches and further fallback requests',async()=>{
 for(const action of ['close','remove'])for(const lane of ['daily','minutes']){
  let release,arrived;const wait=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);let count=0;
  const f=setup(':memory:',async()=>{count++;arrived();await gate;});
  try{
   for(let n=0;n<40;n++)f.store.addWatch(`W${n}.US`);f.save(holding());f.service.controlOperation(lane,'resume');
   const task=lane==='daily'?f.service.refreshDaily('NVDA.US'):f.service.refreshQuote('NVDA.US');await wait;
   if(action==='close')f.save(holding({quantity:'0',reason:'Synthetic close'}));else f.store.removeWatch('NVDA.US');release();await task;
   assert.equal(f.store.daily('NVDA.US'),null);assert.equal(f.store.quote('NVDA.US'),null);assert.equal(count,1,'No next primary or fallback request after scope removal');
   assert.equal(f.store.checks()[lane==='daily'?'daily:NVDA.US':'NVDA.US'],undefined);
  }finally{release();await f.close();}
 }
});
test('holding price observations activate the existing risk rule while account history and recorded prices remain unchanged',async()=>{
 const f=setup();try{
  for(let n=0;n<40;n++)f.store.addWatch(`W${n}.US`);let t=f.service.research.create({title:'Synthetic held price rule',summary:'Synthetic'});t=f.service.research.addCompany(t.id,{version:t.version,symbol:'NVDA.US',note:'Synthetic'});
  f.save(holding({topicId:t.id,topicVersion:t.version}));f.service.syncWatches();const rows=f.store.db.prepare('SELECT * FROM actual_holding_records').all();
  f.service.observations.rules.create(t.id,{topicVersion:t.version,clientId:'held-price-only',label:'Synthetic price limit',join:'all',conditions:[{type:'price',symbol:'NVDA.US',interval:'1m',operator:'gte',value:100}]});
  for(const lane of ['minutes','observations'])f.service.controlOperation(lane,'resume');await f.service.runOperation('minutes');await f.service.runOperation('observations');
  const check=f.service.observations.summary().actualChecks.find(c=>c.ruleId);assert.equal(check.status,'hit');assert.equal(check.details.results[0].input.price,101);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM actual_holding_records').all(),rows);
  f.service.controlOperation('minutes','pause');await f.service.runOperation('observations');const unknown=f.service.observations.summary().actualChecks.find(c=>c.ruleId);assert.equal(unknown.status,'unknown');assert.equal(unknown.active,true);
 }finally{await f.close();}
});
test('manual watch changes are atomic and an automatic re-registration cannot erase explicit opt-out',()=>{
 const s=openStore(':memory:');try{s.addWatch('NVDA.US');s.db.exec("CREATE TRIGGER deny_removal BEFORE INSERT ON watch_removals BEGIN SELECT RAISE(ABORT,'fixture write failure'); END");assert.throws(()=>s.removeWatch('NVDA.US'),/fixture write failure/);assert(s.watchlist().some(w=>w.symbol==='NVDA.US'));s.db.exec('DROP TRIGGER deny_removal');s.removeWatch('NVDA.US');assert.throws(()=>s.addWatch('NVDA.US',{automatic:true}),/手动移出/);assert(s.watchRemoved('NVDA.US'));
  s.db.exec("CREATE TRIGGER deny_resumption BEFORE DELETE ON watch_removals BEGIN SELECT RAISE(ABORT,'fixture write failure'); END");assert.throws(()=>s.addWatch('NVDA.US'),/fixture write failure/);assert(!s.watchlist().some(w=>w.symbol==='NVDA.US'));assert(s.watchRemoved('NVDA.US'));
 }finally{s.close();}
});
test('holding monitoring details disclose background coverage while keeping pause and missing data explicit',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{const {ActualMonitoring}=await vite.ssrLoadModule('/src/integrated/ActualObservationDetails.jsx');const html=renderToStaticMarkup(React.createElement(ActualMonitoring,{monitoring:{label:'巡检已暂停',checkedAt:instant,current:false,watch:{mode:'holding',reason:'持仓后台轮流采集；每轮最多40个证券'},gaps:['分钟行情任务已暂停'],checks:[],policy:'Synthetic'}}));
 assert.match(html,/持仓后台轮流采集/);assert.match(html,/分钟行情任务已暂停/);assert.match(html,/上次检查，不代表当前状态/);assert.doesNotMatch(html,/已达40个行情关注上限|<button/);
 }finally{await vite.close();}
});
test('existing daily charts and company details display out-of-watchlist holding caches without enlarging the watch pool',async()=>{
 const f=setup(),oldWindow=globalThis.window,vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
  globalThis.window={location:{search:''},innerHeight:900,innerWidth:1440};
  for(let n=0;n<40;n++)f.store.addWatch(`W${n}.US`);
  let t=f.service.research.create({title:'Synthetic chart projection',summary:'Synthetic'});t=f.service.research.addCompany(t.id,{version:t.version,symbol:'NVDA.US',note:'Synthetic'});f.save(holding({topicId:t.id,topicVersion:t.version}));f.service.syncWatches();
  for(const lane of ['daily','minutes']){f.service.controlOperation(lane,'resume');await f.service.runOperation(lane);}
  const data=f.service.snapshot(),{default:MarketPanel}=await vite.ssrLoadModule('/src/integrated/MarketPanel.jsx'),{default:CompanyDossier}=await vite.ssrLoadModule('/src/integrated/CompanyDossier.jsx');
  const chart=renderToStaticMarkup(React.createElement(MarketPanel,{topic:t,topics:data.research.topics,book:data.paper,watch:data.watchlist,holdingPrices:data.holdingPrices,selected:'NVDA.US',checks:{}}));
  assert.match(chart,/关注池 40/);assert.match(chart,/101\.00/);assert.match(chart,/放大 \/ 明细 · 1 日/);assert.doesNotMatch(chart,/暂无日线缓存/);
  const dossier=renderToStaticMarkup(React.createElement(CompanyDossier,{symbol:'NVDA.US',topicId:t.id,data}));
  assert.match(dossier,/收盘 101\.00 USD · 2026-10-01/);assert.match(dossier,/1 个分钟收盘点/);assert.doesNotMatch(dossier,/无日线|暂无分钟缓存/);
  assert.equal(data.watchlist.length,40);assert(!data.watchlist.some(w=>w.symbol==='NVDA.US'));
 }finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;await vite.close();await f.close();}
});
