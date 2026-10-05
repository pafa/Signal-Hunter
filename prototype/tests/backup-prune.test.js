import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,rename,realpath,symlink,link,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {planBackupPrune,executeBackupPrune} from '../server/backup-prune.mjs';
const now=Date.parse('2026-10-03T08:00:00Z'),policy={keepNewest:1,maxAgeDays:30};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run){const dir=await realpath(await mkdtemp(join(tmpdir(),'backup-prune-')));try{const database=join(dir,'live.sqlite'),root=join(dir,'backups');await mkdir(root);const s=openStore(database);s.db.prepare("INSERT INTO settings VALUES('runtime_mode','research')").run();const research=openResearch(s,{seed:false});research.create({title:'Synthetic research for backup lifecycle',summary:'Isolated test database'});s.close();await run({dir,database,root});}finally{await rm(dir,{recursive:true,force:true});}}
async function snapshot(database,root,age){const b=await createBackup(database,root),path=join(b.directory,'manifest.json');const m=JSON.parse(await readFile(path));m.createdAt=new Date(now-age*86400000).toISOString();await writeFile(path,JSON.stringify(m));return b.directory;}
const plan=(f,options={})=>planBackupPrune(f.database,f.root,{now,policy,...options});
const apply=(f,p,options={})=>executeBackupPrune(p,{now,confirmation:p.planHash,receiptPath:join(f.dir,'receipt.json'),...options});
test('explicit plan prunes only expired same-dataset backups and retained backup restores all research',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90),recent=await snapshot(f.database,f.root,1),before=sha(await readFile(f.database)),newBytes=sha(await readFile(join(recent,'workbench.sqlite')));
 const p=await plan(f);assert.deepEqual(p.candidates.map(s=>s.directory),[old]);assert.equal(p.retained.length,1);assert.equal(p.automaticDeletion,false);assert.equal((await readdir(f.root)).length,2);
 const result=await apply(f,p);assert.equal(result.phase,'completed');assert.equal(result.removedFileBytes,p.candidateBytes);await assert.rejects(access(old));assert.equal(sha(await readFile(f.database)),before);assert.equal(sha(await readFile(join(recent,'workbench.sqlite'))),newBytes);
 const restored=join(f.dir,'restored.sqlite');restoreBackup(recent,restored);const db=new DatabaseSync(restored,{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM research_topics').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM research_versions').get().n,1);}finally{db.close();}
 const receipt=JSON.parse(await readFile(join(f.dir,'receipt.json')));assert.equal(receipt.planHash,p.planHash);assert.equal(receipt.removed.length,2);await assert.rejects(apply(f,p),/已变化/);
}));
test('wrong confirmation, expired or tampered plans never delete files',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);const p=await plan(f);
 await assert.rejects(apply(f,p,{confirmation:'no'}),/确认/);await assert.rejects(apply(f,p,{now:now+900001}),/过期/);await assert.rejects(apply(f,{...p,candidates:[]}),/已变化/);await access(old);await assert.rejects(access(join(f.dir,'receipt.json')));
}));
test('new, changed or unknown snapshot contents invalidate an approved plan',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);const p=await plan(f);await writeFile(join(old,'user-note'),'do not remove');await assert.rejects(apply(f,p),/已变化/);await access(join(old,'workbench.sqlite'));assert.equal(await readFile(join(old,'user-note'),'utf8'),'do not remove');
}));
test('foreign datasets, bad SQLite, hardlinks and symlinks are protected rather than counted as retained reserve',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);
 const foreign=join(f.dir,'foreign.sqlite'),s=openStore(foreign);s.db.prepare("INSERT INTO settings VALUES('runtime_mode','research')").run();openResearch(s,{seed:false}).create({title:'Different dataset',summary:'Independent identity'});s.close();const other=await snapshot(foreign,f.root,0);
 const bad=await snapshot(f.database,f.root,80);await writeFile(join(bad,'workbench.sqlite'),'bad sqlite');const m=JSON.parse(await readFile(join(bad,'manifest.json')));m.sha256=sha(Buffer.from('bad sqlite'));await writeFile(join(bad,'manifest.json'),JSON.stringify(m));
 const hard=await snapshot(f.database,f.root,70);await link(join(hard,'workbench.sqlite'),join(f.dir,'hardlink.sqlite'));await symlink(old,join(f.root,'snapshot-symbolic'));
 const p=await plan(f);assert.deepEqual(p.candidates.map(s=>s.directory),[old]);assert.equal(p.protectedSnapshots.length,3);assert.equal(p.retained.length,1);await apply(f,p);await access(other);await access(bad);await access(hard);await access(join(f.dir,'hardlink.sqlite'));
}));
test('current database located inside a backup cannot become a cleanup candidate',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);const p=await planBackupPrune(join(old,'workbench.sqlite'),f.root,{now,policy});assert.equal(p.candidates.length,0);assert.ok(p.protectedSnapshots.some(s=>s.reason.includes('活动数据库')));await access(old);
}));
test('existing receipt and lock fail safely without touching snapshots',()=>fixture(async f=>{
 const old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);const p=await plan(f);await writeFile(join(f.dir,'receipt.json'),'keep receipt');await assert.rejects(apply(f,p));assert.equal(await readFile(join(f.dir,'receipt.json'),'utf8'),'keep receipt');await assert.rejects(access(join(f.root,'.prune-lock')));
 await mkdir(join(f.root,'.prune-lock'));await assert.rejects(apply(f,p,{receiptPath:join(f.dir,'other.json')}));await access(old);await assert.rejects(access(join(f.dir,'other.json')));
}));
test('empty datasets without immutable history and unsupported policies cannot be pruned',()=>fixture(async f=>{
 const empty=join(f.dir,'empty.sqlite'),s=openStore(empty);s.close();await assert.rejects(planBackupPrune(empty,f.root,{now,policy}),/历史身份/);await assert.rejects(plan(f,{policy:{automaticDeletion:true}}));
}));
test('CLI plan is read-only and apply requires exact fingerprint and a new receipt',()=>fixture(async f=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const run=promisify(execFile),old=await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);
 const policyFile=join(f.dir,'policy.json'),planFile=join(f.dir,'plan.json'),receipt=join(f.dir,'receipt.json');await writeFile(policyFile,JSON.stringify(policy));
 const call=args=>run(process.execPath,['scripts/backup-prune.mjs',...args],{cwd:new URL('../',import.meta.url)});
 await call(['plan',f.database,f.root,planFile,policyFile]);await access(old);const p=JSON.parse(await readFile(planFile));assert.equal(p.candidates.length,1);
 await assert.rejects(call(['apply',planFile,'wrong',receipt]));await access(old);const result=JSON.parse((await call(['apply',planFile,p.planHash,receipt])).stdout);assert.equal(result.phase,'completed');await assert.rejects(access(old));
}));

test('replacing the backup root or adding a snapshot invalidates the plan',()=>fixture(async f=>{
 await snapshot(f.database,f.root,90);await snapshot(f.database,f.root,1);const p=await plan(f);await snapshot(f.database,f.root,2);await assert.rejects(apply(f,p),/已变化/);
 const updated=await plan(f),moved=join(f.dir,'original-backups');await rename(f.root,moved);await mkdir(f.root);await assert.rejects(apply(f,updated),/已变化/);assert.equal((await readdir(moved)).length,3);
}));
test('new backups are standalone and leave the live WAL database usable',()=>fixture(async f=>{
 const s=openStore(f.database);try{const b=await createBackup(f.database,f.root);assert.deepEqual((await readdir(b.directory)).sort(),['manifest.json','workbench.sqlite']);
 assert.equal(s.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(s.db.prepare('SELECT COUNT(*) n FROM research_topics').get().n,1);
 const created=Date.parse(b.createdAt);const future=await plan(f,{now:created-1});assert.equal(future.retained.length,0);assert.equal(future.protectedSnapshots.length,1);
 const preview=await plan(f,{now:created+1});assert.equal(preview.retained.length,1);assert.deepEqual((await readdir(b.directory)).sort(),['manifest.json','workbench.sqlite']);}finally{s.close();}
}));
test('failure before deleting restores staged snapshots; partial deletion preserves the lock and remaining files',()=>fixture(async f=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const run=promisify(execFile);
 const old=await snapshot(f.database,f.root,90),recent=await snapshot(f.database,f.root,1),p=await plan(f),planPath=join(f.dir,'plan.json');await writeFile(planPath,JSON.stringify(p));
 const helper=join(f.dir,'fault.mjs');await writeFile(helper,`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';let n=0;const unlink=fs.unlink;fs.unlink=async (...args)=>{if(++n===Number(process.env.FAIL_UNLINK))throw new Error('injected unlink failure');return unlink(...args)};syncBuiltinESMExports();`);
 const call=fail=>run(process.execPath,['--import',helper,'scripts/backup-prune.mjs','apply',planPath,p.planHash,join(f.dir,'fault-'+fail+'.json')],{cwd:new URL('../',import.meta.url),env:{...process.env,FAIL_UNLINK:String(fail)}});
 // Use a fresh real-time plan so the subprocess exercises execution, not expiry.
 const livePlan=await planBackupPrune(f.database,f.root,{policy});await writeFile(planPath,JSON.stringify(livePlan));p.planHash=livePlan.planHash;
 await assert.rejects(call(1));await access(old);await access(recent);await assert.rejects(access(join(f.root,'.prune-lock')));assert.equal(JSON.parse(await readFile(join(f.dir,'fault-1.json'))).phase,'failed-before-deletion');
 await assert.rejects(call(2));const receipt=JSON.parse(await readFile(join(f.dir,'fault-2.json')));assert.equal(receipt.phase,'partial-deletion');assert.equal(receipt.removed.length,1);await access(receipt.recoveryDirectory);await access(join(receipt.moved[0].to,'manifest.json'));await access(recent);await access(f.database);
}));
