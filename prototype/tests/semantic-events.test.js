import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {openSemanticEvents,comparisonPacket,validateComparison,comparisonPrompt} from '../server/semantic-events.mjs';
import {digest,CodexResearchError} from '../server/codex-research.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';
const at='2026-10-02T06:00:00Z',config={binary:'/test/codex',model:'test-model',timeoutMs:1000};
const news=[{id:digest('proposal'),title:'虚构甲公司拟收购乙公司，尚需批准',url:'https://example.invalid/proposal',publisher:'合成测试',publishedAt:at},{id:digest('denial'),title:'虚构甲公司否认收购乙公司的传闻',url:'https://example.invalid/denial',publisher:'合成测试',publishedAt:at}];
const input={left:{id:news[1].id,revision:1},right:{id:news[0].id,revision:1}};
function comparison(packet){return {relation:'reversal',left:{actor:'虚构甲公司',action:'否认',object:'收购乙公司',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'否认传闻',quote:packet.input.left.title},right:{actor:'虚构甲公司',action:'拟收购',object:'乙公司',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'待批准',quote:packet.input.right.title},reason:'标题的收购对象相同，但仅凭标题不能核实是否同一项传闻。',missingEvidence:['核对两份全文与具体交易对象']};}
function candidate(packet){const value=comparison(packet),rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',comparison:value,rawOutput,trace:{model:config.model,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};}
function fixture(runner=async p=>candidate(p)){
 const store=openStore(':memory:');store.ingest(news,at);const service=createService(store,{mode:'research',modelConfig:config,semanticRunner:runner});
 return {store,service,runs:service.semanticEvents,async close(){await service.close();store.close();}};
}
test('comparison freezes exact news revisions, source and available time; quotes must come from the corresponding title',async()=>{
 const f=fixture();try{
  const packet=comparisonPacket(f.store,input);assert.equal(packet.inputHash,digest(packet.input));assert.equal(packet.input.left.availableAt,at);assert.equal(packet.input.left.contentScope,'headline-only');assert.match(comparisonPrompt(packet),/发布日期不等于事件时间/);
  const ok=comparison(packet);assert.deepEqual(validateComparison(ok,packet),ok);
  for(const change of [v=>v.left.quote='编造的全文',v=>v.relation='confirmed',v=>v.right.symbol='FAKE.US',v=>v.missingEvidence=[''],v=>v.left.eventTime='',v=>delete v.right]){const v=structuredClone(ok);change(v);assert.throws(()=>validateComparison(v,packet),e=>e.code==='output');}
  for(const data of [{...input,model:'override'}, {...input,right:input.left},{...input,left:{...input.left,revision:2}},{left:null,right:input.right}])assert.throws(()=>f.runs.start(data));
  assert.equal(f.runs.list().runs.length,0);
 }finally{await f.close();}
});
test('human accept, reject and withdraw append pair decisions without editing research, rules, watches or paper account',async()=>{
 const f=fixture();try{
  f.service.processEvents();const before={research:f.service.research.list(),paper:f.service.paper.snapshot(),watches:f.store.watchlist(),events:f.service.eventContinuity({state:'all'})};
  const started=f.runs.start(input),run=await f.runs.wait(started.id);assert.equal(run.status,'candidate');assert.equal(run.active,false);assert.deepEqual(run.packet,comparisonPacket(f.store,input));
  let decided=f.runs.decide(run.id,{version:0,action:'accept',note:'仅采纳待核关系，仍需原文'});assert.equal(decided.active,true);assert.equal(decided.history.length,1);
  assert.throws(()=>f.runs.decide(run.id,{version:0,action:'reject',note:'过期决定'}),/已更新/);
  decided=f.runs.decide(run.id,{version:1,action:'withdraw',note:'需要更多证据'});assert.equal(decided.active,false);
  decided=f.runs.decide(run.id,{version:2,action:'reject',note:'不能确认同一传闻'});assert.equal(decided.history.length,3);assert.deepEqual(decided.candidate,run.candidate);
  assert.deepEqual({research:f.service.research.list(),paper:f.service.paper.snapshot(),watches:f.store.watchlist(),events:f.service.eventContinuity({state:'all'})},before);
 }finally{await f.close();}
});
test('reingestion does not stale a comparison; a new headline revision disables adoption and retains history',async()=>{
 const f=fixture();try{
  const started=f.runs.start(input);await f.runs.wait(started.id);f.runs.decide(started.id,{version:0,action:'accept',note:'暂时采纳'});
  f.store.ingest(news,'2026-10-02T07:00:00Z');assert.equal(f.runs.get(started.id).stale,false);
  f.store.ingest([{...news[1],title:'虚构甲公司终止收购乙公司'}],'2026-10-02T08:00:00Z');const old=f.runs.get(started.id);assert.equal(old.stale,true);assert.equal(old.active,false);assert.equal(old.history[0].action,'accept');assert.equal(old.packet.input.left.title,news[1].title);
  assert.throws(()=>f.runs.decide(started.id,{version:1,action:'accept',note:'仍用旧版'}),/已变化/);f.runs.decide(started.id,{version:1,action:'withdraw',note:'撤销旧输入的决定'});
  assert.throws(()=>f.runs.start(input),/已修订/);
 }finally{await f.close();}
});
test('reverse orientation shares decision sequence and preserves which result was accepted',async()=>{
 const f=fixture();try{
  const a=f.runs.start(input);await f.runs.wait(a.id);f.runs.decide(a.id,{version:0,action:'accept',note:'第一次判断'});
  const b=f.runs.start({left:input.right,right:input.left});await f.runs.wait(b.id);assert.equal(f.runs.get(b.id).decisionVersion,1);
  assert.throws(()=>f.runs.decide(b.id,{version:1,action:'withdraw',note:'不能撤销另一结果'}),/已更新/);
  f.runs.decide(b.id,{version:1,action:'accept',note:'重新核对顺序与含义'});assert.equal(f.runs.get(a.id).active,false);assert.equal(f.runs.get(b.id).active,true);assert.equal(f.runs.get(a.id).history[0].orientation.left,input.right.id);
 }finally{await f.close();}
});
test('failed decision insertion rolls back without losing the candidate or prior receipt',async()=>{
 const f=fixture();try{
  const s=f.runs.start(input);await f.runs.wait(s.id);f.store.db.exec("CREATE TRIGGER fail_semantic BEFORE INSERT ON semantic_decisions BEGIN SELECT RAISE(ABORT,'storage failure'); END");
  assert.throws(()=>f.runs.decide(s.id,{version:0,action:'accept',note:'核对'}),/storage failure/);assert.equal(f.runs.get(s.id).status,'candidate');assert.equal(f.runs.get(s.id).decisionVersion,0);
 }finally{await f.close();}
});
test('semantic and dossier jobs share a database lease; cancellation releases it in both directions',async()=>{
 const blocked=(packet,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new CodexResearchError('cancelled')),{once:true});});
 const store=openStore(':memory:');store.ingest(news,at);const service=createService(store,{mode:'research',modelConfig:config,semanticRunner:blocked,modelRunner:blocked});
 try{
  const topic=service.research.create({title:'合成研究',summary:'互斥测试'}),s=service.semanticEvents.start(input);await Promise.resolve();
  assert.throws(()=>service.modelResearch.start(topic.id,{version:1}),/正在运行/);
  // A second module instance over the same database must also respect the lease.
  const second=openSemanticEvents(store,{enabled:true,config,runner:blocked});assert.throws(()=>second.start(input),/正在运行/);await second.close();
  service.semanticEvents.cancel(s.id);assert.equal((await service.semanticEvents.wait(s.id)).status,'cancelled');
  const m=service.modelResearch.start(topic.id,{version:1});await Promise.resolve();assert.throws(()=>service.semanticEvents.start(input),/正在运行/);service.modelResearch.cancel(topic.id,m.id);await service.modelResearch.wait(m.id);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM model_job_lease').get().n,0);
 }finally{await service.close();store.close();}
});
test('adapter output is independently checked; failed attempts keep frozen input and redact unexpected errors',async()=>{
 for(const change of [c=>c.rawOutput='tampered',c=>c.trace.model='other',c=>c.comparison.left.quote='fabricated',c=>c.trace.inputHash='other']){
  const f=fixture(async packet=>{const c=candidate(packet);change(c);return c;});try{const s=f.runs.start(input),r=await f.runs.wait(s.id);assert.equal(r.status,'failed');assert.equal(r.failure.code,'output');assert.deepEqual(r.packet,comparisonPacket(f.store,input));}finally{await f.close();}
 }
 const f=fixture(async()=>{throw new Error('provider private credential');});try{const s=f.runs.start(input),r=await f.runs.wait(s.id);assert.equal(r.status,'failed');assert.doesNotMatch(JSON.stringify(r),/private credential/);}finally{await f.close();}
});
test('records survive reopening; expired calls project interrupted without writes or automatic retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-semantic-'));let store=openStore(join(dir,'fixture.sqlite')),runs=openSemanticEvents(store,{enabled:true,config,runner:async p=>candidate(p)});
 try{
  store.ingest(news,at);const s=runs.start(input);await runs.wait(s.id);runs.decide(s.id,{version:0,action:'accept',note:'留存'});await runs.close();store.close();
  store=openStore(join(dir,'fixture.sqlite'));runs=openSemanticEvents(store,{enabled:true,config});assert.equal(runs.get(s.id).active,true);assert.equal(runs.get(s.id).history.length,1);
  const r=runs.get(s.id),old={...r,id:'expired',status:'running'};store.db.prepare('INSERT INTO semantic_runs VALUES(?,?,?,?,?)').run('expired',r.pairKey,'running',0,JSON.stringify(old));assert.equal(runs.get('expired').status,'interrupted');assert.equal(store.db.prepare('SELECT status FROM semantic_runs WHERE id=?').get('expired').status,'running');
 }finally{await runs.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP validates mutations, rejects demo model use and exposes safe comparison conflicts',async()=>{
 for(const mode of ['demo','research']){
  const store=openStore(':memory:'),service=createService(store,{mode,modelConfig:config,semanticRunner:async p=>candidate(p)}),handler=createHandler(store,service);store.ingest(news,at);
  const call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
  try{assert.equal((await call('GET','/api/semantic-events')).result.enabled,mode==='research');const s=await call('POST','/api/semantic-events',input);assert.equal(s.status,mode==='research'?202:400);if(mode==='research'){await service.semanticEvents.wait(s.result.id);const base=`/api/semantic-events/${s.result.id}`;assert.equal((await call('GET',base)).result.status,'candidate');assert.equal((await call('POST',`${base}/decision`,{version:0,action:'accept',note:'API核对'})).result.active,true);assert.equal((await call('POST',`${base}/decision`,{version:0,action:'reject',note:'旧版'})).result.error,'语义比较决定已更新，请刷新后再保存');}}
  finally{await service.close();store.close();}
 }
 const text='语义比较输入已变化；请重新生成';assert.equal(safeErrorText(text),text);assert.notEqual(safeErrorText(text+' private detail'),text+' private detail');
});
