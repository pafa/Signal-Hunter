import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createBackup} from '../server/backup.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {createHandler} from '../server/index.mjs';
import {digest,codexPrompt,CODEX_PROMPT_VERSION,CODEX_DRAFT_SCHEMA} from '../server/codex-research.mjs';
const config={binary:'/test/codex',model:'fixture',effort:'high',timeoutMs:5000};
function output(p){const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成输入，未知事项待核对。'],sourceIds:p.input.evidence.map(e=>e.id)})),missingEvidence:['完整事实与结局']},rawOutput=JSON.stringify(d);return {status:'candidate',reviewStatus:'unreviewed',...d,rawOutput,trace:{model:config.model,effort:'high',inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,promptVersion:CODEX_PROMPT_VERSION,promptHash:digest(codexPrompt(p)),schemaHash:digest(CODEX_DRAFT_SCHEMA),outputHash:digest(rawOutput)}};}
function fixture({path=':memory:',mode='research',modelConfig=config,runner=async p=>output(p)}={}){
 let now=Date.parse('2026-10-03T00:00:00Z'),calls=0;
 const store=openStore(path);assertDatabaseMode(store,mode);const service=createService(store,{mode,now:()=>now,modelConfig,modelRunner:async(...args)=>{calls++;return runner(...args);},semanticRunner:async p=>{const f=s=>({actor:'合成',action:'拟收购',object:'合成标的',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'待核',quote:p.input[s].title}),comparison={relation:'followup',left:f('left'),right:f('right'),reason:'合成比较',missingEvidence:['原文']},rawOutput=JSON.stringify(comparison);return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};}});
 const prepare=async()=>{
  now+=3600000;const at=new Date(now).toISOString(),news=[0,1].map(i=>({id:randomUUID(),title:'合成新闻'+i,url:'https://example.com/'+randomUUID(),publisher:'合成',publishedAt:at}));store.ingest(news,at);
  const topic=service.research.createFromNews({newsId:news[0].id,newsRevision:1}),inputs=news.map(n=>({id:n.id,revision:1}));
  const p=service.semanticBatches.preview({inputs}),b=service.semanticBatches.create({inputs,planHash:p.planHash,requestId:randomUUID()});service.semanticBatches.step({assertActive(){}});await service.semanticEvents.wait(service.semanticBatches.get(b.id).items[0].runId);now+=1000;
  const g=service.eventClusters.preview(b.id).groups[0],cluster=service.eventClusters.save({batchId:b.id,groupId:g.id,previewHash:g.hash,clusterId:'',version:0,title:'合成簇',note:'开发测试，非独立真值',requestId:randomUUID()});now+=1000;return {topic,cluster,news,batchId:b.id};
 };
 return {store,service,prepare,get calls(){return calls;},tick(){now+=1000;},async close(){await service.close();store.close();}};
}
const freeze=f=>f.service.forwardEvaluations.freeze({requestId:randomUUID(),title:'合成前向输入基线'});
const start=(f,t)=>f.service.modelResearch.start(t.id,{version:t.version});
test('freezing is explicit, idempotent, versioned and retains actual configured model with no model invocation',async()=>{
 const f=fixture();try{
  assert.equal(f.service.forwardEvaluations.list().activeBaselineId,null);
  const data={requestId:randomUUID(),title:'第一基线'},a=f.service.forwardEvaluations.freeze(data),original=f.service.forwardEvaluations.baseline(a.id);assert.equal(a.execution.model,config.model);assert.equal(a.execution.promptVersion,CODEX_PROMPT_VERSION);assert.equal(f.calls,0);
  assert.deepEqual(f.service.forwardEvaluations.freeze({title:data.title,requestId:data.requestId}),a);assert.throws(()=>f.service.forwardEvaluations.freeze({...data,title:'改名'}));
  const b=freeze(f);assert.notEqual(b.id,a.id);f.service.forwardEvaluations.freeze(data);assert.equal(f.service.forwardEvaluations.list().activeBaselineId,b.id);assert.deepEqual(f.service.forwardEvaluations.baseline(a.id),original);
  assert.throws(()=>f.service.forwardEvaluations.freeze({...data,model:'override'}));
 }finally{await f.close();}
});
test('before inference a model run atomically captures full reviewed membership, exact input and baseline',async()=>{
 let release;const f=fixture({runner:p=>new Promise(resolve=>{release=()=>resolve(output(p));})});try{
  const baseline=freeze(f),{topic,cluster}=await f.prepare(),book=f.service.paper.snapshot(),run=start(f,topic),captured=f.service.forwardEvaluations.get(run.id);
  assert.equal(f.calls,0);assert.equal(captured.baselineId,baseline.id);assert.equal(captured.record.inputHash,f.service.research.packet(topic.id).inputHash);assert.equal(captured.clusterSnapshots[0].id,cluster.id);assert.equal(captured.record.clusterMembers.length,2);assert.equal(captured.inputEligibility.eligible,true);assert.equal(captured.forwardEligible,false);assert.equal(captured.modelStatus,'running');assert.equal(captured.integrity.valid,true);
  await Promise.resolve();release();await f.service.modelResearch.wait(run.id);assert.equal(f.service.forwardEvaluations.get(run.id).integrity.valid,true);
  assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.research.get(topic.id).version,topic.version);
 }finally{await f.close();}
});
test('later edits, archival and a new baseline do not rewrite the frozen model inputs or cluster version',async()=>{
 const f=fixture();try{
  const b=freeze(f),{topic,cluster}=await f.prepare(),run=start(f,topic);await f.service.modelResearch.wait(run.id);const before=f.service.forwardEvaluations.get(run.id);
  f.service.research.update(topic.id,{version:topic.version,nextEvidence:'后来修改'});f.service.eventClusters.archive(cluster.id,{version:1,note:'后来归档',requestId:randomUUID()});freeze(f);
  assert.deepEqual(f.service.forwardEvaluations.get(run.id),before);assert.equal(before.baselineId,b.id);
 }finally{await f.close();}
});
test('old sources, missing membership, repeated runs and failures stay captured with exclusions',async()=>{
 const f=fixture();try{
  const {topic}=await f.prepare();freeze(f);const first=start(f,topic);await f.service.modelResearch.wait(first.id);assert.equal(f.service.forwardEvaluations.get(first.id).inputEligibility.eligible,false);
  const second=start(f,topic);await f.service.modelResearch.wait(second.id);assert.ok(f.service.forwardEvaluations.get(second.id).inputEligibility.reasons.includes('该研究已有模型调用'));
  const other=f.service.research.create({title:'无来源合成研究',summary:'未知'}),r=start(f,other);await f.service.modelResearch.wait(r.id);assert.equal(f.service.forwardEvaluations.get(r.id).inputEligibility.eligible,false);
 }finally{await f.close();}
 const g=fixture({runner:async()=>{throw Error('private failure');}});try{freeze(g);const {topic}=await g.prepare(),r=start(g,topic);await g.service.modelResearch.wait(r.id);assert.equal(g.service.forwardEvaluations.get(r.id).modelStatus,'failed');assert.equal(g.service.forwardEvaluations.get(r.id).forwardEligible,false);}finally{await g.close();}
});
test('capture storage or downstream queue failure rolls back run, lease and registration before inference',async()=>{
 const f=fixture();try{
  freeze(f);const {topic}=await f.prepare();
  f.store.db.exec("CREATE TRIGGER block_forward BEFORE INSERT ON forward_captures BEGIN SELECT RAISE(ABORT,'synthetic capture failure'); END");assert.throws(()=>start(f,topic),/synthetic/);f.store.db.exec('DROP TRIGGER block_forward');
  assert.throws(()=>f.service.modelResearch.start(topic.id,{version:topic.version},()=>{throw Error('queue failure');}),/queue failure/);
  assert.equal(f.calls,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_runs').get().n,0);assert.equal(f.service.forwardEvaluations.records().length,0);
  const r=start(f,topic);await f.service.modelResearch.wait(r.id);assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('damaged input, model output and snapshot provenance are detected without rewriting archive',async()=>{
 const f=fixture();try{
  freeze(f);const {topic}=await f.prepare(),r=start(f,topic);await f.service.modelResearch.wait(r.id);
  const row=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(r.id),saved=JSON.parse(row.payload);saved.candidate.sections[0].paragraphs=['tampered'];f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(saved),r.id);assert.equal(f.service.forwardEvaluations.get(r.id).integrity.valid,false);
  f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(row.payload,r.id);
  saved.packet.input.title='changed';f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(saved),r.id);assert.equal(f.service.forwardEvaluations.get(r.id).integrity.valid,false);
  const record=JSON.parse(f.store.db.prepare('SELECT payload FROM forward_captures WHERE run_id=?').get(r.id).payload);record.topicVersion=999;f.store.db.prepare('UPDATE forward_captures SET payload=? WHERE run_id=?').run(JSON.stringify(record),r.id);assert.throws(()=>f.service.forwardEvaluations.get(r.id),/指纹/);
 }finally{await f.close();}
});
test('capture survives reopen; demo, restore and HTTP caller-supplied membership/configuration are rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-capture-')),path=join(dir,'fixture.sqlite'),f=fixture({path});let reopened;
 try{
  freeze(f);const {topic}=await f.prepare(),r=start(f,topic);await f.service.modelResearch.wait(r.id);const before=f.service.forwardEvaluations.get(r.id);await f.close();reopened=fixture({path});assert.deepEqual(reopened.service.forwardEvaluations.get(r.id),before);
  const handler=createHandler(reopened.store,reopened.service),call=async(method,url,data={})=>{let code,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:c=>code=c,end:b=>result=JSON.parse(b)});return {code,result};};
  assert.equal((await call('GET','/api/forward-evaluations')).result.records.length,1);assert.equal((await call('GET','/api/forward-evaluations/records/'+r.id)).result.record.inputHash,before.record.inputHash);
  assert.equal((await call('POST','/api/forward-evaluations',{requestId:randomUUID(),title:'无效',clusterMembers:[]})).code,400);
  reopened.store.db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();assert.throws(()=>freeze(reopened),/恢复副本/);
 }finally{if(reopened)await reopened.close();else await f.close();rmSync(dir,{recursive:true,force:true});}
 const demo=fixture({mode:'demo'});try{assert.throws(()=>freeze(demo),/当前模式/);}finally{await demo.close();}
});

test('configuration changes are recorded as exclusions and cannot silently use an older baseline',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-config-')),path=join(dir,'fixture.sqlite'),f=fixture({path});let other;
 try{freeze(f);const {topic}=await f.prepare();await f.close();other=fixture({path,modelConfig:{...config,model:'changed'}});const r=start(other,topic);await other.service.modelResearch.wait(r.id);const c=other.service.forwardEvaluations.get(r.id);assert.equal(c.inputEligibility.eligible,false);assert.ok(c.inputEligibility.reasons.includes('代码或模型配置已不同于冻结基线'));assert.equal(c.forwardEligible,false);}finally{if(other)await other.close();else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('a changed research packet before the write lock aborts capture and model start together',async()=>{
 const f=fixture();try{
  freeze(f);const {topic}=await f.prepare(),execute=f.store.db.exec.bind(f.store.db);let armed=true;
  f.store.db.exec=sql=>{if(sql==='BEGIN IMMEDIATE'&&armed){armed=false;f.service.research.update(topic.id,{version:topic.version,nextEvidence:'调用前并发修改'});}return execute(sql);};
  assert.throws(()=>start(f,topic),/研究已更新/);assert.equal(f.calls,0);assert.equal(f.service.forwardEvaluations.records().length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_runs').get().n,0);
 }finally{await f.close();}
});

test('a later topic from the same event is retained but excluded even after the first call fails',async()=>{
 const f=fixture({runner:async()=>{throw Error('synthetic model failure');}});try{
  freeze(f);const {topic,news}=await f.prepare(),first=start(f,topic);await f.service.modelResearch.wait(first.id);
  const before=f.service.forwardEvaluations.get(first.id);assert.equal(before.inputEligibility.eligible,true);assert.equal(before.executionVerified,false);
  const next=f.service.research.createFromNews({newsId:news[1].id,newsRevision:1});assert.notEqual(next.id,topic.id);
  const second=start(f,next);await f.service.modelResearch.wait(second.id);const after=f.service.forwardEvaluations.get(second.id);
  assert.equal(after.inputEligibility.eligible,false);assert.ok(after.inputEligibility.reasons.includes('同事件簇或来源已有前向调用记录'));
  assert.deepEqual(f.service.forwardEvaluations.get(first.id),before);
 }finally{await f.close();}
});
test('packet envelope and actual execution trace remain bound to the pre-call capture',async()=>{
 const f=fixture();try{
  freeze(f);const {topic}=await f.prepare(),r=start(f,topic);await f.service.modelResearch.wait(r.id);
  assert.equal(f.service.forwardEvaluations.get(r.id).executionVerified,true);
  const original=JSON.parse(f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(r.id).payload);
  for(const modify of [r=>{r.packet.generatedAt='2026-10-03T23:00:00Z';},r=>{delete r.candidate.trace.promptHash;},r=>{r.candidate.trace.effort='low';}]){
   const changed=structuredClone(original);modify(changed);f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(changed),r.id);
   const check=f.service.forwardEvaluations.get(r.id);assert.equal(check.integrity.valid,false);assert.equal(check.executionVerified,false);
  }
 }finally{await f.close();}
});

test('pausing preserves records, rejects stale baseline commands and does not silently resume on retries',async()=>{
 const f=fixture();try{
  const data={requestId:randomUUID(),title:'暂停测试'},b=f.service.forwardEvaluations.freeze(data),{topic}=await f.prepare(),r=start(f,topic);await f.service.modelResearch.wait(r.id);
  const before=f.service.forwardEvaluations.get(r.id);f.service.forwardEvaluations.pause({baselineId:b.id});f.service.forwardEvaluations.freeze(data);
  assert.equal(f.service.forwardEvaluations.list().activeBaselineId,null);const next=start(f,topic);await f.service.modelResearch.wait(next.id);assert.throws(()=>f.service.forwardEvaluations.get(next.id),/不存在/);
  assert.deepEqual(f.service.forwardEvaluations.get(r.id),before);const current=freeze(f);assert.throws(()=>f.service.forwardEvaluations.pause({baselineId:b.id}),/已变化/);assert.equal(f.service.forwardEvaluations.list().activeBaselineId,current.id);
 }finally{await f.close();}
});

test('backup and restore preserve frozen baselines and calls while business writes remain guarded',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-recovery-')),path=join(dir,'source.sqlite'),f=fixture({path});let restored;
 try{
  assertDatabaseMode(f.store,'research');freeze(f);const {topic}=await f.prepare(),r=start(f,topic);await f.service.modelResearch.wait(r.id);const before=f.service.forwardEvaluations.get(r.id);
  const backup=await createBackup(path,join(dir,'backup')),report=await rehearseRecovery(backup.directory,join(dir,'rehearsal'));
  assert(report.passed,JSON.stringify(report));assert.equal(report.original.tables.forward_captures.count,1);assert.equal(report.original.tables.forward_baselines.count,1);assert.equal(report.networkAttempts,0);
  restored=fixture({path:join(report.directory,'candidate.sqlite')});assert.deepEqual(restored.service.forwardEvaluations.get(r.id),before);assert.throws(()=>start(restored,topic),/恢复副本/);assert.equal(restored.calls,0);
 }finally{if(restored)await restored.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('unclustered excluded calls still exclude their source when another topic later gets a confirmed cluster',async()=>{
 const f=fixture();try{
  freeze(f);const {topic,cluster,news,batchId}=await f.prepare();f.service.eventClusters.archive(cluster.id,{version:1,note:'测试未归簇输入',requestId:randomUUID()});
  const first=start(f,topic);await f.service.modelResearch.wait(first.id);assert.equal(f.service.forwardEvaluations.get(first.id).record.clusterMembers.length,0);
  const g=f.service.eventClusters.preview(batchId).groups[0];f.service.eventClusters.save({batchId,groupId:g.id,previewHash:g.hash,clusterId:'',version:0,title:'重新归簇',note:'合成核验',requestId:randomUUID()});
  const next=f.service.research.createFromNews({newsId:news[1].id,newsRevision:1}),second=start(f,next);await f.service.modelResearch.wait(second.id);
  // The original research used only the first source, so explicitly reuse it in
  // the later complete cluster; member coverage must exclude the whole event.
  assert.ok(f.service.forwardEvaluations.get(second.id).inputEligibility.reasons.includes('同事件簇或来源已有前向调用记录'));
 }finally{await f.close();}
});
