import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {openModelResearchRuns} from '../server/model-research-runs.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {digest,CodexResearchError} from '../server/codex-research.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';

const config={binary:'/opt/test/codex',model:'request-test-model',effort:'high',timeoutMs:1000};
const requestId='unknown-response-request-0001';
function candidate(packet){
 const output={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['虚构恢复测试；证据不足，保留未知。'],sourceIds:[]})),missingEvidence:['补充可核对材料']};
 const rawOutput=JSON.stringify(output);
 return {status:'candidate',reviewStatus:'unreviewed',...output,rawOutput,trace:{inputHash:packet.inputHash,topicId:packet.input.topicId,topicVersion:packet.input.topicVersion,model:config.model,outputHash:digest(rawOutput)}};
}
function setup(options={}){
 const store=openStore(options.path||':memory:'),research=openResearch(store,{seed:false}),paper=openPaper(store,research,{seed:false});
 const topic=research.create({title:'虚构请求恢复',summary:'只验证持久请求，不调用真实模型'});
 const runs=openModelResearchRuns(store,research,{enabled:true,config,runner:async packet=>candidate(packet),...options});
 return {store,research,paper,topic,runs,async close(){await runs.close();store.close();}};
}
function http(handler){return async(method,url,body)=>{
 let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){if(body!==undefined)yield JSON.stringify(body);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});
 return {status,result};
};}

test('unknown generation response retries the same running request without another runner, lease or start callback',async()=>{
 let release,calls=0,captures=0,commits=0;
 const f=setup({runner:(packet,{signal})=>{calls++;return new Promise((resolve,reject)=>{if(signal.aborted)return reject(new CodexResearchError('cancelled'));signal.addEventListener('abort',()=>reject(new CodexResearchError('cancelled')),{once:true});release=()=>resolve(candidate(packet));});},onStart:()=>captures++});
 try{
  const first=f.runs.start(f.topic.id,{version:1,requestId},()=>commits++),lease=f.store.db.prepare('SELECT * FROM model_job_lease').all();
  const retry=f.runs.start(f.topic.id,{version:1,requestId},()=>commits++);
  assert.deepEqual(retry,first);assert.equal(retry.requestId,requestId);assert.deepEqual(f.store.db.prepare('SELECT * FROM model_job_lease').all(),lease);
  await Promise.resolve();assert.equal(calls,1);assert.equal(captures,1);assert.equal(commits,1);assert.equal(f.runs.list(f.topic.id).length,1);
  assert.equal(f.runs.get(f.topic.id,first.id).requestId,requestId);
  release();await f.runs.wait(first.id);
 }finally{if(release)release();await f.close();}
});

test('completed request resolves its original frozen input after topic and model settings change without adopting it',async()=>{
 let calls=0;const f=setup({runner:async packet=>{calls++;return candidate(packet);}});let reopened;
 try{
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);
  f.research.update(f.topic.id,{version:1,nextEvidence:'新研究版本，不能静默重新调用'});
  const original=f.runs.get(f.topic.id,start.id),topic=f.research.get(f.topic.id),book=f.paper.snapshot();
  reopened=openModelResearchRuns(f.store,f.research,{enabled:false,config:{},runner:()=>assert.fail('replay must not run a model')});
  const resolved=reopened.start(f.topic.id,{version:1,requestId});
  assert.equal(resolved.id,start.id);assert.equal(resolved.status,'candidate');assert.equal(resolved.topicVersion,1);assert.equal(resolved.inputHash,original.packet.inputHash);
  assert.equal(resolved.model,config.model);assert.equal(calls,1);assert.deepEqual(reopened.get(f.topic.id,start.id),original);
  assert.deepEqual(f.research.get(f.topic.id),topic);assert.deepEqual(f.paper.snapshot(),book);
  assert.throws(()=>reopened.adopt(f.topic.id,start.id,{version:2}),/已变化/);
  assert.throws(()=>reopened.start(f.topic.id,{version:2,requestId:'brand-new-request-0001'}),/未启用/);
 }finally{if(reopened)await reopened.close();await f.close();}
});

test('failed and cancelled request receipts do not become new calls on retry',async()=>{
 for(const code of ['process','cancelled']){
  let calls=0;const f=setup({runner:async()=>{calls++;throw new CodexResearchError(code);}});
  try{
   const start=f.runs.start(f.topic.id,{version:1,requestId});const failed=await f.runs.wait(start.id);
   assert.equal(failed.status,code==='cancelled'?'cancelled':'failed');
   const retry=f.runs.start(f.topic.id,{version:1,requestId});assert.equal(retry.id,start.id);assert.equal(retry.status,failed.status);assert.equal(calls,1);
   const intentional=f.runs.start(f.topic.id,{version:1,requestId:'intentional-second-request'});await f.runs.wait(intentional.id);assert.notEqual(intentional.id,start.id);assert.equal(calls,2);
  }finally{await f.close();}
 }
});

test('request identity cannot be reused for another topic or version and invalid parameters consume no identity',async()=>{
 const f=setup();try{
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);
  const other=f.research.create({title:'另一个虚构研究',summary:'隔离请求身份'});
  const original=f.runs.get(f.topic.id,start.id);
  for(const [topicId,version] of [[other.id,1],[f.topic.id,2]])assert.throws(()=>f.runs.start(topicId,{version,requestId}),/请求标识已用于其他输入/);
  for(const data of [null,[],{version:1,requestId:null},{version:1,requestId:''},{version:1,requestId:'short'},{version:1,requestId:'a'.repeat(81)},{version:1,requestId:'../not-a-valid-request'},{version:1.5,requestId:'invalid-version-request'},{version:1,requestId:'valid-shaped-request',model:'override'}])assert.throws(()=>f.runs.start(f.topic.id,data),/请求参数无效/);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_requests').get().n,1);assert.equal(f.runs.list(other.id).length,0);
  assert.deepEqual(f.runs.get(f.topic.id,start.id),original);
 }finally{await f.close();}
});

test('request, run, lease and caller writes roll back together when queue registration fails',async()=>{
 let calls=0;const f=setup({runner:async packet=>{calls++;return candidate(packet);},onStart:()=>f.store.db.prepare("INSERT INTO settings VALUES('test_capture','1')").run()});
 try{
  assert.throws(()=>f.runs.start(f.topic.id,{version:1,requestId},()=>{throw new Error('synthetic queue commit failure');}),/synthetic queue/);
  assert.equal(f.runs.list(f.topic.id).length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_requests').get().n,0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);assert.equal(f.store.db.prepare("SELECT value FROM settings WHERE key='test_capture'").get(),undefined);
  await Promise.resolve();assert.equal(calls,0);
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);assert.equal(calls,1);assert.equal(f.store.db.prepare("SELECT value FROM settings WHERE key='test_capture'").get().value,'1');
 }finally{await f.close();}
});

test('second database connection resolves a live request and preserves the original shared lease',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-request-connections-')),path=join(dir,'test.sqlite');let release,second;
 const f=setup({path,runner:packet=>new Promise(resolve=>{release=()=>resolve(candidate(packet));})});
 try{
  const start=f.runs.start(f.topic.id,{version:1,requestId});await Promise.resolve();const lease=f.store.db.prepare('SELECT * FROM model_job_lease').all();
  second=openStore(path);const research=openResearch(second,{seed:false});const runs=openModelResearchRuns(second,research,{enabled:true,config,runner:()=>assert.fail('second connection must not invoke model')});
  assert.deepEqual(runs.start(f.topic.id,{version:1,requestId}),start);assert.deepEqual(second.db.prepare('SELECT * FROM model_job_lease').all(),lease);
  assert.throws(()=>runs.start(f.topic.id,{version:1,requestId:'another-live-request-0001'}),/正在运行/);assert.equal(second.db.prepare('SELECT count(*) n FROM model_research_requests').get().n,1);
  release();await f.runs.wait(start.id);await runs.close();
 }finally{if(release)release();if(second)second.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('closed database copy and actual reopen retain old history and adopted receipts without creating new calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-request-copy-')),path=join(dir,'original.sqlite'),copy=join(dir,'copy.sqlite');
 const f=setup({path});let store,runs;let closed=false;
 try{
  const legacy=f.runs.start(f.topic.id,{version:1});await f.runs.wait(legacy.id);
  const old=f.store.db.prepare('SELECT * FROM model_research_runs WHERE id=?').get(legacy.id);
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);f.runs.adopt(f.topic.id,start.id,{version:1});
  const topic=f.research.get(f.topic.id),history=f.research.history(f.topic.id),book=f.paper.snapshot(),record=f.runs.get(f.topic.id,start.id);
  await f.close();closed=true;copyFileSync(path,copy);
  store=openStore(copy);const research=openResearch(store,{seed:false}),paper=openPaper(store,research,{seed:false});
  runs=openModelResearchRuns(store,research,{enabled:false,runner:()=>assert.fail('recovered receipts must not call model')});
  const receipt=runs.start(f.topic.id,{version:1,requestId});assert.equal(receipt.status,'adopted');assert.equal(receipt.acceptedVersion,2);assert.equal(receipt.id,start.id);
  assert.deepEqual(runs.get(f.topic.id,start.id),record);assert.deepEqual(research.get(f.topic.id),topic);assert.deepEqual(research.history(f.topic.id),history);assert.deepEqual(paper.snapshot(),book);
  assert.deepEqual(store.db.prepare('SELECT * FROM model_research_runs WHERE id=?').get(legacy.id),old);assert.equal(runs.get(f.topic.id,legacy.id).requestId,undefined);
  assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(runs)await runs.close();if(store)store.close();if(!closed)await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('expired interrupted identity resolves old input without retrying, while restore protection blocks request writes',async()=>{
 const f=setup();let reopened;try{
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);const original=f.runs.get(f.topic.id,start.id);
  const interrupted={...original,status:'running'};delete interrupted.candidate;delete interrupted.finishedAt;
  f.store.db.prepare('UPDATE model_research_runs SET status=?,expires_at=?,payload=? WHERE id=?').run('running',0,JSON.stringify(interrupted),start.id);
  reopened=openModelResearchRuns(f.store,f.research,{enabled:true,config,runner:()=>assert.fail('must not retry interrupted calls')});
  assert.equal(reopened.start(f.topic.id,{version:1,requestId}).status,'interrupted');assert.equal(reopened.get(f.topic.id,start.id).packet.inputHash,original.packet.inputHash);
  f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();
  const before=f.store.db.prepare('SELECT * FROM model_research_runs').all();
  assert.throws(()=>reopened.start(f.topic.id,{version:1,requestId}),/恢复副本/);assert.throws(()=>reopened.start(f.topic.id,{version:1,requestId:'new-restored-request-0001'}),/恢复副本/);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM model_research_runs').all(),before);
 }finally{if(reopened)await reopened.close();await f.close();}
});

test('incomplete or mismatched request mapping fails closed without a replacement run',async()=>{
 const f=setup();try{
  const start=f.runs.start(f.topic.id,{version:1,requestId});await f.runs.wait(start.id);const run=f.runs.get(f.topic.id,start.id);
  f.store.db.prepare("UPDATE model_research_requests SET input_hash='wrong' WHERE request_id=?").run(requestId);
  assert.throws(()=>f.runs.start(f.topic.id,{version:1,requestId}),/请求记录不完整/);assert.equal(f.runs.list(f.topic.id).length,1);assert.deepEqual(f.runs.get(f.topic.id,start.id),run);
 }finally{await f.close();}
});

test('a process exiting after the model starts leaves one durable interrupted request with no automatic restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-request-process-')),path=join(dir,'test.sqlite');
 const f=setup({path}),topicId=f.topic.id;await f.close();let store,runs;
 const script=`
  import {openStore} from ${JSON.stringify(new URL('../server/store.mjs',import.meta.url).href)};
  import {openResearch} from ${JSON.stringify(new URL('../server/research.mjs',import.meta.url).href)};
  import {openModelResearchRuns} from ${JSON.stringify(new URL('../server/model-research-runs.mjs',import.meta.url).href)};
  const store=openStore(${JSON.stringify(path)}),research=openResearch(store,{seed:false});let start;
  const runs=openModelResearchRuns(store,research,{enabled:true,config:${JSON.stringify(config)},runner:()=>{
   process.send({id:start.id,requestId:start.requestId,calls:1},()=>process.exit(0));
   return new Promise(()=>{});
  }});
  start=runs.start(${JSON.stringify(topicId)},{version:1,requestId:${JSON.stringify(requestId)}});
 `;
 try{
  const child=spawn(process.execPath,['--input-type=module','--eval',script],{stdio:['ignore','pipe','pipe','ipc']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);let receipt;
  await new Promise((resolve,reject)=>{child.on('message',message=>receipt=message);child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`test process failed ${code}/${signal}: ${stderr}`)));});
  assert.equal(receipt.requestId,requestId);assert.equal(receipt.calls,1);
  store=openStore(path);const research=openResearch(store,{seed:false});
  const frozen=JSON.parse(store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(receipt.id).payload);
  assert.equal(frozen.status,'running');assert.equal(research.get(topicId).version,1);
  runs=openModelResearchRuns(store,research,{enabled:true,config,now:()=>Date.now()+100000,runner:()=>assert.fail('process recovery must not call the model')});
  const replay=runs.start(topicId,{version:1,requestId});assert.equal(replay.id,receipt.id);assert.equal(replay.status,'interrupted');
  assert.deepEqual(runs.get(topicId,receipt.id).packet,frozen.packet);assert.equal(runs.list(topicId).length,1);assert.equal(research.get(topicId).dossier,undefined);
  assert.equal(store.db.prepare('SELECT count(*) n FROM model_research_requests').get().n,1);
 }finally{if(runs)await runs.close();if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP request recovery uses original receipt, rejects client model overrides and keeps explicit adoption separate',async()=>{
 let calls=0;const store=openStore(':memory:'),service=createService(store,{mode:'research',modelConfig:config,modelRunner:async packet=>{calls++;return candidate(packet);}}),call=http(createHandler(store,service));
 const topic=service.research.create({title:'虚构 HTTP 请求恢复',summary:'只使用注入模型'}),base=`/api/research/${topic.id}/model-runs`,book=service.paper.snapshot();
 try{
  const first=await call('POST',base,{version:1,requestId});assert.equal(first.status,202);assert.equal(first.result.requestId,requestId);await service.modelResearch.wait(first.result.id);
  const retry=await call('POST',base,{version:1,requestId});assert.equal(retry.status,202);assert.equal(retry.result.id,first.result.id);assert.equal(retry.result.status,'candidate');assert.equal(calls,1);
  assert.equal(service.research.get(topic.id).version,1);
  const invalid=await call('POST',base,{version:1,requestId,model:'unapproved'});assert.equal(invalid.status,400);assert.match(invalid.result.error,/研究版本和请求标识/);
  const adopted=await call('POST',`${base}/${first.result.id}/adopt`,{version:1});assert.equal(adopted.status,200);
  const resolved=await call('POST',base,{version:1,requestId});assert.equal(resolved.result.status,'adopted');assert.equal(resolved.result.acceptedVersion,2);assert.equal(calls,1);
  assert.deepEqual(service.paper.snapshot(),book);
 }finally{await service.close();store.close();}
});

test('request errors preserve actionable labels without leaking appended diagnostic details',()=>{
 for(const text of ['模型生成请求参数无效','模型生成请求标识已用于其他输入','模型生成请求记录不完整，请核对运行记录','模型调用仅接受研究版本和请求标识；模型配置由本机服务管理']){
  assert.equal(safeErrorText(new Error(text)),text);assert.doesNotMatch(safeErrorText(text+' private-provider-value'),/private-provider/);
 }
});
