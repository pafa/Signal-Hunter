import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openExecutionInputs,loadExecutionConfig,readPrivateExecutionFile} from '../server/execution-inputs.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';
import {createHash} from 'node:crypto';
const start='2026-10-06T14:00:00Z';
test('an out-of-order executable quote is archived but cannot replace a newer accepted price, even after an invalid packet',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');const now=Date.parse(start)+3000,feed=openExecutionInputs(store,{config:f.config,now:()=>now});
 try{
  f.write([f.quote('2026-10-06T14:00:02Z',{mark:'102'})]);assert.equal(feed.refresh().accepted,1);
  f.write([f.quote('2026-10-06T14:00:01Z',{mark:'90'})]);assert.equal(feed.refresh().accepted,0);assert.deepEqual(feed.inputs().quotes,{});
  writeFileSync(f.framePath,'bad-json');feed.refresh();f.write([f.quote(start)]);assert.equal(feed.refresh().accepted,0);
  f.write([f.quote('2026-10-06T14:00:03Z',{mark:'103'})]);assert.equal(feed.refresh().accepted,1);assert.equal(feed.inputs().quotes['AAPL.US'].mark,'103');
  assert.equal(store.db.prepare('SELECT count(*) n FROM execution_input_frames').get().n,5);
 }finally{store.close();f.close();}
});
test('security clocks are independent and survive partial or empty frames across all three market identifiers',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:'),feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)+4000});
 try{
  const newer='2026-10-06T14:00:02Z',latest='2026-10-06T14:00:03Z',symbols=['AAPL.US','00700.HK','600519.SH'];
  f.write(symbols.map(s=>f.quote(newer,{},s)));assert.equal(feed.refresh().accepted,3);
  f.write([f.quote(start),f.quote(latest,{},'00700.HK')]);const partial=feed.refresh();assert.equal(partial.accepted,1);assert.equal(partial.rejected,1);assert.deepEqual(Object.keys(feed.inputs().quotes),['00700.HK']);
  f.write([f.quote(start,{},'600519.SH')]);assert.equal(feed.refresh().accepted,0);assert.deepEqual(feed.inputs().quotes,{});
  f.write([f.quote(latest,{},'600519.SH')]);assert.equal(feed.refresh().accepted,1);
 }finally{store.close();f.close();}
});
test('ordering preserves nanosecond distinctions and equivalent timezone spellings',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:'),feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)+1});
 try{
  const write=at=>f.write([f.quote(at)]);
  write('2026-10-06T14:00:00.000000200Z');assert.equal(feed.refresh().accepted,1);
  write('2026-10-06T22:00:00.000000200+08:00');assert.equal(feed.refresh().accepted,1,'same instant is not a regression');
  write('2026-10-06T14:00:00.000000199Z');assert.equal(feed.refresh().accepted,0);
  write('2026-10-06T14:00:00.000000201Z');assert.equal(feed.refresh().accepted,1);
 }finally{store.close();f.close();}
});
test('invalid future or unverified quotes cannot poison a security clock; reads do not write',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:'),feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)+4000});
 try{
  f.write([f.quote('2026-10-06T14:00:02Z')]);feed.refresh();
  f.write([f.quote('2026-10-06T14:00:05Z')]);assert.equal(feed.refresh().accepted,0);
  f.write([f.quote('2026-10-06T14:00:04Z',{capacityVerified:false})]);assert.equal(feed.refresh().accepted,0);
  f.write([f.quote('2026-10-06T14:00:03Z')]);assert.equal(feed.refresh().accepted,1);
  const writes=store.db.prepare('SELECT total_changes() n').get().n;feed.inputs();feed.status();assert.equal(store.db.prepare('SELECT total_changes() n').get().n,writes);
 }finally{store.close();f.close();}
});
test('latest accepted times survive close/reopen and do not reset when the active packet was rejected',()=>{
 const f=executionFeedFixture(),path=join(f.dir,'ordering.sqlite');let store=openStore(path),feed;
 const open=()=>openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)+4000});
 try{
  feed=open();f.write([f.quote('2026-10-06T14:00:02Z')]);feed.refresh();writeFileSync(f.framePath,'bad-json');feed.refresh();const old=store.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all();
  store.close();store=openStore(path);feed=open();f.write([f.quote('2026-10-06T14:00:01Z')]);assert.equal(feed.refresh().accepted,0);assert.deepEqual(store.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid LIMIT 2').all(),old);
  f.write([f.quote('2026-10-06T14:00:03Z')]);assert.equal(feed.refresh().accepted,1);
 }finally{store.close();f.close();}
});
test('another connection advancing the source is respected, and a failed packet commit rolls back its time and archive',()=>{
 const f=executionFeedFixture(),path=join(f.dir,'shared.sqlite'),a=openStore(path),b=openStore(path);
 try{
  const one=openExecutionInputs(a,{config:f.config,now:()=>Date.parse(start)+4000}),two=openExecutionInputs(b,{config:f.config,now:()=>Date.parse(start)+4000});
  f.write([f.quote('2026-10-06T14:00:02Z')]);assert.equal(one.refresh().accepted,1);f.write([f.quote('2026-10-06T14:00:01Z')]);assert.equal(two.refresh().accepted,0);
  const clocks=a.db.prepare('SELECT * FROM execution_input_watermarks').all(),frames=a.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all(),state=a.db.prepare('SELECT * FROM execution_input_state').all();
  a.db.exec("CREATE TRIGGER fail_input_state BEFORE INSERT ON execution_input_state BEGIN SELECT RAISE(ABORT,'synthetic commit failure'); END");f.write([f.quote('2026-10-06T14:00:04Z')]);assert.throws(()=>two.refresh(),/synthetic commit failure/);
  assert.deepEqual(a.db.prepare('SELECT * FROM execution_input_watermarks').all(),clocks);assert.deepEqual(a.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all(),frames);assert.deepEqual(a.db.prepare('SELECT * FROM execution_input_state').all(),state);
  a.db.exec('DROP TRIGGER fail_input_state');f.write([f.quote('2026-10-06T14:00:03Z')]);assert.equal(two.refresh().accepted,1,'failed newer commit must not prevent the next valid packet');
 }finally{a.close();b.close();f.close();}
});
test('upgrade derives the maximum from all accepted history without rewriting packets or trusting a regressed current state',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');const open=()=>openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)+4000});
 try{
  let feed=open();f.write([f.quote('2026-10-06T14:00:02Z')]);feed.refresh();const saved=JSON.parse(store.db.prepare('SELECT payload FROM execution_input_state').get().payload),quote=f.quote('2026-10-06T14:00:01Z'),raw=f.write([quote],'legacy-regression'),hash=createHash('sha256').update(raw).digest('hex'),legacy={...saved,frameHash:hash,quotes:{'AAPL.US':{...saved.quotes['AAPL.US'],...quote,provenance:{frameHash:hash,packetId:'legacy-regression',source:f.config.source}}}};
  store.db.prepare('INSERT INTO execution_input_frames VALUES(?,?,?,?,?,?,?)').run(hash,saved.configurationHash,JSON.stringify(f.config),f.config.source,saved.receivedAt,raw,JSON.stringify(legacy));store.db.prepare('UPDATE execution_input_state SET payload=?').run(JSON.stringify(legacy));
  store.db.exec("DROP TABLE execution_input_watermarks; DELETE FROM settings WHERE key='execution_input_ordering/1'");const frames=store.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all(),state=store.db.prepare('SELECT * FROM execution_input_state').all();
  feed=open();assert.deepEqual(store.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all(),frames);assert.deepEqual(store.db.prepare('SELECT * FROM execution_input_state').all(),state);assert.equal(feed.status().accepted,0);assert.deepEqual(feed.inputs().quotes,{});
  const writes=store.db.prepare('SELECT total_changes() n').get().n;feed.inputs();feed.status();assert.equal(store.db.prepare('SELECT total_changes() n').get().n,writes);
  assert.equal(feed.refresh().accepted,0,'an unchanged legacy frame must be rechecked instead of restoring its former acceptance');assert.deepEqual(store.db.prepare('SELECT * FROM execution_input_frames ORDER BY rowid').all(),frames);
  f.write([f.quote('2026-10-06T14:00:03Z')]);assert.equal(feed.refresh().accepted,1);
 }finally{store.close();f.close();}
});
test('only private regular local files with reviewed capabilities can configure the execution bridge',()=>{
 const f=executionFeedFixture();try{
  const path=join(f.dir,'config.json');writeFileSync(path,JSON.stringify(f.config),{mode:0o600});assert.deepEqual(loadExecutionConfig(path),f.config);
  chmodSync(path,0o644);assert.throws(()=>loadExecutionConfig(path),/0600/);chmodSync(path,0o600);
  const link=join(f.dir,'link');symlinkSync(path,link);assert.throws(()=>loadExecutionConfig(link),/0600/);
  assert.throws(()=>readPrivateExecutionFile(path,1));assert.throws(()=>readPrivateExecutionFile('relative'));
  for(const bad of [{...f.config,permission:{...f.config.permission,reviewed:false}},{...f.config,capabilities:{...f.config.capabilities,quantityUnit:'lots'}},{...f.config,capabilities:{...f.config.capabilities,feesVerified:false}}]){writeFileSync(path,JSON.stringify(bad));assert.throws(()=>loadExecutionConfig(path));}
 }finally{f.close();}
});
test('accepted and rejected packets persist; input loss never executes an old good packet',()=>{
 const f=executionFeedFixture();let store=openStore(join(f.dir,'isolated.sqlite'));try{
  const source=()=>openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)});let feed=source();
  f.write([f.quote(start)]);assert.equal(feed.refresh().accepted,1);const frozen=store.db.prepare('SELECT * FROM execution_input_frames').get();
  assert.equal(feed.inputs().quotes['AAPL.US'].executionFeed,true);assert.deepEqual(feed.refresh(),{skipped:'unchanged-frame'});
  store.close();store=openStore(join(f.dir,'isolated.sqlite'));feed=source();assert.equal(feed.status().accepted,1);
  f.write([f.quote(start,{capacityVerified:false})],'rejected');assert.equal(feed.refresh().accepted,0);assert.deepEqual(feed.inputs().quotes,{});
  assert.deepEqual(store.db.prepare('SELECT * FROM execution_input_frames WHERE hash=?').get(frozen.hash),frozen);
  writeFileSync(f.framePath,'bad-json');assert.match(feed.refresh().error,/格式失败/);assert.deepEqual(feed.inputs().quotes,{});
  assert.equal(store.db.prepare('SELECT count(*) n FROM execution_input_frames').get().n,3);
  assert.equal(JSON.stringify(feed.status()).includes(f.dir),false);
 }finally{store.close();f.close();}
});
test('permission expiry, pause while reading and restore review block writes and cached execution',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');let now=Date.parse(start),active=true;
 try{
  f.write([f.quote(start)]);const feed=openExecutionInputs(store,{config:f.config,now:()=>now,readFrame:path=>{const raw=readPrivateExecutionFile(path);active=false;return raw;}});
  assert.throws(()=>feed.refresh({assertActive(){if(!active)throw Error('paused');}}),/paused/);assert.equal(feed.status().accepted,0);
  const normal=openExecutionInputs(store,{config:f.config,now:()=>now});normal.refresh();now=Date.parse('2026-10-08T00:00:00Z');assert.deepEqual(normal.inputs().quotes,{});assert.match(normal.refresh().error,/授权/);assert.equal(normal.status().permissionCurrent,false);
  store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>normal.refresh(),/恢复副本/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM execution_input_frames').get().n,1);
 }finally{store.close();f.close();}
});
test('reprocessing the same raw packet with a new rights configuration retains both review versions',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');try{
  f.write([f.quote(start)]);const first=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)});first.refresh();const old=store.db.prepare('SELECT * FROM execution_input_frames').get();
  const config=structuredClone(f.config);config.permission.id='replacement-test-rights';config.permission.sourceDocument='New synthetic permission record';const second=openExecutionInputs(store,{config,now:()=>Date.parse(start)});assert.deepEqual(second.inputs().quotes,{});assert.equal(second.refresh().accepted,1);
  const rows=store.db.prepare('SELECT * FROM execution_input_frames').all();assert.equal(rows.length,2);assert.equal(rows[0].hash,rows[1].hash);assert.notEqual(rows[0].configuration_hash,rows[1].configuration_hash);assert.deepEqual(rows.find(r=>r.configuration_hash===old.configuration_hash),old);assert.equal(JSON.parse(rows[1].configuration).permission.id,config.permission.id);
 }finally{store.close();f.close();}
});
test('duplicates, reference FX, wrong source and unverified queue capacity cannot become executable inputs',()=>{
 const f=executionFeedFixture(),store=openStore(':memory:');try{
  const feed=openExecutionInputs(store,{config:f.config,now:()=>Date.parse(start)});
  f.write([f.quote(start),f.quote(start),f.quote(start)]);assert.equal(feed.refresh().accepted,0);
  for(const extra of [{source:'other'},{fx:{...f.quote(start).fx,executable:false}},{fees:null},{liquidityBasis:'after-queue',queueVerified:true}]){f.write([f.quote(start,extra)]);assert.equal(feed.refresh().accepted,0);}
  f.write([f.quote(start,{liquidityBasis:'after-queue',queueVerified:true,queueEvidence:'synthetic queue'}),f.quote(start,{rulesVerified:false},'MSFT.US')]);const r=feed.refresh();assert.equal(r.accepted,1);assert.equal(r.rejected,1);
 }finally{store.close();f.close();}
});
