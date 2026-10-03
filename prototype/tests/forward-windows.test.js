import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,freeze,start,output} from './helpers/forward-fixture.js';
import {digest} from '../server/codex-research.mjs';
import {createBackup} from '../server/backup.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';
const command=(f,b,extra={})=>({baselineId:b.id,title:'合成窗口',requestId:randomUUID(),start:'2026-10-03T00:00:00Z',end:f.tick(),...extra});
async function run(f){const p=await f.prepare(),r=start(f,p.topic);await f.service.modelResearch.wait(r.id);return r;}
const label={verdict:'ordinary',exposure:'already-seen',reviewer:'合成评审者',reason:'开发样例',novelty:'',scale:'',mechanism:'',clusterVerdict:'uncertain',clusterReason:'未独立核验',revisionReason:'首版'};
test('window includes failures and exclusions, fixes review versions, and uses half-open timestamps',async()=>{
 let fail=false;const f=fixture({runner:async p=>{if(fail)throw Error('synthetic failure');return output(p);}});try{
  const b=freeze(f),a=await run(f);fail=true;f.tick();const bad=start(f,f.service.research.get(a.topicId));await f.service.modelResearch.wait(bad.id);f.service.forwardReviews.write(a.id,'label',{requestId:randomUUID(),version:0,value:label});
  const data=command(f,b),api=f.service.forwardWindows,r=api.freeze(data);assert.equal(r.summary.calls,2);assert.equal(r.summary.statuses.failed,1);assert.equal(r.summary.inputExcluded,1);assert.equal(r.summary.labels.unreviewed,1);assert.equal(r.summary.labels.ordinary,1);assert.equal(r.forwardEligible,false);assert.equal(r.summary.claims.aggregateError,null);assert.equal(r.reportSourceHash,digest(r.reportSources));
  f.service.forwardReviews.write(a.id,'label',{requestId:randomUUID(),version:1,value:{...label,verdict:'unclear',revisionReason:'更正'}});assert.deepEqual(api.get(r.id),r);assert.deepEqual(api.freeze(data),r);assert.equal(api.freeze(command(f,b)).summary.labels.unclear,1);
  const subset=api.freeze(command(f,b,{end:bad.createdAt}));assert.deepEqual(subset.rows.map(x=>x.capture.runId),[a.id]);assert.equal(api.freeze(command(f,b,{start:bad.createdAt})).summary.calls,1);
  assert.throws(()=>api.freeze({...data,title:'other'}),/标识冲突/);assert.throws(()=>api.freeze({...command(f,b),end:'2027-01-01T00:00:00Z'}),/参数/);assert.throws(()=>api.freeze({...command(f,b),start:'2026-10-02T00:00:00Z'}),/参数/);assert.throws(()=>api.freeze({...command(f,b),runIds:[a.id]}),/参数/);
 }finally{await f.close();}
});
function copies(f,id,n){
 const db=f.store.db,c=JSON.parse(db.prepare('SELECT payload FROM forward_captures WHERE run_id=?').get(id).payload),r=db.prepare('SELECT * FROM model_research_runs WHERE id=?').get(id),keys=Object.keys(r),insert=db.prepare(`INSERT INTO model_research_runs (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
 for(let i=0;i<n;i++){const next=randomUUID(),run=JSON.parse(r.payload);run.id=next;insert.run(...keys.map(k=>k==='id'?next:k==='payload'?JSON.stringify(run):r[k]));const {snapshotHash,...v}=c;v.runId=next;db.prepare('INSERT INTO forward_captures VALUES(?,?,?,?)').run(next,c.baselineId,c.topicId,JSON.stringify({...v,snapshotHash:digest(v)}));}
}
test('complete cohort exceeds UI limit, retains same-cluster calls, and capacity never truncates',async()=>{
 const f=fixture();try{
  const b=freeze(f),a=await run(f);copies(f,a.id,100);assert.equal(f.service.forwardEvaluations.records().length,100);
  const report=f.service.forwardWindows.freeze(command(f,b));assert.equal(report.rows.length,101);assert.equal(report.summary.clusters.known,1);assert.equal(report.summary.clusters.repeatCalls,100);assert.equal(report.summary.clusters.representatives[0].runId,[...report.rows].map(x=>x.capture.runId).sort((a,b)=>a.localeCompare(b))[0]);
  copies(f,a.id,4900);assert.throws(()=>f.service.forwardWindows.freeze(command(f,b)),/超过5000/);assert.equal(f.service.forwardWindows.list().total,1);
 }finally{await f.close();}
});
test('empty cohorts remain explicit; malformed timestamps and damaged reviews do not disappear from windows',async()=>{
 const f=fixture();try{
  const b=freeze(f),empty=f.service.forwardWindows.freeze(command(f,b));assert.equal(empty.summary.calls,0);assert.equal(empty.summary.claims.aggregateError,null);
  const a=await run(f),row=JSON.parse(f.store.db.prepare('SELECT payload FROM forward_captures WHERE run_id=?').get(a.id).payload),{snapshotHash,...c}=structuredClone(row);c.record.decisionAt='bad';f.store.db.prepare('UPDATE forward_captures SET payload=? WHERE run_id=?').run(JSON.stringify({...c,snapshotHash:digest(c)}),a.id);
  assert.throws(()=>f.service.forwardWindows.freeze(command(f,b)),/指纹/);assert.equal(f.service.forwardWindows.list().total,1);
  f.store.db.prepare('UPDATE forward_captures SET payload=? WHERE run_id=?').run(JSON.stringify(row),a.id);f.service.forwardReviews.write(a.id,'label',{requestId:randomUUID(),version:0,value:label});f.store.db.exec("UPDATE forward_reviews SET payload=json_set(payload,'$.value.reason','damaged')");assert.throws(()=>f.service.forwardWindows.freeze(command(f,b)),/指纹/);
 }finally{await f.close();}
});
test('SQL failure rolls back; backup/reopen retain frozen reports; recovery writes and tampered reports are rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-window-')),f=fixture({path:join(dir,'source.sqlite')});let restored;try{
  const b=freeze(f);await run(f);f.store.db.exec("CREATE TRIGGER fail_window BEFORE INSERT ON forward_windows BEGIN SELECT RAISE(ABORT,'synthetic write'); END");assert.throws(()=>f.service.forwardWindows.freeze(command(f,b)),/synthetic/);assert.equal(f.service.forwardWindows.list().total,0);f.store.db.exec('DROP TRIGGER fail_window');const report=f.service.forwardWindows.freeze(command(f,b));
  const backup=await createBackup(join(dir,'source.sqlite'),join(dir,'backup')),recovery=await rehearseRecovery(backup.directory,join(dir,'recovery'));assert(recovery.passed);restored=fixture({path:join(recovery.directory,'candidate.sqlite')});assert.deepEqual(restored.service.forwardWindows.get(report.id),report);assert.throws(()=>restored.service.forwardWindows.freeze(command(restored,b)),/恢复副本/);
  f.store.db.exec("UPDATE forward_windows SET payload=json_set(payload,'$.summary.calls',999)");assert.throws(()=>f.service.forwardWindows.get(report.id),/指纹/);
 }finally{if(restored)await restored.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('unregistered, unresolved and partial claims stay in the denominator with null aggregate error',async()=>{
 const f=fixture();try{
  const b=freeze(f),p=await f.prepare();let t=p.topic;
  for(let i=0;i<3;i++)t=f.service.research.saveClaim(t.id,{version:t.version,claim:{kind:'outcome',outcome:'open',status:'unverified',claim:'合成主张'+i,probability:50,basis:'合成依据',impactIfTrue:'正向',impactIfFalse:'反向',horizon:'短期',resolveBy:'2026-10-05',evidenceIds:[],resolutionReason:'',revisionReason:'新增'}});
  const a=start(f,t);await f.service.modelResearch.wait(a.id);f.tick();const src=f.service.forwardReviews.inputs(a.id).items[0],e={ref:src.ref,hash:src.hash,quote:src.snapshot.title,quoteField:'title'};
  for(const [i,outcome] of ['unresolved','partial'].entries())f.service.forwardReviews.write(a.id,'outcome',{requestId:randomUUID(),version:i,value:{claimId:t.claims[i].id,outcome,eventAt:null,reason:'未知',reviewer:'合成评审',revisionReason:'首次',evidence:outcome==='partial'?[e]:[]}});
  const r=f.service.forwardWindows.freeze(command(f,b));assert.deepEqual(r.summary.claims.outcomes,{partial:1,unregistered:1,unresolved:1});assert.equal(r.summary.claims.total,3);assert.equal(r.summary.claims.withoutDescriptiveError,3);assert.equal(r.summary.claims.aggregateError,null);
 }finally{await f.close();}
});
