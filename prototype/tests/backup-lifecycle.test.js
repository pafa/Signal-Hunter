import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,realpath,symlink,link,open,access,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {backupPolicy,DEFAULT_BACKUP_POLICY,createManagedBackup,maintainBackups,previewManagedBackups,openBackupFiles,backupOwnerId} from '../server/backup-lifecycle.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const huge=100*1024**3,policy={maxBackups:5,maxBackupBytes:16*1024**2,minFreeBytes:1024};
const options={policy,probeOpenFiles:async()=>new Set(),freeSpace:()=>huge};
function database(path,anchor='original'){
 const db=new DatabaseSync(path);try{
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES('runtime_mode','research'); CREATE TABLE news(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO news VALUES(1,'Synthetic backup fixture'); CREATE TABLE research_versions(topic_id TEXT,version INTEGER,recorded_at TEXT,payload TEXT)");
  db.prepare('INSERT INTO research_versions VALUES(?,1,?,?)').run(anchor,'2026-10-01T00:00:00Z',JSON.stringify({anchor}));
 }finally{db.close();}
}
async function fixture(run){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'backup-lifecycle-'))),source=join(dir,'live.sqlite'),root=join(dir,'backups');
 try{database(source);await mkdir(root);await run({dir,source,root});}finally{await rm(dir,{recursive:true,force:true});}
}
async function snapshot(f,days=0,source=f.source){
 const b=await createBackup(source,f.root,{ownerId:backupOwnerId(source)}),mp=join(b.directory,'manifest.json'),manifest=JSON.parse(await readFile(mp));
 manifest.createdAt=new Date(Date.now()-days*86400000).toISOString();await writeFile(mp,JSON.stringify(manifest));return b.directory;
}
const names=root=>readdir(root).then(rows=>rows.sort());
async function copies(f,ages){const out=[];for(const age of ages)out.push(await snapshot(f,age));return out;}

test('bounded defaults reject weakened recovery reserve, invalid values and unknown fields',()=>{
 assert.deepEqual(backupPolicy(),DEFAULT_BACKUP_POLICY);assert.equal(backupPolicy().maxBackupBytes,6*1024**3);
 for(const bad of [{keepNewest:2},{maxBackups:3},{maxAgeDays:0},{minFreeBytes:NaN},{maxBackupBytes:1.5},{automaticDeletion:false},null,[]])assert.throws(()=>backupPolicy(bad));
});
test('count limit removes oldest valid copies and retained snapshots restore the source data',()=>fixture(async f=>{
 const list=await copies(f,[6,5,4,3,2,1]),before=hash(await readFile(f.source));
 const preview=await previewManagedBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:4}});
 assert.deepEqual(preview.candidates.map(s=>s.directory),list.slice(0,2));assert.equal((await names(f.root)).length,6);
 const result=await maintainBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:4}});
 assert.deepEqual(result.removed.map(s=>s.directory),list.slice(0,2));assert.equal((await names(f.root)).length,4);
 assert.equal(hash(await readFile(f.source)),before);
 const restored=join(f.dir,'restored.sqlite');restoreBackup(list.at(-1),restored);
 const db=new DatabaseSync(restored,{readOnly:true});try{assert.equal(db.prepare('SELECT title FROM news').get().title,'Synthetic backup fixture');assert.equal(db.prepare('SELECT count(*) n FROM research_versions').get().n,1);assert.equal(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get().value,'1');}finally{db.close();}
}));
test('age alone prunes expired copies while newest three remain even when old',()=>fixture(async f=>{
 const list=await copies(f,[40,30,20,10,9,8]);
 const r=await maintainBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:10}});
 assert.deepEqual(r.removed.map(s=>s.directory),list.slice(0,3));assert.equal((await names(f.root)).length,3);
}));
test('byte cap independently prunes young snapshots',()=>fixture(async f=>{
 await copies(f,[5,4,3,2,1]);const p=await previewManagedBackups(f.source,f.root,options),bytes=p.usage.snapshots[0].bytes;
 const r=await maintainBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:10,maxBackupBytes:bytes*3+4096}});
 assert.equal(r.removed.length,2);assert.equal((await names(f.root)).length,3);assert.equal(r.blocked.length,0);
}));
test('managed creation reserves capacity before copying and stays at the count limit',()=>fixture(async f=>{
 const list=await copies(f,[5,4,3,2,1]);const r=await createManagedBackup(f.source,f.root,options);
 assert.equal(r.retention.removed.length,1);assert.equal(r.retention.removed[0].directory,list[0]);
 assert.equal((await names(f.root)).length,5);assert.deepEqual((await names(r.directory)),['manifest.json','workbench.sqlite']);
 restoreBackup(r.directory,join(f.dir,'restored.sqlite'));
}));
test('unknown, foreign, pinned, incomplete, open and hardlinked entries are protected and charged to capacity',()=>fixture(async f=>{
 const valid=await copies(f,[6,5,4,3]);const foreign=join(f.dir,'foreign.sqlite');database(foreign,'other');const foreignCopy=await snapshot(f,10,foreign);
 const pinned=await snapshot(f,20);await writeFile(join(pinned,'KEEP'),'manual recovery reserve');
 const incomplete=join(f.root,'snapshot-incomplete');await mkdir(incomplete);await writeFile(join(incomplete,'workbench.sqlite'),Buffer.alloc(2048));
 const hard=await snapshot(f,20);await link(join(hard,'workbench.sqlite'),join(f.dir,'linked.sqlite'));
 const held=await snapshot(f,30),probeOpenFiles=async()=>new Set([join(held,'workbench.sqlite')]);
 const p=await previewManagedBackups(f.source,f.root,{...options,probeOpenFiles,policy:{...policy,maxBackups:8}});
 assert.equal(p.usage.protectedEntries.length,5);assert.deepEqual(p.candidates.map(s=>s.directory),[valid[0]]);
 await maintainBackups(f.source,f.root,{...options,probeOpenFiles,policy:{...policy,maxBackups:8}});
 for(const dir of [foreignCopy,pinned,incomplete,hard,held,...valid.slice(1)])await access(dir);
}));
test('corrupt newest snapshots never replace the three verified recovery copies',()=>fixture(async f=>{
 const valid=await copies(f,[6,5,4,3,2]),bad=await copies(f,[1,0.5,0]);
 for(const dir of bad)await writeFile(join(dir,'workbench.sqlite'),'corrupt');
 const r=await maintainBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:6}});
 assert.deepEqual(r.removed.map(s=>s.directory),valid.slice(0,2));for(const dir of [...valid.slice(2),...bad])await access(dir);
}));
test('a database fork sharing history and legacy snapshots without ownership remain protected',()=>fixture(async f=>{
 await copies(f,[4,3,2,1]);const fork=join(f.dir,'fork.sqlite');await copyFile(f.source,fork);
 const foreign=await snapshot(f,30,fork),legacy=await createBackup(f.source,f.root);
 const r=await maintainBackups(f.source,f.root,{...options,policy:{...policy,maxBackups:5}});
 assert.equal(r.removed.length,1);assert.equal(r.protectedEntries.length,2);await access(foreign);await access(legacy.directory);
}));
test('protected bytes and required minimum cause a clean refusal without deleting existing backups',()=>fixture(async f=>{
 await copies(f,[3,2,1]);await writeFile(join(f.root,'keep.bin'),Buffer.alloc(1024**2));const before=await names(f.root);
 await assert.rejects(createManagedBackup(f.source,f.root,{...options,policy:{...policy,maxBackupBytes:1024**2}}),/停止新增.*容量/);
 assert.deepEqual(await names(f.root),before);
}));
test('low disk space fails before copying and no open-file inspection failure permits deletion',()=>fixture(async f=>{
 await copies(f,[3,2,1]);const before=await names(f.root);
 await assert.rejects(createManagedBackup(f.source,f.root,{...options,freeSpace:()=>1}),/剩余空间/);
 await assert.rejects(maintainBackups(f.source,f.root,{...options,probeOpenFiles:async()=>{throw new Error('inspection unavailable');}}),/inspection unavailable/);
 assert.deepEqual(await names(f.root),before);
}));
test('disk pressure during the copy aborts and removes only its own incomplete files',()=>fixture(async f=>{
 const db=new DatabaseSync(f.source);db.exec('CREATE TABLE payload(data BLOB); INSERT INTO payload VALUES(zeroblob(2000000))');db.close();
 await copies(f,[3,2,1]);const before=await names(f.root);let reads=0;
 await assert.rejects(createManagedBackup(f.source,f.root,{...options,freeSpace:()=>++reads<=2?huge:0}),/剩余空间/);
 assert.ok(reads>=3);assert.deepEqual(await names(f.root),before);
}));
test('database growth after reservation cannot exceed the backup byte budget',()=>fixture(async f=>{
 await copies(f,[3,2,1]);const before=await names(f.root);let reads=0;
 await assert.rejects(createManagedBackup(f.source,f.root,{...options,policy:{...policy,maxBackupBytes:2*1024**2},freeSpace:()=>{
  if(++reads===2){const db=new DatabaseSync(f.source);try{db.exec('CREATE TABLE payload(data BLOB); INSERT INTO payload VALUES(zeroblob(2000000))');}finally{db.close();}}return huge;
 }}),/容量达到上限/);
 assert.deepEqual(await names(f.root),before);
}));
test('raw online backup cancellation and invalid source clean their own staging directories',()=>fixture(async f=>{
 const db=new DatabaseSync(f.source);db.exec('CREATE TABLE payload(data BLOB); INSERT INTO payload VALUES(zeroblob(2000000))');db.close();
 const controller=new AbortController();let checks=0;
 await assert.rejects(createBackup(f.source,f.root,{signal:controller.signal,checkBudget(){if(++checks===3)controller.abort();}}),/abort/i);
 const bad=join(f.dir,'invalid.sqlite');await writeFile(bad,'invalid');await assert.rejects(createBackup(bad,f.root));assert.deepEqual(await names(f.root),[]);
}));
test('shared prune lock refuses concurrent work and releases after success',()=>fixture(async f=>{
 let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const first=createManagedBackup(f.source,f.root,{...options,probeOpenFiles:async()=>{entered();await held;return new Set();}});
 await started;await assert.rejects(createManagedBackup(f.source,f.root,options),/已有备份/);release();await first;
 assert.equal((await names(f.root)).length,1);
 await mkdir(join(f.root,'.prune-lock'));await assert.rejects(maintainBackups(f.source,f.root,options),/隔离目录/);
}));
test('a reserved copy changed after verification aborts deletion and returns staged candidate',()=>fixture(async f=>{
 const list=await copies(f,[10,3,2,1]);let probes=0;
 await assert.rejects(maintainBackups(f.source,f.root,{...options,probeOpenFiles:async()=>{if(++probes===3)await writeFile(join(list.at(-1),'manifest.json'),'changed');return new Set();}}),/已变化/);
 for(const dir of list)await access(join(dir,'workbench.sqlite'));assert.equal((await names(f.root)).length,4);
}));
test('symlink roots, unknown symlinks and an active database inside the root never authorize cleanup',()=>fixture(async f=>{
 const alias=join(f.dir,'alias');await symlink(f.root,alias);await assert.rejects(createManagedBackup(f.source,alias,options),/链接/);
 const original=await snapshot(f);await assert.rejects(maintainBackups(join(original,'workbench.sqlite'),f.root,options),/活动数据库/);
 await symlink(f.source,join(f.root,'unknown-link'));await assert.rejects(createManagedBackup(f.source,f.root,options),/无法计量/);await access(original);
}));
test('real lsof detects an open recovery snapshot',()=>fixture(async f=>{
 const dir=await snapshot(f),file=join(dir,'workbench.sqlite'),handle=await open(file,'r');
 try{assert.ok((await openBackupFiles(f.root)).has(file));}finally{await handle.close();}
}));
test('backup CLI applies the same bounded policy and archive/restore remain explicit',()=>fixture(async f=>{
 const configuration=join(f.dir,'policy.json');await writeFile(configuration,JSON.stringify(policy));
 const run=(...args)=>promisify(execFile)(process.execPath,['scripts/backup.mjs',...args],{cwd:new URL('../',import.meta.url)});
 const created=JSON.parse((await run('create',f.source,f.root,configuration)).stdout);
 assert.equal(created.retention.policy.keepNewest,3);assert.equal(created.retention.policy.maxBackups,5);
 const status=JSON.parse((await run('status',f.source,f.root,configuration)).stdout);assert.equal(status.dryRun,true);
 await run('restore',created.directory,join(f.dir,'restored.sqlite'));
 const invalid=join(f.dir,'invalid-policy.json');await writeFile(invalid,'{"keepNewest":1}');
 await promisify(execFile)(process.execPath,['scripts/backup.mjs','restore',created.directory,join(f.dir,'restored-with-bad-policy.sqlite')],{cwd:new URL('../',import.meta.url),env:{...process.env,SIGNAL_BACKUP_POLICY_PATH:invalid}});
}));
test('partial deletion preserves the isolation lock and blocks subsequent growth',()=>fixture(async f=>{
 const list=await copies(f,[30,3,2,1]),configuration=join(f.dir,'policy.json'),helper=join(f.dir,'unlink-fault.mjs');
 await writeFile(configuration,JSON.stringify(policy));
 const staged=join(f.root,'.prune-lock',list[0].split('/').at(-1));
 await writeFile(helper,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const unlink=fs.unlinkSync;fs.unlinkSync=path=>{if(path===${JSON.stringify(join(staged,'manifest.json'))})throw Error('injected unlink failure');return unlink(path);};syncBuiltinESMExports();`);
 await assert.rejects(promisify(execFile)(process.execPath,['--import',helper,'scripts/backup.mjs','maintain',f.source,f.root,configuration],{cwd:new URL('../',import.meta.url)}),/injected unlink failure/);
 assert.deepEqual(await names(staged),['manifest.json']);for(const dir of list.slice(1))await access(join(dir,'workbench.sqlite'));
 await assert.rejects(createManagedBackup(f.source,f.root,options),/未完成的隔离目录/);
 restoreBackup(list.at(-1),join(f.dir,'restore-after-failure.sqlite'));
}));
test('service schedules backup every six hours and preserves explicit pause across reopening',async()=>{
 const store=openStore(':memory:');let at=Date.now(),service;
 try{
  service=createService(store,{mode:'demo',now:()=>at,backupTask:async context=>{context.assertActive();return {ok:true};}});
  await service.runOperation('backup');assert.equal(Date.parse(service.operations().tasks.backup.nextRunAt)-at,21600000);
  service.controlOperation('backup','pause');await service.close();
  service=createService(store,{mode:'demo',now:()=>at,backupTask:async()=>{throw Error('paused backup must not run');}});
  assert.equal(service.operations().tasks.backup.paused,true);
 }finally{await service?.close();store.close();}
});
