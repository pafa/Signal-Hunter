import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {openStorageMonitor} from '../server/storage-monitor.mjs';
import {previewStorageRetention} from '../server/storage-retention.mjs';
import {createBackup,restoreBackup} from '../server/backup.mjs';
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'signal-capacity-'));const path=join(dir,'workbench.sqlite'),root=join(dir,'backups'),store=openStore(path);try{store.db.prepare("INSERT OR REPLACE INTO settings VALUES('runtime_mode','demo')").run();await run({dir,path,root,store});}finally{store.close();await rm(dir,{recursive:true,force:true});}}
function context(token){const controller=new AbortController();return {token,signal:controller.signal,assertActive:()=>controller.signal.throwIfAborted(),cancel:()=>controller.abort()};}
test('capacity reports are append-only, bounded on read, deduplicated and retain last success after failure without leaking paths',()=>fixture(async({path,root,store})=>{
 const monitor=openStorageMonitor(store.db,{databasePath:path,backupRoot:root}),c=context('first');
 await Promise.all([monitor.check(c),monitor.check(c)]);await monitor.check(c);assert.equal(monitor.snapshot().total,1);
 const first=monitor.snapshot().latest;assert.equal(first.outcome,'ok');assert.equal(first.backupBytes,0);assert.deepEqual(first.warnings,[{kind:'backup-root-missing'}]);await assert.rejects(readdir(root),{code:'ENOENT'});
 for(let i=0;i<21;i++)await monitor.check(context('next-'+i));await writeFile(root,'not a directory, preserve');await monitor.check(context('failed'));
 const s=monitor.snapshot();assert.equal(s.total,23);assert.equal(s.history.length,20);assert.equal(s.latest.outcome,'failed');assert.equal(s.latest.reason,'scan-unavailable');assert.equal(s.lastSuccess.id,22);assert(!JSON.stringify(s).includes(path));assert(!JSON.stringify(s).includes(root));assert.deepEqual(JSON.parse(store.db.prepare('SELECT report FROM storage_checks WHERE id=1').get().report),Object.fromEntries(Object.entries(first).filter(([k])=>!['id','startedAt','completedAt','outcome'].includes(k))));assert.equal(await readFile(root,'utf8'),'not a directory, preserve');
 assert.deepEqual(openStorageMonitor(store.db,{databasePath:path,backupRoot:root}).snapshot(),s);
}));
test('cancellation stops a pending filesystem scan and saves an interruption instead of a measurement',()=>fixture(async({path,root,store})=>{
 const monitor=openStorageMonitor(store.db,{databasePath:path,backupRoot:root}),c=context('cancel');const run=monitor.check(c);c.cancel();await run;
 assert.equal(monitor.snapshot().latest.outcome,'interrupted');assert.equal(monitor.snapshot().lastSuccess,null);assert.equal(monitor.snapshot().latest.databaseBytes,undefined);
 const stopped=context('already-stopped');stopped.cancel();await assert.rejects(previewStorageRetention(path,root,{signal:stopped.signal}),{name:'AbortError'});
}));
test('scheduler starts paused, allows offline local checks, ignores client paths, exposes numbers and preserves history through backup and restore',()=>fixture(async({dir,path,root,store})=>{
 let calls=0;const service=createService(store,{mode:'demo',fetcher:async()=>{calls++;throw Error('unexpected network');},storageConfig:{databasePath:path,backupRoot:root}});
 try{
 assert.equal(service.operations().tasks.storage.paused,true);assert.throws(()=>service.runOperation('storage'),/暂停/);service.controlOperation('storage','resume');assert.equal((await service.runOperation('storage',{databasePath:'/do-not-read',automaticDeletion:true})).outcome,'ok');assert.equal(service.snapshot().storageMonitor.total,1);service.controlOperation('storage','pause');
 const h=createHandler(store,service);let status,body;await h({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179'}},{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});assert.equal(status,200);assert.equal(typeof body.storageMonitor.latest.databaseBytes,'number');assert.equal(body.storageMonitor.latest.warnings[0].kind,'backup-root-missing');assert.equal(calls,0);
 const snapshot=await createBackup(path,root),saved=service.snapshot().storageMonitor;
 const target=join(dir,'restored.sqlite');assert.equal(restoreBackup(snapshot.directory,target).verified,true);const restored=openStore(target),other=createService(restored,{mode:'demo',storageConfig:{databasePath:target,backupRoot:root}});
 try{assert.deepEqual(other.snapshot().storageMonitor.history,saved.history);assert.notEqual(other.snapshot().storageMonitor.scopeId,saved.scopeId);assert.equal(other.snapshot().storageMonitor.lastSuccess.scopeId,saved.scopeId);assert.equal(other.operations().tasks.storage.paused,true);assert.throws(()=>other.controlOperation('storage','resume'),/恢复副本/);other.acknowledgeRestore();assert.equal(other.operations().tasks.storage.paused,true);}finally{await other.close();restored.close();}
 service.controlOperation('storage','resume');await service.runOperation('storage');const latest=service.snapshot().storageMonitor.latest;assert.equal(latest.verifiedBackups,1);assert.equal(latest.unverifiedBackups,0);assert.equal(latest.capacityComplete,true);assert.deepEqual(await readdir(root),[snapshot.directory.split('/').at(-1)]);
 }finally{await service.close();}
}));
test('invalid backups and unknown files are retained with partial-capacity and threshold warnings',()=>fixture(async({path,root,store})=>{
 const b=await createBackup(path,root),file=join(b.directory,'workbench.sqlite');await writeFile(file,'damaged synthetic backup');await writeFile(join(root,'keep.txt'),'preserve');const before=await readFile(file);
 const monitor=openStorageMonitor(store.db,{databasePath:path,backupRoot:root,policy:{maxBackupBytes:1,minFreeBytes:Number.MAX_SAFE_INTEGER}});await monitor.check(context('bad'));const r=monitor.snapshot().latest;
 assert.equal(r.outcome,'ok');assert.equal(r.capacityComplete,false);assert.equal(r.verifiedBackups,0);assert.equal(r.unverifiedBackups,1);assert.equal(r.candidateBackups,0);assert.equal(r.candidateBytes,0);assert.deepEqual(r.warnings.map(w=>w.kind),['partial-capacity-measurement','backup-capacity-exceeded','low-free-space']);assert.equal(r.warnings[0].entries,2);assert.deepEqual(await readFile(file),before);assert.equal(await readFile(join(root,'keep.txt'),'utf8'),'preserve');
}));
