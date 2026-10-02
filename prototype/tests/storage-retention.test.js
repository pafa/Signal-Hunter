import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {previewStorageRetention,retentionPolicy} from '../server/storage-retention.mjs';
const now=Date.parse('2026-10-02T00:00:00Z');
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'signal-retention-'));try{const db=join(dir,'source.sqlite'),root=join(dir,'backups');await writeFile(db,'synthetic database');await mkdir(root);await run({dir,db,root});}finally{await rm(dir,{recursive:true,force:true});}}
async function snapshot(root,name,age,{corrupt=false,future=false}={}){const directory=join(root,'snapshot-'+name);await mkdir(directory);const data='synthetic backup '+name;await writeFile(join(directory,'workbench.sqlite'),data);await writeFile(join(directory,'manifest.json'),JSON.stringify({format:1,database:'workbench.sqlite',createdAt:new Date(now+(future?1:-age)*86400000).toISOString(),sha256:corrupt?'0'.repeat(64):createHash('sha256').update(data).digest('hex')}));return directory;}
test('retention requires age and newest reserve, reports capacity, and never mutates files',()=>fixture(async({db,root})=>{
 await snapshot(root,'oldest',90);await snapshot(root,'middle',60);await snapshot(root,'recent',2);await writeFile(db+'-wal','wal');
 const before=await Promise.all((await readdir(root)).map(async name=>[name,await readFile(join(root,name,'manifest.json'),'utf8'),await readFile(join(root,name,'workbench.sqlite'),'utf8')]));
 const result=await previewStorageRetention(db,root,{now,policy:{keepNewest:2,maxAgeDays:30,maxBackupBytes:1,minFreeBytes:Number.MAX_SAFE_INTEGER}});
 assert.equal(result.dryRun,true);assert.equal(result.automaticDeletion,false);assert.equal(result.snapshots.filter(s=>s.candidate).length,1);assert.ok(result.snapshots.find(s=>s.directory.endsWith('oldest')).candidate);assert.equal(result.databaseBytes,21);assert.ok(result.candidateBytes>0);assert.ok(result.warnings.some(w=>w.kind==='backup-capacity-exceeded'));assert.ok(result.warnings.some(w=>w.kind==='low-free-space'));
 const after=await Promise.all((await readdir(root)).map(async name=>[name,await readFile(join(root,name,'manifest.json'),'utf8'),await readFile(join(root,name,'workbench.sqlite'),'utf8')]));assert.deepEqual(after,before);
}));
test('bad fingerprints, future manifests, unknown files and symbolic links are protected',()=>fixture(async({dir,db,root})=>{
 await snapshot(root,'bad',90,{corrupt:true});await snapshot(root,'future',90,{future:true});const unknown=await snapshot(root,'unknown',90);await writeFile(join(unknown,'private-note'),'keep');await symlink(dir,join(root,'snapshot-link'));
 const r=await previewStorageRetention(db,root,{now,policy:{keepNewest:1,maxAgeDays:1}});assert.equal(r.candidateBytes,0);assert.equal(r.capacityComplete,false);assert.ok(r.warnings.some(w=>w.kind==='partial-capacity-measurement'));assert.ok(r.snapshots.every(s=>!s.verified&&!s.candidate));assert.equal(await readFile(join(unknown,'private-note'),'utf8'),'keep');
}));
test('missing backup root is observed without creating it and symlink roots are refused',()=>fixture(async({dir,db})=>{
 const root=join(dir,'missing');const r=await previewStorageRetention(db,root,{now});assert.equal(r.snapshots.length,0);assert.ok(r.warnings.some(w=>w.kind==='backup-root-missing'));await assert.rejects(readdir(root),{code:'ENOENT'});await symlink(dir,join(dir,'link'));await assert.rejects(previewStorageRetention(db,join(dir,'link'),{now}),/普通目录/);
}));
test('policy refuses deletion, unknown options and invalid numeric limits',()=>{
 assert.equal(retentionPolicy().automaticDeletion,false);for(const input of [{automaticDeletion:true},{keepNewest:0},{maxAgeDays:-1},{maxBackupBytes:Infinity},{minFreeBytes:1.2},{extra:1},[]])assert.throws(()=>retentionPolicy(input));
});
test('CLI applies a supplied policy and produces dry-run output without changing source',()=>fixture(async({dir,db,root})=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const policyFile=join(dir,'policy.json');await writeFile(policyFile,JSON.stringify({keepNewest:2,maxAgeDays:7}));const before=await readFile(db);
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/storage-preview.mjs',db,root,policyFile],{cwd:new URL('../',import.meta.url),timeout:10000});const result=JSON.parse(stdout);assert.equal(result.dryRun,true);assert.equal(result.policy.keepNewest,2);assert.equal(result.policy.maxAgeDays,7);assert.equal(result.automaticDeletion,false);assert.deepEqual(await readFile(db),before);assert.deepEqual(await readdir(root),[]);
}));
