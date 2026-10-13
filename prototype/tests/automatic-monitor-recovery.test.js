import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';

const start=Date.parse('2026-10-08T08:00:00Z');
function fixture({path=':memory:',automatic=true,now=start,fetcher=()=>assert.fail('external requests forbidden')}={}){
 let clock=now;const store=openStore(path),service=createService(store,{mode:'research',now:()=>clock,fetcher,modelConfig:{binary:'/test/codex',model:'synthetic',timeoutMs:1000}});
 if(service.researchPipeline.snapshot().settings.version===1)service.researchPipeline.configure({version:1,dailyCalls:10,includeClues:false,extractEvents:true,automatic});
 return {store,service,time:v=>clock=v,task:lane=>service.operations().tasks[lane],isolate:lane=>{for(const name of Object.keys(service.operations().tasks))if(name!==lane)service.controlOperation(name,'pause');if(service.operations().tasks[lane].paused)service.controlOperation(lane,'resume');},close:async()=>{await service.close();store.close();}};
}
function worker(f,lane,job){
 if(lane==='daily'||lane==='minutes'){f.store.addWatch('AAPL.US');f.service[lane==='daily'?'refreshDaily':'refreshQuote']=job;}
 else f.service[lane==='observations'?'observations':'priceCollection'][lane==='observations'?'process':'step']=job;
}
const runs=(f,lane)=>f.store.db.prepare('SELECT * FROM operation_runs WHERE name=? ORDER BY id').all(lane);
async function failThree(f,lane){for(let i=0;i<3;i++){await f.service.tick();assert.equal(f.task(lane).consecutiveFailures,i+1);if(i<2)f.time(Date.parse(f.task(lane).nextRunAt));}assert(f.task(lane).blocked);}

for(const lane of ['daily','minutes','observations','pricecollection'])test(`${lane}: registered automatic task recovers after three failures only when due, retaining failed history`,async()=>{
 const f=fixture();let calls=0,healthy=false;try{
  f.isolate(lane);worker(f,lane,()=>{calls++;if(!healthy)throw Error('synthetic temporary failure');return {ok:true,added:1};});
  await failThree(f,lane);const history=runs(f,lane);assert.equal(calls,3);assert.equal(history.length,3);assert(history.every(r=>r.outcome==='error'));
  healthy=true;const due=Date.parse(f.task(lane).nextRunAt);f.time(due-1);await f.service.tick();assert.equal(calls,3);
  f.time(due);await f.service.tick();assert.equal(calls,4);assert.equal(f.task(lane).blocked,false);assert.equal(f.task(lane).consecutiveFailures,0);assert(f.task(lane).lastSuccessAt);
  assert.deepEqual(runs(f,lane).slice(0,3),history);assert.equal(runs(f,lane).at(-1).outcome,'ok');
  assert(f.service.operations().tasks.execution.paused);assert(f.service.operations().tasks.semantic.paused);
 }finally{await f.close();}
});

test('automatic start does not enable paused monitoring, evaluation or execution tasks',async()=>{
 const f=fixture();try{
  for(const lane of ['daily','minutes','observations'])f.service.controlOperation(lane,'pause');
  f.service.controlResearchAutomation({action:'start',version:2});
  for(const lane of ['daily','minutes','observations','pricecollection','execution','semantic'])assert(f.task(lane).paused,lane);
  assert.equal(f.task('news').paused,false);assert.equal(f.task('discovery').paused,false);
 }finally{await f.close();}
});

test('pause, cancel, restore lock and a policy without automatic research prohibit recovery',async()=>{
 for(const gate of ['pause','cancel','restore','not-automatic']){
  const f=fixture({automatic:gate!=='not-automatic'});let calls=0;try{
   f.isolate('observations');worker(f,'observations',()=>{calls++;throw Error('synthetic');});await failThree(f,'observations');
   if(gate==='restore')f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();
   else if(gate!=='not-automatic')f.service.controlOperation('observations',gate);
   f.time(Date.parse(f.task('observations').nextRunAt)+3600000);await f.service.tick();assert.equal(calls,3,gate);assert.equal(runs(f,'observations').length,3,gate);
  }finally{await f.close();}
 }
});

test('blocked monitoring survives a database reopen and resumes without manual reset or duplicate work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'automatic-monitor-')),path=join(dir,'test.sqlite');let f=fixture({path}),closed=false;
 try{
  f.isolate('observations');worker(f,'observations',()=>{throw Error('synthetic');});await failThree(f,'observations');const due=Date.parse(f.task('observations').nextRunAt),history=runs(f,'observations');
  await f.close();closed=true;f=fixture({path,now:due-1});closed=false;let calls=0;worker(f,'observations',()=>{calls++;return {ok:true,added:1};});
  await f.service.tick();assert.equal(calls,0);assert.deepEqual(runs(f,'observations'),history);f.time(due);await f.service.tick();await f.service.tick();assert.equal(calls,1);assert.deepEqual(runs(f,'observations').slice(0,3),history);
 }finally{if(!closed)await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('automatic minute retries retain provider 429 cooling, failure records and an empty quote cache',async()=>{
 let requests=0;const f=fixture({fetcher:async()=>{requests++;return new Response('',{status:429});}});try{
  f.isolate('minutes');f.store.addWatch('AAPL.US');await failThree(f,'minutes');const count=requests,history=runs(f,'minutes');assert(count>0);
  f.time(Date.parse(f.task('minutes').nextRunAt));await f.service.tick();assert.equal(requests,count,'retrying the task must not bypass upstream cooldown');assert.equal(runs(f,'minutes').length,4);assert.deepEqual(runs(f,'minutes').slice(0,3),history);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM quote_snapshots').get().n,0);assert(Object.values(f.store.checks()).some(c=>c.retryAt&&Date.parse(c.retryAt)>Date.parse(f.task('minutes').completedAt)));
 }finally{await f.close();}
});

test('repeated monitor failures back off to fifteen minutes without erasing errors or spinning early',async()=>{
 const f=fixture();let calls=0;try{
  f.isolate('observations');worker(f,'observations',()=>{calls++;throw Error('synthetic');});
  for(let i=1;i<=9;i++){
   await f.service.tick();assert.equal(calls,i);const task=f.task('observations'),due=Date.parse(task.nextRunAt),completed=Date.parse(task.completedAt);
   assert.equal(due-completed,Math.min(30000*2**(i-1),900000));f.time(due-1);await f.service.tick();assert.equal(calls,i);f.time(due);
  }
  assert.equal(runs(f,'observations').length,9);assert(runs(f,'observations').every(r=>r.outcome==='error'));
 }finally{await f.close();}
});

test('original observation job recovers from a transient NAV write failure without rewriting ledger facts or duplicating samples',async()=>{
 const f=fixture();try{
  f.isolate('observations');const p=f.service.actualHoldings.ledger.preview({rows:[{account:'Synthetic cash',currency:'USD',externalId:'opening',type:'opening',at:new Date(start).toISOString(),sequence:'0',source:'Synthetic only',amount:'10000',costMethod:'average'}],confirmOpening:true});assert(p.canApply);f.service.actualHoldings.ledger.apply({id:p.id,hash:p.hash});
  const facts=f.service.actualHoldings.ledger.snapshot();f.store.db.exec("CREATE TRIGGER synthetic_nav_failure BEFORE INSERT ON actual_nav_samples BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
  await failThree(f,'observations');assert.equal(f.store.db.prepare('SELECT count(*) n FROM actual_nav_samples').get().n,0);
  f.store.db.exec('DROP TRIGGER synthetic_nav_failure');f.time(Date.parse(f.task('observations').nextRunAt));await f.service.tick();await f.service.tick();
  assert.equal(f.task('observations').blocked,false);assert.equal(f.store.db.prepare('SELECT count(*) n FROM actual_nav_samples').get().n,1);assert.deepEqual(f.service.actualHoldings.ledger.snapshot(),facts);assert.deepEqual(runs(f,'observations').map(r=>r.outcome),['error','error','error','ok']);
 }finally{await f.close();}
});
