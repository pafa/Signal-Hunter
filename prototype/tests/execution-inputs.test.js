import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openExecutionInputs,loadExecutionConfig,readPrivateExecutionFile} from '../server/execution-inputs.mjs';
import {executionFeedFixture} from './fixtures/execution-feed.mjs';
const start='2026-10-06T14:00:00Z';
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
