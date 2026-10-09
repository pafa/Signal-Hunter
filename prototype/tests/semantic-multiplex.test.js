import {ARTICLE_SCOPE_VERSION} from '../server/article-extraction.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../server/codex-research.mjs';
import {comparisonContract,validateComparisonCandidate} from '../server/semantic-events.mjs';
import {COMPARISON_GROUP_VERSION,comparisonGroup,comparisonGroupPackets,comparisonGroupSchema,comparisonGroupPrompt,validateComparisonGroup,projectComparisonGroup} from '../server/semantic-multiplex.mjs';
import {fixture,comparison} from './automatic-research-fixture.mjs';
import {groupedComparisonFixture} from './helpers/grouped-comparison-fixture.mjs';

const record=i=>({kind:'event',id:`event-${i}`,revision:1,title:`Synthetic ${i}`,body:`Synthetic company ${i} announces a distinct project ${i}.`,eventFocus:{actor:`company ${i}`,action:'announces',object:`project ${i}`,stage:'announced',quote:`company ${i} announces a distinct project ${i}`,quoteField:'body'}});
const pair=(a,b)=>{const input={left:a,right:b};return {schema:'event-pair-scoped-1',input,inputHash:digest(input)};};
const packets=()=>[1,2,3].map(i=>pair(record(0),record(i)));
const rows=f=>f.store.db.prepare('SELECT * FROM research_pipeline_relations ORDER BY rowid').all();
async function pending(f){for(let i=1;i<=3;i++){f.add(i);await f.drive(32);}f.add(4);await f.until(()=>rows(f).filter(r=>r.status==='queued').length===3);return rows(f).filter(r=>r.status==='queued');}
const read=(f,id)=>f.store.db.prepare('SELECT * FROM research_pipeline_relations WHERE id=?').get(id);

test('one frozen group carries every original pair, shared materials once, exact output coverage and orientations',async()=>{
 const ps=packets(),p=comparisonGroup(ps),candidate=await groupedComparisonFixture(q=>comparison(q,'unrelated'))(p);
 assert.deepEqual(comparisonGroupPackets(p),ps);assert.equal(Object.keys(p.input.records).length,4);assert.equal(p.input.pairs.length,3);assert.deepEqual(comparisonGroupSchema(p).properties.comparisons.required,['p0','p1','p2']);assert.match(comparisonGroupPrompt(p),/不能跳过、合并或改换配对/);
 assert.equal(comparisonContract(p).promptVersion,COMPARISON_GROUP_VERSION+'/'+ARTICLE_SCOPE_VERSION);assert.equal(comparisonContract(p).prompt,comparisonGroupPrompt(p));
 for(let i=0;i<3;i++){const projected=projectComparisonGroup(candidate,p,'test-model',i);validateComparisonCandidate(projected,ps[i],'test-model',{requireTimeEvidence:true});assert.equal(projected.rawOutput,candidate.rawOutput);assert.equal(projected.trace.inputHash,p.inputHash);assert.throws(()=>validateComparisonCandidate(projected,ps[(i+1)%3],'test-model'));}
 for(const mutate of [v=>delete v.comparisons.p1,v=>v.comparisons.p3=v.comparisons.p0,v=>v.comparisons.p1.right.quote=v.comparisons.p2.right.quote,v=>v.comparisons.p0.left.timeEvidence={basis:'explicit',quote:'2099-01-01',quoteField:'body'}]){const v=JSON.parse(candidate.rawOutput);mutate(v);assert.throws(()=>validateComparisonGroup(v,p));}
 for(const mutate of [v=>v.comparison.relation='followup',v=>v.group.pairId='p1',v=>v.trace.inputHash='wrong',v=>v.rawOutput='{}']){const v=projectComparisonGroup(candidate,p,'test-model',0);mutate(v);assert.throws(()=>validateComparisonCandidate(v,ps[0],'test-model'));}
 assert.throws(()=>comparisonGroup([ps[0],ps[0]]));assert.throws(()=>comparisonGroup([...ps,ps[0]]));assert.throws(()=>comparisonGroup(ps.map(p=>pair({...p.input.left,body:'x'.repeat(530000)},p.input.right))));
 const altered=structuredClone(p);altered.input.records.extra=record(9);altered.inputHash=digest(altered.input);assert.throws(()=>comparisonGroupPackets(altered));
});

test('automatic groups spend one remaining call on three pairs, preserve all attempts and resume remaining scope',async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,'unrelated')});try{
  const queued=await pending(f),before=f.queue.snapshot().callsInLast24Hours,pairsBefore=f.calls.semantic,invocationsBefore=f.calls.semanticInvocations,book=f.service.paper.snapshot();f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:before+1,includeClues:false});
  await f.until(()=>queued.every(r=>read(f,r.id).status==='completed'));
  assert.equal(f.queue.snapshot().callsInLast24Hours,before+1);assert.equal(f.calls.semantic-pairsBefore,3);assert.equal(f.calls.semanticInvocations-invocationsBefore,1);
  const runs=queued.map(r=>f.service.semanticEvents.get(read(f,r.id).run_id));assert.equal(new Set(runs.map(r=>r.invocation.id)).size,1);assert(runs.every(r=>r.active&&r.invocation.comparisons===3));assert.equal(new Set(runs.map(r=>r.packet.inputHash)).size,3);assert(runs.every(r=>r.candidate.rawOutput===runs[0].candidate.rawOutput));
  const usage=f.queue.snapshot().comparisonUsage;assert.equal(usage.pairAttempts,f.calls.semantic);assert.equal(usage.invocations,f.calls.semanticInvocations);assert.deepEqual(f.service.paper.snapshot(),book);
  f.advance(86400001);assert.equal(f.queue.snapshot().callsInLast24Hours,0);assert.deepEqual({...f.queue.snapshot().comparisonUsage},{pairAttempts:0,invocations:0});
 }finally{await f.close();}
});

test('a failed atomic group start leaves all plans and quota untouched, and pause prevents late start',async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,'unrelated')});try{
  const queued=await pending(f),before=rows(f),calls=f.calls.semanticInvocations,used=f.queue.snapshot().callsInLast24Hours,runCount=f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n;
  f.store.db.exec(`CREATE TRIGGER reject_group BEFORE INSERT ON research_pipeline_attempts WHEN NEW.item_id='${queued[1].id}' BEGIN SELECT RAISE(ABORT,'synthetic group storage failure'); END`);
  await f.drive(8);assert.deepEqual(rows(f),before);assert.equal(f.calls.semanticInvocations,calls);assert.equal(f.queue.snapshot().callsInLast24Hours,used);assert.equal(f.store.db.prepare('SELECT count(*) n FROM semantic_runs').get().n,runCount);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  f.store.db.exec('DROP TRIGGER reject_group');const start=f.service.semanticEvents.startGroup;f.service.semanticEvents.startGroup=(...args)=>{f.service.controlOperation('discovery','pause');return start(...args);};await f.drive(8);assert.deepEqual(rows(f),before);assert.equal(f.calls.semanticInvocations,calls);f.service.semanticEvents.startGroup=start;await f.drive(20);assert(queued.every(r=>read(f,r.id).status==='completed'));
 }finally{await f.close();}
});

test('group cancellation stops all shared pairs without automatic retry and cannot be requested by a client actor',async()=>{
 let hold=false;const f=fixture({semanticRunner:(p,c)=>hold?new Promise((resolve,reject)=>c.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})):comparison(p,'unrelated')});try{
  const queued=await pending(f),refs=queued.map(r=>JSON.parse(r.payload).refs);assert.throws(()=>f.service.semanticEvents.startGroup(refs,()=>{},{kind:'system'}),/内部/);hold=true;
  for(let i=0;i<10&&!read(f,queued[0].id).run_id;i++){f.service.controlOperation('discovery','resume');await f.service.runOperation('discovery');}
  const running=queued.map(r=>read(f,r.id));assert(running.every(r=>r.run_id));const calls=f.calls.semanticInvocations;f.service.semanticEvents.cancel(running[1].run_id);await f.finish();hold=false;await f.drive(16);
  assert(queued.every(r=>read(f,r.id).status==='cancelled'));assert.equal(f.calls.semanticInvocations,calls);assert(running.every(r=>f.service.semanticEvents.get(r.run_id).status==='cancelled'));assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
 }finally{await f.close();}
});

test('one changed target invalidates only its pair after a shared call, preserving other evidence and history',async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,'unrelated')});try{
  const queued=await pending(f);await f.until(()=>queued.every(r=>read(f,r.id).run_id));const original=queued.map(r=>f.service.semanticEvents.get(read(f,r.id).run_id));
  const target=JSON.parse(queued[1].payload).target,t=f.service.research.get(target.id);f.service.research.update(t.id,{version:t.version,nextEvidence:'Person changes only this target'});await f.drive(20);
  assert.equal(read(f,queued[1].id).status,'invalidated');assert.equal(read(f,queued[0].id).status,'completed');assert.equal(read(f,queued[2].id).status,'completed');assert.equal(f.service.semanticEvents.get(original[1].id).candidate.rawOutput,original[1].candidate.rawOutput);assert.equal(f.service.research.get(t.id).nextEvidence,'Person changes only this target');
 }finally{await f.close();}
});

test('failed shared calls retain each pair attempt and stop after three bounded tries',async()=>{
 let fail=false;const f=fixture({semanticRunner:p=>{if(fail)throw Error('synthetic whole invocation failure');return comparison(p,'unrelated');}});try{
  const queued=await pending(f),before=f.queue.snapshot().comparisonUsage;fail=true;await f.drive(16);f.advance(60001);await f.drive(16);f.advance(120001);await f.drive(24);
  assert(queued.every(r=>read(f,r.id).status==='observing'));
  for(const row of queued){const attempts=f.store.db.prepare('SELECT run_id FROM research_pipeline_attempts WHERE item_id=?').all(row.id);assert.equal(attempts.length,3);assert(attempts.every(a=>f.service.semanticEvents.get(a.run_id).status==='failed'));}
  const usage=f.queue.snapshot().comparisonUsage;assert.equal(usage.invocations-before.invocations,7);assert.equal(usage.pairAttempts-before.pairAttempts,9);const calls=f.calls.semanticInvocations;f.advance(86400001);await f.drive(16);assert.equal(f.calls.semanticInvocations,calls);
 }finally{await f.close();}
});

test('restart retains completed group bytes, pair identities and one invocation charge without replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'semantic-group-restart-')),path=join(dir,'test.sqlite');let f=fixture({path,semanticRunner:p=>comparison(p,'unrelated')});try{
  const queued=await pending(f);await f.until(()=>queued.every(r=>read(f,r.id).status==='completed'));const before=f.store.db.prepare('SELECT * FROM semantic_runs ORDER BY rowid').all(),usage={...f.queue.snapshot().comparisonUsage},attempts=f.store.db.prepare('SELECT * FROM research_pipeline_attempts ORDER BY id').all();f.service.controlOperation('discovery','pause');await f.close();
  f=fixture({path,semanticRunner:p=>comparison(p,'unrelated')});assert(f.service.operations().tasks.discovery.paused);await f.drive(20);assert.equal(f.calls.semanticInvocations,0);assert.deepEqual(f.store.db.prepare('SELECT * FROM semantic_runs ORDER BY rowid').all(),before);assert.deepEqual({...f.queue.snapshot().comparisonUsage},usage);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_attempts ORDER BY id').all(),attempts);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});


test('one malformed grouped pair falls back to independent retries while the other pairs complete',async()=>{
 let badTarget=null;const f=fixture({semanticRunner:p=>comparison(p,p.input.right.id===badTarget?'invalid-relation':'unrelated')});try{
  const queued=await pending(f),before=f.queue.snapshot().comparisonUsage;badTarget=JSON.parse(queued[1].payload).refs.right.id;
  await f.drive(16);const first=queued.map(r=>f.service.semanticEvents.get(f.store.db.prepare('SELECT run_id FROM research_pipeline_attempts WHERE item_id=? ORDER BY id LIMIT 1').get(r.id).run_id));assert(first.every(r=>r.status==='failed'&&r.invocation.comparisons===3));
  f.advance(60001);await f.drive(24);assert.equal(read(f,queued[0].id).status,'completed');assert.equal(read(f,queued[2].id).status,'completed');
  f.advance(120001);await f.drive(24);assert.equal(read(f,queued[1].id).status,'observing');
  for(const [i,row] of queued.entries()){const attempts=f.store.db.prepare('SELECT run_id FROM research_pipeline_attempts WHERE item_id=? ORDER BY id').all(row.id);assert.equal(attempts.length,i===1?3:2);assert(attempts.slice(1).every(a=>!f.service.semanticEvents.get(a.run_id).invocation));assert.equal(f.service.semanticEvents.get(first[i].id).status,'failed');}
  const usage=f.queue.snapshot().comparisonUsage;assert.equal(usage.invocations-before.invocations,5);assert.equal(usage.pairAttempts-before.pairAttempts,7);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
 }finally{await f.close();}
});
