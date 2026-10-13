import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {LEDGER_COLUMNS,ledgerTemplate} from '../shared/actual-ledger.mjs';

test('confirmed simulation survives restart, remains separate from identical actual records and never starts matching',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-manual-confirmed-')),file=join(dir,'test.sqlite');
 const at='2026-10-06T14:00:00.000Z',base={account:'Same name',currency:'USD',at,source:'Synthetic confirmed record'};
 const rows=[{...base,externalId:'opening',type:'opening',sequence:'0',amount:'10000',costMethod:'average'},{...base,externalId:'buy',type:'buy',sequence:'1',symbol:'AAPL.US',quantity:'10',amount:'1000',fees:'1'},{...base,externalId:'sell',type:'sell',sequence:'2',symbol:'AAPL.US',quantity:'4',amount:'480',fees:'1'}];
 let store=openStore(file),service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:()=>assert.fail('network forbidden')});
 const save=(input)=>{const p=service.actualHoldings.ledger.preview(input);assert(p.canApply,JSON.stringify(p));const result=service.actualHoldings.ledger.apply({id:p.id,hash:p.hash});assert.equal(service.actualHoldings.ledger.apply({id:p.id,hash:p.hash}).replayed,true);return result;};
 try{
  const before=Object.values(service.marketSimulations).map(m=>m.snapshot());
  save({rows,confirmOpening:true});
  const csv=ledgerTemplate+rows.map(r=>LEDGER_COLUMNS.map(k=>r[k]??'').join(',')).join('\n');
  save({csv,confirmOpening:true,accountKind:'manual-simulation'});
  const book=service.actualHoldings.snapshot();assert.equal(book.ledger.accounts.length,2);assert.equal(new Set(book.ledger.entries.map(r=>r.id)).size,6);assert.equal(new Set(book.records.map(r=>r.id)).size,2);
  for(const a of book.ledger.accounts){assert.equal(a.cashCents,947800);assert.equal(a.realizedCents,7860);assert.equal(a.positions[0].quantity,'6');assert.equal(a.positions[0].costCents,60060);}
  assert.equal(service.actualHoldings.ledger.preview({csv,confirmOpening:true,accountKind:'manual-simulation'}).canApply,false);
  assert.throws(()=>service.actualHoldings.ledger.preview({rows,confirmOpening:true,accountKind:'broker-auto'}));
  // Fix the simulation sell only; same actual record ID/revision remains intact.
  save({rows:[{...rows[2],amount:'400',revision:'2',reason:'Correct synthetic fill'}],confirmOpening:false,accountKind:'manual-simulation'});
  const books=service.actualHoldings.ledger.snapshot().accounts;
  assert.equal(books.find(a=>!a.accountKind).realizedCents,7860);assert.equal(books.find(a=>a.accountKind).realizedCents,-140);
  const sim=service.actualHoldings.ledger.snapshot().entries.find(r=>r.accountKind&&r.type==='sell');assert.equal(service.actualHoldings.ledger.history(sim.id).length,2);
  service.syncWatches();await service.runOperation('observations');
  const accounts=service.snapshot().overview.accounts.filter(a=>['actual','manual-simulation'].includes(a.kind));assert.equal(accounts.length,2);assert.notEqual(accounts[0].id,accounts[1].id);
  for(const a of accounts){assert.equal(a.positions[0].qty,'6');assert.equal(a.unrealizedCents,null);assert.equal(service.actualPerformance.history(a.id).total,1);}
  assert.match(accounts.find(a=>a.kind==='manual-simulation').label,/手动模拟/);
  assert.deepEqual(Object.values(service.marketSimulations).map(m=>m.snapshot()),before);assert.equal(service.snapshot().operations.execution.paused,true);
  const old=service.actualHoldings.ledger.snapshot();await service.close();store.close();store=openStore(file);service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:()=>assert.fail('network forbidden')});assert.deepEqual(service.actualHoldings.ledger.snapshot(),old);
 }finally{await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
