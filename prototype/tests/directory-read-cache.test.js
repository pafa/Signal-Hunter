import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openSecurityDirectory,DIRECTORY_SOURCES} from '../server/security-directory.mjs';
import {digest} from '../server/codex-research.mjs';
const at=Date.parse('2026-10-11T08:00:00Z');
async function fixture(path=':memory:'){
 const store=openStore(path);let clock=at;
 const d=openSecurityDirectory(store,{now:()=>clock,fetcher:async url=>{const s=DIRECTORY_SOURCES.find(s=>s.url===url);assert(s);return new Response([s.header,s.id==='nasdaq'?'ACME|Acme Laboratories Inc. - Common Stock|Q|N|N|100|N|N':'OTHER|Other Holdings plc Ordinary Shares|N|OTHER|N|100|N|OTHER','File Creation Time: 1010202618:01'+'|'.repeat(s.id==='other'?6:7)].join('\n'));}});
 d.refresh({requestId:'directory-cache-synthetic-0001'});await d.wait();
 return {store,d,setClock:value=>{clock=value;},async close(){await d.close();store.close();}};
}
function change(db,id,mutate){const s=JSON.parse(db.prepare('SELECT payload FROM security_directory_snapshots WHERE id=?').get(id).payload);mutate(s);const {snapshotHash,...value}=s;s.snapshotHash=digest(value);db.prepare('UPDATE security_directory_snapshots SET payload=? WHERE id=?').run(JSON.stringify(s),id);}

test('callers cannot alter current directory snapshots or later identity selections',async()=>{
 const f=await fixture();try{const original=f.d.current(),basis=f.d.freezeBasis(),expected=f.d.selection('Acme Laboratories',basis);assert.equal(expected.entries[0].symbol,'ACME.US');original.entries[0].name='Caller mutation';original.sources.length=0;expected.entries[0].aliases.push('Fake alias');expected.basis.snapshots.length=0;
 assert.match(f.d.current().entries[0].name,/Acme/);assert.equal(f.d.current().sources.length,2);const next=f.d.selection('Acme Laboratories',basis);assert(!next.entries[0].aliases.includes('Fake alias'));assert.equal(next.basis.snapshots.length,1);assert.equal(f.d.selection('Fake alias',basis).entries.length,0);
 }finally{await f.close();}
});

test('local snapshot corruption invalidates warm current, historical and identity reads',async()=>{
 const f=await fixture();try{const basis=f.d.freezeBasis(),id=basis.snapshotIds[0],row=f.store.db.prepare('SELECT payload FROM security_directory_snapshots WHERE id=?').get(id);f.d.selection('Acme Laboratories',basis);f.d.search({snapshotId:id});const bad=JSON.parse(row.payload);bad.entries[0].name='Changed without a hash';f.store.db.prepare('UPDATE security_directory_snapshots SET payload=? WHERE id=?').run(JSON.stringify(bad),id);
 for(const read of [()=>f.d.current(),()=>f.d.status(),()=>f.d.search({snapshotId:id}),()=>f.d.selection('Acme Laboratories',basis)])assert.throws(read,/校验/);
 f.store.db.prepare('UPDATE security_directory_snapshots SET payload=? WHERE id=?').run(row.payload,id);assert.equal(f.d.selection('Acme Laboratories',basis).entries[0].symbol,'ACME.US');
 }finally{await f.close();}
});

test('peer commits and deletes cannot leave a cached identity or directory usable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'directory-read-cache-')),path=join(dir,'db.sqlite'),f=await fixture(path);let peer;
 try{const basis=f.d.freezeBasis(),id=basis.snapshotIds[0];f.d.selection('Acme Laboratories',basis);peer=new DatabaseSync(path);change(peer,id,s=>{s.entries[0].name='Renamed Synthetic Inc. - Common Stock';});assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,0);assert.equal(f.d.selection('Renamed Synthetic',basis).entries[0].symbol,'ACME.US');assert.match(f.d.current().entries[0].name,/Renamed/);peer.prepare('DELETE FROM security_directory_snapshots WHERE id=?').run(id);assert.equal(f.d.current(),null);assert.throws(()=>f.d.selection('Renamed Synthetic',basis),/不存在/);
 }finally{peer?.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('transaction reads validate uncommitted data and rollback cannot publish it',async()=>{
 const f=await fixture();try{const basis=f.d.freezeBasis(),id=basis.snapshotIds[0];assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,1);f.store.db.exec('BEGIN');change(f.store.db,id,s=>{s.entries[0].name='Transient Company Inc. - Common Stock';});assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,0);assert.equal(f.d.selection('Transient Company',basis).entries.length,1);f.store.db.exec('ROLLBACK');assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,1);assert.equal(f.d.selection('Transient Company',basis).entries.length,0);
 }finally{if(f.store.db.isTransaction)f.store.db.exec('ROLLBACK');await f.close();}
});

test('day changes and same-day clock rollback cannot reuse future directory evidence',async()=>{
 const f=await fixture();try{const id=f.d.current().id;change(f.store.db,id,s=>{s.sources.forEach(x=>{x.sourceDate='2026-10-12';});});assert.equal(f.d.selection('Acme Laboratories'),null);f.setClock(Date.parse('2026-10-12T08:00:00Z'));assert.equal(f.d.selection('Acme Laboratories').entries.length,1);const basis=f.d.freezeBasis();assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,1);f.setClock(Date.parse('2026-10-12T07:59:59Z'));assert.throws(()=>f.d.selection('Acme Laboratories',basis),/依据无效/);
 }finally{await f.close();}
});

test('legacy snapshots without a market field stay readable after index migration',async()=>{
 const f=await fixture();try{const id=f.d.current().id;change(f.store.db,id,s=>{delete s.market;});f.store.db.exec('DROP INDEX security_directory_market');const before=f.store.db.prepare('SELECT * FROM security_directory_snapshots').all();const reopened=openSecurityDirectory(f.store,{enabled:false,now:()=>at});try{assert.equal(reopened.current('US').id,id);assert.equal(reopened.current('CN'),null);assert.equal(reopened.selection('Acme Laboratories').entries[0].symbol,'ACME.US');assert.deepEqual(f.store.db.prepare('SELECT * FROM security_directory_snapshots').all(),before);}finally{await reopened.close();}}
 finally{await f.close();}
});

test('different event texts keep reviewed aliases separate from earlier and legacy directory bases',async()=>{
 const f=await fixture();try{
  change(f.store.db,f.d.current().id,s=>{Object.assign(s.entries[0],{symbol:'CDNS.US',sourceSymbol:'CDNS',name:'Cadence Design Systems, Inc. - Common Stock'});});
  const earlier=f.d.freezeBasis();assert.equal(f.d.selection('Cadence announces a product',earlier).entries.length,0);
  assert.equal(f.d.selection('NASDAQ:CDNS announced a product',earlier).entries[0].symbol,'CDNS.US');
  f.setClock(Date.parse('2026-10-11T08:14:33.000Z'));const reviewed=f.d.freezeBasis(),match=f.d.selection('Cadence reports results',reviewed);
  assert.equal(match.entries[0].symbol,'CDNS.US');assert(match.entries[0].nameEvidence.aliases.some(p=>p.rule==='reviewed-issuer-name'));
  match.entries[0].nameEvidence.aliases[0].alias='Caller changed the proof';
  assert(f.d.selection('Cadence introduces another product',reviewed).entries[0].nameEvidence.aliases.some(p=>p.alias==='Cadence'));
  assert.equal(f.d.selection('Cadence introduces another product',earlier).entries.length,0);
  assert.equal(f.d.selection('Cadence introduces another product',{...reviewed,schema:'security-directory-basis/1'}).entries.length,0);
  assert.equal(f.d.selection('NYSE:CDNS changed guidance',reviewed).entries.length,0);
 }finally{await f.close();}
});

test('prepared names cannot bypass a listing date across current and historical queries',async()=>{
 const f=await fixture();try{
  change(f.store.db,f.d.current().id,s=>{s.entries[0].listingDate='2026-10-12';});
  const earlier=f.d.freezeBasis();assert.equal(f.d.selection('Acme Laboratories announces results',earlier).entries.length,0);
  assert.equal(f.d.selection('Other Holdings announces results',earlier).entries[0].symbol,'OTHER.US');
  f.setClock(Date.parse('2026-10-12T08:00:00Z'));const later=f.d.freezeBasis();
  assert.equal(f.d.selection('Acme Laboratories announces new results',later).entries[0].symbol,'ACME.US');
  assert.equal(f.d.selection('NASDAQ:ACME announces an update',earlier).entries.length,0);
  assert.equal(f.d.selection('NASDAQ:ACME announces an update',later).entries[0].symbol,'ACME.US');
 }finally{await f.close();}
});


test('long material recall preserves later complete names, normalized punctuation and non-ASCII boundaries without accepting near-matches',async()=>{
 const f=await fixture();try{
  const padding='Unrelated synthetic material without a listed issuer. '.repeat(400),basis=f.d.freezeBasis();
  for(const [text,symbols] of [
   ['xAcme Laboratoriesx '+padding,[]],
   ['Acme Laboratoriesx '+padding+' Acme Laboratories',['ACME.US']],
   ['xAcme Laboratories '+padding+' Acme---Laboratories',['ACME.US']],
   ['Ａｃｍｅ Ｌａｂｏｒａｔｏｒｉｅｓ '+padding,['ACME.US']],
   ['中Acme Laboratories中 '+padding,['ACME.US']],
   [padding+' Acme Laboratories; Other Holdings',['ACME.US','OTHER.US']],
   [padding+' Other Holdingsx',[]]
  ])for(const schema of ['security-directory-basis/1','security-directory-basis/2'])assert.deepEqual(f.d.selection(text,{...basis,schema}).entries.map(e=>e.symbol),symbols,`${schema}: ${text.slice(-80)}`);
 }finally{await f.close();}
});

test('unrelated local and peer task writes keep exact identity results while revalidating changed directory bytes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'directory-active-read-')),path=join(dir,'db.sqlite'),f=await fixture(path);let peer;
 try{
  const basis=f.d.freezeBasis(),id=basis.snapshotIds[0],expected=f.d.selection('Acme Laboratories and Other Holdings',basis);
  peer=new DatabaseSync(path);
  for(const db of [f.store.db,peer]){
   db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('synthetic-background-task','changed');
   assert.deepEqual(f.d.selection('Acme Laboratories and Other Holdings',basis),expected);
  }
  const row=peer.prepare('SELECT payload FROM security_directory_snapshots WHERE id=?').get(id),invalid=JSON.parse(row.payload);invalid.entries[0].name='Renamed but not verified';
  peer.prepare('UPDATE security_directory_snapshots SET payload=? WHERE id=?').run(JSON.stringify(invalid),id);
  assert.throws(()=>f.d.selection('Acme Laboratories and Other Holdings',basis),/校验/);
  peer.prepare('UPDATE security_directory_snapshots SET payload=? WHERE id=?').run(row.payload,id);
  assert.deepEqual(f.d.selection('Acme Laboratories and Other Holdings',basis),expected);
  change(peer,id,s=>{s.entries[0].name='Renamed Synthetic Inc. - Common Stock';});
  assert.equal(f.d.selection('Acme Laboratories',basis).entries.length,0);
  assert.equal(f.d.selection('Renamed Synthetic',basis).entries[0].symbol,'ACME.US');
 }finally{peer?.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('prepared content reused after task writes keeps query dates, naming policies and transaction views separate',async()=>{
 const f=await fixture();try{
  const id=f.d.current().id;change(f.store.db,id,s=>{Object.assign(s.entries[0],{symbol:'CDNS.US',sourceSymbol:'CDNS',name:'Cadence Design Systems, Inc. - Common Stock',listingDate:'2026-10-12'});});
  const earlier=f.d.freezeBasis();assert.equal(f.d.selection('Cadence Design Systems',earlier).entries.length,0);
  f.setClock(Date.parse('2026-10-12T08:00:00Z'));const later=f.d.freezeBasis(),expected=f.d.selection('Cadence announces new products',later);assert.equal(expected.entries[0].symbol,'CDNS.US');
  f.store.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('synthetic-background-task','changed');
  assert.equal(f.d.selection('Cadence Design Systems',earlier).entries.length,0);
  assert.deepEqual(f.d.selection('Cadence announces new products',later),expected);
  assert.equal(f.d.selection('Cadence announces new products',{...later,schema:'security-directory-basis/1'}).entries.length,0);
  f.store.db.exec('BEGIN');change(f.store.db,id,s=>{s.entries[0].name='Transient Name Inc. - Common Stock';});
  assert.equal(f.d.selection('Cadence announces new products',later).entries.length,0);
  assert.equal(f.d.selection('Transient Name',later).entries[0].symbol,'CDNS.US');f.store.db.exec('ROLLBACK');
  assert.deepEqual(f.d.selection('Cadence announces new products',later),expected);
  assert.equal(f.d.selection('Transient Name',later).entries.length,0);
 }finally{if(f.store.db.isTransaction)f.store.db.exec('ROLLBACK');await f.close();}
});
