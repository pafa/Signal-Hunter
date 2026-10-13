import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../server/store.mjs';
import {openActualHoldings,projectActualAccounts} from '../server/actual-holdings.mjs';
import {normalizeLedgerRow,LEDGER_COLUMNS,ledgerTemplate} from '../shared/actual-ledger.mjs';
import {parseActualCsv} from '../shared/actual-holdings.mjs';
import {buildWorkbenchOverview} from '../shared/workbench-overview.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {openExecutionInputs} from '../server/execution-inputs.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';
const at='2026-10-06T14:00:00.000Z',start='2026-10-06T10:00:00Z';
const entry=(type,extra={})=>({account:'Synthetic actual',currency:'USD',externalId:type,type,at:start,sequence:'0',source:'Synthetic statement',...extra});
const opening=extra=>entry('opening',{amount:'10000',costMethod:'average',...extra});
const buy=extra=>entry('buy',{symbol:'AAPL.US',quantity:'10',amount:'1000',fees:'1',sequence:'1',...extra});
const sell=extra=>entry('sell',{symbol:'AAPL.US',quantity:'4',amount:'480',fees:'1',sequence:'3',...extra});
function fixture(fn){const store=openStore(':memory:');let now=at,topic={id:'t',version:1,status:'active',updatedAt:'2026-10-06T09:00:00Z',companies:[{symbol:'AAPL.US'}]};const h=openActualHoldings(store,{enabled:true,clock:()=>now,getTopic:()=>topic}),book=()=>h.ledger.snapshot(),preview=(rows,confirmOpening=true)=>h.ledger.preview({rows,confirmOpening}),save=rows=>{const p=preview(rows);assert.equal(p.canApply,true,JSON.stringify(p));return h.ledger.apply({id:p.id,hash:p.hash});};try{return fn({store,h,book,preview,save,clock:v=>now=v,topic:v=>topic=v});}finally{store.close();}}
test('ledger fields preserve cents and explicit unknowns; currency, dates, fields and fractional bounds are checked',()=>{
 const r=normalizeLedgerRow(buy({quantity:'0.125000',fees:'',revision:'',sequence:''}),at);assert.equal(r.amount,'1000.00');assert.equal(r.quantity,'0.125');assert.equal(r.fees,null);assert.equal(r.revision,1);assert.equal(r.sequence,0);
 for(const extra of [{amount:'1.001'},{fees:0},{currency:'HKD'},{at:'2026-10-06'},{at:'2027-01-01T00:00:00Z'},{cost:'10'},{quantity:'1e3'},{quantity:'0'},{type:['buy']},{secret:'x'}])assert.throws(()=>normalizeLedgerRow(buy(extra),at));
 assert.throws(()=>normalizeLedgerRow(opening({costMethod:''}),at));assert.throws(()=>normalizeLedgerRow(entry('opening_position',{symbol:'AAPL.US',quantity:'0',cost:'2'}),at));
 const csv=ledgerTemplate+LEDGER_COLUMNS.map(k=>buy()[k]??'').join(',');assert.equal(parseActualCsv(csv,LEDGER_COLUMNS).length,1);assert.throws(()=>parseActualCsv(csv.replace('externalId','id'),LEDGER_COLUMNS));
});
test('opening is explicit, complete and first; initial holdings precede all subsequent transactions',()=>fixture(({preview,save,book})=>{
 assert.equal(preview([buy()]).canApply,false);assert.equal(preview([opening()],false).canApply,false);
 const pos=entry('opening_position',{symbol:'MSFT.US',quantity:'3',cost:'150',amount:'180',sequence:'2'});
 assert.equal(preview([opening(),buy(),pos]).canApply,false);save([opening(),{...pos,sequence:'1'}]);assert.equal(book().accounts[0].openingValueCents,1018000);
 assert.equal(preview([entry('opening_position',{symbol:'AAPL.US',quantity:'1',cost:'10',amount:'12',sequence:'2'})],false).canApply,false);
 assert.equal(preview([opening({externalId:'another'})]).canApply,false);
}));
test('partial sales, cash flows, dividends and fees reconcile exactly without counting deposits as profit',()=>fixture(({save,book})=>{
 save([opening(),buy(),entry('deposit',{amount:'500',sequence:'2'}),sell(),entry('dividend',{symbol:'AAPL.US',amount:'20',fees:'2',sequence:'4'}),entry('withdrawal',{amount:'200',sequence:'5'}),entry('fee',{amount:'3',sequence:'6'})]);
 const a=book().accounts[0];assert.equal(a.cashCents,979300);assert.equal(a.netFlowsCents,30000);assert.equal(a.realizedCents,7860);assert.equal(a.incomeCents,1500);assert.equal(a.feesCents,700);assert.equal(a.positions[0].quantity,'6');assert.equal(a.positions[0].costCents,60060);assert.equal(a.entryCount,7);assert.equal(a.entries,undefined);assert.match(a.basisNote,/移动加权平均/);assert.deepEqual(a.issues,[]);
}));
test('fractional weighted cost conserves every cent through a full close',()=>fixture(({save,book})=>{
 save([opening(),buy({quantity:'0.3',amount:'1',fees:'0'}),sell({quantity:'0.1',amount:'1',fees:'0'}),sell({externalId:'sell-2',quantity:'0.2',amount:'2',fees:'0',sequence:'4'})]);
 const a=book().accounts[0];assert.equal(a.realizedCents,200);assert.equal(a.positions[0].quantity,'0');assert.equal(a.positions[0].costCents,0);assert.equal(a.cashCents,1000200);
}));
test('reported allocation is explicit; omitted fees or cost never become zero or fabricated realized gains',()=>fixture(({save,book,preview})=>{
 save([opening({costMethod:'reported'}),buy(),sell({cost:'400.40'})]);let a=book().accounts[0];assert.equal(a.realizedCents,7860);assert.equal(a.positions[0].costCents,60060);
 assert.equal(preview([sell({externalId:'wrong',quantity:'6',cost:'600',sequence:'4'})]).canApply,false);
 save([sell({externalId:'missing-cost',quantity:'1',sequence:'4'})]);a=book().accounts[0];assert.equal(a.realizedCents,null);assert.equal(a.positions[0].costCents,null);assert.notEqual(a.cashCents,null);
}));
test('unknown buy fees taint cost and cash; a later balance repairs current cash but not historical returns',()=>fixture(({save,book})=>{
 save([opening(),buy({fees:''}),sell()]);let a=book().accounts[0];assert.equal(a.cashCents,null);assert.equal(a.realizedCents,null);assert.equal(a.feesCents,null);assert.equal(a.positions[0].costCents,null);
 save([entry('cash_balance',{amount:'9500',sequence:'4',reason:'Statement balance'})]);a=book().accounts[0];assert.equal(a.cashCents,950000);assert.equal(a.performanceKnown,false);assert.equal(a.realizedCents,null);
}));
test('split keeps total cost; zero, oversales, overdrafts and mixed ordering reject the complete batch',()=>fixture(({save,book,preview})=>{
 save([opening(),buy(),entry('split',{symbol:'AAPL.US',quantity:'20',sequence:'2'}),sell({quantity:'8'})]);let a=book().accounts[0];assert.equal(a.positions[0].quantity,'12');assert.equal(a.positions[0].costCents,60060);
 for(const rows of [[sell({externalId:'over',quantity:'13',sequence:'4'})],[entry('withdrawal',{amount:'99999',sequence:'5'})],[entry('fee',{amount:'1',sequence:'3'})]])assert.equal(preview(rows).canApply,false);
 assert.equal(book().version,1);
}));
test('an identical reconciliation preserves period basis; an adjustment preserves recorded facts but invalidates inferred return',()=>fixture(({save,book})=>{
 save([opening(),buy(),entry('cash_balance',{amount:'8999',sequence:'2',reason:'Matches statement'}),entry('position_balance',{symbol:'AAPL.US',quantity:'10',cost:'1001',sequence:'3',reason:'Matches position'})]);assert.equal(book().accounts[0].performanceKnown,true);
 save([entry('position_balance',{externalId:'adjust',symbol:'AAPL.US',quantity:'11',cost:'1100',sequence:'4',reason:'Corrected broker position'})]);assert.equal(book().accounts[0].performanceKnown,false);assert.equal(book().accounts[0].positions[0].quantity,'11');
}));
test('duplicate batches do not write twice; revisions append history and can correct timestamps through a complete replay',()=>fixture(({save,preview,h,book})=>{
 const result=save([opening(),buy(),buy()]);assert.equal(book().entries.length,2);assert.equal(preview([buy()]).canApply,false);
 const corrected=buy({revision:'2',quantity:'12',at:'2026-10-06T11:00:00Z',reason:'Corrected time and quantity'});save([corrected]);assert.equal(book().accounts[0].positions[0].quantity,'12');const id=book().entries.find(r=>r.type==='buy').id;
 assert.equal(h.ledger.history(id).length,2);assert.equal(h.ledger.history(id)[1].quantity,'10');assert.equal(preview([buy({revision:'4',reason:'Skipped'})]).canApply,false);
 assert.throws(()=>h.ledger.apply({id:result.id,hash:h.ledger.preview({rows:[buy()],confirmOpening:false}).hash}),/数据已变化/);
}));
test('void is a revision and updates effective holding version, so current monitoring cannot reuse the pre-void result',()=>fixture(({save,h,book,preview})=>{
 save([opening(),buy()]);const before=h.snapshot().records[0];save([entry('void',{externalId:'buy',revision:'2',sequence:'1',reason:'Duplicate on broker statement'})]);
 assert.equal(book().version,2);assert.equal(book().accounts[0].version,2);assert.equal(book().accounts[0].cashCents,1000000);assert.equal(h.snapshot().records.length,0);assert.equal(preview([entry('void',{externalId:'opening',revision:'2',reason:'Cannot remove opening'})]).canApply,false);assert.equal(before.version,'ledger-1');
}));
test('stale previews include both ledger and snapshot changes; expiration, restore and disabled guards apply',()=>fixture(({preview,save,h,store,clock})=>{
 const p=preview([opening()]),other=preview([opening({account:'Other'})]);h.ledger.apply({id:p.id,hash:p.hash});assert.throws(()=>h.ledger.apply({id:other.id,hash:other.hash}),/数据已变化/);
 const q=preview([buy()]);clock('2026-10-06T14:31:00Z');assert.throws(()=>h.ledger.apply({id:q.id,hash:q.hash}),/过期/);clock(at);
 store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>save([buy()]),/恢复副本/);assert.throws(()=>openActualHoldings(store).ledger.preview({rows:[opening()],confirmOpening:true}),/当前模式/);
}));
test('a failing insert rolls back an entire ledger batch and the same reviewed request can retry idempotently',()=>fixture(({preview,h,book,store})=>{
 const p=preview([opening(),buy()]);store.db.exec("CREATE TRIGGER ledger_fail BEFORE INSERT ON actual_ledger_entries WHEN json_extract(NEW.payload,'$.type')='buy' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");assert.throws(()=>h.ledger.apply({id:p.id,hash:p.hash}),/synthetic/);assert.equal(book().version,0);assert.equal(book().entries.length,0);
 store.db.exec('DROP TRIGGER ledger_fail');assert.equal(h.ledger.apply({id:p.id,hash:p.hash}).version,1);assert.equal(h.ledger.apply({id:p.id,hash:p.hash}).replayed,true);assert.equal(book().entries.length,2);
}));
test('invalid correction cannot rewrite prior valid account, and duplicate identities with conflicting facts reject atomically',()=>fixture(({save,preview,book})=>{
 save([opening(),buy(),sell()]);const before=book();assert.equal(preview([buy({revision:'2',quantity:'1',reason:'Would oversell'})]).canApply,false);assert.deepEqual(book(),before);assert.equal(preview([entry('fee',{amount:'1',sequence:'8'}),entry('fee',{amount:'2',sequence:'8'})]).canApply,false);
}));
test('ledger replaces only the declared account currency; snapshots and their history survive and cannot double count',()=>fixture(({h,save,preview})=>{
 const r={account:'Synthetic actual',symbol:'AAPL.US',quantity:'5',unitCost:'100',asOf:start,source:'Synthetic snapshot'},p=h.preview({rows:[r,{...r,symbol:'00700.HK'},{...r,account:'Other'}]});h.apply({id:p.id,hash:p.hash});const old=h.snapshot().records.find(x=>x.account===r.account&&x.symbol===r.symbol),stale=h.preview({rows:[{...r,quantity:'6',reason:'old preview'}]});
 const pending=preview([opening({account:'Other ledger'})]);const newSnapshot=h.preview({rows:[{...r,account:'third'}]});h.apply({id:newSnapshot.id,hash:newSnapshot.hash});assert.throws(()=>h.ledger.apply({id:pending.id,hash:pending.hash}),/数据已变化/);
 save([opening(),buy()]);assert.equal(h.snapshot().legacyRecords.length,4);assert.equal(h.snapshot().records.length,4);assert.equal(h.snapshot().records.find(x=>x.id===old.id).quantity,'10');assert.deepEqual(h.history(old.id)[0],old);
 assert.equal(h.preview({rows:[r]}).canApply,false);assert.throws(()=>h.apply({id:stale.id,hash:stale.hash}),/数据已变化/);
}));
test('bindings cannot backdate future research; mixed original versions remain explicit instead of guessing one',()=>fixture(({preview,save,book,topic})=>{
 assert.equal(preview([opening(),buy({topicId:'t',topicVersion:1,at:'2026-10-06T08:00:00Z'})]).canApply,false);
 save([opening(),buy({topicId:'t',topicVersion:1})]);topic({id:'t',version:2,status:'active',updatedAt:'2026-10-06T11:00:00Z',companies:[{symbol:'AAPL.US'}]});
 save([buy({externalId:'second',at:'2026-10-06T12:00:00Z',topicId:'t',topicVersion:2})]);const p=book().accounts[0].positions[0];assert.equal(p.topicId,null);assert.equal(p.bindings.length,2);
}));
test('current marked NAV, period PnL and closed cash accounts use the ledger while history prices never leak into current value',()=>fixture(({save,h,store})=>{
 const f=executionFeedFixture();try{f.write([f.quote(at)]);const feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(at)});feed.refresh();save([opening(),buy(),sell()]);
 let a=projectActualAccounts(h.snapshot(),[],at,{}, {inputs:feed.inputs()})[0];assert.equal(a.navCents,1007800);assert.equal(a.unrealizedCents,-60);assert.equal(a.realizedCents,7860);assert.equal(a.periodPnlCents,7800);assert.equal(a.ledger.positions,undefined);assert.equal(a.positions[0].recordValuation.price,null);assert.equal(a.maxDrawdownPct,null);
 a=projectActualAccounts(h.snapshot(),[],at)[0];assert.equal(a.navCents,null);assert.equal(a.realizedCents,7860);save([sell({externalId:'close',quantity:'6',amount:'720',sequence:'4'})]);a=projectActualAccounts(h.snapshot(),[],at)[0];assert.equal(a.positions.length,0);assert.equal(a.navCents,1019700);assert.equal(a.realizedCents,19700);assert.equal(a.periodPnlCents,19700);
 }finally{f.close();}
}));
test('account warnings remain visible after all holdings are closed and overview reads never generate orders',()=>fixture(({save,h,store})=>{
 save([opening({amount:''})]);const before=store.db.prepare('SELECT total_changes() n').get().n;const a=projectActualAccounts(h.snapshot(),[],at),o=buildWorkbenchOverview({at,actualAccounts:a});assert.equal(o.accounts.length,1);assert(o.risks.some(r=>/现金/.test(r.message)));assert.equal(o.decisions.length,0);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
}));
test('ledger reopen preserves corrections and applied receipts; tampered record or commit metadata fails closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-ledger-')),path=join(dir,'ledger.sqlite');let store=openStore(path);
 try{let h=openActualHoldings(store,{enabled:true,clock:()=>at});const p=h.ledger.preview({rows:[opening(),buy()],confirmOpening:true});h.ledger.apply({id:p.id,hash:p.hash});store.close();store=openStore(path);h=openActualHoldings(store,{enabled:true,clock:()=>at});assert.equal(h.ledger.apply({id:p.id,hash:p.hash}).replayed,true);assert.equal(h.ledger.snapshot().entries.length,2);store.db.exec('UPDATE actual_ledger_batches SET applied_version=NULL');assert.throws(()=>h.ledger.snapshot(),/指纹/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('ledger HTTP routes enforce request boundaries and preserve business fields through response sanitization',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'ledger-fixture'},now:()=>Date.parse(at),fetcher:()=>{throw Error('No network');}}),handler=createHandler(store,service);
 const call=async(path,{method='GET',body,headers={}}={})=>{const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'ledger-fixture',...headers}});let status,payload;await handler(req,{writeHead:s=>status=s,end:b=>payload=JSON.parse(b)});return {status,body:payload};};
 try{assert.equal((await call('/api/actual-holdings/ledger/preview',{method:'POST',body:{rows:[opening()],confirmOpening:true},headers:{'x-signal-instance':'wrong'}})).status,409);assert.equal((await call('/api/actual-holdings/ledger/preview',{method:'POST',body:'x'.repeat(400001)})).status,413);
 const p=await call('/api/actual-holdings/ledger/preview',{method:'POST',body:{rows:[opening(),buy()],confirmOpening:true}});assert.equal(p.status,200);assert.equal(p.body.accounts[0].cashCents,899900);assert.equal(p.body.items[1].row.amount,'1000.00');const b=await call('/api/actual-holdings/ledger/apply',{method:'POST',body:{id:p.body.id,hash:p.body.hash}});assert.equal(b.status,200);assert.equal(b.body.records[0].costCents,100100);assert.equal(b.body.ledger.entries.length,2);const history=await call('/api/actual-holdings/ledger/'+b.body.ledger.entries[0].id+'/history');assert.equal(history.status,200);assert.equal(history.body.length,1);
 const view=(await call('/api/data')).body;assert.equal(view.overview.accounts.find(a=>a.kind==='actual').cashCents,899900);assert.equal(view.paper.positions.length,0);assert.equal(view.overview.decisions.length,0);
 }finally{await service.close();store.close();}
});
