import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {classifyHeadline} from '../server/triage.mjs';
import {screeningMetrics,claimMetrics} from '../server/evaluation-metrics.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(path=':memory:'){
 let at='2026-10-02T14:00:00Z';const store=openStore(path),service=createService(store,{mode:'research',now:()=>Date.parse(at)}),api=service.evaluations;
 const command=(b,extra={})=>({requestId:randomUUID(),version:b?.version||0,...extra});
 const f={store,service,api,command,setTime:x=>at=x,
  capture(title,id=title,revision=1){const news={id,revision,title,url:'https://example.org/fixture',publisher:'Synthetic fixture',publishedAt:'2026-10-02T13:00:00Z',articleFirstSeen:at,revisionFirstSeen:at};service.research.screenings.capture(news,classifyHeadline(news),at);},
  create(extra={}){return api.create(command(null,{title:'Synthetic blind review',start:'2026-10-02T14:00:00Z',end:'2026-10-02T14:05:00Z',rulesHash:service.research.screenings.rulesHash,...extra}));},
  label(b,id,extra={}){return api.annotate(b.id,command(b,{label:{sampleId:id,verdict:'ordinary',clusterId:`c-${b.samples.findIndex(s=>s.id===id)}`,reviewer:'Synthetic reviewer',exposure:'unseen-attested',reason:'Synthetic label only',novelty:'',scale:'',mechanism:'',...extra}}));},
  async close(){await service.close();store.close();}
 };f.capture('Company files for bankruptcy','a');f.setTime('2026-10-02T14:01:00Z');f.capture('Company appoints office manager','b');f.setTime('2026-10-02T14:10:00Z');return f;
}
test('cohort freezes all screening levels and sources, with no predictions or reports before seal',async()=>{
 const f=fixture();try{const b=f.create();assert.equal(b.total,2);assert.equal(b.forwardEligible,false);assert.ok(b.samples.every(s=>!('triage' in s)));assert.equal(b.report,undefined);assert.equal(b.sources,undefined);assert.throws(()=>f.api.report(b.id),/先完成封存/);assert.throws(()=>f.api.export(b.id),/先完成封存/);
 f.setTime('2026-10-02T14:02:00Z');f.capture('Another company bankruptcy','later-added');assert.equal(f.api.detail(b.id).total,2);assert.equal(f.api.list().batches[0].total,2);
 }finally{await f.close();}
});
test('all labels including unclear are required, labels are versioned, and sealing is immutable',async()=>{
 const f=fixture();try{let b=f.create();assert.throws(()=>f.api.seal(b.id,f.command(b,{confirm:true})),/全部样本/);b=f.label(b,b.samples[0].id);const v=b.version;
 assert.throws(()=>f.api.annotate(b.id,{...f.command(b,{label:{}}),version:v-1}),/版本已变化/);
 b=f.label(b,b.samples[0].id,{verdict:'major',novelty:'New',scale:'Company-wide',mechanism:'Survival',reason:'Corrected before reveal'});b=f.label(b,b.samples[1].id,{verdict:'unclear',clusterId:'',reason:'Insufficient input'});
 const data=f.command(b,{confirm:true});b=f.api.seal(b.id,data);assert.equal(b.state,'sealed');assert.equal(b.report.labelHistory.length,3);assert.equal(b.report.screening.unclear,1);assert.equal(b.report.screening.unknownCluster,1);assert.ok(b.samples.every(s=>s.triage));assert.equal(f.api.seal(b.id,data).version,b.version);
 assert.throws(()=>f.label(b,b.samples[0].id),/已经封存/);const exported=f.api.export(b.id),r={...exported.report};delete r.sha256;assert.equal(digest(r),exported.report.sha256);assert.equal(digest(exported.batch.sources),b.sourceHash);
 }finally{await f.close();}
});
test('major labels need mechanism evidence, invalid clusters and unknown reviewers cannot count as reviewed',async()=>{
 const f=fixture();try{const b=f.create();for(const extra of [{verdict:'major'},{clusterId:'bad space'},{reviewer:''},{exposure:'blind-proven'},{reason:''},{verdict:'made-up'}])assert.throws(()=>f.label(b,b.samples[0].id,extra),/标签/);assert.equal(f.api.detail(b.id).reviewed,0);}finally{await f.close();}
});
test('idempotency, window bounds and corrupt input fingerprints cannot create misleading cohorts',async()=>{
 const f=fixture();try{for(const extra of [{start:'2026-02-30T14:00:00Z'},{end:'2026-10-02T14:11:00Z'},{start:'2026-10-02T14:05:00Z'},{rulesHash:'unknown'}])assert.throws(()=>f.create(extra),/参数/);
 const data={requestId:randomUUID()};const a=f.create(data);assert.equal(f.create(data).id,a.id);assert.throws(()=>f.create({...data,title:'Changed'}),/请求标识/);
 f.store.db.exec("UPDATE screening_samples SET payload=json_set(payload,'$.input.title','tampered')");assert.throws(()=>f.create(),/指纹/);assert.equal(f.api.list().batches.length,1);
 }finally{await f.close();}
});
test('annotation failure rolls back its label and version, and restore review blocks writes',async()=>{
 const f=fixture();try{const b=f.create();f.store.db.exec("CREATE TRIGGER fail_evaluation BEFORE UPDATE ON evaluation_batches BEGIN SELECT RAISE(ABORT,'fixture failure'); END");assert.throws(()=>f.label(b,b.samples[0].id),/fixture failure/);assert.equal(f.api.detail(b.id).reviewed,0);assert.equal(f.api.detail(b.id).version,1);f.store.db.exec('DROP TRIGGER fail_evaluation');f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.label(b,b.samples[0].id),/恢复副本/);assert.throws(()=>f.create(),/恢复副本/);}finally{await f.close();}
});
test('cluster representatives are earliest by time, not whichever revision makes the rule look correct',()=>{
 const samples=[{id:'a',input:{id:'story'},decisionAt:'2026-10-02T01:00Z',triage:{bucket:'quiet'}},{id:'b',input:{id:'story'},decisionAt:'2026-10-02T02:00Z',triage:{bucket:'review'}},{id:'c',input:{id:'other'},decisionAt:'2026-10-02T03:00Z',triage:{bucket:'review'}},{id:'d',input:{id:'unknown'},decisionAt:'2026-10-02T04:00Z',triage:{bucket:'quiet'}}];
 const labels=Object.fromEntries(['a','b','c'].map((id,i)=>[id,{verdict:i===2?'ordinary':'major',clusterId:i===2?'cluster-two':'cluster-one',exposure:'already-seen'}]));const m=screeningMetrics(samples,labels);
 assert.deepEqual(m.representativeIds,['a','c']);assert.equal(m.raw.tp,1);assert.equal(m.raw.fp,1);assert.equal(m.raw.fn,1);assert.equal(m.raw.precision,.5);assert.equal(m.raw.recallWithinCohort,.5);assert.equal(m.clusterRepresentatives.tp,0);assert.equal(m.clusterRepresentatives.fn,1);assert.equal(m.duplicateClusterSamples,1);assert.equal(m.unreviewed,1);assert.equal(m.unknownCluster,1);
 assert.equal(screeningMetrics([],{}).raw.precision,null);
});
function versions(){
 const base={id:'claim-1',claim:'Binary event',kind:'outcome',resolveBy:'2026-10-03',outcome:'open',evidenceIds:['e1'],resolutionReason:'Outcome evidence',firstAssessedAt:'2026-10-01T10:00:00Z'};
 const row=(v,at,c)=>({topic_id:'topic',version:v,recorded_at:at,payload:JSON.stringify({id:'topic',claims:[{...base,assessedAt:at,...c}],evidence:[{id:'e1',availableAt:'2026-10-02T10:00:00Z'}]})});
 return [row(1,'2026-10-01T10:00:00Z',{probability:20}),row(2,'2026-10-01T11:00:00Z',{probability:70}),row(3,'2026-10-02T11:00:00Z',{probability:100,outcome:'true',resolvedAt:'2026-10-02T11:00:00Z'})];
}
test('Brier uses probabilities recorded before outcome, separates first and revision, and bins safely include 100%',()=>{
 const m=claimMetrics(versions(),'2026-10-02T12:00:00Z');assert.equal(m.total,1);assert.equal(m.cases[0].first,20);assert.equal(m.cases[0].last,70);assert.ok(Math.abs(m.first.brier-.64)<1e-12);assert.ok(Math.abs(m.last.brier-.09)<1e-12);assert.equal(m.paired.n,1);assert.equal(m.first.bins[1].n,1);assert.equal(m.last.bins[3].observedFrequency,1);
 const v=versions();const t=JSON.parse(v[1].payload);t.claims[0].probability=100;v[1].payload=JSON.stringify(t);assert.equal(claimMetrics(v,'2026-10-02T12:00:00Z').last.bins[4].n,1);
});
test('unknown first probability stays unknown, partial/future/unsubstantiated outcomes stay unscored',()=>{
 for(const patch of [{outcome:'partial'},{outcome:'unresolved'},{resolvedAt:'2026-10-03T11:00:00Z'},{evidenceIds:[]},{resolutionReason:''}]){const v=versions(),t=JSON.parse(v[2].payload);Object.assign(t.claims[0],patch);v[2].payload=JSON.stringify(t);const m=claimMetrics(v,'2026-10-02T12:00:00Z');assert.equal(m.first.brier,null);assert.equal(m.unscored,1);}
 const v=versions(),t=JSON.parse(v[0].payload);t.claims[0].probability=null;v[0].payload=JSON.stringify(t);const m=claimMetrics(v,'2026-10-02T12:00:00Z');assert.equal(m.first.n,0);assert.equal(m.last.n,1);assert.equal(m.paired.n,0);
});
test('future evidence, modified claim identity and post-outcome reopen cannot improve historical scores',()=>{
 for(const change of [t=>t.evidence[0].availableAt='2026-10-02T11:30:00Z',t=>t.claims[0].claim='Different question']){const v=versions(),t=JSON.parse(v[2].payload);change(t);v[2].payload=JSON.stringify(t);assert.equal(claimMetrics(v,'2026-10-02T12:00:00Z').first.brier,null);}
 const v=versions(),t=JSON.parse(v[2].payload);t.claims[0]={...t.claims[0],outcome:'open',probability:99,assessedAt:'2026-10-02T12:00:00Z'};v.push({topic_id:'topic',version:4,recorded_at:'2026-10-02T12:00:00Z',payload:JSON.stringify(t)});t.claims[0]={...t.claims[0],outcome:'true',resolvedAt:'2026-10-02T13:00:00Z',assessedAt:'2026-10-02T13:00:00Z'};v.push({topic_id:'topic',version:5,recorded_at:'2026-10-02T13:00:00Z',payload:JSON.stringify(t)});assert.equal(claimMetrics(v,'2026-10-02T14:00:00Z').cases[0].last,70);
});
test('sealed cohort and exact report survive reopening while later research stays outside the snapshot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-evaluation-')),path=join(dir,'fixture.sqlite'),f=fixture(path);let store,service;
 try{let b=f.create();for(const s of b.samples)b=f.label(b,s.id);b=f.api.seal(b.id,f.command(b,{confirm:true}));const before=f.api.export(b.id);await f.close();store=openStore(path);service=createService(store,{mode:'research'});assert.deepEqual(service.evaluations.export(b.id),before);}finally{if(store){await service.close();store.close();}else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP cannot request results before labels seal or inject a prediction into batch creation',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service);const call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const b=f.create();assert.equal((await call('GET',`/api/evaluations/${b.id}`)).result.samples[0].triage,undefined);assert.equal((await call('GET',`/api/evaluations/${b.id}/export`)).status,400);assert.equal((await call('POST','/api/evaluations',{samples:[]})).status,400);}finally{await f.close();}
});

test('unknown rule outputs never count as negative predictions',()=>{
 const m=screeningMetrics([{id:'pending',input:{id:'p'},decisionAt:'2026-10-02T01:00Z',triage:{bucket:'pending'}}],{pending:{verdict:'ordinary',clusterId:'x',exposure:'already-seen'}});
 assert.equal(m.unknownPrediction,1);assert.equal(m.raw.n,0);assert.equal(m.raw.tn,0);assert.equal(m.clusterRepresentatives.n,0);
});

test('oversized windows are refused rather than silently truncating the sample population',async()=>{
 const f=fixture();try{
  f.store.db.exec('BEGIN');const insert=f.store.db.prepare('INSERT INTO screening_samples VALUES(?,?,?,?,?,?)');
  for(let i=0;i<4999;i++)insert.run(`extra-${i}`,`extra-news-${i}`,1,f.service.research.screenings.rulesHash,'{}','2026-10-02T14:01:00Z');
  f.store.db.exec('COMMIT');assert.throws(()=>f.create(),/超过5000/);assert.equal(f.api.list().batches.length,0);
 }finally{await f.close();}
});
test('a failed seal cannot leave a report behind or lock an uncommitted batch',async()=>{
 const f=fixture();try{let b=f.create();for(const sample of b.samples)b=f.label(b,sample.id);
  f.store.db.exec("CREATE TRIGGER fail_seal BEFORE UPDATE ON evaluation_batches BEGIN SELECT RAISE(ABORT,'seal failure'); END");
  assert.throws(()=>f.api.seal(b.id,f.command(b,{confirm:true})),/seal failure/);assert.equal(f.api.detail(b.id).state,'annotating');assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM evaluation_reports').get().n,0);assert.equal(f.api.detail(b.id).version,b.version);
 }finally{await f.close();}
});
