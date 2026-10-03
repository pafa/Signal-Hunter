import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,freeze,start} from './helpers/forward-fixture.js';
import {createBackup} from '../server/backup.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
import {createHandler} from '../server/index.mjs';
const claim={kind:'outcome',outcome:'open',status:'unverified',claim:'合成事项是否完成',probability:60,basis:'合成依据',impactIfTrue:'合成正向',impactIfFalse:'合成反向',horizon:'短期',resolveBy:'2026-10-05',evidenceIds:[],resolutionReason:'',revisionReason:'冻结前研究假设'};
const label={verdict:'unclear',exposure:'already-seen',reviewer:'合成测试者',reason:'未足以独立判断',novelty:'',scale:'',mechanism:'',clusterVerdict:'uncertain',clusterReason:'仍需外部核验',revisionReason:'首次复核'};
async function prepared(options){const f=fixture(options);freeze(f);const p=await f.prepare();const topic=f.service.research.saveClaim(p.topic.id,{version:p.topic.version,claim}),run=start(f,topic);await f.service.modelResearch.wait(run.id);f.tick();return {...p,f,topic,run,api:f.service.forwardReviews};}
const command=(version,value)=>({version,requestId:randomUUID(),value});
function outcome(x,extra={}){return {claimId:x.topic.claims[0].id,outcome:'unresolved',eventAt:null,reason:'暂无结局材料',reviewer:'合成测试者',revisionReason:'首次结局登记',evidence:[],...extra};}
function evidence(x){const source=x.api.inputs(x.run.id).items[0];return {ref:source.ref,hash:source.hash,quote:source.snapshot.title,quoteField:'title'};}
test('labels reuse the cohort contract and append immutable versions without changing captures or research',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  const original=f.service.forwardEvaluations.get(run.id),topic=f.service.research.get(x.topic.id),before=api.detail(run.id);assert.equal(before.version,0);assert.equal(before.claims[0].probability,60);
  const data=command(0,label),a=api.write(run.id,'label',data);assert.equal(a.version,1);assert.equal(api.write(run.id,'label',data).version,1);assert.equal(a.label.independent,false);assert.equal(a.forwardEligible,false);
  assert.throws(()=>api.write(run.id,'label',{...data,value:{...label,reason:'different'}}),/标识冲突/);assert.throws(()=>api.write(run.id,'label',command(0,label)),/版本已变化/);
  assert.throws(()=>api.write(run.id,'label',command(1,{...label,verdict:'major'})),/标签/);
  const b=api.write(run.id,'label',command(1,{...label,verdict:'ordinary',reason:'更正标签',revisionReason:'新增核验结果'}));assert.equal(b.version,2);assert.deepEqual(b.history[0],a.history[0]);assert.equal(b.label.verdict,'ordinary');
  assert.deepEqual(f.service.forwardEvaluations.get(run.id),original);assert.deepEqual(f.service.research.get(x.topic.id),topic);
 }finally{await f.close();}
});
test('unresolved, partial and unknown event times remain unscored and frozen claim identity cannot be replaced',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  let r=api.write(run.id,'outcome',command(0,outcome(x)));assert.equal(r.claims[0].score,null);
  r=api.write(run.id,'outcome',command(1,outcome(x,{outcome:'partial',evidence:[evidence(x)]})));assert.equal(r.claims[0].score,null);
  r=api.write(run.id,'outcome',command(2,outcome(x,{outcome:'true',evidence:[evidence(x)]})));assert.equal(r.claims[0].score,null);assert.match(r.claims[0].scoringReasons.join(' '),/缺少判断之后/);
  assert.throws(()=>api.write(run.id,'outcome',command(3,{...outcome(x),probability:100})),/参数/);assert.throws(()=>api.write(run.id,'outcome',command(3,outcome(x,{claimId:'unknown'}))),/没有此主张/);
  assert.equal(r.history.length,3);assert.equal(r.claims[0].probability,60);
 }finally{await f.close();}
});
test('resolved observations preserve exact source revisions and quotes; a later probability cannot improve the frozen score',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  const eventAt=f.tick(),availableAt=f.tick();f.store.ingest([{...x.news[0],title:'合成事项已完成'}],availableAt);
  const ref={kind:'news',id:x.news[0].id,revision:2};
  // Reference is returned by the linked research version, so attach the new revision as evidence.
  const updated=f.service.research.addEvidence(x.topic.id,{version:x.topic.version,newsId:x.news[0].id,newsRevision:2,claim:'合成事项已完成',stance:'supports',family:'other',step:'fact',verification:'reported',interpretation:'合成结局证据'});
  const picked=api.inputs(run.id).items.find(e=>e.ref.revision===2),e={ref,hash:picked.hash,quote:'合成事项已完成',quoteField:'title'};
  let r=api.write(run.id,'outcome',command(0,outcome(x,{outcome:'true',eventAt,evidence:[e]})));assert.ok(Math.abs(r.claims[0].score-.16)<1e-10);assert.equal(r.forwardEligible,false);
  const before=r.history[0];f.tick();f.store.ingest([{...x.news[0],title:'合成后来更正'}],f.time());f.service.research.saveClaim(updated.id,{version:updated.version,claim:{...claim,id:x.topic.claims[0].id,probability:99,revisionReason:'后来的概率'}});
  r=api.detail(run.id);assert.equal(r.claims[0].probability,60);assert.deepEqual(r.history[0],before);assert.equal(r.claims[0].resolution.evidence[0].snapshot.title,'合成事项已完成');
 }finally{await f.close();}
});
test('invalid quote, changed hash, future source/time and incomplete binary outcomes cannot be persisted',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  const e=evidence(x);for(const extra of [{evidence:[{...e,quote:'not in source'}]},{evidence:[{...e,hash:'tampered'}]},{evidence:[e,{...e,ref:{revision:e.ref.revision,id:e.ref.id,kind:e.ref.kind}}]},{evidence:[]},{eventAt:'2026-02-30T00:00:00Z',evidence:[e]},{eventAt:'2027-01-01T00:00:00Z',evidence:[e]}])assert.throws(()=>api.write(run.id,'outcome',command(0,outcome(x,{outcome:'true',...extra}))));
  assert.equal(api.detail(run.id).version,0);
 }finally{await f.close();}
});
test('storage failure is atomic, fingerprint damage blocks history, and restoration guards apply to HTTP writes',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  f.store.db.exec("CREATE TRIGGER fail_forward_review BEFORE INSERT ON forward_reviews BEGIN SELECT RAISE(ABORT,'synthetic review failure'); END");assert.throws(()=>api.write(run.id,'label',command(0,label)),/synthetic/);f.store.db.exec('DROP TRIGGER fail_forward_review');assert.equal(api.detail(run.id).version,0);
  api.write(run.id,'label',command(0,label));f.store.db.exec("UPDATE forward_reviews SET payload=json_set(payload,'$.value.reason','damaged')");assert.throws(()=>api.detail(run.id),/指纹/);
  const handler=createHandler(f.store,f.service);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();let code;
  await handler({method:'POST',url:`/api/forward-evaluations/records/${run.id}/label`,headers:{host:'127.0.0.1:4179','content-type':'application/json'}},{writeHead:c=>code=c,end(){}});assert.equal(code,409);
 }finally{await f.close();}
});
test('review histories survive restart and verified backup restoration without rewriting original captures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-review-')),x=await prepared({path:join(dir,'source.sqlite')}),{f,api,run}=x;let restored;
 try{
  api.write(run.id,'label',command(0,label));const before=api.write(run.id,'outcome',command(1,outcome(x))),b=await createBackup(join(dir,'source.sqlite'),join(dir,'backups')),report=await rehearseRecovery(b.directory,join(dir,'recovery'));assert(report.passed,JSON.stringify(report));assert.equal(report.original.tables.forward_reviews.count,2);
  restored=fixture({path:join(report.directory,'candidate.sqlite')});assert.deepEqual(restored.service.forwardReviews.detail(run.id),before);assert.throws(()=>restored.service.forwardReviews.write(run.id,'label',command(2,label)),/恢复副本/);
 }finally{if(restored)await restored.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a previously resolved then reopened claim is never scored as a fresh forecast',async()=>{
 const f=fixture();try{
  freeze(f);const p=await f.prepare();let t=f.service.research.saveClaim(p.topic.id,{version:p.topic.version,claim});
  const id=t.claims[0].id;t=f.service.research.saveClaim(t.id,{version:t.version,claim:{...claim,id,outcome:'true',evidenceIds:[t.evidence[0].id],resolutionReason:'旧结局',revisionReason:'旧结局已知'}});
  t=f.service.research.saveClaim(t.id,{version:t.version,claim:{...claim,id,probability:99,revisionReason:'重新打开'}});const run=start(f,t);await f.service.modelResearch.wait(run.id);const eventAt=f.tick(),x={f,api:f.service.forwardReviews,run,topic:t};
  const result=x.api.write(run.id,'outcome',command(0,outcome(x,{outcome:'true',eventAt,evidence:[evidence(x)]})));
  assert.equal(result.claims[0].score,null);assert.match(result.claims[0].scoringReasons.join(' '),/重开不能/);assert.equal(f.service.forwardEvaluations.get(run.id).claimTimeline.length,t.version);
 }finally{await f.close();}
});
test('outcome body citations reuse immutable material validation and retain the old snapshot after source damage',async()=>{
 const x=await prepared(),{f,api,run}=x;try{
  const eventAt=f.tick();f.tick();f.service.research.saveMaterial(x.topic.id,{version:x.topic.version,title:'合成结局公告',sourceName:'合成来源',url:'https://example.com/outcome',publishedAt:'2026-10-03',scope:'excerpt',body:'合成事件已经完成。原文仅用于开发测试，不是真实公告。',stance:'supports',family:'other',step:'fact',interpretation:'合成结局材料'});
  const s=api.inputs(run.id).items.find(s=>s.ref.kind==='material'),e={ref:s.ref,hash:s.hash,quote:'合成事件已经完成',quoteField:'body'};
  const before=api.write(run.id,'outcome',command(0,outcome(x,{outcome:'true',eventAt,evidence:[e]})));assert.notEqual(before.claims[0].score,null);
  f.store.db.prepare("UPDATE research_materials SET payload=json_set(payload,'$.body','damaged') WHERE id=?").run(s.ref.id);
  assert.throws(()=>api.write(run.id,'outcome',command(1,outcome(x,{outcome:'false',eventAt,evidence:[e]}))),/证据/);assert.deepEqual(api.detail(run.id),before);assert.equal(api.inputs(run.id).unavailable.length,1);
 }finally{await f.close();}
});
