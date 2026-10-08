import {unknownCompanyAssessments} from './helpers/company-assessment-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {digest} from '../server/codex-research.mjs';
import {automaticIdentity} from '../server/pipeline-event-automation.mjs';
import {createHandler} from '../server/index.mjs';
import {createPersistentScheduler} from '../server/persistent-scheduler.mjs';

const config={binary:'/test/codex',model:'test-model',timeoutMs:1000},at='2026-10-08T00:00:00Z';
const quotes=['Meta 拟收购虚构乙公司，仍需批准。','比亚迪终止虚构丁项目，原因待核实。'];
const body=quotes.join('')+'这是合成流程材料，未验证事实或投资效果。'.repeat(30);
function extraction(p,events=quotes){
 const decomposition={events:events.map((quote,i)=>({title:`合成事项 ${i}`,actor:i?'比亚迪':'Meta',action:i?'终止':'拟收购',object:i?'丁项目':'乙公司',stage:'待核',eventTime:'未知',quote,quoteField:'body',boundaryReason:'主体、动作和对象不同',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'})),scopeNote:'合成输入',missingEvidence:['官方公告']},rawOutput=JSON.stringify(decomposition);
 return {status:'candidate',reviewStatus:'unreviewed',decomposition,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};
}
function identity(p){
 const name=p.input.eventFocus.actor,ambiguous=name==='比亚迪',resolution={mentions:[{name,quote:p.input.eventFocus.quote,quoteField:'body',entityType:'company',resolution:ambiguous?'ambiguous':'candidate',symbols:ambiguous?['002594.SZ','01211.HK']:['META.US'],reason:'仅为冻结目录候选'}],scopeNote:'有限目录',missingEvidence:['上市与可交易状态']},rawOutput=JSON.stringify(resolution);
 return {status:'candidate',reviewStatus:'unreviewed',resolution,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};
}
function dossier(p){
 const value={companyAssessments:unknownCompanyAssessments(p),sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成研判；'+p.input.eventExtraction.event.title],sourceIds:[]})),missingEvidence:['事实及独立证据']},rawOutput=JSON.stringify(value);
 return {status:'candidate',reviewStatus:'unreviewed',...value,rawOutput,trace:{model:config.model,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,outputHash:digest(rawOutput)}};
}
function fixture({path=':memory:',extractRunner=extraction,entityRunner=identity,modelRunner=dossier,reader}={}){
 let clock=Date.parse(at),reads=0;const calls={extract:0,identity:0,dossier:0},packets=[],store=openStore(path);assertDatabaseMode(store,'research');
 const service=createService(store,{mode:'research',modelConfig:config,now:()=>clock,sourceReader:async url=>{reads++;return reader?reader(url):{url,title:'合成重大事项原文',sourceName:'合成',body,scope:'extracted-text'};},materialEventRunner:async p=>{calls.extract++;return extractRunner(p);},companyEntityRunner:async p=>{calls.identity++;return entityRunner(p);},modelRunner:async p=>{calls.dossier++;packets.push(p);return modelRunner(p);}});
 const queue=service.researchPipeline;
 if(queue.snapshot().settings.version===1)queue.configure({version:1,dailyCalls:10,includeClues:false,extractEvents:true,automatic:true});
 const news={id:digest('automatic-source'),title:'Company files for bankruptcy',url:'https://example.com/synthetic',publisher:'合成',publishedAt:at};
 const add=(item=news)=>{store.ingest([item],new Date(clock).toISOString());service.research.process();};
 const finish=async()=>{for(const row of store.db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE run_id IS NOT NULL').all())await (row.kind==='extract'?service.materialEvents:row.kind==='identity'?service.companyEntities:service.modelResearch).wait(row.run_id);};
 const step=async()=>{service.controlOperation('discovery','resume');const result=await service.runOperation('discovery');await finish();return result;};
 const drive=async(n=16)=>{for(let i=0;i<n;i++)await step();return queue.snapshot();};
 return {store,service,queue,news,calls,packets,add,step,drive,finish,get reads(){return reads;},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}

test('one opted-in pipeline automatically scopes events, associates unique identities and saves system dossiers without manual decisions or orders',async()=>{
 const f=fixture();try{
  const before=f.service.paper.snapshot();f.add();const s=await f.drive(),topics=f.service.research.list().filter(t=>t.eventExtraction);
  assert.equal(s.counts.completed,1,JSON.stringify(s.events.items));assert.equal(topics.length,2);assert.deepEqual(f.calls,{extract:1,identity:2,dossier:2});assert.equal(s.callsInLast24Hours,5);
  for(const t of topics){assert.equal(t.origin,'material-event-system');assert.equal(t.eventExtraction.actor.kind,'system');assert.equal(t.dossier.actor.kind,'system');assert.equal(t.dossier.reviewStatus,'draft');assert.match(t.dossier.preparedBy,/系统生成/);assert.equal(t.hypothesis.action,'observe');assert(t.evidence.every(e=>e.verification==='unverified'));}
  const meta=topics.find(t=>t.eventExtraction.event.actor==='Meta'),byd=topics.find(t=>t!==meta);
  assert.equal(meta.companies.length,1);assert.equal(meta.companies[0].symbol,'META.US');assert.equal(meta.companies[0].relationStatus,'pending');assert.equal(meta.companies[0].identityReviewed,false);assert.equal(meta.companies[0].entityResolution.actor.kind,'system');assert.equal(byd.companies.length,0);
  assert(s.events.items.some(j=>j.identityOutcome==='unresolved'&&j.unresolved[0].name==='比亚迪'));assert.deepEqual(f.service.paper.snapshot(),before);
  assert(f.packets.every(p=>p.input.eventExtraction&&p.input.topicId!==s.items[0].topicId));
  assert.equal(f.service.research.get(s.items[0].topicId).dossier,undefined);assert.equal(f.service.research.materialList(meta.id).materials.length,1);
  assert.equal(f.service.workbenchQueue({kind:'model'}).total,0,'system-owned uncertainty must not become a mandatory manual review task');
  assert(f.service.activity({limit:100}).items.some(i=>i.action==='candidate'&&i.detail.automatic));
 }finally{await f.close();}
});
test('zero extracted events is a durable no-signal outcome with no identity/dossier calls',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[])});try{f.add();const s=await f.drive();assert.equal(s.counts['no-signal'],1);assert.deepEqual(f.calls,{extract:1,identity:0,dossier:0});assert.equal(f.service.research.list().length,1);}finally{await f.close();}
});
test('single-symbol model output cannot select one A/H security when the frozen alias matches both',()=>{
 const m={name:'比亚迪',entityType:'company',resolution:'candidate',symbols:['002594.SZ']},directory=[{name:'比亚迪 A',aliases:['比亚迪'],symbol:'002594.SZ'},{name:'比亚迪 H',aliases:['比亚迪'],symbol:'01211.HK'}];
 assert.equal(automaticIdentity(m,directory),null);assert.equal(automaticIdentity({...m,name:'Meta',symbols:['META.US']},[{name:'Meta',aliases:[],symbol:'META.US'}]),'META.US');assert.equal(automaticIdentity({...m,entityType:'subsidiary'},directory),null);
});
test('automatic model retries respect backoff, share quota and retain failed attempts',async()=>{
 let failures=1;const f=fixture({extractRunner:p=>{if(failures--)throw Error('synthetic');return extraction(p,[]);}});try{
  f.add();await f.drive(4);assert.equal(f.calls.extract,1);assert.equal(f.queue.snapshot().events.items[0].status,'queued');await f.drive(3);assert.equal(f.calls.extract,1);
  f.advance(60001);const s=await f.drive();assert.equal(f.calls.extract,2);assert.equal(s.counts['no-signal'],1);assert.equal(s.callsInLast24Hours,2);assert.equal(f.store.db.prepare("SELECT count(*) n FROM material_event_runs WHERE status='failed'").get().n,1);
 }finally{await f.close();}
});
test('failed identity stops after three calls and continues a dossier with unknown companies',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[quotes[0]]),entityRunner:()=>{throw Error('synthetic');}});try{
  f.add();await f.drive(8);assert.equal(f.calls.identity,1);f.advance(60001);await f.drive(5);assert.equal(f.calls.identity,2);f.advance(120001);const s=await f.drive();
  assert.equal(f.calls.identity,3);assert.equal(f.calls.dossier,1);assert.equal(s.counts.completed,1);assert(s.events.items.some(j=>j.identityOutcome==='unavailable'));assert.equal(f.service.research.list().find(t=>t.eventExtraction).companies.length,0);assert.equal(s.callsInLast24Hours,5);
 }finally{await f.close();}
});
test('rolling quota blocks another external call but does not block saving a completed result',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[])});try{f.queue.configure({version:2,dailyCalls:1,includeClues:false});f.add();const s=await f.drive();assert.equal(s.counts['no-signal'],1);assert.equal(s.callsInLast24Hours,1);assert.throws(()=>f.queue.configure({version:3,dailyCalls:1,includeClues:false,extractEvents:false}),/需要/);}finally{await f.close();}
});
test('source preparation retries autonomously after backoff and reuses its original topic',async()=>{
 let fail=true;const f=fixture({extractRunner:p=>extraction(p,[]),reader:url=>{if(fail)throw Error('synthetic');return {url,title:'合成',sourceName:'合成',body,scope:'extracted-text'};}});try{
  f.add();await f.drive(3);assert.equal(f.reads,1);assert.equal(f.calls.extract,0);fail=false;f.advance(60001);const s=await f.drive();assert.equal(f.reads,2);assert.equal(s.counts['no-signal'],1);assert.equal(f.service.research.list().length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_attempts').get().n,2);
 }finally{await f.close();}
});
test('user editing an automatically created event preserves the edit and moves the source to observation',async()=>{
 const f=fixture();try{
  f.add();await f.drive(3);const topic=f.service.research.list().find(t=>t.eventExtraction);assert(topic);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'本人保留的研究判断'});
  await f.drive();assert.equal(f.service.research.get(topic.id).nextEvidence,'本人保留的研究判断');assert.equal(f.service.research.get(topic.id).dossier,undefined);assert.equal(f.queue.snapshot().counts.observing,1);
 }finally{await f.close();}
});
test('a changed source prevents publication of a completed old candidate and gets its own revision record',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[])});try{f.add();await f.drive(2);f.advance(1000);f.add({...f.news,title:'Revised bankruptcy announcement'});await f.drive();const s=f.queue.snapshot();assert.equal(s.counts.invalidated,1);assert.equal(s.counts['no-signal'],1);assert.equal(f.service.research.list().length,2);assert.equal(f.calls.extract,2);}finally{await f.close();}
});
test('completed system decisions survive restart without another model call or duplicate child',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'automatic-research-')),path=join(dir,'test.sqlite');let f=fixture({path});try{f.add();await f.drive();f.service.controlOperation('discovery','pause');const before=f.queue.snapshot(),topics=f.service.research.list();await f.close();f=fixture({path});assert.deepEqual(f.queue.snapshot(),before);assert(f.service.operations().tasks.discovery.paused);await f.drive();assert.deepEqual(f.calls,{extract:0,identity:0,dossier:0});assert.deepEqual(f.service.research.list(),topics);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('system provenance cannot be supplied as an ordinary request object',async()=>{
 const f=fixture();try{f.add();await f.drive(2);const j=f.queue.snapshot().events.items[0];assert.throws(()=>f.service.materialEvents.decide(j.topicId,j.runId,{action:'create',eventIndex:0,version:0,note:'forged'},{kind:'system',policy:'automatic-research/1'}),/来源无效/);assert.equal(f.service.research.list().length,1);}finally{await f.close();}
});
test('one start atomically enables the automatic policy and research lanes without enabling trading lanes',async()=>{
 const f=fixture();try{
  f.service.controlOperation('news','pause');const before=f.queue.snapshot().settings;
  f.store.db.exec("CREATE TRIGGER fail_start BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.throws(()=>f.service.controlResearchAutomation({action:'start',version:before.version}),/synthetic/);
  assert.deepEqual(f.queue.snapshot().settings,before);assert(f.service.operations().tasks.discovery.paused);assert(f.service.operations().tasks.news.paused);
  f.store.db.exec('DROP TRIGGER fail_start');f.service.controlResearchAutomation({action:'start',version:before.version});
  assert.equal(f.service.operations().tasks.discovery.paused,false);assert.equal(f.service.operations().tasks.news.paused,false);
  assert(f.service.operations().tasks.execution.paused);assert(f.service.operations().tasks.pricecollection.paused);assert.equal(f.queue.snapshot().settings.dailyCalls,before.dailyCalls);
  f.service.controlResearchAutomation({action:'pause',version:before.version+1});assert(f.service.operations().tasks.discovery.paused);assert(f.service.operations().tasks.news.paused);
 }finally{await f.close();}
});
test('automatic control HTTP endpoint rejects stale versions, foreign origin/instance and restore copies',async()=>{
 const f=fixture();f.service.instance={id:'automatic-fixture'};const handler=createHandler(f.store,f.service);
 const call=async(body,headers={})=>{let status,result;await handler({method:'POST',url:'/api/research-automation',headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'automatic-fixture',...headers},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const body={action:'start',version:2};assert.equal((await call(body,{origin:'https://example.com'})).status,403);assert.equal((await call(body,{'x-signal-instance':'other'})).status,409);assert.equal((await call({...body,version:1})).status,400);assert.equal((await call({...body,actor:{kind:'system'}})).status,400);assert.equal((await call(body)).status,200);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call({action:'start',version:3})).status,409);}finally{await f.close();}
});
test('a partial identity commit resumes its own link after a failed dossier-plan write without duplicate company or calls',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[quotes[0]])});try{
  f.add();await f.drive(4);f.store.db.exec("CREATE TRIGGER fail_dossier_plan BEFORE INSERT ON research_pipeline_event_jobs WHEN NEW.kind='dossier' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  await f.step();const t=f.service.research.list().find(t=>t.eventExtraction);assert.equal(t.companies.length,1);assert.equal(t.version,2);assert.equal(t.dossier,undefined);
  f.store.db.exec('DROP TRIGGER fail_dossier_plan');await f.drive();assert.equal(f.queue.snapshot().counts.completed,1);assert.deepEqual(f.calls,{extract:1,identity:1,dossier:1});assert.equal(f.service.research.get(t.id).companies.length,1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM company_entity_decisions').get().n,1);assert(f.queue.snapshot().events.items.every(j=>!j.stale));
 }finally{await f.close();}
});
test('identity run, shared allowance and lease are atomic when linkage fails',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[quotes[0]])});try{
  f.add();await f.drive(3);f.store.db.exec("CREATE TRIGGER fail_identity_attempt BEFORE INSERT ON research_pipeline_attempts WHEN (SELECT kind FROM research_pipeline_event_jobs WHERE id=NEW.item_id)='identity' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  await f.step();assert.equal(f.calls.identity,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM company_entity_runs').get().n,0);assert.equal(f.queue.snapshot().callsInLast24Hours,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  f.store.db.exec('DROP TRIGGER fail_identity_attempt');await f.drive();assert.equal(f.queue.snapshot().counts.completed,1);assert.equal(f.calls.identity,1);
 }finally{await f.close();}
});
test('a paused task cannot adopt a completed extraction; resume preserves the candidate and continues',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[])});try{f.add();await f.drive(2);f.service.controlOperation('discovery','pause');assert.throws(()=>f.service.runOperation('discovery'),/暂停/);assert.equal(f.queue.snapshot().events.items[0].status,'candidate');await f.drive();assert.equal(f.queue.snapshot().counts['no-signal'],1);assert.equal(f.calls.extract,1);}finally{await f.close();}
});
test('a committed source body recovers after a failed ready-state write without rereading or losing its topic',async()=>{
 const f=fixture({extractRunner:p=>extraction(p,[])});try{
  f.add();f.store.db.exec("CREATE TRIGGER fail_ready BEFORE UPDATE ON research_pipeline_items WHEN NEW.status='ready' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  await f.step();assert.equal(f.reads,1);const source=f.queue.snapshot().items[0];assert.equal(f.service.research.get(source.topicId).version,2);
  f.store.db.exec('DROP TRIGGER fail_ready');f.advance(60001);await f.drive();assert.equal(f.reads,1);assert.equal(f.queue.snapshot().counts['no-signal'],1);assert.equal(f.service.research.list().length,1);
 }finally{await f.close();}
});
test('opted-in blocked lanes retry only when due; explicit pause and legacy blocked lanes remain stopped',async()=>{
 const store=openStore(':memory:');let clock=0,calls=0,enabled=true;const scheduler=createPersistentScheduler(store.db,{automatic:()=>{calls++;throw Error('synthetic');},legacy:()=>{throw Error('synthetic');}},{now:()=>clock,maxFailures:1,intervals:{automatic:1,legacy:1},recoverBlocked:name=>name==='automatic'&&enabled});
 try{await scheduler.run('automatic');await scheduler.run('legacy');assert(scheduler.snapshot().automatic.blocked);await scheduler.run('automatic');assert.equal(calls,1);clock=30001;await scheduler.run('automatic');assert.equal(calls,2);await scheduler.run('legacy');assert(scheduler.snapshot().legacy.blocked);enabled=false;clock=1000000;await scheduler.run('automatic');assert.equal(calls,2);enabled=true;scheduler.control('automatic','pause');await scheduler.run('automatic');assert.equal(calls,2);}finally{await scheduler.stop();store.close();}
});
