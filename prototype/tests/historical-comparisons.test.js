import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';import {createService} from '../server/service.mjs';import {createHandler} from '../server/index.mjs';import {openMaterials} from '../server/research-materials.mjs';import {digest} from '../server/codex-research.mjs';import {historicalComparisonPair} from '../server/historical-comparisons.mjs';
const at='2026-10-04T00:00:00Z',config={binary:'/test/codex',model:'synthetic-test',timeoutMs:1000};
function output(packet){const comparison={relation:'analogy',reason:'合成测试：不同主体的药物审批，仅核对数据流。',missingEvidence:['需独立核对机制和全文'],...Object.fromEntries(['left','right'].map(side=>[side,{actor:'未知',action:'批准',object:'药物',eventTime:'未知',stage:'未知',quote:packet.input[side].body||packet.input[side].title,...(packet.schema==='event-pair-material-1'?{quoteField:packet.input[side].body?'body':'title'}:{}),timeEvidence:{basis:'unknown',quote:'',quoteField:'none'}}]))};return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput:JSON.stringify(comparison),trace:{model:config.model,inputHash:packet.inputHash,outputHash:digest(JSON.stringify(comparison))}};}
function fixture({body=false,runner,missed}={}){
 const store=openStore(':memory:');let calls=0;const service=createService(store,{mode:'research',now:()=>Date.parse(at),modelConfig:config,semanticRunner:async(...args)=>{calls++;return runner?runner(...args):output(args[0]);}}),materials=openMaterials(store.db,{clock:()=>at});
 const save=(key,text,date)=>{const p=materials.prepare('fixture',{title:'合成公告',body:text,publishedAt:date,sourceName:'测试来源',scope:'excerpt',url:'https://example.invalid/'+key},'manual');p.persist();return p.material;};
 let anchor,old;
 if(body){old=save('old','诺和诺德治疗肥胖的药物获批。','2020-01-01');anchor=save('anchor','FDA approves Eli Lilly obesity drug.','2026-10-01');}
 else {old={id:digest('old'),title:'FDA approves obesity therapy',url:'https://example.invalid/old',publishedAt:'2020-01-01'};anchor={id:digest('anchor'),title:'FDA approves obesity treatment',url:'https://example.invalid/anchor',publishedAt:'2026-10-01'};store.ingest([old,anchor],at);}
 if(missed){const text=missed==='no_context'?'Helios acquisition confirmed.':'Routine bulletin without event details.';if(body){old=save('old',text,'2020-01-01');anchor=save('anchor','Orion acquisition announced.','2026-10-01');}else{old={...old,title:text};anchor={...anchor,title:'Orion acquisition announced.'};store.ingest([old,anchor],at);}}
 const report=service.historicalRecall.freeze((body?'material:':'')+anchor.id,{revision:missed?2:1,requestId:randomUUID()}),candidateId=(body?'material:':'')+old.id;
 assert.equal(report.rows.find(r=>r.newsId===candidateId).status,missed||'candidate');
 return {store,service,save,anchor,old,report,candidateId,calls:()=>calls,request:()=>({candidateId,reportHash:report.hash,requestId:randomUUID()}),async close(){await service.close();store.close();}};
}
for(const body of [false,true])test(`history ${body?'body':'title'} comparison binds frozen sources, retries once and preserves reports and research`,async()=>{
 const f=fixture({body});try{
  const before={report:f.service.historicalRecall.byId(f.report.id),research:f.service.research.list(),paper:f.service.paper.snapshot()},req=f.request(),started=f.service.historicalComparisons.start(f.report.id,req);
  assert.equal(f.service.historicalComparisons.start(f.report.id,req).id,started.id);const run=await f.service.semanticEvents.wait(started.id);assert.equal(run.status,'candidate');assert.equal(f.calls(),1);
  const list=f.service.historicalComparisons.list(f.report.id,f.candidateId);assert.equal(list.total,1);assert.equal(list.runs[0].id,started.id);assert.equal(list.runs[0].right.body,undefined);assert.equal(run.packet.input.right.body,body?f.old.body:undefined);
  const binding=JSON.parse(f.store.db.prepare('SELECT payload FROM historical_comparison_runs').get().payload);assert.equal(binding.reportHash,f.report.hash);assert.equal(binding.inputHash,run.packet.inputHash);
  assert.throws(()=>f.service.historicalComparisons.start(f.report.id,{...req,candidateId:f.report.anchor.id}));
  f.service.semanticEvents.decide(run.id,{version:0,action:'accept',note:'合成测试人工核对'});assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).runs[0].active,true);assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).runs[0].decision.action,'accept');
  assert.deepEqual({report:f.service.historicalRecall.byId(f.report.id),research:f.service.research.list(),paper:f.service.paper.snapshot()},before);
  if(body)f.save('old','A changed FDA approval for obesity drug.','2020-01-01');else f.store.ingest([{...f.old,title:'FDA approves updated obesity drug'}],at);
  assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).runs[0].stale,true);assert.equal(f.service.historicalComparisons.start(f.report.id,req).id,run.id);assert.throws(()=>f.service.historicalComparisons.start(f.report.id,f.request()));assert.equal(f.calls(),1);
 }finally{await f.close();}
});
test('historical comparison refuses wrong report, excluded candidate, hash, metadata drift and malformed requests before model invocation',async()=>{
 const f=fixture();try{
  for(const req of [{...f.request(),reportHash:'f'.repeat(64)},{...f.request(),candidateId:f.anchor.id},{...f.request(),extra:1},{...f.request(),requestId:'bad'},null])assert.throws(()=>f.service.historicalComparisons.start(f.report.id,req));
  assert.throws(()=>f.service.historicalComparisons.start(randomUUID(),f.request()));assert.throws(()=>f.service.historicalComparisons.list(f.report.id,f.anchor.id));
  f.store.db.prepare('UPDATE revisions SET received_at=? WHERE news_id=?').run('2026-10-04T00:00:01Z',f.old.id);assert.throws(()=>f.service.historicalComparisons.start(f.report.id,f.request()),/不匹配/);
  assert.equal(f.calls(),0);assert.equal(f.service.semanticEvents.list().runs.length,0);
 }finally{await f.close();}
});
test('comparison binding and model lease roll back together when persistence fails',async()=>{
 const f=fixture();try{
  f.store.db.exec("CREATE TRIGGER reject_binding BEFORE INSERT ON historical_comparison_runs BEGIN SELECT RAISE(ABORT,'test binding failure'); END");
  assert.throws(()=>f.service.historicalComparisons.start(f.report.id,f.request()),/binding failure/);await Promise.resolve();assert.equal(f.calls(),0);assert.equal(f.service.semanticEvents.list().runs.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  f.store.db.exec('DROP TRIGGER reject_binding');const run=f.service.historicalComparisons.start(f.report.id,f.request());await f.service.semanticEvents.wait(run.id);assert.equal(f.calls(),1);
 }finally{await f.close();}
});
test('failed and cancelled comparisons retain history association and request identity',async()=>{
 const f=fixture({runner:async()=>{throw Error('synthetic failure');}});try{
  const req=f.request(),r=f.service.historicalComparisons.start(f.report.id,req);assert.equal((await f.service.semanticEvents.wait(r.id)).status,'failed');assert.equal(f.service.historicalComparisons.start(f.report.id,req).id,r.id);assert.equal(f.calls(),1);
  const next=f.service.historicalComparisons.start(f.report.id,f.request());f.service.semanticEvents.cancel(next.id);await f.service.semanticEvents.wait(next.id);const list=f.service.historicalComparisons.list(f.report.id,f.candidateId);assert.equal(list.total,2);assert.deepEqual(list.runs.map(r=>r.status),['cancelled','failed']);assert.equal(f.service.historicalRecall.byId(f.report.id).hash,f.report.hash);
 }finally{await f.close();}
});
test('HTTP history comparison enforces origin, JSON, exact query and restore guards',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service),path=`/api/historical-recall/${f.report.id}/comparisons`;
 const call=async(method,url,data,headers={})=>{let status,body;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json',...headers},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:v=>body=JSON.parse(v)});return {status,body};};
 try{
  assert.equal((await call('POST',path,f.request(),{origin:'https://example.invalid'})).status,403);assert.equal((await call('POST',path,f.request(),{'content-type':'text/plain'})).status,415);
  assert.equal((await call('GET',path+'?candidateId='+f.candidateId+'&extra=1')).status,400);assert.equal((await call('GET',path+'?candidateId='+f.candidateId+'&candidateId='+f.candidateId)).status,400);
  const r=await call('POST',path,f.request());assert.equal(r.status,202);await f.service.semanticEvents.wait(r.body.id);assert.equal((await call('GET',path+'?candidateId='+f.candidateId)).body.total,1);
  f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('POST',path,f.request())).status,409);assert.equal((await call('GET',path+'?candidateId='+f.candidateId)).body.runs.length,1);
 }finally{await f.close();}
});

for(const body of [false,true])for(const missed of ['no_context','no_mechanism'])test(`history ${body?'body':'title'} ${missed} can be reviewed without rewriting the frozen miss`,async()=>{
 const f=fixture({body,missed});try{
  const before={report:f.service.historicalRecall.byId(f.report.id),research:f.service.research.list(),paper:f.service.paper.snapshot()},req=f.request();
  assert.deepEqual(f.report.candidateIds,[]);assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).total,0);
  const started=f.service.historicalComparisons.start(f.report.id,req);assert.equal(f.service.historicalComparisons.start(f.report.id,req).id,started.id);
  const run=await f.service.semanticEvents.wait(started.id);assert.equal(run.status,'candidate');assert.equal(f.calls(),1);assert.equal(run.packet.input.right.revision,2);
  const binding=JSON.parse(f.store.db.prepare('SELECT payload FROM historical_comparison_runs').get().payload);
  assert.equal(binding.version,'historical-comparison-basis/2');assert.equal(binding.retrievalStatus,missed);assert.equal(binding.reportHash,f.report.hash);assert.equal(binding.inputHash,run.packet.inputHash);
  assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).runs[0].id,run.id);assert.equal(run.decision,null);
  assert.deepEqual({report:f.service.historicalRecall.byId(f.report.id),research:f.service.research.list(),paper:f.service.paper.snapshot()},before);
  if(body)f.save('old','Revised bulletin.','2020-01-01');else f.store.ingest([{...f.old,title:'Revised bulletin.'}],at);
  assert.equal(f.service.historicalComparisons.list(f.report.id,f.candidateId).runs[0].stale,true);assert.equal(f.service.historicalComparisons.start(f.report.id,req).id,run.id);assert.throws(()=>f.service.historicalComparisons.start(f.report.id,f.request()));assert.equal(f.calls(),1);
 }finally{await f.close();}
});
test('history review eligibility preserves time and duplicate exclusions and rejects inconsistent selection',async()=>{
 const f=fixture();try{
  for(const status of ['anchor','invalid_time','future_input','not_earlier','same_source','duplicate_title','unknown']){
   const report={...f.report,candidateIds:[],rows:f.report.rows.map(r=>r.newsId===f.candidateId?{...r,status}:r)};
   assert.throws(()=>historicalComparisonPair(f.store,report,f.candidateId),/不匹配/);
  }
  assert.throws(()=>historicalComparisonPair(f.store,{...f.report,candidateIds:[]},f.candidateId));
  assert.throws(()=>historicalComparisonPair(f.store,{...f.report,rows:f.report.rows.map(r=>r.newsId===f.candidateId?{...r,status:'no_context'}:r)},f.candidateId));
  assert.equal(f.calls(),0);
 }finally{await f.close();}
});
