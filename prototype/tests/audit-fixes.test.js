import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {assessTopic,syncResearchWatches} from '../server/workflow.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {classifyHeadline} from '../server/triage.mjs';
import {collectEvaluationSources,buildEvaluationBaseline,digest} from '../server/evaluation-baseline.mjs';
import {EVALUATION_VERSION,forwardEligibility,outcomeLabel} from '../shared/evaluation.mjs';
import {createScheduler,pool} from '../server/scheduler.mjs';
const at='2026-09-25T01:00:00.000Z';
function setup(){const s=openStore(':memory:'),r=openResearch(s,{clock:()=>at}),p=openPaper(s,r,{clock:()=>at});return {s,r,p};}
const reject=p=>{for(const o of p.snapshot().orders.filter(o=>o.status==='pending'))p.decide(o.id,{version:p.snapshot().version,decision:'reject'});};
const proposal=(p,r,patch={})=>({version:p.snapshot().version,topicVersion:r.get('agent-cpu').version,topicId:'agent-cpu',clientId:crypto.randomUUID(),symbol:'AMD.US',side:'buy',qty:100,price:200,limit:205,reason:'Audit hypothesis',invalidation:'Evidence weakens',holdingHorizon:'30 days',...patch});
test('F01 arbitrary reference prices cannot create profit or evade issuer limits; legacy pending mismatch is blocked',()=>{
 const {s,r,p}=setup();try{reject(p);const before=p.snapshot();
 for(const price of [1,199,201])assert.throws(()=>p.propose(proposal(p,r,{qty:10000,price,limit:300})),/估值价/);
 assert.equal(p.snapshot().version,before.version);assert.equal(p.snapshot().nav,1000000);
 p.propose(proposal(p,r));const b=p.snapshot(),o=b.orders.at(-1);p.decide(o.id,{version:b.version,decision:'approve',confirmScenario:true});
 const after=p.snapshot();assert.equal(after.fills.length,1);assert.equal(after.pnl,-30.01);assert.equal(after.positions.find(p=>p.symbol==='AMD.US').valueUSD,100000);
 // Simulate an already-persisted legacy mismatched pending order, never the live account.
 const raw=JSON.parse(s.db.prepare('SELECT payload FROM paper_books').get().payload);raw.orders.push({...o,id:'legacy-bad',clientId:'legacy-bad',price:1,qty:10000,status:'pending'});s.db.prepare('UPDATE paper_books SET payload=?').run(JSON.stringify(raw));
 assert.throws(()=>p.decide('legacy-bad',{version:raw.version,decision:'approve',confirmScenario:true}),/估值价/);assert.equal(p.snapshot().fills.length,1);
 assert.throws(()=>p.propose(proposal(p,r,{symbol:'INTC.US',qty:10,price:35,limit:40})),/旧待批申请/);
 }finally{s.close();}
});
test('F01 cap uses post-cost NAV with pending marked exposure, never pending sale proceeds',()=>{const {s,r,p}=setup();try{reject(p);assert.throws(()=>p.propose(proposal(p,r,{qty:200})),/发行人/);p.propose(proposal(p,r,{qty:199}));const b=p.snapshot();p.decide(b.orders.at(-1).id,{version:b.version,decision:'approve',confirmScenario:true});const a=p.snapshot();assert.ok(a.positions.find(x=>x.symbol==='AMD.US').valueUSD/a.nav*100<=a.params.issuerCapPct);}finally{s.close();}});
test('F02 later news revision has its own availability; old history is enriched without writes',()=>{
 const {s,r}=setup();try{const n={id:'revision-audit',title:'Acme plans acquisition',publisher:'Reuters',url:'https://www.reuters.com/example',publishedAt:'2026-09-24T00:00:00Z'};
 s.ingest([n],'2026-09-24T01:00:00Z');s.ingest([{...n,title:'Acme cancels acquisition'}],'2026-09-25T00:30:00Z');
 let t=r.create({title:'Revision test',summary:'Review source'});const fields={newsId:n.id,newsRevision:2,stance:'against',family:'corporate',step:'fact',interpretation:'Changed stage'};
 t=r.addEvidence(t.id,{version:t.version,...fields});const e=t.evidence.at(-1);assert.equal(e.articleFirstSeen,'2026-09-24T01:00:00Z');assert.equal(e.firstSeen,'2026-09-25T00:30:00Z');assert.equal(e.availableAt,e.firstSeen);
 const changes=s.db.prepare('SELECT total_changes() n').get().n;assert.equal(r.history(t.id)[0].topic.evidence.at(-1).availableAt,e.firstSeen);r.list();assert.equal(s.db.prepare('SELECT total_changes() n').get().n,changes);
 s.ingest([{...n,title:'Another correction'}],'2026-09-25T00:40:00Z');assert.throws(()=>r.addEvidence(t.id,{version:t.version,...fields}),/新闻版本/);assert.equal(r.history(t.id)[0].topic.evidence.at(-1).availableAt,e.firstSeen);
 }finally{s.close();}
});
test('F03 explicit current review clears acknowledged evidence, retains entry version and catches new evidence',()=>{
 const {s,r,p}=setup();try{reject(p);let t=r.get('spotify-access');t=r.update(t.id,{version:t.version,hypothesis:{logic:'New research',reviewAt:''}});
 assert.equal(assessTopic(t,{today:'2026-09-25',book:p.snapshot()}).priorityReason,'持仓出现反向线索');
 assert.throws(()=>p.review({version:p.snapshot().version,symbol:'SPOT.US',topicVersion:1,result:'intact',note:'Stale'}),/研究版本/);
 p.review({version:p.snapshot().version,symbol:'SPOT.US',topicVersion:t.version,result:'intact',note:'Checked all current evidence'});
 assert.equal(p.snapshot().positions.find(x=>x.symbol==='SPOT.US').researchVersion,1);assert.equal(assessTopic(t,{today:'2026-09-25',book:p.snapshot()}).priorityReason,'补证与观察');
 t=r.addEvidence(t.id,{version:t.version,claim:'New contrary rumor',sourceName:'Fixture',stance:'against',family:'constraint',step:t.chain[0].id,interpretation:'New risk'});
 assert.equal(assessTopic(t,{today:'2026-09-25',book:p.snapshot()}).priorityReason,'持仓出现反向线索');
 p.review({version:p.snapshot().version,symbol:'SPOT.US',topicVersion:t.version,result:'verify',note:'Still checking'});assert.equal(assessTopic(t,{book:p.snapshot()}).priorityReason,'持仓出现反向线索');
 }finally{s.close();}
});
test('F03 intact review acknowledges version only until a later research change',()=>{const {s,r,p}=setup();try{reject(p);let t=r.get('agent-cpu');t=r.update(t.id,{version:t.version,hypothesis:{logic:'Version 2',reviewAt:''}});for(const x of p.snapshot().positions.filter(x=>x.topicId===t.id))p.review({version:p.snapshot().version,symbol:x.symbol,topicVersion:t.version,result:'intact',note:'Checked'});assert.notEqual(assessTopic(t,{book:p.snapshot()}).priorityReason,'持仓研究已更新');t=r.update(t.id,{version:t.version,hypothesis:{logic:'Version 3'}});assert.equal(assessTopic(t,{book:p.snapshot()}).priorityReason,'持仓研究已更新');}finally{s.close();}});
test('F04 completion negation and anticipated completion do not become completed events',()=>{
 for(const text of ['Acme has yet to complete acquisition of Beta','Acme did not complete acquisition of Beta','Acme failed to complete acquisition','Acme cannot complete acquisition','Acme acquisition remains incomplete','Acme acquisition completion delayed','公司尚未完成收购','公司未能完成收购'])assert.match(classifyHeadline({title:text}).stage,/尚未完成/,text);
 for(const text of ['Acme expects to complete acquisition','Acme acquisition will be completed in November','公司预计完成收购'])assert.doesNotMatch(classifyHeadline({title:text}).stage,/称已完成/,text);
 assert.match(classifyHeadline({title:'Acme completes acquisition of Beta'}).stage,/称已完成/);
});
test('headline diagnoses cover severe business/accounting clues without inventing Muse ownership',()=>{
 for(const title of ['Acme auditor resigns after discovering fabricated revenue','Acme withdraws financial statements; accounts cannot be relied upon','Acme earnings fall 90% as key customer leaves'])assert.equal(classifyHeadline({title}).bucket,'review');
 assert.equal(classifyHeadline({title:'Muse coffee chain completes acquisition of bakery'}).companies.length,0);
 assert.equal(classifyHeadline({title:'Arm reports record licensing revenue'}).companies[0]?.symbol,'ARM.US');
 assert.equal(classifyHeadline({title:'Arm Holdings signs contract'}).companies[0]?.symbol,'ARM.US');
 assert.equal(classifyHeadline({title:'Doctors repair arm with a chip implant'}).companies.length,0);
});
test('F05 baseline freezes complete core and can replay the classifier independently',async()=>{
 const {s}=setup(),root=fileURLToPath(new URL('../../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'signal-frozen-'));
 try{const b=buildEvaluationBaseline(s.db,root,{frozenAt:at});assert.ok(b.sources['prototype/server/event-routing.mjs']);assert.ok(b.sources['prototype/package-lock.json']);assert.equal(b.rulesHash,digest(JSON.stringify({sources:b.sources,configuration:b.configuration})));
 for(const [path,source] of Object.entries(b.sources)){const file=join(dir,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source.text);}
 const frozen=await import('file://'+join(dir,'prototype/server/triage.mjs'));const title='Acme has yet to complete acquisition';assert.deepEqual(frozen.classifyHeadline({title}),classifyHeadline({title}));
 writeFileSync(join(dir,'prototype/server/event-routing.mjs'),readFileSync(join(dir,'prototype/server/event-routing.mjs'),'utf8')+'\n// Rule change\n');assert.notEqual(digest(JSON.stringify({sources:collectEvaluationSources(dir),configuration:b.configuration})),b.rulesHash);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('F06 newly completed session bypasses young cache while failures back off',async()=>{
 const s=openStore(':memory:');let now=Date.parse('2026-09-24T07:31:00Z'),calls=0;const service=createService(s,{now:()=>now,fetcher:async()=>{calls++;throw new Error('fixture offline');}});
 try{s.saveDaily({symbol:'688008.SH',interval:'1d',receivedAt:'2026-09-24T06:50:00Z',lastDate:'2026-09-23',points:[{date:'2026-09-23',close:100}]});assert.ok((await service.refreshDaily('688008.SH')).error);assert.equal(calls,1);now+=120000;assert.equal((await service.refreshDaily('688008.SH')).skipped,'cooldown');assert.equal(calls,1);assert.equal(s.daily('688008.SH').lastDate,'2026-09-23');}finally{s.close();}
});
const claim=patch=>({kind:'outcome',status:'rumor',claim:'Acme acquisition closes by October',probability:50,basis:'Subjective fixture',impactIfTrue:'Benefit',impactIfFalse:'Loss',horizon:'Month',resolveBy:'2026-10-25',outcome:'open',evidenceIds:[],resolutionReason:'',revisionReason:'Initial',...patch});
test('F07 changing question kind or deadline cannot inherit an earlier forecast; compatibility endpoint cannot bypass',()=>{
 const {s,r}=setup();try{let t=r.create({title:'Fixed prediction',summary:'Test only'});t=r.saveClaim(t.id,{version:t.version,claim:claim()});const original=t.claims[0];
 for(const patch of [{claim:'Different question'},{kind:'earnings'},{resolveBy:'2027-10-25'}])assert.throws(()=>r.saveClaim(t.id,{version:t.version,claim:claim({id:original.id,...patch})}),/冻结/);
 assert.throws(()=>r.update(t.id,{version:t.version,assessment:{}}),/多主张/);
 t=r.saveClaim(t.id,{version:t.version,claim:claim({id:original.id,probability:70,revisionReason:'New independent report'})});assert.equal(t.claims[0].firstProbability,50);
 t=r.saveClaim(t.id,{version:t.version,claim:claim({claim:'Different question',probability:20})});assert.equal(t.claims[1].firstProbability,20);assert.notEqual(t.claims[0].id,t.claims[1].id);
 }finally{s.close();}
});
test('F08 invalid or out-of-order evaluation timestamps cannot be admitted',()=>{
 const b={protocolVersion:EVALUATION_VERSION,forwardStart:'2026-09-26T00:00:00+08:00',frozenAt:at,excludedTopicIds:[],excludedClusterIds:[],rulesHash:'fixed'},record={topicId:'new',clusterId:'new',clusterReviewedAt:'2026-09-26T01:05Z',origin:'forward-capture',firstSeen:'2026-09-26T01:00Z',availableAt:'2026-09-26T01:00Z',decisionAt:'2026-09-26T01:10Z',inputHash:'snapshot',rulesHash:'fixed'};
 assert.equal(forwardEligibility(record,b).eligible,true);
 for(const frozenAt of [null,'not-a-date','2026-02-31T00:00Z','2026-09-27T00:00Z'])assert.equal(forwardEligibility(record,{...b,frozenAt}).eligible,false);
 assert.equal(forwardEligibility({...record,availableAt:'2026-09-25T00:00Z'},b).eligible,false);
 const c={outcome:'true',evidenceIds:['e'],resolutionReason:'Source reviewed',resolvedAt:at};assert.equal(outcomeLabel(c,{now:at}).mature,true);
 for(const resolvedAt of ['not-a-date','2026-02-31T00:00Z','2026-10-01T00:00Z'])assert.equal(outcomeLabel({...c,resolvedAt},{now:at}).mature,false);
 assert.equal(outcomeLabel({...c,firstAssessedAt:'2026-09-26T00:00Z'},{now:at}).mature,false);
 assert.equal(outcomeLabel({...c,resolutionReason:42},{now:at}).mature,false);
 assert.equal(outcomeLabel({...c,evidenceIds:'not-an-array'},{now:at}).mature,false);
});
test('F09 scheduler distinguishes error partial skipped and recovery; batch does not abandon later items',async()=>{
 let result={error:'Provider failed'};const scheduler=createScheduler({news:async()=>result});await scheduler.run();assert.equal(scheduler.snapshot().news.outcome,'error');assert.equal(scheduler.snapshot().news.error,'Provider failed');
 result=await pool([1,2,3],1,async n=>{if(n===1)throw new Error('One failed');return n===2?{ok:true}:{skipped:'cooldown'};});await scheduler.run();assert.equal(scheduler.snapshot().news.outcome,'partial');assert.equal(scheduler.snapshot().news.failed,1);assert.equal(scheduler.snapshot().news.succeeded,1);
 result={skipped:'cooldown'};await scheduler.run();assert.equal(scheduler.snapshot().news.outcome,'skipped');result={ok:true};await scheduler.run();assert.equal(scheduler.snapshot().news.error,null);assert.equal(scheduler.snapshot().news.outcome,'ok');
});
test('news to event HTTP flow freezes source, avoids duplicate topics and respects rumor and unknown identity',async()=>{
 const {s}=setup(),service=createService(s,{now:()=>Date.parse(at)}),handler=createHandler(s,service);const news={id:'unfamiliar-event',title:'Acme reportedly completes acquisition of Beta',publisher:'Reuters',url:'https://www.reuters.com/example',publishedAt:at};s.ingest([news],at);
 const call=async data=>{let status,result;await handler({method:'POST',url:'/api/research/from-news',headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:v=>status=v,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const before=service.paper.snapshot();let response=await call({newsId:news.id,newsRevision:1});assert.equal(response.status,200);const id=response.result.createdTopicId,t=service.research.get(id);assert.equal(t.origin,'news-candidate');assert.equal(t.messageStatus,'rumor');assert.equal(t.companies.length,0);assert.equal(t.hypothesis.action,'observe');assert.equal(t.evidence[0].verification,'unverified');assert.equal(t.evidence[0].availableAt,at);
 response=await call({newsId:news.id,newsRevision:1});assert.equal(response.result.createdTopicId,id);assert.equal(service.research.history(id).length,1);
 const next=service.research.update(id,{version:1,nextEvidence:'Check announcement tomorrow'});assert.match(service.research.list().find(t=>t.id===id).changeSummary.items.join(''),/观察点/);assert.equal(next.nextEvidence,'Check announcement tomorrow');
 s.ingest([{...news,title:'Acme denies acquisition'}],'2026-09-25T02:00:00Z');assert.equal((await call({newsId:news.id,newsRevision:1})).status,400);assert.deepEqual(service.paper.snapshot(),before);
 s.ingest([{...news,id:'known-entity',title:'Nvidia announces major supply contract'}],at);const known=service.research.createFromNews({newsId:'known-entity',newsRevision:1});syncResearchWatches(s,service.research.list());assert.ok(s.watchlist().some(w=>w.symbol==='NVDA.US'));assert.ok(known.companies[0].note.includes('待核验'));assert.equal(service.paper.snapshot().fills.length,0);
 }finally{s.close();}
});

test('isolated local ports retain host and origin restrictions',async()=>{
 const {s}=setup(),service=createService(s),handler=createHandler(s,service,{apiPort:4189,frontendPort:4188});
 try{for(const [origin,expected] of [['http://127.0.0.1:4188',200],['https://external.example',403],['http://127.0.0.1:4178',403]]){let status;await handler({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4189',origin}},{writeHead:v=>status=v,end:()=>{}});assert.equal(status,expected);}
 assert.throws(()=>createHandler(s,service,{apiPort:NaN}),/端口/);
 }finally{s.close();}
});
