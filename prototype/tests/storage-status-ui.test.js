import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';
test('capacity UI distinguishes failures, stale and restored measurements and keeps unknown sizes unknown',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
 const {default:Status,storageBytes}=await vite.ssrLoadModule('/src/integrated/StorageStatus.jsx');
 const policy={keepNewest:10,maxAgeDays:30,maxBackupBytes:1024**3,minFreeBytes:1024**3},last={id:1,scopeId:'original',outcome:'ok',completedAt:'2026-10-04T00:00:00Z',databaseBytes:1024,backupBytes:0,freeBytes:null,verifiedBackups:0,unverifiedBackups:0,candidateBackups:0,candidateBytes:0,warnings:[{kind:'backup-root-missing'}]},failed={id:2,scopeId:'original',outcome:'failed',completedAt:'2026-10-04T03:00:00Z',reason:'scan-timeout'};
 const render=monitor=>renderToStaticMarkup(React.createElement(Status,{monitor,serverTime:'2026-10-04T03:00:00Z'}));
 assert.equal(storageBytes(null),'未知');assert.equal(storageBytes(0),'0 B');assert.equal(storageBytes(1024),'1.00 KiB');assert.equal(render(null),'');assert.match(render({policy,scopeId:'original',total:0,history:[]}),/尚无检查记录/);
 const monitor={policy,scopeId:'original',intervalSeconds:3600,total:2,latest:failed,lastSuccess:last,history:[failed,last]},text=render(monitor);for(const expected of ['检查失败','扫描超过时限','以下为历史成功记录','结果已过时','磁盘可用 未知','尚无备份目录'])assert(text.includes(expected));
 const restored=render({...monitor,scopeId:'restored'});assert.match(restored,/来自其他路径的历史测量/);assert(!restored.includes('结果已过时'));assert.equal(monitor.lastSuccess.scopeId,'original');
 }finally{await vite.close();}
});
