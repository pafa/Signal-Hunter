import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openObservationInbox} from '../server/observation-inbox.mjs';
import {evaluateResearchCondition} from '../server/research-observations.mjs';
import {conditionFixture,conditionalDossier} from './helpers/research-conditions-fixture.mjs';
import {fixture as automatic,two,output,extraction} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
const at='2026-10-02T06:00:00.000Z',book={positions:[],reviews:[]};
const group=(conditions,join='all')=>({status:'defined',reason:'Synthetic test conditions',join,conditions});
function fixture(path=':memory:'){
 const store=openStore(path),topic={id:'example',title:'Synthetic research',status:'active',version:1,companies:[{symbol:'00700.HK'}],evidence:[]};let clock=at,enabled=true;
 const keys=['entryCondition','exitCondition','invalidation','nextCheck'],a={symbol:'00700.HK',analysis:Object.fromEntries(keys.map(k=>[k,{text:'Synthetic evidence',basis:'inference',citations:[{evidenceId:'fixture',field:'body',quote:'Synthetic'}]}])),monitoring:{entryCondition:group([{type:'price',interval:'1m',operator:'gte',value:100}]),exitCondition:group([{type:'at',at:'2026-10-02T06:01:00Z'}]),invalidation:group([{type:'counterevidence'}]),nextCheck:group([{type:'research-change'}])}};
 const s={kind:'research',id:topic.id,title:topic.title,version:1,runId:'test-run',baseline:structuredClone(topic),current:topic,assessments:[a],ready:true,fresh:true,changed:false,reason:'Synthetic current basis'},subjects=[s];
 const inbox=openObservationInbox(store,{clock:()=>clock,getTopic:()=>topic,getResearchSubjects:()=>subjects,actualPriceEnabled:()=>enabled});
 const price=value=>{const q={symbol:'00700.HK',currency:'HKD',provider:'eastmoney-public',providerTimezone:'Asia/Hong_Kong',providerTime:'2026-10-02 14:00',points:[{time:'2026-10-02 14:00',close:value}]};store.db.prepare('INSERT OR REPLACE INTO quotes VALUES(?,?,?)').run(q.symbol,JSON.stringify(q),clock);store.status(q.symbol,{state:'ok',receivedAt:clock});};
 return {store,topic,s,a,subjects,inbox,price,run:()=>inbox.process([topic],book),checks:()=>inbox.summary().researchChecks,hits:()=>inbox.snapshot().items.filter(x=>x.kind==='research-condition'),clock:v=>clock=v,enable:v=>enabled=v,close:()=>store.close()};
}
const using=fn=>{const f=fixture();try{return fn(f);}finally{f.close();}};
test('research definitions enroll automatically and preserve unknown, future deadlines and non-executable native price evidence',()=>using(f=>{
 f.run();assert.equal(f.checks().length,4);assert.equal(f.checks().find(c=>c.group==='entryCondition').status,'unknown');assert.equal(f.checks().find(c=>c.group==='exitCondition').status,'false');assert.equal(f.hits().length,0);assert.equal(f.inbox.rules.list().length,0);
 f.price(105);f.run();const h=f.hits()[0];assert.equal(h.input.results[0].input.currency,'HKD');assert.equal(h.input.results[0].input.price,105);assert.equal(h.input.results[0].input.executable,false);assert.equal(h.input.subject.runId,'test-run');
 f.clock('2026-10-02T06:01:00.000Z');f.run();assert(f.hits().some(h=>h.input.group==='exitCondition'));
}));
test('continued hits, receipts, missing or failed data cannot duplicate or clear a trigger; an observed recovery allows a new episode',()=>using(f=>{
 f.price(105);f.run();const first=f.hits()[0];f.inbox.respond(first.id,{revision:1,action:'complete',note:'Synthetic optional receipt'});f.price(110);f.run();assert.equal(f.hits().length,1);
 f.enable(false);f.run();assert.equal(f.checks().find(c=>c.group==='entryCondition').active,true);f.enable(true);f.run();assert.equal(f.hits().length,1);f.store.status('00700.HK',{state:'error'});f.run();assert.equal(f.checks().find(c=>c.group==='entryCondition').status,'unknown');
 f.price(99);f.run();f.price(105);f.run();assert.equal(f.hits().length,2);assert.deepEqual(f.hits().map(h=>h.input.episode).sort(),[1,2]);assert.equal(f.hits().find(h=>h.id===first.id).state,'completed');assert.deepEqual(f.hits().find(h=>h.id===first.id).input,first.input);
}));
test('source changes invalidate price and time while independently checking bound research updates and material revisions',()=>using(f=>{
 f.s.baseline.evidence=[{id:'risk',stance:'against',claim:'Known risk',materialRevision:1}];f.topic.evidence=structuredClone(f.s.baseline.evidence);f.price(105);f.run();f.s.fresh=false;f.s.changed=true;f.topic.version=2;f.topic.evidence[0].materialRevision=2;f.run();
 assert.equal(f.checks().find(c=>c.group==='entryCondition').status,'unknown');assert.equal(f.checks().find(c=>c.group==='exitCondition').status,'unknown');assert(f.hits().some(h=>h.input.group==='nextCheck'));assert(f.hits().some(h=>h.input.group==='invalidation'));
 const n=f.hits().length;f.topic.evidence[0].materialRevision=3;f.run();assert.equal(f.hits().length,n+1);f.topic.status='archived';f.run();assert(f.checks().every(c=>c.status==='unknown'));
}));
test('all and any retain three-valued logic, and unknown definitions never become successful empty conjunctions',()=>using(f=>{
 const evaluate=()=>evaluateResearchCondition(f.s,f.a,'entryCondition',{at,quote:()=>null,check:()=>null});
 f.a.monitoring.entryCondition=group([{type:'price',interval:'1m',operator:'gte',value:100},{type:'at',at:'2026-10-02T06:01:00Z'}]);assert.equal(evaluate().state,'false');f.a.monitoring.entryCondition.join='any';assert.equal(evaluate().state,'unknown');f.a.monitoring.entryCondition.conditions[1].at=at;assert.equal(evaluate().state,'true');f.a.monitoring.entryCondition.join='all';assert.equal(evaluate().state,'unknown');
 f.a.monitoring.entryCondition={status:'unknown',reason:'Business evidence unavailable',join:'all',conditions:[]};assert.equal(evaluate().state,'unknown');
}));
test('single and composite identities remain separate; new saved versions retire old checks without losing historical triggers',()=>using(f=>{
 f.subjects.push({...structuredClone(f.s),kind:'event-cluster'});f.price(105);f.run();assert.equal(f.hits().length,2);assert.equal(new Set(f.hits().map(h=>h.id)).size,2);assert.equal(f.hits().filter(h=>h.topicId===null).length,1);
 f.s.runId='replacement-run';f.s.version=2;f.run();assert.equal(f.hits().length,3);assert.equal(f.checks().length,8);assert(f.store.db.prepare("SELECT count(*) n FROM research_observation_states WHERE json_extract(payload,'$.status')='retired'").get().n===4);
}));
test('checks and history roll back together on write failure; restore lock and clock rollback preserve them',()=>using(f=>{
 f.price(105);f.store.db.exec("CREATE TEMP TRIGGER fail_research_observation BEFORE INSERT ON observation_todos WHEN json_extract(NEW.payload,'$.kind')='research-condition' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.throws(f.run,/synthetic failure/);assert.equal(f.checks().length,0);f.store.db.exec('DROP TRIGGER fail_research_observation');f.run();const snapshot=f.checks();
 f.clock('2026-10-02T05:59:00Z');assert.throws(f.run,/时间无效/);assert.deepEqual(f.checks(),snapshot);f.clock(at);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(f.run,/恢复副本/);assert.deepEqual(f.checks(),snapshot);
}));
test('restart retains automatic conditions and trigger deduplication without requiring rearm',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-research-monitor-')),path=join(dir,'test.sqlite');let f=fixture(path);
 try{f.price(105);f.run();const hit=f.hits()[0];f.close();f=fixture(path);f.run();assert.equal(f.hits().length,1);assert.deepEqual(f.hits()[0],hit);}finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
test('read projection exposes pause, failure, stale checks and changed input without writes or a new evaluation',()=>using(f=>{
 f.price(105);f.run();const before=f.store.db.prepare('SELECT total_changes() n').get().n,view=options=>f.inbox.researchChecks([f.topic],{at,operation:{paused:false},...options});
 assert.equal(view()[0].current,true);assert(view({operation:{paused:true}}).every(c=>!c.current&&c.status==='unknown'));assert(view({operation:{outcome:'error'}}).every(c=>!c.current));assert(view({at:'2026-10-02T06:03:00Z'}).every(c=>!c.current));f.topic.version++;assert(view().every(c=>!c.current));assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
}));
test('saved single research enrolls in the real scheduler, manual edits invalidate numeric conditions and model candidates do not enroll',async()=>{
 const f=conditionFixture();try{
  for(const name of Object.keys(f.service.operations().tasks).filter(n=>n!=='observations'))f.service.controlOperation(name,'pause');assert.equal(f.service.snapshot().observationInbox.researchChecks.length,0);
  const t=await f.save(),before=f.service.paper.snapshot();await f.service.runOperation('observations');let checks=f.service.snapshot().observationInbox.researchChecks;assert.equal(checks.length,4);assert(checks.every(c=>c.current),JSON.stringify(checks));assert.equal(checks.find(c=>c.group==='nextCheck').status,'false');
  f.service.research.update(t.id,{version:t.version,nextEvidence:'Synthetic revision'});assert(f.service.snapshot().observationInbox.researchChecks.every(c=>!c.current));await f.service.runOperation('observations');checks=f.service.snapshot().observationInbox.researchChecks;assert.equal(checks.find(c=>c.group==='nextCheck').status,'true');assert.equal(checks.find(c=>c.group==='exitCondition').status,'unknown');assert.deepEqual(f.service.paper.snapshot(),before);assert.equal(f.service.observations.rules.list().length,0);
  f.service.controlOperation('observations','pause');assert(f.service.snapshot().observationInbox.researchChecks.every(c=>!c.current));
 }finally{await f.close();}
});
test('composite conditions bind to the exact saved result and become unknown immediately when source news changes',async()=>{
 const q='NVIDIA proposes an order subject to approval.';
 const f=automatic({sourceReader:async url=>({url,title:'Synthetic NVIDIA',sourceName:'合成',body:q+'合成规则和条件范围，仅为流程测试。'.repeat(45),scope:'extracted-text'}),extractionRunner:p=>{const r=extraction(p);Object.assign(r.decomposition.events[0],{title:'NVIDIA 合成条件',actor:'NVIDIA',quote:q});r.rawOutput=JSON.stringify(r.decomposition);r.trace.outputHash=digest(r.rawOutput);return r;},identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:q,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成匹配'}],scopeNote:'合成',missingEvidence:['核实']}),researchRunner:conditionalDossier,synthesisRunner:conditionalDossier});
 try{const c=await two(f),d=f.queue.synthesis.detail(c.id);await f.service.runOperation('observations');let checks=f.service.snapshot().observationInbox.researchChecks;assert.equal(checks.filter(x=>x.subject.kind==='event-cluster').length,4);assert(checks.every(x=>x.current),JSON.stringify(checks));assert(checks.filter(x=>x.subject.kind==='event-cluster').every(x=>x.subject.runId===d.selected.run.id));const before=f.service.paper.snapshot();
  f.revise(1);checks=f.service.snapshot().observationInbox.researchChecks;assert(checks.filter(x=>x.subject.kind==='event-cluster').every(x=>!x.current));await f.service.runOperation('observations');checks=f.service.snapshot().observationInbox.researchChecks;assert.equal(checks.find(x=>x.subject.kind==='event-cluster'&&x.group==='exitCondition').status,'unknown');const compositeChange=checks.find(x=>x.subject.kind==='event-cluster'&&x.group==='nextCheck');assert.equal(compositeChange.details.results[0].input.currentVersion,undefined);assert.equal(compositeChange.details.results[0].input.baselineSynthesisVersion,1);assert.deepEqual(f.service.paper.snapshot(),before);assert.equal(f.synthesisCalls,1);
 }finally{await f.close();}
});

test('unavailable saved composite inputs preserve active history and expose unknown instead of retiring a risk',()=>using(f=>{
 f.price(105);f.run();const hit=f.hits()[0];f.s.ready=false;f.s.assessments=[];f.run();const c=f.checks().find(x=>x.group==='entryCondition');assert.equal(c.status,'unknown');assert.equal(c.active,true);assert.equal(c.lastTodoId,hit.id);assert.equal(f.inbox.researchChecks([],{at,operation:{paused:false}}).length,4);
}));
test('damaged saved model provenance stays unknown and cannot fabricate a trigger',async()=>{
 const f=conditionFixture();try{const t=await f.save(),id=t.dossier.companyAssessment.sourceModelRunId;const row=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(id),run=JSON.parse(row.payload);run.candidate.companyAssessments[0].monitoring.entryCondition.conditions[0].value=999;f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(run),id);await f.service.runOperation('observations');assert(f.service.snapshot().observationInbox.researchChecks.every(c=>c.status==='unknown'));assert.equal(f.service.observations.snapshot().items.filter(h=>h.kind==='research-condition').length,0);
 }finally{await f.close();}
});

test('a future-dated saved result is unknown even when the observed price would match',()=>using(f=>{f.s.preparedAt='2026-10-03T06:00:00Z';f.price(105);f.run();assert(f.checks().every(c=>c.status==='unknown'));assert.equal(f.hits().length,0);}));
