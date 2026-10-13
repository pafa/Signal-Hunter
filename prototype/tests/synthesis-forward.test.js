import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,two,cluster,dossier,config,at} from './automatic-research-fixture.mjs';
import {digest,codexPrompt,codexDraftSchema,CODEX_PROMPT_VERSION,CODEX_SCHEMA_VERSION,EVENT_SYNTHESIS_PROMPT_VERSION} from '../server/codex-research.mjs';
import {createHandler} from '../server/index.mjs';
function traced(p){const r=dossier(p);return {...r,trace:{...r.trace,effort:'high',promptVersion:CODEX_PROMPT_VERSION+(p.input.eventSynthesis?'/'+EVENT_SYNTHESIS_PROMPT_VERSION:''),promptHash:digest(codexPrompt(p)),schemaHash:digest(codexDraftSchema(p)),schemaVersion:CODEX_SCHEMA_VERSION}};}
const setup=options=>fixture({researchRunner:traced,synthesisRunner:traced,...options});
const freeze=f=>f.service.forwardEvaluations.freeze({requestId:randomUUID(),title:'事件综合前向合成基线'});
const captures=f=>f.service.forwardEvaluations.records().filter(r=>r.subject==='event-cluster');
const label={verdict:'unclear',exposure:'already-seen',reviewer:'合成测试',reason:'仍待独立核验',novelty:'',scale:'',mechanism:'',clusterVerdict:'uncertain',clusterReason:'系统归组不作真值',revisionReason:'首次合成核验'};
const window=(f,b)=>f.service.forwardWindows.freeze({requestId:randomUUID(),title:'全部调用',baselineId:b.id,start:b.frozenAt,end:new Date(Date.parse(at)+1000).toISOString()});

test('synthesis captures exact members and prompt before inference, retaining source overlap and system-group exclusions',async()=>{
 let before;const f=setup({synthesisRunner:p=>{const run=captures(f)[0];before=f.service.forwardEvaluations.get(run.runId);return traced(p);}});
 try{
  const b=freeze(f),book=f.service.paper.snapshot();f.advance(100);const c=await two(f),d=f.queue.synthesis.detail(c.id).selected,after=f.service.forwardEvaluations.get(d.runId);
  assert.deepEqual(b.subjects,['research','event-cluster']);assert.equal(before.modelStatus,'running');assert.equal(before.executionVerified,false);assert.equal(before.baselineId,b.id);
  assert.equal(after.modelStatus,'adopted');assert.equal(after.integrity.valid,true);assert.equal(after.executionVerified,true);assert.equal(after.record.clusterId,c.id);assert.equal(after.record.clusterVersion,c.version);assert.equal(after.packetHash,digest(d.packet));assert.equal(after.record.inputHash,d.packet.inputHash);assert.equal(after.synthesis.inputHash,digest(d.packet.input.eventSynthesis));assert.equal(after.synthesis.memberResearch.length,2);
  assert(after.inputEligibility.reasons.includes('系统事件归组尚未独立核验'));assert(after.inputEligibility.reasons.includes('同事件簇或来源已有前向调用记录'));assert.equal(after.forwardEligible,false);assert.deepEqual(after.claimTimeline,[]);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});

test('mixed window retains all single and synthesis calls and reviews without constructing aggregate probabilities',async()=>{
 const f=setup();try{
  const b=freeze(f);f.advance(100);const c=await two(f),id=f.queue.synthesis.detail(c.id).selected.runId,original=f.service.forwardEvaluations.get(id),api=f.service.forwardReviews;
  assert.equal(api.detail(id).subject,'event-cluster');assert.deepEqual(api.detail(id).claims,[]);const inputs=api.inputs(id);assert.equal(inputs.items.length,2);assert(inputs.items.every(x=>x.ref.kind==='material'));assert.match(inputs.scope,/调用时冻结/);
  const data={version:0,requestId:randomUUID(),value:label},saved=api.write(id,'label',data);assert.equal(saved.version,1);assert.deepEqual(api.write(id,'label',data),saved);assert.deepEqual(f.service.forwardEvaluations.get(id),original);
  assert.throws(()=>api.write(id,'outcome',{version:1,requestId:randomUUID(),value:{claimId:'member-claim',outcome:'unresolved',eventAt:null,reason:'未解决',reviewer:'合成',revisionReason:'禁止补造',evidence:[]}}),/没有此主张/);
  f.advance(1000);const report=window(f,b);assert.equal(report.summary.calls,3);assert.deepEqual(report.summary.subjects,{'event-cluster':1,research:2});assert.equal(report.summary.claims.total,0);assert.equal(report.summary.claims.aggregateError,null);assert.equal(report.rows.find(r=>r.capture.runId===id).review.version,1);assert.equal(report.forwardEligible,false);
  const before=JSON.stringify(report);api.write(id,'label',{version:1,requestId:randomUUID(),value:{...label,revisionReason:'追加独立复核待办'}});assert.equal(JSON.stringify(f.service.forwardWindows.get(report.id)),before);
 }finally{await f.close();}
});

test('every failed synthesis retry remains in the complete window alongside successful member calls',async()=>{
 const f=setup({synthesisRunner:()=>{throw Error('synthetic failure');}});try{
  const b=freeze(f);f.advance(100);await two(f);f.advance(60001);await f.drive(3);f.advance(120001);await f.drive(3);
  assert.equal(f.synthesisCalls,3);const rows=captures(f);assert.equal(rows.length,3);assert(rows.every(r=>r.modelStatus==='failed'&&r.integrity.valid));
  f.advance(1);const report=f.service.forwardWindows.freeze({requestId:randomUUID(),title:'失败也纳入',baselineId:b.id,start:b.frozenAt,end:new Date(Date.parse(at)+180103).toISOString()});assert.equal(report.summary.calls,5);assert.equal(report.summary.subjects['event-cluster'],3);assert.equal(report.summary.statuses.failed,3);assert.equal(report.summary.executionVerified,2);
 }finally{await f.close();}
});

for(const failure of ['capture','queue'])test(`${failure} storage failure atomically rolls back synthesis registration before provider execution`,async()=>{
 const f=setup();try{
  freeze(f);f.advance(100);
  f.store.db.exec(failure==='capture'?"CREATE TRIGGER stop_synthesis BEFORE INSERT ON forward_captures WHEN json_extract(NEW.payload,'$.subject')='event-cluster' BEGIN SELECT RAISE(ABORT,'capture failure'); END":"CREATE TRIGGER stop_synthesis BEFORE UPDATE ON event_cluster_research WHEN NEW.status='running' BEGIN SELECT RAISE(ABORT,'queue failure'); END");
  await two(f);assert.equal(f.synthesisCalls,0);assert.equal(captures(f).length,0);assert.equal(f.store.db.prepare("SELECT count(*) n FROM model_research_runs WHERE json_extract(payload,'$.subject')='event-cluster'").get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  f.store.db.exec('DROP TRIGGER stop_synthesis');await f.drive(3);assert.equal(f.synthesisCalls,1);assert.equal(captures(f).length,1);
 }finally{await f.close();}
});

test('pause never backfills earlier synthesis; old-scope baselines mark later event calls excluded without rewriting history',async()=>{
 const f=setup();try{
  const b=freeze(f);f.service.forwardEvaluations.pause({baselineId:b.id});f.advance(100);const c=await two(f);assert.equal(captures(f).length,0);const old=f.queue.synthesis.detail(c.id).selected.runId;
  const next=freeze(f),row=f.store.db.prepare('SELECT payload FROM forward_baselines WHERE id=?').get(next.id),legacy=JSON.parse(row.payload);delete legacy.subjects;delete legacy.snapshotHash;legacy.snapshotHash=digest(legacy);f.store.db.prepare('UPDATE forward_baselines SET payload=? WHERE id=?').run(JSON.stringify(legacy),next.id);
  f.add(3);await f.drive();assert.equal(captures(f).length,1);const record=f.service.forwardEvaluations.get(captures(f)[0].runId);assert.equal(record.synthesis.priorVersion,1);assert(record.inputEligibility.reasons.includes('原冻结基线未包含事件综合调用'));assert(record.inputEligibility.reasons.includes('已见开发样本或同一事件簇'));assert(record.inputEligibility.reasons.includes('包含先前综合判断，仅作后续版本留样'));assert.throws(()=>f.service.forwardEvaluations.get(old),/不存在/);assert.equal(f.service.forwardEvaluations.baseline(next.id).snapshotHash,legacy.snapshotHash);
 }finally{await f.close();}
});

test('reopen, source revision, member edit and archival preserve the exact capture and frozen review material',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'synthesis-forward-')),path=join(dir,'research.sqlite');let f=setup({path});try{
  freeze(f);f.advance(100);const c=await two(f),id=captures(f)[0].runId,before=f.service.forwardEvaluations.get(id),inputs=f.service.forwardReviews.inputs(id);await f.close();f=setup({path});f.advance(100);assert.deepEqual(f.service.forwardEvaluations.get(id),before);
  const topic=f.service.research.get(c.members[0].id);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'本人后续研究'});f.revise(1);f.service.eventClusters.archive(c.id,{version:c.version,note:'后续归档',requestId:randomUUID()});freeze(f);
  assert.deepEqual(f.service.forwardEvaluations.get(id),before);assert.deepEqual(f.service.forwardReviews.inputs(id),inputs);assert.equal(f.synthesisCalls,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('subject, member and synthesis prompt corruption cannot masquerade as a verified captured execution',async()=>{
 const f=setup();try{
  freeze(f);f.advance(100);await two(f);const id=captures(f)[0].runId,row=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(id),saved=JSON.parse(row.payload);
  for(const modify of [r=>{delete r.subject;},r=>{r.packet.input.eventSynthesis.members.pop();},r=>{delete r.packet.input.eventSynthesis;},r=>{r.candidate.trace.promptVersion=CODEX_PROMPT_VERSION;}]){
   const changed=structuredClone(saved);modify(changed);f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(changed),id);const result=f.service.forwardEvaluations.get(id);assert.equal(result.integrity.valid,false);assert.equal(result.executionVerified,false);assert.throws(()=>f.service.forwardReviews.detail(id),/档案异常/);
  }
  f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(row.payload,id);assert.equal(f.service.forwardEvaluations.get(id).executionVerified,true);
 }finally{await f.close();}
});

test('event forward HTTP reads preserve storage and labels are still blocked on restore-locked copies',async()=>{
 const f=setup();try{
  freeze(f);f.advance(100);await two(f);const id=captures(f)[0].runId,handler=createHandler(f.store,f.service),call=async(method,url,data={})=>{let code,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:c=>code=c,end:b=>result=JSON.parse(b)});return {code,result};};
  const before=f.store.db.prepare('SELECT * FROM forward_captures ORDER BY rowid').all();for(const suffix of ['', '/review','/review-inputs'])assert.equal((await call('GET','/api/forward-evaluations/records/'+id+suffix)).code,200);assert.deepEqual(f.store.db.prepare('SELECT * FROM forward_captures ORDER BY rowid').all(),before);
  f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('POST','/api/forward-evaluations/records/'+id+'/label',{version:0,requestId:randomUUID(),value:label})).code,409);assert.equal(f.service.forwardReviews.detail(id).version,0);
 }finally{await f.close();}
});

test('cancelled in-flight synthesis remains captured and no automatic retry or result claim is created',async()=>{
 let release;const f=setup({synthesisRunner:p=>new Promise(resolve=>{release=()=>resolve(traced(p));})});try{
  freeze(f);f.advance(100);f.add(1);await f.drive();f.add(2);
  for(let i=0;i<40&&!captures(f).length;i++){
   f.service.controlOperation('discovery','resume');await f.service.runOperation('discovery');
   if(!captures(f).length)await f.finish();
  }
  const record=captures(f)[0];assert(record);await Promise.resolve();const job=f.queue.synthesis.overview(cluster(f).id);f.queue.synthesis.cancel(job.id);release();await f.service.modelResearch.wait(record.runId);
  assert.equal(f.service.forwardEvaluations.get(record.runId).modelStatus,'cancelled');assert.equal(f.service.forwardEvaluations.get(record.runId).executionVerified,false);f.advance(180001);await f.drive(4);assert.equal(captures(f).length,1);assert.equal(f.synthesisCalls,1);assert.equal(f.queue.synthesis.overview(cluster(f).id).current,false);
 }finally{if(release)release();await f.close();}
});
