import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openActualHoldings,projectActualAccounts} from '../server/actual-holdings.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {actualReviewCandidates} from '../server/actual-observations.mjs';
import {projectActualMonitoring} from '../shared/actual-monitoring.mjs';
import {createService} from '../server/service.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';
const at='2026-10-02T06:00:00.000Z',empty={positions:[],reviews:[]};
const row=(extra={})=>({account:'Synthetic A',symbol:'00700.HK',quantity:'10.5',unitCost:'100',price:'999',asOf:at,source:'Synthetic snapshot',feeBasis:'included',topicId:'fixture',topicVersion:1,...extra});
const topic=()=>({id:'fixture',title:'Synthetic review',status:'active',version:1,companies:[{symbol:'00700.HK'}],evidence:[],claims:[],hypothesis:{reviewAt:'2026-10-03'}});
function fixture(path=':memory:'){
 const store=openStore(path),t=topic(),baseline=structuredClone(t);let clock=at,enabled=true,history=true;
 const holdings=openActualHoldings(store,{enabled:true,clock:()=>clock,getTopic:()=>t});
 const inbox=openObservationInbox(store,{clock:()=>clock,getTopic:()=>t,getActualHoldings:()=>holdings.snapshot(),getTopicVersion:()=>history?baseline:null,actualPriceEnabled:()=>enabled});
 const save=r=>{const p=holdings.preview({rows:Array.isArray(r)?r:[r]});assert(p.canApply,JSON.stringify(p));holdings.apply({id:p.id,hash:p.hash});};
 const run=()=>inbox.process([t],empty),hits=()=>inbox.snapshot().items.filter(x=>x.kind==='actual-review'),checks=()=>inbox.summary().actualChecks;
 const rule=()=>inbox.rules.create(t.id,{topicVersion:t.version,clientId:'synthetic-price',label:'Synthetic price condition',join:'all',conditions:[{type:'price',symbol:'00700.HK',interval:'1m',operator:'gte',value:100}]});
 const price=value=>{const q={symbol:'00700.HK',currency:'HKD',provider:'eastmoney-public',providerTimezone:'Asia/Hong_Kong',providerTime:'2026-10-02 14:00',points:[{time:'2026-10-02 14:00',close:value}]};store.db.prepare('INSERT OR REPLACE INTO quotes VALUES(?,?,?)').run(q.symbol,JSON.stringify(q),clock);store.status(q.symbol,{state:'ok',receivedAt:clock});};
 return {store,t,baseline,holdings,inbox,save,run,hits,checks,rule,price,clock:v=>clock=v,enable:v=>enabled=v,history:v=>history=v,close:()=>store.close()};
}
function using(fn){const f=fixture();try{return fn(f);}finally{f.close();}}
test('actual records automatically compare exact research baseline and preserve missing price coverage as unknown',()=>using(f=>{
 f.save(row());assert.equal(f.run().added,0);assert.equal(f.checks().length,5);assert.equal(f.checks().find(c=>c.reviewKind==='price-coverage').status,'unknown');assert.equal(f.checks().find(c=>c.reviewKind==='counterevidence').status,'clear');
 assert.equal(f.holdings.snapshot().records[0].price,'999');assert.equal(f.hits().length,0);
}));
test('research updates and counterevidence freeze the holding version, baseline hash and revised material identity',()=>using(f=>{
 f.baseline.evidence=[{id:'e',stance:'against',claim:'Known risk',materialRevision:1}];f.t.evidence=structuredClone(f.baseline.evidence);f.save(row());f.run();
 f.t.version=2;f.t.evidence[0].materialRevision=2;f.run();assert.deepEqual(f.hits().map(h=>h.input.reviewKind).sort(),['counterevidence','research-version']);
 const hit=f.hits().find(h=>h.input.reviewKind==='counterevidence');assert.equal(hit.input.record.topicVersion,1);assert.equal(hit.input.record.version,1);assert(hit.input.baselineHash);assert.equal(hit.input.evidence[0].claim,'Known risk');
 f.t.evidence[0].claim='Revised again';f.run();assert.equal(f.hits().filter(h=>h.input.reviewKind==='counterevidence').length,2);assert.equal(f.hits().find(h=>h.id===hit.id).input.evidence[0].claim,'Known risk');
}));
test('no news is required for deadline triggers and dates use the security market timezone',()=>using(f=>{
 f.save(row());f.run();f.clock('2026-10-02T16:00:00.000Z');f.run();assert(f.hits().some(h=>h.input.reviewKind==='review-due'));assert.equal(f.hits().find(h=>h.input.reviewKind==='review-due').input.metrics.localDate,'2026-10-03');
 const record={...f.holdings.snapshot().records[0],symbol:'AAPL.US'},t={...f.t,companies:[{symbol:'AAPL.US'}]};const cs=actualReviewCandidates(record,t,f.baseline,[],'2026-10-03T00:00:00.000Z');assert.equal(cs.find(c=>c.hit.input.reviewKind==='review-due').state,'clear');
}));
test('unlinked, archived, removed and unavailable historical research never silently pass checks',()=>using(f=>{
 f.save(row());f.history(false);f.run();assert.equal(f.checks().find(c=>c.reviewKind==='counterevidence').status,'unknown');
 f.t.companies=[];f.run();assert(f.hits().some(h=>h.input.reviewKind==='research-status'));f.t.status='archived';f.run();assert.equal(f.hits().filter(h=>h.input.reviewKind==='research-status').length,2);
 f.save(row({account:'No binding',topicId:'',topicVersion:''}));f.run();assert(f.checks().some(c=>c.details.record.account==='No binding'&&c.reviewKind==='research-status'&&c.status==='unknown'));
}));
test('price hits use valid provider observations, never the manually supplied holding price',()=>using(f=>{
 f.save(row());f.rule();f.run();assert.equal(f.hits().length,0);f.price(99);f.run();assert.equal(f.hits().length,0);f.price(105);f.run();
 const h=f.hits().find(h=>h.input.reviewKind==='condition:synthetic-price');assert.equal(h.input.results[0].input.price,105);assert.equal(h.input.record.price,'999');assert.equal(h.input.results[0].input.executable,false);
 f.store.status('00700.HK',{state:'error'});f.run();assert.equal(f.checks().find(c=>c.ruleId)?.status,'unknown');assert.equal(f.checks().find(c=>c.ruleId)?.active,true);
}));
test('receipts and unknown input cannot clear or duplicate persistent hits; observed recovery rearms an episode',()=>using(f=>{
 f.save(row());f.rule();f.price(105);f.run();const h=f.hits().find(h=>h.input.reviewKind.startsWith('condition:')),frozen=JSON.stringify(h.input);f.inbox.respond(h.id,{revision:1,action:'complete',note:'Synthetic receipt'});
 f.enable(false);f.run();assert.equal(f.checks().find(c=>c.ruleId).active,true);f.enable(true);f.run();assert.equal(f.hits().length,1);assert.equal(JSON.stringify(f.hits()[0].input),frozen);assert.equal(f.hits()[0].state,'completed');
 f.price(99);f.run();f.price(105);f.run();assert.equal(f.hits().length,2);assert.deepEqual(f.hits().map(h=>h.input.episode).sort(),[1,2]);
}));
test('record or rule changes during unknown input cannot consume the next valid new-version trigger',()=>using(f=>{
 f.save(row());const r=f.rule();f.price(105);f.run();f.enable(false);f.save(row({quantity:'12',reason:'Synthetic quantity correction'}));f.run();f.enable(true);f.run();assert.equal(f.hits().length,2);
 f.inbox.rules.update(r.id,{version:1,action:'pause',note:'Synthetic pause'});f.run();assert.equal(f.checks().find(c=>c.ruleId).status,'unknown');f.inbox.rules.update(r.id,{version:2,topicVersion:1,action:'resume',note:'Synthetic resume'});f.run();assert.equal(f.hits().length,3);
}));
test('same securities in different accounts have independent monitor identities and closed records retain history',()=>using(f=>{
 f.save([row(),row({account:'Synthetic B'})]);f.t.version=2;f.run();assert.equal(f.hits().length,2);assert.equal(new Set(f.hits().map(h=>h.affectedPositions[0].lifecycleId)).size,2);
 f.save(row({quantity:'0',reason:'Synthetic close record'}));f.run();assert.equal(new Set(f.checks().map(c=>c.recordId)).size,1);assert.equal(f.hits().length,2);
}));
test('a failed inbox write atomically rolls back all checks and retries without losing an episode',()=>using(f=>{
 f.save(row());f.t.version=2;f.store.db.exec("CREATE TRIGGER fail_actual BEFORE INSERT ON observation_todos WHEN json_extract(NEW.payload,'$.kind')='actual-review' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(f.run,/synthetic failure/);assert.equal(f.checks().length,0);assert.equal(f.hits().length,0);f.store.db.exec('DROP TRIGGER fail_actual');f.run();assert.equal(f.hits()[0].input.episode,1);
}));
test('clock rollback and restore review preserve all existing checks and history',()=>using(f=>{
 f.save(row());f.run();const before=f.inbox.snapshot();f.clock('2026-10-02T05:59:00.000Z');assert.throws(f.run,/时钟倒退/);assert.deepEqual(f.inbox.snapshot(),before);
 f.clock(at);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(f.run,/恢复副本/);assert.deepEqual(f.inbox.snapshot(),before);assert.match(safeErrorText('实际持仓巡检时钟倒退，本轮未保存'),/时钟倒退/);
}));
test('restart preserves frozen triggers and deduplication independently of receipt state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-actual-review-')),path=join(dir,'fixture.sqlite');let f=fixture(path);
 try{f.save(row());f.t.version=2;f.run();const old=f.hits()[0];f.inbox.respond(old.id,{revision:1,action:'read',note:'Synthetic read'});f.close();f=fixture(path);f.t.version=2;f.run();assert.equal(f.hits().length,1);assert.equal(f.hits()[0].state,'read');assert.equal(f.inbox.receipts(old.id).length,1);}finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
test('automatic watch registration respects capacity, retries later and never reverses manual removal',()=>using(f=>{
 f.save(row());for(let i=0;f.store.watchlist().length<40;i++)f.store.addWatch(`F${i}.US`);f.holdings.syncWatches();assert.equal(f.holdings.snapshot().watching[0].state,'deferred');
 f.store.removeWatch(f.store.watchlist()[0].symbol);f.holdings.syncWatches();assert.equal(f.holdings.snapshot().watching[0].state,'watching');f.store.removeWatch('00700.HK');f.holdings.syncWatches();assert.equal(f.holdings.snapshot().watching[0].state,'removed');assert(!f.store.watchlist().some(w=>w.symbol==='00700.HK'));
}));
test('freshness projection distinguishes paused, failed, stale, new record and new rule checks without writes',()=>using(f=>{
 f.save(row());f.run();const record=f.holdings.snapshot().records[0],options={checks:f.checks(),rules:[],operations:{observations:{paused:false}},at};
 assert.equal(projectActualMonitoring(record,f.t,options).state,'checked');assert.equal(projectActualMonitoring(record,f.t,{...options,at:'2026-10-02T06:03:00Z'}).state,'stale');
 assert.equal(projectActualMonitoring(record,f.t,{...options,operations:{observations:{paused:true}}}).state,'paused');assert.equal(projectActualMonitoring(record,f.t,{...options,operations:{observations:{outcome:'error'}}}).state,'failed');
 assert.equal(projectActualMonitoring({...record,version:2},f.t,options).state,'changed');const r=f.rule();assert.equal(projectActualMonitoring(record,f.t,{...options,rules:[r]}).state,'changed');
 const before=f.store.db.prepare('SELECT total_changes() n').get().n;projectActualAccounts(f.holdings.snapshot(),[f.t],at,options);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
}));
test('cross-security combined conditions are not silently attributed to a single actual holding',()=>using(f=>{
 f.save(row());f.t.companies.push({symbol:'AAPL.US'});const r=f.inbox.rules.create(f.t.id,{topicVersion:1,clientId:'mixed-fixture',label:'Mixed fixture',join:'any',conditions:[{type:'price',symbol:'00700.HK',interval:'1m',operator:'gte',value:100},{type:'price',symbol:'AAPL.US',interval:'1m',operator:'gte',value:100}]});f.price(105);f.run();const c=f.checks().find(c=>c.ruleId===r.id);assert.equal(c.status,'unknown');assert.match(c.reason,/跨证券/);assert.equal(f.checks().find(c=>c.reviewKind==='price-coverage').status,'unknown');
}));
test('real scheduler checks actual records with no news, preserves books and exposes paused state without GET writes',async()=>{
 const store=openStore(':memory:');let clock=at;const s=createService(store,{mode:'research',now:()=>Date.parse(clock),fetcher:async()=>{throw Error('Fixture forbids network');}});
 try{for(const name of Object.keys(s.operations().tasks).filter(n=>n!=='observations'))s.controlOperation(name,'pause');let t=s.research.create({title:'Synthetic actual research',summary:'Synthetic fixture'});t=s.research.addCompany(t.id,{version:t.version,symbol:'00700.HK',note:'Synthetic binding'});
 const p=s.actualHoldings.preview({rows:[row({topicId:t.id,topicVersion:t.version})]});s.actualHoldings.apply({id:p.id,hash:p.hash});s.syncWatches();const books=JSON.stringify([s.paper.snapshot(),Object.values(s.marketSimulations).map(m=>m.snapshot())]);
 await s.runOperation('observations');let v=s.snapshot();assert.equal(v.overview.accounts.find(a=>a.kind==='actual').positions[0].monitoring.state,'checked');assert.equal(v.observationInbox.actualChecks.find(c=>c.reviewKind==='counterevidence').status,'clear');
 t=s.research.update(t.id,{version:t.version,hypothesis:{reviewAt:'2026-10-02'}});await s.runOperation('observations');assert(s.observations.snapshot().items.some(i=>i.kind==='actual-review'&&i.input.reviewKind==='review-due'));
 assert.equal(JSON.stringify([s.paper.snapshot(),Object.values(s.marketSimulations).map(m=>m.snapshot())]),books);
 s.controlOperation('observations','pause');assert.throws(()=>s.runOperation('observations'),/暂停/);const before=store.db.prepare('SELECT total_changes() n').get().n;v=s.snapshot();assert.equal(v.overview.accounts.find(a=>a.kind==='actual').positions[0].monitoring.state,'paused');assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
 }finally{await s.close();store.close();}
});
