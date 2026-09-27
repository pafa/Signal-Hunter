import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode,runtimeConfig,checkDatabaseFile} from '../server/runtime.mjs';
import {createHandler} from '../server/index.mjs';

test('fresh offline demo provides synthetic topics/charts and cannot fetch news, quotes, daily or article bodies',async()=>{
 const store=openStore(':memory:');let requests=0;
 try{
  assertDatabaseMode(store,'demo');const service=createService(store,{mode:'demo',fetcher:()=>{requests++;throw new Error('external request');}});
  const s=service.snapshot();assert.equal(s.research.topics.length,3);assert.equal(s.watchlist.length,9);assert.equal(s.paper.positions.length,5);assert.equal(s.paper.orders.length,3);
  assert.ok(s.research.topics.every(t=>t.origin==='synthetic-demo'));assert.ok(s.watchlist.every(w=>w.daily.provider==='synthetic-demo'&&w.daily.points.length>100));
  assert.ok(s.paper.orders.every(o=>o.status==='pending'));assert.equal(s.paper.fills.length,0);
  await service.tick();await assert.rejects(service.refreshNews(),/离线演示/);await assert.rejects(service.refreshQuote('AMD.US'),/离线演示/);await assert.rejects(service.refreshDaily('AMD.US'),/离线演示/);
  const topic=service.research.get('agent-cpu');await assert.rejects(service.research.readMaterial(topic.id,{version:topic.version,url:'https://example.com/article',stance:'context',family:'other',step:'fact',interpretation:'example'}),/离线演示/);
  assert.equal(requests,0);
 }finally{store.close();}
});
test('blank research has no imported topics, watches, positions or orders; still a scenario cash account',()=>{
 const store=openStore(':memory:');try{assertDatabaseMode(store,'research');const s=createService(store,{mode:'research'}).snapshot();assert.equal(s.research.topics.length,0);assert.equal(s.watchlist.length,0);assert.equal(s.paper.positions.length,0);assert.equal(s.paper.orders.length,0);assert.equal(s.paper.cash,1000000);}finally{store.close();}
});
test('demo restart preserves user edits and never silently switches an existing database mode',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-demo-')),path=join(dir,'demo.sqlite');let store=openStore(path);
 try{
  assertDatabaseMode(store,'demo');let service=createService(store,{mode:'demo'});const id=store.news()[0].id;store.editNews(id,{note:'my demo note'});const version=service.paper.snapshot().version;store.close();
  store=openStore(path);assertDatabaseMode(store,'demo');service=createService(store,{mode:'demo'});assert.equal(store.news()[0].note,'my demo note');assert.equal(service.paper.snapshot().version,version);
  assert.throws(()=>assertDatabaseMode(store,'research'),/拒绝/);assert.throws(()=>assertDatabaseMode(store,'legacy'),/拒绝/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('unmarked populated legacy database cannot become a demo or research database',()=>{
 const store=openStore(':memory:');try{store.addWatch('AMD.US');assert.throws(()=>assertDatabaseMode(store,'demo'),/旧数据库/);assert.throws(()=>assertDatabaseMode(store,'research'),/旧数据库/);assert.equal(store.watchlist().length,1);assertDatabaseMode(store,'legacy');}finally{store.close();}
});
test('runtime uses distinct default database files and validates all modes and ports',()=>{
 const paths=['demo','research','legacy'].map(SIGNAL_MODE=>runtimeConfig({SIGNAL_MODE}).dbPath);assert.equal(new Set(paths).size,3);
 for(const env of [{SIGNAL_MODE:'invalid'},{SIGNAL_API_PORT:'80'},{SIGNAL_API_PORT:'4178'},{SIGNAL_FRONTEND_PORT:'abc'}])assert.throws(()=>runtimeConfig(env));
});
test('health endpoint observes the same local host/origin boundary on custom ports',async()=>{
 const store=openStore(':memory:');try{
 const handler=createHandler(store,createService(store,{mode:'demo'}),{apiPort:4279,frontendPort:4278});let code,body;
 const res={writeHead:c=>code=c,end:s=>body=JSON.parse(s)};
 await handler({method:'GET',url:'/api/health',headers:{host:'127.0.0.1:4279'}},res);assert.equal(code,200);assert.equal(body.mode,'demo');
 await handler({method:'GET',url:'/api/health',headers:{host:'evil.example'}},res);assert.equal(code,403);
 }finally{store.close();}
});

test('wrong-mode file is checked read-only before any schema initialization',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-preflight-')),dbPath=join(dir,'private.sqlite');const store=openStore(dbPath);store.addWatch('AMD.US');store.close();
 try{const before=readFileSync(dbPath);assert.throws(()=>checkDatabaseFile({dbPath,mode:'demo'}),/旧数据库/);assert.deepEqual(readFileSync(dbPath),before);checkDatabaseFile({dbPath,mode:'legacy'});assert.deepEqual(readFileSync(dbPath),before);}finally{rmSync(dir,{recursive:true,force:true});}
});
