import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import {openStore} from '../server/store.mjs';
import {createPersistentScheduler} from '../server/persistent-scheduler.mjs';
import {createService} from '../server/service.mjs';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {assertDatabaseMode,checkDatabaseFile} from '../server/runtime.mjs';
import {createStaticHandler} from '../server/static-site.mjs';
import {createHandler} from '../server/index.mjs';
const temp=()=>mkdtempSync(join(tmpdir(),'signal-foundation-'));
const turn=()=>new Promise(r=>setImmediate(r));

test('two independent schedulers cannot claim the same lane; pause persists through reopening',async()=>{
 const path=join(temp(),'test.sqlite'),a=openStore(path),b=openStore(path);
 let release,calls=0;const gate=new Promise(r=>release=r);
 const first=createPersistentScheduler(a.db,{news:async()=>{calls++;await gate;return {ok:true};}});
 const second=createPersistentScheduler(b.db,{news:()=>{calls++;return {ok:true};}});
 const work=first.runAll();await turn();await second.runAll();assert.equal(calls,1);
 first.control('news','pause');release();await work;
 assert.equal(second.snapshot().news.paused,true);assert.equal(second.history()[0].outcome,'cancelled');
 await first.stop();await second.stop();a.close();b.close();
 const c=openStore(path),third=createPersistentScheduler(c.db,{news:()=>{calls++;}});
 await third.runAll();assert.equal(calls,1);assert.equal(third.snapshot().news.paused,true);
 third.control('news','resume');await third.runAll();assert.equal(calls,2);await third.stop();c.close();
});
test('expired lease is recoverable and stale completion cannot replace the new result',async()=>{
 const s=openStore(':memory:');let at=100000,release,oldWrite=false;
 const first=createPersistentScheduler(s.db,{news:async c=>{await new Promise(r=>release=r);c.assertActive();oldWrite=true;return {ok:true};}},{now:()=>at,leaseMs:60000});
 const work=first.runAll();await turn();at+=60001;
 const second=createPersistentScheduler(s.db,{news:()=>({ok:true})},{now:()=>at,leaseMs:60000});
 await second.runAll();release();await work;
 assert.equal(oldWrite,false);assert.equal(second.snapshot().news.outcome,'ok');
 assert.deepEqual(second.history().map(r=>r.outcome),['ok','interrupted']);
 await first.stop();await second.stop();s.close();
});
test('bounded retries stop a failing lane without blocking other lanes; retry is explicit',async()=>{
 const s=openStore(':memory:');let at=100000,fail=true,other=0;
 const jobs=createPersistentScheduler(s.db,{news:()=>{if(fail)throw new Error('fixture 403');return {ok:true};},daily:()=>{other++;return {ok:true};}},{now:()=>at,intervals:{news:1000,daily:1000}});
 for(let i=0;i<3;i++){await jobs.runAll();at+=300000;}
 assert.equal(jobs.snapshot().news.blocked,true);assert.equal(other,3);
 await jobs.runAll();assert.equal(jobs.history().filter(r=>r.name==='news').length,3);
 fail=false;jobs.control('news','retry');await jobs.runAll();assert.equal(jobs.snapshot().news.outcome,'ok');assert.equal(jobs.snapshot().news.blocked,false);
 await jobs.stop();s.close();
});
test('partial failures retain successful lanes and last success survives skipped cycles',async()=>{
 const s=openStore(':memory:');let at=100000,value=[{ok:true},{error:'bad source'}];
 const jobs=createPersistentScheduler(s.db,{daily:()=>value},{now:()=>at,intervals:{daily:1}});
 await jobs.runAll();const success=jobs.snapshot().daily.lastSuccessAt;assert.equal(jobs.snapshot().daily.outcome,'partial');
 at+=10;value=[{skipped:'cooldown'}];await jobs.runAll();assert.equal(jobs.snapshot().daily.lastSuccessAt,success);assert.equal(jobs.snapshot().daily.blocked,false);
 await jobs.stop();s.close();
});
test('paused source cannot write late results, invoke manual fetch, or lose cached data',async()=>{
 const s=openStore(':memory:');let release;
 const service=createService(s,{mode:'research',fetcher:async()=>{await new Promise(r=>release=r);return new Response('<rss><channel></channel></rss>');}});
 const work=service.runOperation('news');await turn();service.controlOperation('news','pause');release();await work;
 assert.equal(s.news().length,0);assert.equal(service.operations().tasks.news.paused,true);
 await assert.rejects(service.refreshNews(),/暂停/);
 await service.close();s.close();
});
test('source attempt cooldown persists across service restart; data capability never claims executable quotes',async()=>{
 const s=openStore(':memory:');let calls=0;const now=()=>Date.parse('2026-10-01T10:00:00Z'),fetcher=async()=>{calls++;throw new Error('fixture unavailable');};
 let service=createService(s,{mode:'research',now,fetcher});await service.refreshNews();assert.equal(calls,1);
 await service.close();service=createService(s,{mode:'research',now,fetcher});await service.refreshNews();assert.equal(calls,1);
 s.addWatch('AAPL.US');s.status('AAPL.US',{state:'error',error:'fixture 403',attemptedAt:new Date(now()).toISOString()});
 const c=service.snapshot().dataCapabilities[0];assert.equal(c.minutes.status,'error');assert.equal(c.execution.enabled,false);
 await service.close();s.close();
});
test('consistent online backup preserves all rows and restore cannot overwrite or silently start tasks',async()=>{
 const dir=temp(),path=join(dir,'source.sqlite'),s=openStore(path);assertDatabaseMode(s,'research');
 const service=createService(s,{mode:'research'});service.research.create({title:'Synthetic backup fixture',summary:'Original record'});
 const result=await createBackup(path,join(dir,'backups'));const restored=join(dir,'restored.sqlite');
 assert.equal(result.counts.research_topics,1);assert.equal(result.mode,'research');
 assert.throws(()=>restoreBackup(result.directory,path),/全新路径/);
 restoreBackup(result.directory,restored);
 const copy=openStore(restored),r=createService(copy,{mode:'research',fetcher:()=>{throw new Error('must not fetch');}});
 assert.equal(r.research.list().length,1);assert.equal(r.health().restoreReviewRequired,true);
 await r.tick();assert.equal(Object.values(r.operations().tasks).every(t=>t.paused),true);
 assert.throws(()=>r.controlOperation('news','resume'),/核对/);r.acknowledgeRestore();assert.equal(r.health().restoreReviewRequired,false);
 assert.equal(Object.values(r.operations().tasks).every(t=>t.paused),true);
 assert.equal(service.research.list()[0].title,'Synthetic backup fixture');
 checkDatabaseFile({dbPath:restored,mode:'research'});assert.throws(()=>checkDatabaseFile({dbPath:restored,mode:'demo'}),/模式/);
 await r.close();copy.close();await service.close();s.close();
});
test('tampered backup is rejected before creating destination',async()=>{
 const dir=temp(),s=openStore(join(dir,'source.sqlite'));assertDatabaseMode(s,'research');
 const result=await createBackup(join(dir,'source.sqlite'),join(dir,'backups'));s.close();
 writeFileSync(join(result.directory,'workbench.sqlite'),'broken');
 const target=join(dir,'new.sqlite');assert.throws(()=>restoreBackup(result.directory,target),/指纹/);assert.equal(existsSync(target),false);
});
test('production handler serves static content and same-origin API while hiding traversal and private files',async()=>{
 const dir=temp();writeFileSync(join(dir,'index.html'),'<main>Fixture workbench</main>');writeFileSync(join(dir,'asset.js'),'const fixture=1;');
 const s=openStore(':memory:'),service=createService(s,{mode:'demo'}),server=http.createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 server.on('request',createHandler(s,service,{apiPort:port,frontendPort:port,staticHandler:createStaticHandler(dir)}));
 try{
  const base='http://127.0.0.1:'+port;
  assert.match(await (await fetch(base+'/')).text(),/Fixture workbench/);
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/%2e%2e%2fsecret')).status,404);
  assert.equal((await fetch(base+'/missing.js')).status,404);
  assert.match(await (await fetch(base+'/research/fixture')).text(),/Fixture workbench/);
  assert.equal((await fetch(base+'/',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const changed=await fetch(base+'/api/operations/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
  assert.equal(changed.status,200);assert.equal((await changed.json()).operations.news.paused,true);
 }finally{await new Promise(r=>server.close(r));await service.close();s.close();}
});


test('provider rejection is cooled persistently and cannot be bypassed by a restart',async()=>{
 const {createProviderGate}=await import('../server/provider-gate.mjs');
 const s=openStore(':memory:');let at=100000,calls=0;
 const fetcher=async()=>{calls++;return new Response('',{status:403});};
 let gated=createProviderGate(s,{now:()=>at,fetcher});
 assert.equal((await gated('https://fixture.example/chart')).status,403);
 await assert.rejects(gated('https://fixture.example/other'),/暂停请求/);assert.equal(calls,1);
 gated=createProviderGate(s,{now:()=>at,fetcher});
 await assert.rejects(gated('https://fixture.example/chart'),/暂停请求/);assert.equal(calls,1);
 at+=30*60000;await gated('https://fixture.example/chart');assert.equal(calls,2);s.close();
});
test('request for a selected symbol is persisted and recovered with that input',async()=>{
 const s=openStore(':memory:');let at=100000,release,seen;
 const first=createPersistentScheduler(s.db,{daily:async c=>{await new Promise(r=>release=r);c.assertActive();}},{now:()=>at,leaseMs:60000});
 const work=first.run('daily',{input:{symbols:['AAPL.US'],manual:true}});await turn();at+=60001;
 const second=createPersistentScheduler(s.db,{daily:c=>{seen=c.input;return {ok:true};}},{now:()=>at});
 await second.runAll();release();await work;
 assert.deepEqual(seen,{symbols:['AAPL.US'],manual:true});assert.deepEqual(second.history()[0].input,seen);
 await first.stop();await second.stop();s.close();
});
