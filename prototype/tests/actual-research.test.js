import test from 'node:test';
import assert from 'node:assert/strict';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {projectActualResearch} from '../server/actual-research.mjs';
import {Readable} from 'node:stream';
import {createHandler} from '../server/index.mjs';

const account='Synthetic actual research',symbol='NVDA.US';
const position=f=>f.service.snapshot().overview.accounts.find(a=>a.kind==='actual')?.positions[0];
const checks=f=>f.service.observations.summary().actualChecks;
const actualHits=f=>f.service.observations.snapshot().items.filter(i=>i.kind==='actual-review');
const save=(f,rows)=>{const h=f.service.actualHoldings.ledger,p=h.preview({rows,confirmOpening:true});assert.equal(p.canApply,true,JSON.stringify(p));return h.apply({id:p.id,hash:p.hash});};
const row=(f,type,extra={})=>({account,currency:'USD',type,externalId:type,at:f.at(),sequence:'0',source:'Synthetic recorded statement; no real trade',...extra});
function record(f,t,{ledger=true}={}){
 if(ledger)save(f,[row(f,'opening',{amount:'10000',costMethod:'average'}),row(f,'buy',{symbol,quantity:'10',amount:'1000',fees:'1',sequence:'1',topicId:t.id,topicVersion:t.version})]);
 else{const h=f.service.actualHoldings,p=h.preview({rows:[{account,symbol,quantity:'10',unitCost:'100.1',price:'999',feeBasis:'included',asOf:f.at(),source:'Synthetic snapshot',topicId:t.id,topicVersion:t.version}]});assert(p.canApply,JSON.stringify(p));h.apply({id:p.id,hash:p.hash});}
 f.service.syncWatches();
}
const books=f=>JSON.stringify([f.service.paper.snapshot(),...Object.values(f.service.marketSimulations).map(m=>m.snapshot().orders)]);
test('actual current judgement uses saved system research, preserves the original version and updates without touching ledgers or orders',async()=>{
 const f=await marketResearchFixture();try{
  record(f,f.topic);await f.observe();const old=f.service.actualHoldings.snapshot(),before=books(f);
  f.tick();await f.save('exit');const n=f.store.db.prepare('SELECT total_changes() n').get().n,p=position(f);
  assert.equal(p.actualResearch.link.status,'current');assert.equal(p.currentBinding.kind,'research');assert.equal(p.openingVersion,old.records[0].topicVersion);assert(p.currentVersion>p.openingVersion);
  assert.match(p.judgement,/退出/);assert.equal(p.actualResearch.exitAdvice.state,'review');assert.equal(p.actualResearch.exitAdvice.quantity,null);assert.equal(p.actualResearch.exitAdvice.limitPrice,null);assert.equal(p.actualResearch.exitAdvice.executable,false);
  assert.equal(p.monitoring.state,'checked');assert(p.risks.some(r=>r.includes('退出条件')));assert.equal(p.referenceValuation.state,'unavailable');assert.equal(p.price,null);
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,n);assert.deepEqual(f.service.actualHoldings.snapshot(),old);assert.equal(books(f),before);
  const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179'}});let status,payload;await createHandler(f.store,f.service)(req,{writeHead:s=>status=s,end:b=>payload=JSON.parse(b)});assert.equal(status,200);assert.deepEqual(payload.overview.accounts.find(a=>a.kind==='actual').positions[0].actualResearch,p.actualResearch);assert.equal(payload.overview.decisions.filter(d=>d.account.startsWith('actual:')).length,0);
  assert(actualHits(f).some(h=>h.input.reviewKind==='research-exit-advice'&&h.input.metrics.action.subject.runId===p.currentBinding.runId));
  save(f,[row(f,'sell',{sequence:'2',quantity:'2',symbol,amount:'200',fees:'0'})]);assert.equal(position(f).actualResearch.exitAdvice.state,'waiting');await f.observe();assert.equal(position(f).actualResearch.exitAdvice.state,'review');assert.equal(position(f).qty,'8');
 }finally{await f.close();}
});
test('snapshot holdings follow a newly formed composite and original exact research is independently recoverable',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  const t=f.service.research.list().find(t=>t.eventExtraction);record(f,t,{ledger:false});await f.observe();const original=f.service.actualHoldings.snapshot().records[0];
  f.setAction('reduce');await f.addMember(2);const p=position(f);assert.equal(p.actualResearch.link.status,'current',p.actualResearch.link.reason);assert.equal(p.currentBinding.kind,'event-cluster');assert.equal(p.currentBinding.id,f.cluster.id);assert.equal(p.actualResearch.link.links[0].relation.kind,'event-member');assert.equal(p.topicId,t.id);assert.equal(p.currentVersion,f.service.researchPipeline.synthesis.overview(f.cluster.id).version);assert.equal(p.monitoring.state,'checked');assert.equal(p.actualResearch.exitAdvice.state,'review');
  assert.deepEqual(f.service.actualHoldings.snapshot().records[0],original);assert.equal(f.service.research.historyDetail(t.id,p.openingVersion).topic.version,original.topicVersion);assert(!p.risks.some(r=>r.includes('原研究与当前版本不同')));
 }finally{await f.close();}
});
test('source revision invalidates actual guidance immediately; unknown checks retain old triggers and receipts do not clear risk',async()=>{
 const f=await marketResearchFixture({composite:true,initialMembers:1});try{
  record(f,f.service.research.list().find(t=>t.eventExtraction));f.setAction('exit');await f.addMember(2);
  const hit=actualHits(f).find(h=>h.input.reviewKind==='research-exit-advice');assert(hit);const frozen=JSON.stringify(hit.input);f.service.observations.respond(hit.id,{revision:1,action:'complete',note:'Synthetic read, no transaction'});
  f.auto.revise(1);let p=position(f);assert.equal(p.actualResearch.link.status,'waiting');assert.equal(p.actualResearch.exitAdvice.state,'waiting');assert.match(p.judgement,/待更新/);assert.equal(p.monitoring.state,'changed');assert.equal(p.actualResearch.valuation,null);
  await f.observe();assert.equal(checks(f).find(c=>c.reviewKind==='research-exit-advice').status,'unknown');assert.equal(checks(f).find(c=>c.reviewKind==='research-exit-advice').active,true);assert.equal(actualHits(f).filter(h=>h.input.reviewKind==='research-exit-advice').length,1);assert.equal(JSON.stringify(actualHits(f).find(h=>h.id===hit.id).input),frozen);
  await f.auto.drive();await f.observe();p=position(f);assert.equal(p.actualResearch.link.status,'current',p.actualResearch.link.reason);assert.equal(p.actualResearch.link.links[0].relation.kind,'event-succession');assert.equal(p.actualResearch.exitAdvice.state,'review');assert.equal(p.topicId,hit.input.record.topicId);assert.equal(p.costCents,100100);
 }finally{await f.close();}
});
test('several ledger origins may share one verified event, but partial sells never allocate shares to guessed origins',async()=>{
 const f=await marketResearchFixture({composite:true});try{
  const ts=f.service.research.list().filter(t=>t.eventExtraction);assert.equal(ts.length,2);record(f,ts[0]);save(f,[row(f,'buy',{externalId:'second',sequence:'2',symbol,quantity:'5',amount:'500',fees:'1',topicId:ts[1].id,topicVersion:ts[1].version})]);await f.observe();let p=position(f);assert.equal(p.actualResearch.origins.length,2);assert.equal(p.topicId,null);assert.equal(p.actualResearch.link.status,'current');assert.equal(p.currentBinding.kind,'event-cluster');assert.equal(p.monitoring.state,'checked');
  save(f,[row(f,'sell',{sequence:'3',symbol,quantity:'4',amount:'480',fees:'1'})]);assert.equal(position(f).monitoring.state,'changed');await f.observe();p=position(f);assert.equal(p.qty,'11');assert.equal(p.actualResearch.origins.length,2);assert.equal(p.actualResearch.link.status,'current');assert.equal(p.actualResearch.exitAdvice.quantity,null);
 }finally{await f.close();}
});
test('an unbound addition blocks a pooled judgement, and a later complete close retires checks without erasing prior advice',async()=>{
 const f=await marketResearchFixture();try{
  await f.save('exit');record(f,f.topic);await f.observe();const hit=actualHits(f).find(h=>h.input.reviewKind==='research-exit-advice');assert(hit);
  save(f,[row(f,'buy',{externalId:'unbound',sequence:'2',symbol,quantity:'1',amount:'100',fees:'0'})]);let p=position(f);assert.equal(p.actualResearch.link.status,'waiting');assert.match(p.actualResearch.link.reason,/未绑定/);assert.equal(p.currentBinding,null);await f.observe();assert.equal(checks(f).find(c=>c.reviewKind==='research-exit-advice').active,true);
  save(f,[row(f,'sell',{sequence:'3',symbol,quantity:'11',amount:'1100',fees:'1'})]);await f.observe();assert.equal(position(f),undefined);assert.equal(checks(f).length,0);assert(actualHits(f).some(h=>h.id===hit.id));assert.equal(f.service.actualHoldings.ledger.snapshot().entries.length,4);
 }finally{await f.close();}
});
test('paused, stale and expired current research cannot be presented as an actionable exit even if the last condition hit',async()=>{
 const f=await marketResearchFixture();try{
  await f.save('exit');record(f,f.topic);await f.observe();assert.equal(position(f).actualResearch.exitAdvice.state,'review');
  f.service.controlOperation('observations','pause');let p=position(f);assert.equal(p.monitoring.state,'paused');assert.equal(p.actualResearch.exitAdvice.state,'waiting');assert.equal(p.actualResearch.conditions.find(c=>c.key==='exitCondition').status,'unknown');
  f.service.controlOperation('observations','resume');f.tick(121000);p=position(f);assert.equal(p.actualResearch.exitAdvice.state,'waiting');await f.observe();assert.equal(position(f).actualResearch.exitAdvice.state,'review');
  f.tick(6*3600000);p=position(f);assert.match(p.judgement,/历史/);assert.equal(p.actualResearch.exitAdvice.state,'waiting');assert.equal(p.actualResearch.valuation,null);await f.observe();assert(checks(f).some(c=>c.reviewKind==='review-due'&&c.status==='hit'));
 }finally{await f.close();}
});
test('failure while freezing an actual research alert rolls back both research checks and actual checks; retry records one episode',async()=>{
 const f=await marketResearchFixture();try{
  await f.save('exit');record(f,f.topic);const before=f.service.observations.summary(),ledger=f.service.actualHoldings.snapshot();
  f.store.db.exec("CREATE TEMP TRIGGER fail_actual_research BEFORE INSERT ON observation_todos WHEN json_extract(NEW.payload,'$.kind')='actual-review' AND json_extract(NEW.payload,'$.input.reviewKind')='research-exit-advice' BEGIN SELECT RAISE(ABORT,'synthetic actual research failure'); END");
  f.tick();assert.throws(()=>f.service.observations.process(f.service.research.list(),f.service.paper.snapshot()),/synthetic actual research failure/);assert.deepEqual(f.service.observations.summary(),before);assert.deepEqual(f.service.actualHoldings.snapshot(),ledger);
  f.store.db.exec('DROP TRIGGER fail_actual_research');await f.observe();const alerts=actualHits(f).filter(h=>h.input.reviewKind==='research-exit-advice');assert.equal(alerts.length,1);assert.equal(alerts[0].input.episode,1);await f.observe();assert.equal(actualHits(f).filter(h=>h.input.reviewKind==='research-exit-advice').length,1);
 }finally{await f.close();}
});
test('identity, unavailable history and different current subjects block unified guidance instead of borrowing another security',()=>{
 const record={id:'real',version:'ledger-1',symbol,accountingOrigin:'actual-ledger',bindings:[['one',1],['two',1]]},topics=['one','two'].map(id=>({id,title:id,version:1,status:'active',companies:[{symbol}],evidence:[]}));
 const subjects=topics.map(t=>({kind:'research',id:t.id,runId:t.id+'-run',version:1,ready:true,fresh:true,changed:false,current:t,assessments:[]})),ctx={subjects,getTopicVersion:id=>topics.find(t=>t.id===id)};
 let p=projectActualResearch(record,topics,ctx,'2026-10-08T14:00:00Z');assert.equal(p.link.status,'waiting');assert.match(p.link.reason,/不同/);assert.equal(p.currentBinding,null);
 p=projectActualResearch({...record,bindings:[['one',1]]},topics,{...ctx,getTopicVersion:()=>null},'2026-10-08T14:00:00Z');assert.match(p.link.reason,/历史/);assert.equal(p.link.status,'waiting');
 p=projectActualResearch({...record,bindings:[['one',1]],symbol:'09988.HK'},topics,ctx,'2026-10-08T14:00:00Z');assert.equal(p.link.status,'waiting');assert.equal(p.exitAdvice.state,'waiting');
});
test('composite counterevidence is compared with every recorded origin; repeated material is not new but a revision or distinct material is',()=>{
 const e={id:'material:original',materialId:'document-a',materialRevision:1,stance:'against',claim:'Synthetic known risk',verification:'unverified'},t={id:'one',title:'Synthetic origin',version:1,status:'active',companies:[{symbol}],evidence:[e]},record={id:'real',version:1,symbol,topicId:'one',topicVersion:1};
 const cluster={id:'event',version:1,status:'active',health:{current:true},topicIds:['one','two'],history:[]},subject={kind:'event-cluster',id:'event',runId:'run',version:1,ready:true,fresh:true,changed:false,current:{status:'active',companies:[{symbol}],evidence:[{...e,id:'alias-a',originalEvidenceId:e.id,memberTopicId:'one'},{...e,id:'alias-b',originalEvidenceId:e.id,memberTopicId:'two'}]},assessments:[]};
 const ctx={subjects:[subject],holdingClusters:[cluster],getTopicVersion:()=>t};let p=projectActualResearch(record,[t],ctx,'2026-10-08T14:00:00Z');assert.equal(p.link.status,'current');assert.equal(p.against.length,0);
 subject.current.evidence[1].materialRevision=2;p=projectActualResearch(record,[t],ctx,'2026-10-08T14:00:00Z');assert.equal(p.against.length,1);assert.equal(p.against[0].id,'alias-b');
 subject.current.evidence[1]={...subject.current.evidence[1],materialRevision:1,materialId:'different-document'};p=projectActualResearch(record,[t],ctx,'2026-10-08T14:00:00Z');assert.equal(p.against.length,1);
 subject.fresh=false;subject.changed=true;p=projectActualResearch(record,[t],ctx,'2026-10-08T14:00:00Z');assert.equal(p.link.status,'waiting');assert.equal(p.exitAdvice.state,'waiting');
});
