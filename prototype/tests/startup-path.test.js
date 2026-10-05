import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,symlinkSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {inventoryDatabase,compareInventories} from '../server/database-inventory.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function within(promise,ms){let timer;return Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]).finally(()=>clearTimeout(timer));}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}

for(const production of [true,false])test(`${production?'production':'development'} launcher resolves a relative database once before changing child working directory`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-startup-path-')),app=join(dir,'app'),invocation=join(dir,'invocation'),database=join(invocation,'data','research.sqlite');
 let store,service,child,closed,duplicate,duplicateClosed;
 try{
  mkdirSync(join(app,'scripts'),{recursive:true});mkdirSync(join(app,'dist'));mkdirSync(invocation);
  for(const name of ['server','shared'])cpSync(join(root,name),join(app,name),{recursive:true});
  cpSync(join(root,'scripts','start.mjs'),join(app,'scripts','start.mjs'));
  for(const name of ['package.json','vite.config.js'])cpSync(join(root,name),join(app,name));
  symlinkSync(join(root,'node_modules'),join(app,'node_modules'),'dir');
  writeFileSync(join(app,'dist','index.html'),'<main>Synthetic startup fixture</main>');
  writeFileSync(join(app,'index.html'),'<main>Synthetic startup fixture</main>');
  // Child service and launcher both use this guard. Local health probes work;
  // all external requests fail even if a wrong, empty DB were accidentally opened.
  const guard=join(dir,'network-guard.mjs');
  writeFileSync(guard,`const original=globalThis.fetch;globalThis.fetch=(url,options)=>{const u=new URL(typeof url==='string'?url:url.url||url.href);if(!['127.0.0.1','localhost'].includes(u.hostname))throw Error('Fixture forbids external network');return original(url,options);};`);
  store=openStore(database);assertDatabaseMode(store,'research');service=createService(store,{mode:'research',storageConfig:{databasePath:database,backupRoot:join(invocation,'data','backups')},backupTask:async()=>({ok:true})});
  const topic=service.research.create({title:'Saved startup fixture',summary:'Must remain on the selected database'});
  for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');
  // Suppress startup/tick mutations so the complete database can be compared.
  store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();
  await service.close();service=null;store.close();store=null;
  const before=inventoryDatabase(database),frontendPort=await freePort();let apiPort=await freePort();while(apiPort===frontendPort)apiPort=await freePort();
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('SIGNAL_'))delete env[key];
  Object.assign(env,{SIGNAL_MODE:'research',SIGNAL_DB_PATH:'data/research.sqlite',SIGNAL_FRONTEND_PORT:String(frontendPort),SIGNAL_API_PORT:String(apiPort),NODE_OPTIONS:'--import '+JSON.stringify(guard)});
  child=spawn(process.execPath,[join(app,'scripts','start.mjs'),'research',...(production?['--production']:[])],{cwd:invocation,env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));let spawnError;child.once('error',e=>spawnError=e);
  const deadline=Date.now()+15000;while(!output.includes('Signal Hunter:')&&!spawnError&&child.exitCode===null&&Date.now()<deadline)await pause(25);
  assert.ifError(spawnError);assert.match(output,/Signal Hunter:/,'service must start: '+output);
  assert.equal(existsSync(join(app,'data','research.sqlite')),false,'child must not create a second database relative to its own cwd');
  while(!output.includes('工作台已就绪')&&child.exitCode===null&&Date.now()<deadline)await pause(25);
  assert.match(output,/工作台已就绪/);assert.ok(output.includes(database));
  const base='http://127.0.0.1:'+frontendPort,snapshot=await(await fetch(base+'/api/data',{signal:AbortSignal.timeout(2000)})).json();
  assert.equal(snapshot.research.topics.length,1);assert.equal(snapshot.research.topics[0].id,topic.id);assert.equal(snapshot.serviceHealth.restoreReviewRequired,true);
  const history=await(await fetch(base+'/api/news/'+ 'a'.repeat(64)+'/history-recall')).json();
  assert.equal(history.enabled,false);assert.match(history.unavailableReason,/完整候选源码/);assert.deepEqual(history.reports,[]);
  // A second invocation with occupied ports must leave the first service and
  // both possible locations of a new relative database untouched.
  duplicate=spawn(process.execPath,[join(app,'scripts','start.mjs'),'research',...(production?['--production']:[])],{cwd:invocation,env:{...env,SIGNAL_DB_PATH:'data/blocked.sqlite'},stdio:['ignore','pipe','pipe']});
  let failure='';duplicate.stdout.on('data',b=>failure+=b);duplicate.stderr.on('data',b=>failure+=b);
  duplicateClosed=new Promise(resolve=>duplicate.once('close',(code,signal)=>resolve({code,signal})));duplicate.once('error',e=>failure+=e.message);
  const rejected=await within(duplicateClosed,5000);assert.ok(rejected,'occupied-port invocation did not stop');assert.equal(rejected.code,1);assert.match(failure,/端口不可用/);
  for(const folder of [app,invocation])assert.equal(existsSync(join(folder,'data','blocked.sqlite')),false);
  assert.equal((await(await fetch(base+'/api/data',{signal:AbortSignal.timeout(2000)})).json()).research.topics[0].id,topic.id);
  child.kill('SIGTERM');const result=await within(closed,12000);assert.ok(result,'launcher did not stop');
  assert.equal(result.code,0);const preservation=compareInventories(before,inventoryDatabase(database));assert.equal(preservation.passed,true,JSON.stringify(preservation.tables.filter(t=>!t.identical)));
 }finally{
  if(duplicate&&duplicate.exitCode===null&&duplicate.signalCode===null)duplicate.kill('SIGKILL');if(duplicateClosed)await duplicateClosed;
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await within(closed,12000);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  if(closed)await closed;if(service)await service.close();if(store)store.close();rmSync(dir,{recursive:true,force:true});
 }
});

for(const preserveMain of [false,true])test(`direct server entry starts through a directory alias${preserveMain?' with preserve-symlinks-main':''} and keeps the restored database protected`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-direct-alias-')),app=join(dir,'app'),alias=join(dir,'app-alias'),database=join(dir,'data','research.sqlite');let store,service,child,closed;
 try{
  mkdirSync(app);mkdirSync(join(app,'dist'));for(const name of ['server','shared'])cpSync(join(root,name),join(app,name),{recursive:true});
  cpSync(join(root,'package.json'),join(app,'package.json'));symlinkSync(join(root,'node_modules'),join(app,'node_modules'),'dir');symlinkSync(app,alias,'dir');writeFileSync(join(app,'dist','index.html'),'<main>Synthetic alias recovery fixture</main>');
  store=openStore(database);assertDatabaseMode(store,'research');service=createService(store,{mode:'research',storageConfig:{databasePath:database,backupRoot:join(dir,'data','backups')},backupTask:async()=>({ok:true})});const topic=service.research.create({title:'Saved alias fixture',summary:'Restored rows must remain unchanged'});
  for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();await service.close();service=null;store.close();store=null;const before=inventoryDatabase(database);
  const frontendPort=await freePort();let apiPort=await freePort();while(apiPort===frontendPort)apiPort=await freePort();const guard=join(dir,'deny-network.mjs');writeFileSync(guard,"globalThis.fetch=()=>{throw Error('Alias fixture forbids network');};");
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('SIGNAL_')||key==='NODE_OPTIONS')delete env[key];Object.assign(env,{SIGNAL_MODE:'research',SIGNAL_DB_PATH:database,SIGNAL_SERVE_STATIC:'1',SIGNAL_FRONTEND_PORT:String(frontendPort),SIGNAL_API_PORT:String(apiPort)});
  child=spawn(process.execPath,[...(preserveMain?['--preserve-symlinks-main']:[]),'--import',guard,join(alias,'server','index.mjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let output='',spawnError;child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',e=>spawnError=e);closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const deadline=Date.now()+10000;while(!output.includes('Signal Hunter:')&&!spawnError&&child.exitCode===null&&Date.now()<deadline)await pause(25);assert.ifError(spawnError);assert.match(output,/Signal Hunter:/,'aliased direct entry must start: '+output);
  const base='http://127.0.0.1:'+frontendPort,health=await(await fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)})).json();assert.equal(health.restoreReviewRequired,true);const data=await(await fetch(base+'/api/data',{signal:AbortSignal.timeout(2000)})).json();assert.equal(data.research.topics[0].id,topic.id);
  const response=await fetch(base+'/api/news/refresh',{method:'POST',headers:{'content-type':'application/json','x-signal-instance':health.instance.id},body:'{}',signal:AbortSignal.timeout(2000)});assert.equal(response.status,409);assert.match((await response.json()).error,/恢复副本/);assert.equal((await fetch(base+'/',{signal:AbortSignal.timeout(2000)})).status,200);
  child.kill('SIGTERM');const result=await within(closed,12000);assert.ok(result);assert.equal(result.code,0);assert.equal(compareInventories(before,inventoryDatabase(database)).passed,true);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await within(closed,12000);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}if(closed)await closed;if(service)await service.close();if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});
