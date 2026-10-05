import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,symlinkSync,lstatSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {inventoryDatabase,compareInventories} from '../server/database-inventory.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {createPersistentScheduler} from '../server/persistent-scheduler.mjs';

async function fixture(run){
 const dir=mkdtempSync(join(tmpdir(),'signal-recovery-')),path=join(dir,'source.sqlite'),store=openStore(path);
 assertDatabaseMode(store,'research');const service=createService(store,{mode:'research'});
 try{await run({dir,path,store,service});}finally{await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
}
const backup=f=>createBackup(f.path,join(f.dir,'backups'));
const call=async(handler,method,url,data={})=>{
 let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:x=>status=x,end:x=>result=JSON.parse(x)});return {status,result};
};

test('inventory catches same-count substitutions, duplicate loss, blobs and exact 64-bit integers',()=>fixture(async f=>{
 f.store.db.exec('CREATE TABLE unusual(v); INSERT INTO unusual VALUES(9223372036854775806),(9223372036854775807),(NULL),(NULL),(1.5),(X\'00FF\'),(\'1\')');
 f.store.db.exec('CREATE TABLE "__proto__"(v); INSERT INTO "__proto__" VALUES(1)');
 const before=inventoryDatabase(f.path);assert.equal(before.tables.unusual.count,7);
 assert.equal(Object.hasOwn(before.tables,'__proto__'),true);assert.equal(before.tables.__proto__.count,1);
 f.store.db.exec('UPDATE unusual SET v=9223372036854775805 WHERE v=9223372036854775806');
 let diff=compareInventories(before,inventoryDatabase(f.path));assert.equal(diff.passed,false);assert.equal(diff.tables.find(t=>t.name==='unusual').removed,1);
 f.store.db.exec('DELETE FROM unusual WHERE rowid=(SELECT rowid FROM unusual WHERE v IS NULL LIMIT 1)');
 diff=compareInventories(before,inventoryDatabase(f.path));assert.equal(diff.tables.find(t=>t.name==='unusual').removed,2);
 assert.equal(compareInventories(before,before).passed,true);
}));

test('online snapshot includes WAL writes; restoration changes only documented control fields',()=>fixture(async f=>{
 f.service.research.create({title:'Synthetic saved version',summary:'Fixture'});
 f.store.db.exec("UPDATE operation_tasks SET token='old-token',lease_until=1,state='running'; INSERT INTO operation_runs(name,token,started_at,outcome) VALUES('news','old-token','2026-10-01T00:00:00Z','running')");
 const original=inventoryDatabase(f.path),b=await backup(f),target=join(f.dir,'restored.sqlite');
 assert.equal(compareInventories(original,inventoryDatabase(join(b.directory,'workbench.sqlite'))).passed,true);
 const result=restoreBackup(b.directory,target);assert.equal(result.verified,true);
 assert.equal(compareInventories(inventoryDatabase(join(b.directory,'workbench.sqlite'),{restoreProjection:true}),inventoryDatabase(target)).passed,true);
 assert.equal(compareInventories(original,inventoryDatabase(f.path)).passed,true);
 assert.equal(statSync(target).mode&0o777,0o600);
}));

test('failed restore cannot publish a partially paused database or overwrite occupied paths',()=>fixture(async f=>{
 f.store.db.exec("CREATE TRIGGER reject_restore BEFORE UPDATE ON operation_tasks BEGIN SELECT RAISE(ABORT,'synthetic restore failure'); END");
 const b=await backup(f),target=join(f.dir,'failed.sqlite');
 assert.throws(()=>restoreBackup(b.directory,target),/synthetic restore failure/);assert.equal(existsSync(target),false);
 f.store.db.exec('DROP TRIGGER reject_restore');const good=await backup(f);
 writeFileSync(target,'existing');assert.throws(()=>restoreBackup(good.directory,target),/全新路径/);assert.equal(readFileSync(target,'utf8'),'existing');
 const dangling=join(f.dir,'dangling.sqlite');symlinkSync(join(f.dir,'absent'),dangling);
 assert.throws(()=>restoreBackup(good.directory,dangling),/全新路径/);assert.ok(lstatSync(dangling).isSymbolicLink());
 const sidecar=join(f.dir,'sidecar.sqlite');writeFileSync(sidecar+'-journal','existing');assert.throws(()=>restoreBackup(good.directory,sidecar),/全新路径/);assert.equal(existsSync(sidecar),false);
}));

test('restored startup, reads and background ticks preserve expired model records and every existing row',()=>fixture(async f=>{
 f.store.db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run('model','topic','running','2026-01-01',1,JSON.stringify({id:'model',status:'running'}));
 f.store.db.prepare('INSERT INTO semantic_runs VALUES(?,?,?,?,?)').run('semantic','pair','running',1,JSON.stringify({id:'semantic',status:'running'}));
 // Unprocessed input would otherwise be screened by tick().
 f.store.ingest([{id:'unscreened',title:'Synthetic firm bankruptcy',url:'https://example.org/fixture',publisher:'Fixture',publishedAt:'2026-10-02T12:00:00Z'}],'2026-10-02T12:01:00Z');
 const b=await backup(f),report=await rehearseRecovery(b.directory,join(f.dir,'drills'));
 assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.networkAttempts,0);assert.equal(report.idle.identical,true);assert.equal(report.rollback.identical,true);
 const persisted=JSON.parse(readFileSync(join(report.directory,'report.json')));assert.equal(persisted.passed,true);
}));

test('recovery preserves both 500k books and sealed evaluation sources, labels and report hashes',()=>fixture(async f=>{
 for(const [id,profile] of Object.entries(strategyProfiles))f.service.marketSimulations[id].initialize({requestId:randomUUID(),version:0,initialUSD:500000,config:profile.suggestedConfig,confirmSimulation:true});
 const sample={id:'synthetic',revision:1,title:'Synthetic fixture',url:'https://example.org/fixture',publisher:'Fixture',publishedAt:'2026-10-01T00:00:00Z',articleFirstSeen:'2026-10-01T00:00:00Z',revisionFirstSeen:'2026-10-01T00:00:00Z'};
 f.service.research.screenings.capture(sample,{bucket:'background'},'2026-10-01T00:01:00Z');
 const api=f.service.evaluations;let b=api.create({requestId:randomUUID(),version:0,title:'Recovery fixture',start:'2026-10-01T00:00:00Z',end:'2026-10-01T01:00:00Z',rulesHash:f.service.research.screenings.rulesHash});
 b=api.annotate(b.id,{requestId:randomUUID(),version:b.version,label:{sampleId:b.samples[0].id,verdict:'unclear',clusterId:'fixture',reviewer:'Synthetic reviewer',exposure:'unseen-attested',reason:'Fixture only',novelty:'',scale:'',mechanism:''}});
 b=api.seal(b.id,{requestId:randomUUID(),version:b.version,confirm:true});const expected=api.export(b.id);
 const snapshot=await backup(f),report=await rehearseRecovery(snapshot.directory,join(f.dir,'drills'));assert.equal(report.passed,true,JSON.stringify(report));
 const copy=openStore(join(report.directory,'candidate.sqlite')),s=createService(copy,{mode:'research'});
 try{assert.deepEqual(s.evaluations.export(b.id),expected);for(const id of Object.keys(strategyProfiles)){assert.equal(s.marketSimulations[id].snapshot().cashCents,50000000);assert.equal(s.marketSimulations[id].history().length,f.service.marketSimulations[id].history().length);}}finally{await s.close();copy.close();}
}));

test('rehearsal reports a destructive candidate as failed while rollback retains the original rows',()=>fixture(async f=>{
 f.service.research.create({title:'Must survive',summary:'Fixture'});const b=await backup(f);
 const report=await rehearseRecovery(b.directory,join(f.dir,'drills'),{initialize:(store,options)=>{store.db.exec('DELETE FROM research_versions');return createService(store,options);}});
 assert.equal(report.passed,false);assert.equal(report.startup.passed,false);assert.equal(report.startup.tables.find(t=>t.name==='research_versions').removed,1);assert.equal(report.rollback.passed,true);assert.equal(report.snapshotUnchanged,true);
 const failed=await rehearseRecovery(b.directory,join(f.dir,'drills'),{initialize:()=>{throw new Error('synthetic startup failure');}});
 assert.equal(failed.passed,false);assert.equal(failed.rollback.passed,true);assert.equal(failed.failure.message,'synthetic startup failure');
}));

test('restore HTTP review blocks edits, permits viewing and acknowledgement, and keeps tasks paused',()=>fixture(async f=>{
 const b=await backup(f),path=join(f.dir,'copy.sqlite');restoreBackup(b.directory,path);
 const store=openStore(path),service=createService(store,{mode:'research'}),handler=createHandler(store,service);
 try{
  assert.equal((await call(handler,'GET','/api/data')).status,200);
  assert.equal((await call(handler,'POST','/api/research',{title:'blocked'})).status,409);
  assert.equal((await call(handler,'POST','/api/operations/news',{action:'resume'})).status,400);
  assert.equal((await call(handler,'POST','/api/operations/restore-review',{confirm:true})).status,200);
  assert.equal(service.health().restoreReviewRequired,false);assert.ok(Object.values(service.operations().tasks).every(t=>t.paused));
 }finally{await service.close();store.close();}
}));

test('restore review blocks even an accidentally unpaused scheduler lane and direct model starts',()=>fixture(async f=>{
 f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();let calls=0;
 const scheduler=createPersistentScheduler(f.store.db,{news:()=>{calls++;return {ok:true};}});
 try{await scheduler.run('news',{force:true});assert.equal(calls,0);assert.throws(()=>f.service.modelResearch.start('any',{version:1}),/恢复副本/);assert.throws(()=>f.service.semanticEvents.start({}),/恢复副本/);await assert.rejects(f.service.refreshNews(),/恢复副本/);}finally{await scheduler.stop();}
}));

test('restore rejects a trigger that silently rewrites business data even when counts match',()=>fixture(async f=>{
 f.service.research.create({title:'Original',summary:'Must remain exact'});
 f.store.db.exec("CREATE TRIGGER unexpected_change AFTER UPDATE ON operation_tasks BEGIN UPDATE research_versions SET reason='rewritten'; END");
 const b=await backup(f),target=join(f.dir,'unsafe.sqlite');
 assert.throws(()=>restoreBackup(b.directory,target),/恢复核验失败/);assert.equal(existsSync(target),false);
 assert.notEqual(f.store.db.prepare('SELECT reason FROM research_versions').get().reason,'rewritten');
}));

test('restored demo never seeds missing examples or persists expiry of pending scenario orders',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-demo-recovery-')),path=join(dir,'source.sqlite'),store=openStore(path);
 assertDatabaseMode(store,'demo');const service=createService(store,{mode:'demo',now:()=>Date.parse('2026-01-01T00:00:00Z')});
 try{
  const original=service.paper.history();assert.ok(service.paper.snapshot().orders.some(o=>o.status==='pending'));
  const b=await createBackup(path,join(dir,'backups')),report=await rehearseRecovery(b.directory,join(dir,'drills'));
  assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.idle.identical,true);
  assert.equal(report.original.tables.paper_versions.count,original.length);
 }finally{await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
