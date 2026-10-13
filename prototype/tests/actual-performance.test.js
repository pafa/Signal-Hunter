import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openActualPerformance} from '../server/actual-performance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {performanceInterval,actualPerformanceSeries,actualPerformanceAccumulator,performanceDay,actualPerformanceErrors} from '../shared/actual-performance.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';
const start='2026-10-06T14:00:00.000Z',near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const row=(type,extra={})=>({account:'Synthetic actual',currency:'USD',externalId:type,type,at:start,sequence:'0',source:'Synthetic only',...extra});
const opening=extra=>row('opening',{amount:'10000',costMethod:'average',...extra});
const buy=extra=>row('buy',{symbol:'AAPL.US',quantity:'10',amount:'1000',fees:'0',sequence:'1',...extra});
async function fixture(run,{file=':memory:',seed=true,feed=null,initialQuote=true,initialAt=start,inspectDb=null}={}){
 const f=feed||executionFeedFixture(),store=openStore(file);let now=Date.parse(initialAt);inspectDb?.(store.db);const service=createService(store,{mode:'research',executionConfig:f.config,now:()=>now,fetcher:()=>assert.fail('external network forbidden')});
 const at=()=>new Date(now).toISOString(),save=rows=>{const p=service.actualHoldings.ledger.preview({rows,confirmOpening:true});assert(p.canApply,JSON.stringify(p));return service.actualHoldings.ledger.apply({id:p.id,hash:p.hash});},quote=(mark='100',symbol='AAPL.US')=>{f.write([f.quote(at(),{mark,settlesAt:new Date(now+3600000).toISOString()},symbol)]);const result=service.executionInputs.refresh();assert(result.accepted===1||result.skipped==='unchanged-frame',JSON.stringify(result));},account=()=>service.snapshot().overview.accounts.find(a=>a.kind==='actual'),capture=()=>service.actualPerformance.capture(),series=()=>service.actualPerformance.history(account().id);
 service.controlOperation('execution','resume');if(seed)save([opening(),buy()]);if(initialQuote)quote();
 try{await run({f,store,service,at,save,quote,account,capture,series,tick:ms=>now+=ms,set:v=>now=Date.parse(v)});}finally{await service.close();store.close();if(!feed)f.close();}
}
const point=(at,navCents,id=1)=>({at,navCents,eligible:true,id,currency:'USD',issues:[]});
test('Modified Dietz independently matches the published calendar-weighted example and excludes the starting boundary flow',()=>{
 const a=point('2026-05-31T00:00:00.000Z',10000000),b=point('2026-06-30T00:00:00.000Z',13500000),entries=[{id:'a',type:'withdrawal',amount:'2000.00',at:'2026-06-06T00:00:00.000Z'},{id:'b',type:'deposit',amount:'20000.00',at:'2026-06-11T00:00:00.000Z'},{id:'excluded',type:'deposit',amount:'5000.00',at:a.at}];
 const r=performanceInterval(a,b,entries);assert.equal(r.state,'available');assert.equal(r.pnlCents,1700000);assert.equal(r.netFlowCents,1800000);near(r.rate,17000/(100000-2000*.8+20000*19/30));assert.equal(r.flows.length,2);
 const endFlow=performanceInterval(point(a.at,10000),point(b.at,20000),[{id:'end',type:'deposit',amount:'100.00',at:b.at}]);near(endFlow.rate,0);assert.equal(endFlow.weightedCapitalCents,10000);
});
test('linked reference return and sampled drawdown distinguish profit, recovery and a reset at reconciliation',()=>{
 const points=[10000,11000,8800,10560].map((v,i)=>point(`2026-10-06T14:0${i}:00.000Z`,v,i+1));const r=actualPerformanceSeries(points,[],{currency:'USD',at:points.at(-1).at,current:true});near(r.summary.referenceReturnPct,5.6);near(r.summary.currentDrawdownPct,4);near(r.summary.maxDrawdownPct,20);assert.equal(r.summary.dailyPnlCents,560);
 const reset=actualPerformanceSeries(points,[{type:'cash_balance',at:points[2].at}],{currency:'USD',at:points.at(-1).at,current:true});assert.equal(reset.summary.windowStart,points[2].at);near(reset.summary.referenceReturnPct,20);near(reset.summary.maxDrawdownPct,0);assert.equal(reset.summary.dailyFrom,points[2].at);
});
test('time zones, zero capital, undefined endpoints and excessive flow reversals do not fabricate valid returns',()=>{
 assert.equal(performanceDay('2026-10-06T02:00:00.000Z','USD'),'2026-10-05');assert.equal(performanceDay('2026-10-06T02:00:00.000Z','HKD'),'2026-10-06');
 assert.equal(performanceInterval(point(start,0),point('2026-10-06T14:01:00.000Z',10000),[]).state,'reset');assert.equal(performanceInterval(point(start,100),point(start,200),[]).state,'unknown');
 const a=point(start,10000),b=point('2026-10-06T15:00:00.000Z',0);assert.equal(performanceInterval(a,b,[{type:'withdrawal',amount:'300.00',at:'2026-10-06T14:01:00.000Z'}]).state,'reset');
});
test('original observation scheduler captures actual NAV, preserves accounting and reads never write',()=>fixture(async({service,store,account,quote,tick,series})=>{
 const before=service.actualHoldings.ledger.snapshot(),books=Object.values(service.marketSimulations).map(m=>m.snapshot()),paper=service.paper.snapshot();await service.runOperation('observations');assert.equal(account().performance.status,'baseline');assert.equal(account().performance.reason,'已记录首个净值，等待下一次有效采样');assert.equal(account().navCents,1000000);
 tick(60000);quote('110');await service.runOperation('observations');const a=account();near(a.performance.referenceReturnPct,1);assert.equal(a.dailyPnlCents,10000);near(a.currentDrawdownPct,0);assert.equal(series().items.length,2);
 const changes=store.db.prepare('SELECT total_changes() n').get().n;account();series();service.actualPerformance.project();assert.equal(store.db.prepare('SELECT total_changes() n').get().n,changes);assert.deepEqual(service.actualHoldings.ledger.snapshot(),before);assert.deepEqual(Object.values(service.marketSimulations).map(m=>m.snapshot()),books);assert.deepEqual(service.paper.snapshot(),paper);
}));
test('deposits and withdrawals are not profit; dividends and fees change performance, while quotes retain provenance',()=>fixture(async({at,save,capture,tick,quote,account,series})=>{
 capture();tick(30000);save([row('deposit',{at:at(),amount:'1000'})]);tick(30000);quote('100');capture();near(account().performance.referenceReturnPct,0);assert.equal(account().dailyPnlCents,0);
 tick(30000);save([row('withdrawal',{at:at(),amount:'500'})]);tick(30000);quote('100');capture();near(account().performance.referenceReturnPct,0);
 tick(60000);save([row('dividend',{at:at(),symbol:'AAPL.US',amount:'100',fees:'10'}),row('fee',{at:at(),sequence:'1',amount:'10'})]);quote('100');capture();near(account().performance.referenceReturnPct,80/10500*100);assert.equal(account().dailyPnlCents,8000);const p=series().items[0];assert.equal(p.interval.netFlowCents,0);assert.equal(p.interval.pnlCents,8000);assert.equal(p.quotes[0].provenance.source,'synthetic-only');assert(p.quotes[0].provenance.quoteHash);
}));
test('later facts keep original samples eligible; backdated corrections invalidate affected points without rewriting them',()=>fixture(async({save,capture,tick,quote,account,series,store,at})=>{
 capture();tick(60000);quote('110');capture();const old=store.db.prepare('SELECT payload FROM actual_nav_samples ORDER BY id').all();tick(30000);save([row('deposit',{at:at(),amount:'1000'})]);assert(series().items.every(p=>p.eligible));assert.equal(account().performance.current,false);
 tick(30000);quote('110');capture();save([buy({amount:'1100',revision:'2',reason:'Synthetic correction'})]);assert(series().items.every(p=>!p.eligible));assert.equal(account().performance.referenceReturnPct,null);assert.deepEqual(store.db.prepare('SELECT payload FROM actual_nav_samples WHERE id<=2 ORDER BY id').all(),old);
 tick(60000);quote('110');capture();assert.equal(account().performance.status,'baseline');assert.equal(account().performance.gapSamples,3);tick(60000);quote('120');capture();assert.equal(account().performance.windowSamples,2);assert.equal(account().performance.gapSamples,3);
}));
test('backdated additions and voids invalidate only the affected history, without editing archived quotes',()=>fixture(async({save,capture,tick,quote,series,at})=>{
 capture();tick(60000);quote();capture();tick(60000);save([row('deposit',{amount:'100',at:'2026-10-06T14:00:30.000Z'})]);let p=series().items;assert.equal(p[0].eligible,false);assert.equal(p[1].eligible,true);quote();capture();const recent=series().items[0];assert.equal(recent.interval.pnlCents,0);
 save([row('void',{externalId:'deposit',revision:'2',reason:'Synthetic reversal',at:at()})]);assert.equal(series().items[0].eligible,false);assert.equal(series().items.at(-1).eligible,true);
}));
test('missing or stale quotes create visible gaps; recovery never uses recorded snapshot prices',()=>fixture(async({capture,tick,quote,account,series})=>{
 capture();tick(61000);capture();let a=account();assert.equal(a.navCents,null);assert.equal(a.performance.referenceReturnPct,null);assert.equal(a.performance.gapSamples,1);assert.equal(series().items[0].navCents,null);assert.equal(capture().captured,0);
 tick(60000);quote('90');capture();a=account();near(a.performance.referenceReturnPct,-1);near(a.maxDrawdownPct,1);assert.equal(a.performance.gapSamples,1);assert.equal(series().items[0].index,99);
}));
test('reconciliation starts a new comparison window and does not erase the earlier loss',()=>fixture(async({capture,tick,quote,save,at,account,series})=>{
 capture();tick(60000);quote('80');capture();near(account().performance.referenceReturnPct,-2);
 tick(60000);save([row('cash_balance',{at:at(),amount:'9500',reason:'Synthetic statement adjustment'})]);quote('80');capture();assert.equal(account().performance.status,'baseline');assert.equal(account().performance.referenceReturnPct,null);assert.match(series().items[0].resetReason,/对账调整/);
 tick(60000);quote('90');capture();near(account().performance.referenceReturnPct,100/10300*100);near(series().items.find(p=>p.id===2).returnPct,-2);
}));
test('pause, input revision, recovery lock and quote expiry never show stale samples as current performance',()=>fixture(async({service,store,capture,tick,quote,account,series})=>{
 capture();tick(60000);quote('110');capture();assert.equal(account().performance.current,true);service.controlOperation('observations','pause');assert.equal(account().performance.current,false);assert.equal(account().currentDrawdownPct,null);assert.match(account().performance.reason,/暂停/);service.controlOperation('observations','resume');
 service.controlOperation('execution','pause');assert.equal(account().performance.current,false);service.controlOperation('execution','resume');tick(1000);quote('111');assert.equal(account().performance.current,false);capture();assert.equal(account().performance.current,true);
 store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal(capture().captured,0);assert.equal(account().performance.current,false);assert(series().items.length>0);
}));
test('cash-only accounts, currency-separated accounts and snapshot-only holdings are never pooled',()=>fixture(async({save,service,capture,tick,account})=>{
 save([opening(),opening({currency:'HKD',externalId:'opening-hkd',amount:'20000'}),opening({account:'Other',amount:'5000'})]);const p=service.actualHoldings.preview({rows:[{account:'Snapshot only',symbol:'AAPL.US',quantity:'1',unitCost:'100',price:'500',asOf:start,source:'Synthetic',feeBasis:'included'}]});assert(p.canApply);service.actualHoldings.apply({id:p.id,hash:p.hash});capture();tick(60000);capture();const accounts=service.snapshot().overview.accounts.filter(a=>a.kind==='actual');assert.equal(accounts.length,4);for(const a of accounts.filter(a=>a.ledger)){near(a.performance.referenceReturnPct,0);assert.equal(a.performance.totalSamples,2);}assert.equal(accounts.find(a=>a.label.includes('Snapshot only')).performance,undefined);
},{seed:false}));
test('history pagination pins its ceiling, validates inputs and never discards old samples',()=>fixture(async({capture,tick,quote,series,service,account})=>{
 for(let i=0;i<65;i++){quote();capture();tick(60000);}const first=series();assert.equal(first.items.length,60);assert.equal(first.total,65);quote();capture();const next=service.actualPerformance.history(account().id,{ceiling:String(first.ceiling),before:first.nextCursor});assert.equal(next.items.length,5);assert.equal(next.total,65);assert(!next.items.some(p=>first.items.some(q=>p.id===q.id)));assert.equal(series().total,66);
 for(const params of [{limit:'1000'},{before:'1'},{ceiling:'NaN'},{ceiling:'9007199254740992'}])assert.throws(()=>service.actualPerformance.history(account().id,params),/查询参数/);assert.throws(()=>service.actualPerformance.history('actual:'+'a'.repeat(64)),/不存在/);
}));
test('same instant is idempotent, clock regression rejects atomically and tampered history fails closed',()=>fixture(async({store,capture,tick,quote,series})=>{
 capture();assert.equal(capture().captured,0);tick(60000);quote();capture();tick(-1000);assert.throws(capture,/时钟倒退/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM actual_nav_samples').get().n,2);
 store.db.prepare("UPDATE actual_nav_samples SET payload='{}' WHERE id=1").run();assert.throws(series,/校验失败/);
}));
test('a failed multi-account capture rolls back the entire sample batch',()=>fixture(async({store,save,capture})=>{
 save([opening({account:'Second'})]);store.db.exec("CREATE TRIGGER synthetic_nav_failure BEFORE INSERT ON actual_nav_samples WHEN (SELECT COUNT(*) FROM actual_nav_samples)>0 BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");assert.throws(capture,/synthetic storage failure/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM actual_nav_samples').get().n,0);
}));
test('saved NAV survives reopen without rewriting existing samples',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-actual-nav-')),file=join(dir,'test.sqlite'),feed=executionFeedFixture();try{await fixture(async({capture,tick,quote})=>{capture();tick(60000);quote('110');capture();},{file,feed});await fixture(async({service,series,quote})=>{quote('110');assert.equal(series().total,2);assert.equal(service.actualPerformance.capture().captured,0);},{file,feed,seed:false,initialQuote:false,initialAt:'2026-10-06T14:01:00.000Z'});}finally{feed.close();rmSync(dir,{recursive:true,force:true});}
});
async function request(service,store,path){const req=Readable.from([]);Object.assign(req,{url:path,method:'GET',headers:{host:'127.0.0.1:4179'}});let status,body;await createHandler(store,service)(req,{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});return {status,body};}
test('history HTTP returns current account proof, stable input errors and no writes; owned errors do not expose arbitrary text',()=>fixture(async({service,store,capture,tick,quote,account})=>{
 capture();tick(60000);quote();capture();const before=store.db.prepare('SELECT total_changes() n').get().n,r=await request(service,store,'/api/actual-performance/'+account().id);assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(r.body.summary.current,true);const bad=await request(service,store,'/api/actual-performance/'+account().id+'?before=1');assert.equal(bad.status,400);assert.match(bad.body.error,/查询参数/);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
 for(const error of actualPerformanceErrors){assert.equal(safeErrorText(error),error);assert.notEqual(safeErrorText(error+' https://private.invalid'),error+' https://private.invalid');}
}));

const pointHash=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
function countNavReads(){
 let rows=0;return {get rows(){return rows;},reset(){rows=0;},install(db){const prepare=db.prepare.bind(db);db.prepare=sql=>{const stmt=prepare(sql);if(!sql.includes('actual_nav_samples')||!/^SELECT (?:\*|r\.\*)/i.test(sql))return stmt;return new Proxy(stmt,{get(target,key){if(key==='iterate')return function*(...args){for(const r of target.iterate(...args)){rows++;yield r;}};if(key==='get')return(...args)=>{const r=target.get(...args);if(r)rows++;return r;};if(key==='all')return(...args)=>{const r=target.all(...args);rows+=r.length;return r;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});};}};
}
function extendCashSamples(db,count){
 const seed=JSON.parse(db.prepare('SELECT payload FROM actual_nav_samples ORDER BY id LIMIT 1').get().payload),put=db.prepare('INSERT INTO actual_nav_samples(account_key,at,context_hash,payload,hash) VALUES(?,?,?,?,?)');db.exec('BEGIN');try{for(let i=1;i<count;i++){const p={...seed,at:new Date(Date.parse(seed.at)+i*60000).toISOString()};put.run(p.accountKey,p.at,p.contextHash,JSON.stringify(p),pointHash(p));}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
test('long history uses checked checkpoints: warm summary reads no history, one append reads one row and page replay stays bounded',async()=>{
 const reads=countNavReads();await fixture(async({save,capture,store,service,set,account})=>{
  save([opening()]);capture();extendCashSamples(store.db,2500);set(new Date(Date.parse(start)+2499*60000).toISOString());reads.reset();const a=account();assert.equal(a.performance.totalSamples,2500);assert.equal(reads.rows,2500);near(a.performance.referenceReturnPct,0);
  reads.reset();assert.deepEqual(account().performance,a.performance);assert.equal(reads.rows,0);
  set(new Date(Date.parse(start)+2500*60000).toISOString());capture();reads.reset();assert.equal(account().performance.totalSamples,2501);assert.equal(reads.rows,1);
  reads.reset();const p=service.actualPerformance.history(a.id,{before:'1050',ceiling:'2500'});assert.equal(p.items.length,60);assert.equal(p.items[0].id,1049);assert.equal(p.items.at(-1).id,990);assert(reads.rows<=572,`page scanned ${reads.rows}`);assert(p.items.every(r=>r.index===100));assert.equal(p.total,2500);assert.equal(p.nextCursor,'990');
  p.items[0].index=800;p.summary.referenceReturnPct=800;assert.equal(service.actualPerformance.history(a.id,{before:'1050',ceiling:'2500'}).items[0].index,100);assert.equal(account().performance.referenceReturnPct,0);
 },{seed:false,initialQuote:false,inspectDb:db=>reads.install(db)});
});
test('checkpoint replays agree before and after same-time supersession, out-of-order insertion and ledger correction',()=>fixture(async({save,capture,store,service,set,account,at})=>{
 save([opening()]);capture();extendCashSamples(store.db,1100);set(new Date(Date.parse(start)+1099*60000).toISOString());let a=account();
 const original=store.db.prepare('SELECT * FROM actual_nav_samples WHERE id=512').get(),p=JSON.parse(original.payload);p.contextHash='synthetic-same-time-revision';store.db.prepare('INSERT INTO actual_nav_samples(account_key,at,context_hash,payload,hash) VALUES(?,?,?,?,?)').run(p.accountKey,p.at,p.contextHash,JSON.stringify(p),pointHash(p));
 a=account();assert.equal(a.performance.eligibleSamples,1100);assert.equal(a.performance.gapSamples,1);let page=service.actualPerformance.history(a.id,{before:'530',ceiling:'1101'});assert.equal(page.items.find(p=>p.id===512).eligible,false);assert(page.items.filter(p=>p.eligible).every(p=>p.index===100));
 // A fresh evaluator has no cached checkpoints and must reproduce the same page.
 const fresh=()=>openActualPerformance(store,{clock:at,enabled:true,getContext:()=>({at:at(),snapshot:service.actualHoldings.snapshot(),inputs:service.executionInputs.inputs(),operation:service.operations().tasks.execution,monitorOperation:service.operations().tasks.observations,restorePending:false})});assert.deepEqual(fresh().history(a.id,{before:'530',ceiling:'1101'}),page);
 save([opening({amount:'11000',revision:'2',reason:'Synthetic correction'})]);page=service.actualPerformance.history(a.id,{before:'530',ceiling:'1101'});assert(page.items.every(p=>!p.eligible));assert.deepEqual(fresh().history(a.id,{before:'530',ceiling:'1101'}),page);assert.equal(account().performance.referenceReturnPct,null);
},{seed:false,initialQuote:false}));
test('committed tampering from another SQLite connection invalidates a warm cache; rollback leaves the verified result intact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-nav-cache-')),file=join(dir,'actual.sqlite');try{await fixture(async({save,capture,tick,account,store})=>{
  save([opening()]);capture();tick(60000);capture();const before=account().performance;store.db.exec("BEGIN; UPDATE actual_nav_samples SET hash='bad' WHERE id=1; ROLLBACK");assert.deepEqual(account().performance,before);
  const other=new DatabaseSync(file);try{other.exec("UPDATE actual_nav_samples SET hash='bad' WHERE id=1");}finally{other.close();}assert.throws(account,/净值采样记录校验失败/);
 },{file,seed:false,initialQuote:false});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('replacement of the last sample and deletion cannot reuse a stale cached summary',()=>fixture(async({save,capture,tick,account,store,service})=>{
 save([opening()]);capture();tick(60000);capture();const a=account();const r=store.db.prepare('SELECT * FROM actual_nav_samples ORDER BY id DESC LIMIT 1').get(),p=JSON.parse(r.payload);p.navCents=1010000;store.db.prepare('INSERT OR REPLACE INTO actual_nav_samples(id,account_key,at,context_hash,payload,hash) VALUES(?,?,?,?,?,?)').run(r.id,r.account_key,r.at,r.context_hash,JSON.stringify(p),pointHash(p));assert.equal(service.actualPerformance.history(a.id).items[0].navCents,1010000);near(account().performance.referenceReturnPct,1);
 store.db.prepare('DELETE FROM actual_nav_samples WHERE id=?').run(r.id);assert.equal(account().performance.totalSamples,1);assert.equal(account().performance.referenceReturnPct,null);
},{seed:false,initialQuote:false}));

test('resumed cash-flow accumulator preserves prior loss, weighted returns and the account-day baseline',()=>{
 const entries=[{id:'flow',revision:1,type:'deposit',amount:'100.00',at:'2026-10-06T14:01:30.000Z'}],options={currency:'USD'},a=actualPerformanceAccumulator(entries,options);
 a.push(point(start,10000,1));a.push(point('2026-10-06T14:01:00.000Z',9000,2));const state=a.state(),resumed=actualPerformanceAccumulator(entries,{...options,state});state.peak=999;state.previous.navCents=999;
 const p=resumed.push(point('2026-10-06T14:02:00.000Z',20900,3)),summary=resumed.summary({at:p.at,current:true});near(p.index,90*(1+1900/14000));near(summary.maxDrawdownPct,10);assert.equal(summary.currentDrawdownPct,0);assert.equal(summary.dailyPnlCents,900);assert.equal(summary.dailyFrom,start);assert.equal(p.interval.netFlowCents,10000);
 const nextDay=resumed.push(point('2026-10-07T04:01:00.000Z',21000,4));assert.equal(resumed.summary({at:nextDay.at,current:true}).dailyPnlCents,null);
 resumed.push(point('2026-10-07T04:02:00.000Z',21100,5));assert.equal(resumed.summary({at:'2026-10-07T04:02:00.000Z',current:true}).dailyPnlCents,100);
});
