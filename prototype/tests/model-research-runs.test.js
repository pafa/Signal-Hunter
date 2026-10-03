import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {openModelResearchRuns} from '../server/model-research-runs.mjs';
import {digest,CodexResearchError} from '../server/codex-research.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';

const config={binary:'/opt/test/codex',model:'test-model',effort:'high',timeoutMs:1000};
function result(packet){const output={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['没有材料，保留未知并补充来源。'],sourceIds:[]})),missingEvidence:['取得有来源的原文']},rawOutput=JSON.stringify(output);return {status:'candidate',reviewStatus:'unreviewed',...output,rawOutput,trace:{inputHash:packet.inputHash,topicId:packet.input.topicId,topicVersion:packet.input.topicVersion,model:config.model,outputHash:digest(rawOutput)}};}
function setup(runner=async packet=>result(packet)){
 const store=openStore(':memory:'),research=openResearch(store,{seed:false}),paper=openPaper(store,research,{seed:false});
 const topic=research.create({title:'合成候选流程',summary:'验证候选不会自动覆盖研究或交易'}),runs=openModelResearchRuns(store,research,{enabled:true,config,runner});
 return {store,research,paper,topic,runs,async close(){await runs.close();store.close();}};
}
test('model candidate requires explicit adoption, preserves input and paper book, and keeps provenance through manual edits',async()=>{
 const f=setup();try{
  const original=f.research.get(f.topic.id),book=f.paper.snapshot(),packet=f.research.packet(f.topic.id);
  const start=f.runs.start(f.topic.id,{version:1});assert.equal(start.status,'running');
  const run=await f.runs.wait(start.id);assert.equal(run.status,'candidate');assert.deepEqual(run.packet.input,packet.input);assert.equal(run.packet.inputHash,packet.inputHash);assert.ok(Number.isFinite(Date.parse(run.packet.generatedAt)));assert.deepEqual(f.research.get(f.topic.id),original);assert.deepEqual(f.paper.snapshot(),book);
  const adopted=f.runs.adopt(f.topic.id,start.id,{version:1});assert.equal(adopted.version,2);assert.equal(adopted.dossier.reviewStatus,'draft');assert.equal(adopted.dossier.sourceModelRun.id,start.id);assert.match(adopted.dossier.preparedBy,/Codex/);assert.equal(f.runs.get(f.topic.id,start.id).acceptedVersion,2);
  assert.throws(()=>f.runs.adopt(f.topic.id,start.id,{version:2}),/已经处理/);
  const edited=f.research.update(f.topic.id,{version:2,dossier:{sections:adopted.dossier.sections,reviewStatus:'draft',revisionReason:'本人核对后修改'}});assert.equal(edited.dossier.sourceModelRun.id,start.id);
  assert.deepEqual(f.paper.snapshot(),book);assert.equal(f.research.history(f.topic.id).at(-1).topic.dossier,undefined);
 }finally{await f.close();}
});
test('concurrent requests, wrong topics, stale versions and changed materials do not overwrite research',async()=>{
 let release;const f=setup(packet=>new Promise(resolve=>{release=()=>resolve(result(packet));}));try{
  const start=f.runs.start(f.topic.id,{version:1});assert.throws(()=>f.runs.start(f.topic.id,{version:1}),/正在运行/);await Promise.resolve();
  const other=f.research.create({title:'另一个事件',summary:'隔离事件'});assert.throws(()=>f.runs.get(other.id,start.id),/不属于/);
  f.research.update(f.topic.id,{version:1,nextEvidence:'原研究在推理过程中更新'});release();await f.runs.wait(start.id);
  assert.throws(()=>f.runs.adopt(f.topic.id,start.id,{version:2}),/已变化/);assert.equal(f.runs.get(f.topic.id,start.id).status,'candidate');assert.equal(f.research.get(f.topic.id).dossier,undefined);
  assert.throws(()=>f.runs.start(f.topic.id,{version:1}),/已更新/);
 }finally{await f.close();}
});
test('candidate adoption and research version are one transaction; failures retain original candidate',async()=>{
 const f=setup();try{
  const start=f.runs.start(f.topic.id,{version:1});await f.runs.wait(start.id);
  f.store.db.exec("CREATE TRIGGER fail_model_adoption BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'simulated storage error'); END");
  assert.throws(()=>f.runs.adopt(f.topic.id,start.id,{version:1}),/simulated storage error/);assert.equal(f.runs.get(f.topic.id,start.id).status,'candidate');assert.equal(f.research.get(f.topic.id).version,1);
 }finally{await f.close();}
});
test('failed and cancelled calls persist safe records, and expired interrupted calls recover without automatic retry',async()=>{
 let calls=0;const f=setup(async()=>{calls++;throw new Error('private credential and provider log');});try{
  const started=f.runs.start(f.topic.id,{version:1}),failed=await f.runs.wait(started.id);assert.equal(failed.status,'failed');assert.doesNotMatch(JSON.stringify(failed),/private credential/);
  const old={...failed,id:'expired',status:'running'};delete old.failure;
  f.store.db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run(old.id,old.topicId,old.status,old.createdAt,0,JSON.stringify(old));
  assert.equal(f.runs.list(f.topic.id)[0].status,'interrupted');assert.equal(f.runs.get(f.topic.id,'expired').status,'interrupted');assert.equal(f.store.db.prepare('SELECT status FROM model_research_runs WHERE id=?').get('expired').status,'running','GET projects expiry without writing');
  const reopened=openModelResearchRuns(f.store,f.research,{enabled:true,config});assert.equal(reopened.get(f.topic.id,'expired').status,'interrupted');assert.equal(calls,1);await reopened.close();
 }finally{await f.close();}
 const c=setup((packet,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new CodexResearchError('cancelled')),{once:true});}));try{
  const started=c.runs.start(c.topic.id,{version:1});await Promise.resolve();c.runs.cancel(c.topic.id,started.id);assert.equal((await c.runs.wait(started.id)).status,'cancelled');assert.equal(c.research.get(c.topic.id).version,1);
 }finally{await c.close();}
});
test('candidate persistence rejects invalid adapter output and trace mismatches',async()=>{
 for(const mutate of [r=>r.trace.inputHash='wrong',r=>r.sections[0].sourceIds=['invented'],r=>r.rawOutput='tampered',r=>r.reviewStatus='complete',r=>r.trace.topicId='other']){
  const f=setup(async packet=>{const r=result(packet);mutate(r);return r;});try{const started=f.runs.start(f.topic.id,{version:1});assert.equal((await f.runs.wait(started.id)).failure.code,'output');assert.equal(f.research.get(f.topic.id).version,1);}finally{await f.close();}
 }
});
test('adoption rejects stored output or provenance mismatches without changing research, paper or the saved run',async()=>{
 for(const mutate of [
  r=>r.candidate.sections[0].paragraphs[0]='Stored text no longer matches the model response',
  r=>r.candidate.missingEvidence=['Changed after generation'],
  r=>r.candidate.rawOutput='invalid stored JSON',
  r=>r.candidate.trace.outputHash='wrong',
  r=>r.candidate.trace.model='different-model',
  r=>r.candidate.reviewStatus='complete',
  r=>r.packet.input.topicVersion=2,
 ]){
  const f=setup();try{
   const started=f.runs.start(f.topic.id,{version:1});await f.runs.wait(started.id);
   const row=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(started.id),run=JSON.parse(row.payload);mutate(run);
   const payload=JSON.stringify(run);f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(payload,started.id);
   const topic=f.research.get(f.topic.id),history=f.research.history(f.topic.id),book=f.paper.snapshot();
   assert.throws(()=>f.runs.adopt(f.topic.id,started.id,{version:1}),CodexResearchError);
   assert.deepEqual(f.research.get(f.topic.id),topic);assert.deepEqual(f.research.history(f.topic.id),history);assert.deepEqual(f.paper.snapshot(),book);
   assert.equal(f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(started.id).payload,payload,'failed validation must preserve the stored record for diagnosis');
  }finally{await f.close();}
 }
});
test('adoption rechecks the exact candidate inside the research transaction',async()=>{
 const f=setup();try{
  const started=f.runs.start(f.topic.id,{version:1});await f.runs.wait(started.id);
  const original=f.research.adoptModelDraft.bind(f.research),topic=f.research.get(f.topic.id),history=f.research.history(f.topic.id);
  f.research.adoptModelDraft=(...args)=>{
   const run=f.runs.get(f.topic.id,started.id);run.candidate.sections[0].paragraphs[0]='Replaced between preview and transaction';
   f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(run),started.id);
   return original(...args);
  };
  assert.throws(()=>f.runs.adopt(f.topic.id,started.id,{version:1}),CodexResearchError);
  assert.deepEqual(f.research.get(f.topic.id),topic);assert.deepEqual(f.research.history(f.topic.id),history);
  assert.equal(f.runs.get(f.topic.id,started.id).status,'candidate');
 }finally{await f.close();}
});
test('an intact stored candidate remains adoptable after the configured model changes',async()=>{
 const f=setup();let reopened;try{
  const started=f.runs.start(f.topic.id,{version:1});await f.runs.wait(started.id);
  reopened=openModelResearchRuns(f.store,f.research,{enabled:true,config:{...config,model:'new-model'}});
  const topic=reopened.adopt(f.topic.id,started.id,{version:1});
  assert.equal(topic.dossier.reviewStatus,'draft');assert.equal(topic.dossier.sourceModelRun.model,config.model);
  assert.equal(reopened.get(f.topic.id,started.id).acceptedVersion,2);
 }finally{if(reopened)await reopened.close();await f.close();}
});
test('HTTP exposes read-only status, async generation and explicit adoption; demo blocks model use even with configuration',async()=>{
 for(const mode of ['demo','research']){
  const store=openStore(':memory:'),service=createService(store,{mode,modelConfig:config,modelRunner:async packet=>result(packet)}),handler=createHandler(store,service);
  const topic=service.research.create({title:'HTTP模型核验',summary:'只用临时库'}),base=`/api/research/${topic.id}/model-runs`,book=service.paper.snapshot();
  const call=async(method,url,body)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){if(body)yield JSON.stringify(body);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
  try{
   assert.equal((await call('GET',base)).result.enabled,mode!=='demo');assert.equal(service.modelResearch.list(topic.id).length,0);
   const invalid=await call('POST',base,{version:1,model:'unapproved-override'});assert.equal(invalid.status,400);assert.equal(invalid.result.error,'模型调用仅接受研究版本；模型配置由本机服务管理');
   const started=await call('POST',base,{version:1});assert.equal(started.status,mode==='demo'?400:202);
   if(mode==='research'){
    await service.modelResearch.wait(started.result.id);const detail=await call('GET',`${base}/${started.result.id}`);assert.equal(detail.result.status,'candidate');
    const adopted=await call('POST',`${base}/${started.result.id}/adopt`,{version:1});assert.equal(adopted.status,200);assert.equal(adopted.result.research.topics.find(t=>t.id===topic.id).dossier.reviewStatus,'draft');
   }
   assert.deepEqual(service.paper.snapshot(),book);
  }finally{await service.close();store.close();}
 }
});
test('model workflow errors preserve actionable owned text without permitting appended details',()=>{
 const message='研究或材料已变化；此候选保留在历史中，请重新生成';assert.equal(safeErrorText(new Error(message)),message);assert.equal(safeErrorText(safeErrorText(message)),message);assert.doesNotMatch(safeErrorText(message+' secret-provider-details'),/secret-provider/);
});
test('background storage failure is observed, retains initial input and never changes the research',async()=>{
 const f=setup(),messages=[],original=console.error;console.error=value=>messages.push(String(value));
 try{
  f.store.db.exec("CREATE TRIGGER fail_run_save BEFORE UPDATE ON model_research_runs BEGIN SELECT RAISE(ABORT,'private SQL diagnostic'); END");
  const started=f.runs.start(f.topic.id,{version:1});await assert.rejects(f.runs.wait(started.id),/private SQL diagnostic/);
  await Promise.resolve();assert.deepEqual(messages,['模型研判记录保存失败；候选未确认落库，请检查本机存储。']);assert.equal(f.research.get(f.topic.id).version,1);assert.equal(f.runs.get(f.topic.id,started.id).packet.input.topicVersion,1);assert.equal(f.runs.get(f.topic.id,started.id).candidate,undefined);
 }finally{console.error=original;await f.close();}
});
