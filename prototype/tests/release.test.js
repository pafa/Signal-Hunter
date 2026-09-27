import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,copyFileSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {releaseRoot,releaseFiles,checkRelease} from '../scripts/release-files.mjs';
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'signal-release-'));try{for(const p of releaseFiles()){mkdirSync(dirname(join(root,p)),{recursive:true});copyFileSync(join(releaseRoot,p),join(root,p));}return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}

test('release allows only explicit source/docs, excludes runtime databases and review images',()=>{
 const files=releaseFiles();assert.ok(files.includes('LICENSE'));assert.ok(files.includes('prototype/server/demo.mjs'));assert.ok(!files.some(p=>/^(data|session-artifacts)\/|prototype\/(screens|design)\//.test(p)));assert.ok(Object.keys(checkRelease()).length>100);
});
test('release checker refuses broken relative documentation and host-specific paths',()=>fixture(root=>{
 writeFileSync(join(root,'README.md'),'[missing](private-report.md)');assert.throws(()=>checkRelease(root),/缺少链接目标/);
 writeFileSync(join(root,'README.md'),['','Users','someone','secret'].join('/'));assert.throws(()=>checkRelease(root),/本机绝对路径/);
}));
test('release checker refuses symlinked allowed files without reading their targets',()=>fixture(root=>{
 const path=join(root,'LICENSE');rmSync(path);symlinkSync(join(root,'README.md'),path);assert.throws(()=>checkRelease(root),/不是普通文件/);
}));
test('release export refuses to overwrite an existing directory',()=>{
 const root=mkdtempSync(join(tmpdir(),'signal-output-'));try{writeFileSync(join(root,'keep.txt'),'keep');const r=spawnSync(process.execPath,[join(releaseRoot,'prototype/scripts/prepare-release.mjs'),root],{encoding:'utf8'});assert.notEqual(r.status,0);assert.equal(readFileSync(join(root,'keep.txt'),'utf8'),'keep');}finally{rmSync(root,{recursive:true,force:true});}
});
