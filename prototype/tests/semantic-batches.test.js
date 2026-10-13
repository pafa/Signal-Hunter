import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {digest,CodexResearchError} from '../server/codex-research.mjs';
import {openSemanticBatches} from '../server/semantic-batches.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000};
const at='2026-10-03T00:00:00Z';
function candidate(packet){const fields=side=>({actor:'合成主体',action:'待核',object:'未知',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'未知',quote:packet.input[side].body||packet.input[side].title,...(packet.schema==='event-pair-1'?{}:{quoteField:packet.input[side].body?'body':'title'})});const comparison={relation:'unrelated',left:fields('left'),right:fields('right'),reason:'合成样例，保留未命中',missingEvidence:['核对原文']},rawOutput=JSON.stringify(comparison);return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:config.model,inputHash:packet.inputHash,promptVersion:packet.schema,outputHash:digest(rawOutput)}};}
function fixture({path=':memory:',runner=async p=>candidate(p),mode='research'}={}){
 let clock=Date.parse(at),calls=0;const store=openStore(path),service=createService(store,{mode,modelConfig:config,now:()=>clock,semanticRunner:async(...args)=>{calls++;return runner(...args);}});
 const news=[0,1,2].map(n=>({id:digest(`batch-news-${n}`),title:`合成新闻${n}`,url:`https://example.invalid/${n}`,publisher:'合成',publishedAt:at}));store.ingest(news,at);
 const inputs=news.map(n=>({id:n.id,revision:1})),batch=service.semanticBatches;
 const create=(refs=inputs)=>{const p=batch.preview({inputs:refs});return batch.create({inputs:refs,planHash:p.planHash,requestId:randomUUID()});};
 const step=async()=>{service.controlOperation('semantic','resume');return service.runOperation('semantic');};
 const finish=async id=>{for(const item of batch.get(id).items)if(item.runId)await service.semanticEvents.wait(item.runId);return batch.get(id);};
 return {store,service,batch,news,inputs,create,step,finish,get calls(){return calls;},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}
test('preview freezes all distinct pairs, exposes exact call count, and creation is idempotent without starting models',async()=>{
 const f=fixture();try{const plan=f.batch.preview({inputs:f.inputs});assert.equal(plan.maximumCalls,3);assert.equal(new Set(plan.pairs.map(p=>`${p.left}:${p.right}`)).size,3);assert.equal(f.calls,0);assert.equal(f.service.operations().tasks.semantic.paused,true);const request={inputs:f.inputs,planHash:plan.planHash,requestId:randomUUID()},first=f.batch.create(request);assert.equal(f.batch.create(request).id,first.id);assert.equal(f.batch.list().batches.length,1);assert.equal(first.counts.queued,3);assert.equal(f.calls,0);assert.throws(()=>f.batch.create({...request,inputs:[...f.inputs].reverse()}),/请求标识/);assert.throws(()=>f.batch.create({...request,requestId:randomUUID(),planHash:'wrong'}),/计划已变化/);
 for(const data of [{inputs:[f.inputs[0]]},{inputs:[f.inputs[0],f.inputs[0]]},{inputs:Array(11).fill(f.inputs[0])},{inputs:f.inputs,model:'override'}])assert.throws(()=>f.batch.preview(data));
 assert.throws(()=>f.service.runOperation('semantic'),/任务已暂停/);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('scheduler executes every pair once and retains unrelated outputs without adopting or editing research',async()=>{
 const f=fixture();try{const b=f.create(),before=f.service.research.list(),book=f.service.paper.snapshot();for(let i=0;i<3;i++){await f.step();await f.finish(b.id);}const done=f.batch.get(b.id);assert.equal(done.state,'completed');assert.equal(done.counts.candidate,3);assert.equal(f.calls,3);assert.ok(done.items.every(i=>i.relation==='unrelated'&&i.attempts.length===1));assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_decisions').get().n,0);await f.step();assert.equal(f.calls,3);assert.deepEqual(f.service.research.list(),before);assert.deepEqual(f.service.paper.snapshot(),book);
 assert.deepEqual(f.batch.list().batches[0].counts,{candidate:3});
 }finally{await f.close();}
});
test('progress reports exact persisted counts and reuse without resolving comparison evidence or writing state',async()=>{
 const f=fixture();try{
  const first=f.create();await f.step();const completed=await f.finish(first.id),runId=completed.items.find(i=>i.runId).runId;
  const plan=f.batch.preview({inputs:f.inputs}),next=f.batch.create({inputs:f.inputs,planHash:plan.planHash,requestId:randomUUID()},{reuseRunIds:[runId]});
  const inspector=openSemanticBatches(f.store,{status:()=>({enabled:true}),get:()=>{throw Error('progress must not resolve full evidence');}},{enabled:true,config});
  const before=f.store.db.prepare('SELECT total_changes() n').get().n,p=inspector.progress(next.id);
  assert.equal(p.state,'active');assert.equal(p.inputCount,3);assert.equal(p.pairCount,3);assert.equal(p.reusedPairs,1);assert.deepEqual(p.counts,{candidate:1,queued:2});assert.equal(p.items,undefined);
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
  f.batch.control(next.id,{action:'pause'});assert.equal(inspector.progress(next.id).state,'paused');f.batch.control(next.id,{action:'cancel'});assert.equal(inspector.progress(next.id).state,'cancelled');assert.deepEqual(inspector.progress(next.id).counts,{candidate:1,cancelled:2});
 }finally{await f.close();}
});
test('mixed material and news plans freeze bodies internally but return only source summaries',async()=>{
 const f=fixture();try{let topic=f.service.research.create({title:'合成材料主题',summary:'混合输入'});topic=f.service.research.saveMaterial(topic.id,{version:topic.version,title:'合成材料',sourceName:'测试',url:'https://example.invalid/material',body:'正文只留在冻结快照中',scope:'excerpt',publishedAt:'2026-10-01',stance:'unverified',family:'other',step:'fact',interpretation:'合成'});const m=topic.evidence[0],inputs=[f.inputs[0],{kind:'material',id:m.materialId,revision:m.materialRevision}],p=f.batch.preview({inputs});assert.equal(p.inputs[1].body,undefined);const b=f.create(inputs);await f.step();await f.finish(b.id);const r=f.service.semanticEvents.get(f.batch.get(b.id).items[0].runId);assert.equal(r.packet.input.right.body,'正文只留在冻结快照中');assert.equal(f.batch.get(b.id).inputs[1].body,undefined);
 }finally{await f.close();}
});
test('pause stops subsequent calls and cancellation keeps an in-flight result while cancelling queued work',async()=>{
 let finish;const f=fixture({runner:p=>new Promise(resolve=>{finish=()=>resolve(candidate(p));})});try{const b=f.create();await f.step();assert.equal(f.calls,1);f.batch.control(b.id,{action:'pause'});await f.step();assert.equal(f.calls,1);assert.equal(f.batch.get(b.id).counts.running,1);f.batch.control(b.id,{action:'resume'});await f.step();assert.equal(f.calls,1,'shared model lease blocks the next item');f.batch.control(b.id,{action:'cancel'});finish();await f.finish(b.id);const r=f.batch.get(b.id);assert.equal(r.state,'cancelled');assert.equal(r.counts.cancelled,2);assert.equal(r.counts.candidate,1);await f.step();assert.equal(f.calls,1);assert.throws(()=>f.batch.control(b.id,{action:'retry',ordinal:1}),/不能重试/);
 }finally{finish?.();await f.close();}
});
test('failed calls stay terminal without retries; explicit retry keeps the earlier attempt and creates exactly one new call',async()=>{
 let fail=true;const f=fixture({runner:async p=>{if(fail)throw new CodexResearchError('process');return candidate(p);}});try{const b=f.create(f.inputs.slice(0,2));await f.step();await f.finish(b.id);const first=f.batch.get(b.id).items[0].runId;assert.equal(f.batch.get(b.id).counts.failed,1);await f.step();assert.equal(f.calls,1);fail=false;f.batch.control(b.id,{action:'retry',ordinal:0});assert.throws(()=>f.batch.control(b.id,{action:'retry',ordinal:0}),/只能重试/);await f.step();await f.finish(b.id);const item=f.batch.get(b.id).items[0];assert.deepEqual(item.attempts[0],first);assert.equal(item.attempts.length,2);assert.equal(f.service.semanticEvents.get(first).status,'failed');assert.equal(item.status,'candidate');assert.equal(f.calls,2);
 }finally{await f.close();}
});
test('news changes between preview and creation reject the plan; changes after creation invalidate only affected pairs',async()=>{
 const f=fixture();try{const p=f.batch.preview({inputs:f.inputs}),b=f.create();f.store.ingest([{...f.news[0],title:'修订后的新闻'}],'2026-10-03T01:00:00Z');assert.throws(()=>f.batch.create({inputs:f.inputs,planHash:p.planHash,requestId:randomUUID()}),/已修订/);for(let i=0;i<3;i++){await f.step();await f.finish(b.id);}const r=f.batch.get(b.id);assert.equal(r.counts.invalidated,2);assert.equal(r.counts.candidate,1);assert.equal(f.calls,1);assert.equal(r.inputs[0].title,'合成新闻0');assert.equal(f.service.operations().tasks.semantic.blocked,false);
 }finally{await f.close();}
});
test('configuration or frozen execution fingerprint changes do not silently run another model or prompt',async()=>{
 const f=fixture();try{const b=f.create(f.inputs.slice(0,2)),different=openSemanticBatches(f.store,f.service.semanticEvents,{enabled:true,config:{...config,model:'other'}});different.step({assertActive(){}});assert.equal(different.get(b.id).counts.invalidated,1);assert.equal(f.calls,0);
 const c=f.create(f.inputs.slice(1)),row=f.store.db.prepare('SELECT payload FROM semantic_batch_items WHERE batch_id=?').get(c.id),item=JSON.parse(row.payload);item.executionHash='older-prompt';f.store.db.prepare('UPDATE semantic_batch_items SET payload=? WHERE batch_id=?').run(JSON.stringify(item),c.id);await f.step();assert.equal(f.batch.get(c.id).counts.invalidated,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('batch and semantic run linkage commit together and a storage failure leaves the item queued',async()=>{
 const f=fixture();try{const b=f.create();f.store.db.exec("CREATE TRIGGER fail_batch_start BEFORE UPDATE ON semantic_batch_items BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");await f.step();assert.equal(f.batch.get(b.id).counts.queued,3);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);assert.equal(f.calls,0);f.store.db.exec('DROP TRIGGER fail_batch_start');await f.step();await f.finish(b.id);assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('cancellation of the scheduler context before run commit rolls back both the queue update and model run',async()=>{
 const f=fixture();try{const b=f.create();let checks=0;assert.throws(()=>f.batch.step({assertActive(){if(++checks>=2)throw Error('cancelled context');}}),/cancelled context/);assert.equal(f.batch.get(b.id).counts.queued,3);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('a single comparison occupies the same lease and does not consume a queued batch attempt',async()=>{
 let finish;const f=fixture({runner:p=>new Promise(resolve=>{finish=()=>resolve(candidate(p));})});try{const b=f.create(),r=f.service.semanticEvents.start({left:f.inputs[0],right:f.inputs[1]});await Promise.resolve();await f.step();assert.equal(f.batch.get(b.id).counts.queued,3);assert.equal(f.calls,1);finish();await f.service.semanticEvents.wait(r.id);await f.step();assert.equal(f.calls,2);finish();await f.finish(b.id);
 }finally{finish?.();await f.close();}
});
test('separate service instances cannot issue the same queued comparison twice',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'semantic-batch-shared-')),path=join(dir,'fixture.sqlite');let finish;const f=fixture({path,runner:p=>new Promise(resolve=>{finish=()=>resolve(candidate(p));})}),otherStore=openStore(path),other=createService(otherStore,{mode:'research',modelConfig:config,now:()=>Date.parse(at),semanticRunner:async()=>{throw Error('must not run');}});
 try{const b=f.create();await f.step();other.controlOperation('semantic','resume');await other.runOperation('semantic');assert.equal(f.calls,1);assert.equal(f.batch.get(b.id).items[0].attempts.length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,1);finish();await f.finish(b.id);}finally{finish?.();await other.close();otherStore.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('paused batches and completed attempts survive reopening without automatic replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'semantic-batch-reopen-')),path=join(dir,'fixture.sqlite'),f=fixture({path});let store,service;
 try{const b=f.create();await f.step();await f.finish(b.id);f.batch.control(b.id,{action:'pause'});const before=f.batch.get(b.id);await f.close();store=openStore(path);service=createService(store,{mode:'research',modelConfig:config,now:()=>Date.parse(at),semanticRunner:async()=>{throw Error('must not rerun');}});assert.deepEqual(service.semanticBatches.get(b.id),before);service.controlOperation('semantic','resume');await service.runOperation('semantic');assert.deepEqual(service.semanticBatches.get(b.id),before);}finally{if(service){await service.close();store.close();}else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('expired orphan calls are projected as interrupted and never resubmitted without explicit retry',async()=>{
 const f=fixture();try{const b=f.create(f.inputs.slice(0,2));await f.step();await f.finish(b.id);const item=f.batch.get(b.id).items[0],run=f.service.semanticEvents.get(item.runId);f.store.db.prepare("UPDATE semantic_runs SET status='running',expires_at=0,payload=? WHERE id=?").run(JSON.stringify({...run,status:'running',candidate:undefined}),run.id);assert.equal(f.batch.get(b.id).counts.interrupted,1);await f.step();assert.equal(f.calls,1);assert.equal(f.store.db.prepare('SELECT status FROM semantic_runs WHERE id=?').get(run.id).status,'running');
 assert.deepEqual(f.batch.list().batches[0].counts,{interrupted:1});
 }finally{await f.close();}
});
test('restore gating and demo mode prohibit new batch calls while retaining read access',async()=>{
 const f=fixture();try{const b=f.create();f.store.db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1')").run();assert.throws(()=>f.create(),/恢复副本/);assert.throws(()=>f.batch.control(b.id,{action:'resume'}),/恢复副本/);assert.throws(()=>f.batch.step({assertActive(){}}),/恢复副本/);assert.equal(f.batch.get(b.id).counts.queued,3);assert.equal(f.calls,0);}finally{await f.close();}
 const demo=fixture({mode:'demo'});try{assert.throws(()=>demo.create(),/未启用/);demo.service.controlOperation('semantic','resume');await demo.service.tick();assert.equal(demo.calls,0);}finally{await demo.close();}
});
test('HTTP preview and create reject injected settings, preserve idempotency and expose batch results',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service),call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};};
 try{assert.equal((await call('GET','/api/semantic-batches')).result.task.paused,true);const p=await call('POST','/api/semantic-batches/preview',{inputs:f.inputs});assert.equal(p.result.maximumCalls,3);const data={inputs:f.inputs,planHash:p.result.planHash,requestId:randomUUID()},b=await call('POST','/api/semantic-batches',data);assert.equal(b.status,201);assert.equal((await call('POST','/api/semantic-batches',data)).result.id,b.result.id);assert.equal((await call('POST','/api/semantic-batches',{...data,model:'override'})).status,400);assert.equal((await call('POST','/api/semantic-batches/preview',{inputs:f.inputs,beforePersist:'injected'})).status,400);assert.equal((await call('GET',`/api/semantic-batches/${b.result.id}`)).result.counts.queued,3);assert.equal((await call('POST',`/api/semantic-batches/${b.result.id}/control`,{action:'pause'})).result.state,'paused');
 }finally{await f.close();}
});
test('a revision committed by another connection before the model transaction invalidates the item without a call',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'semantic-batch-race-')),path=join(dir,'fixture.sqlite'),f=fixture({path}),other=openStore(path),original=f.store.db.exec.bind(f.store.db);
 try{const b=f.create(f.inputs.slice(0,2));let armed=true;f.store.db.exec=sql=>{if(armed&&sql==='BEGIN IMMEDIATE'){armed=false;other.ingest([{...f.news[0],title:'并发修订'}],'2026-10-03T01:00:00Z');}return original(sql);};f.batch.step({assertActive(){}});assert.equal(f.batch.get(b.id).counts.invalidated,1);assert.equal(f.calls,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,0);}
 finally{f.store.db.exec=original;other.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});
