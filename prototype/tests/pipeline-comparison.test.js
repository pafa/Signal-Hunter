import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,chmodSync,rmSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {collectEvaluationSources} from '../server/evaluation-baseline.mjs';
import {newsUrl} from '../server/providers.mjs';
import {officialQueries,sourcePageUrl} from '../server/news-sources.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {comparisonImplementation,invokeComparisonWorker} from '../server/source-comparison.mjs';
import {digest} from '../server/codex-research.mjs';
import {validateReplayRecipe,resolveReplayValue} from '../server/pipeline-replay.mjs';
import {freezePipelineComparison,savePipelineComparison,runPipelineComparison,readPipelineComparison} from '../server/pipeline-comparison.mjs';
import {setup,complete,at,next,ref} from './helpers/pipeline-fixture.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),cli=join(root,'prototype/scripts/compare-pipeline.mjs');
test('full stream uses actual intake, screening, reader, model, frozen approval, partial execution and persistent ledger across source versions',async()=>{
 const f=setup();try{await complete(f);const {dir}=f.save(),r=await runPipelineComparison(dir,{timeoutMs:30000});assert.equal(r.summary.completed,2,JSON.stringify(r.rows));for(const row of r.rows){const v=row.result.value;assert.equal(v.summary.failed,0,JSON.stringify(v.rows.filter(r=>r.status==='failed')));assert.equal(v.summary.rejected,0,JSON.stringify(v.rows.filter(r=>r.status==='rejected')));assert.equal(v.tables.screening_samples.rows.length,2);assert.equal(v.tables.research_materials.rows.length,1);assert(v.tables.observation_todos.rows.length);const ledger=v.rows.find(r=>r.id==='ledger').value;assert.equal(ledger.orders[0].status,'partial');assert.equal(ledger.fills[0].qty,40);assert.equal(ledger.orders[0].approval.fingerprint,v.rows.find(r=>r.id==='review').value.fingerprint);assert(existsSync(join(dir,row.role+'-data/replay.sqlite')));const db=new DatabaseSync(join(dir,row.role+'-data/replay.sqlite'),{readOnly:true});assert.equal(JSON.parse(db.prepare('SELECT payload FROM market_sim_book_steady').get().payload).fills.length,1);db.close();}
  assert(Object.values(r.reached).every(Boolean),JSON.stringify(r.reached));assert.notEqual(r.rows[0].result.value.rows.at(-1).value.cashCents,r.rows[1].result.value.rows.at(-1).value.cashCents);assert(r.tables.some(t=>t.name==='market_sim_events_steady'&&t.changed));assert(r.steps.find(s=>s.id==='execute').changed);await assert.rejects(runPipelineComparison(dir),/EEXIST/);
 }finally{f.close();}
});
test('recorded output matches exact built packet and prompt; incompatible candidate preserves failure and never invents a trace',async()=>{
 const f=setup();try{const captured=await complete(f),call=captured.modelCalls[0];f.recipe.model.mode='recorded';f.recipe.model.records=[{id:'frozen-model',at,lane:'research',contract:call.contract,result:call.result}];const file=join(f.roots.candidate,'prototype/server/codex-research.mjs');writeFileSync(file,readFileSync(file,'utf8').replace("'codex-research-8'","'codex-research-8-pipeline-experiment'").replace('你是新闻事件研究助手。','PIPELINE_CANDIDATE 你是新闻事件研究助手。'));
  const {dir}=f.save(),r=await runPipelineComparison(dir,{timeoutMs:30000});assert.equal(r.summary.completed,2);const [a,b]=r.rows.map(r=>r.result.value);assert.equal(a.modelCalls[0].status,'candidate');assert.equal(b.modelCalls[0].status,'failed');assert.equal(b.unusedModelRecords.length,1);assert.equal(b.rows.find(r=>r.id==='adopt').status,'rejected');assert.equal(b.rows.find(r=>r.id==='approve').status,'failed');assert.equal(b.rows.find(r=>r.id==='ledger').value.fills.length,0);assert(b.summary.failed>0);assert.equal(a.rows.find(r=>r.id==='ledger').value.fills.length,1);assert.equal(a.modelCalls[0].result.trace.promptHash,call.contract.promptHash);
 }finally{f.close();}
});
test('future raw responses and missing dependencies remain visible; normalized ingest is not counted as parsed intake',async()=>{
 const f=setup();try{f.recipe.model.mode='recorded';f.recipe.responses[0].at=next;f.recipe.steps=f.recipe.steps.slice(0,3);const {dir}=f.save(),r=await runPipelineComparison(dir);for(const row of r.rows){const v=row.result.value;assert.equal(v.network[0].status,'missing');assert.equal(v.tables.news.rows.length,0);assert.equal(v.summary.failed,1);assert.deepEqual(v.unusedResponses,['rss','article']);}
 }finally{f.close();}
});
test('dynamic approval fingerprint, arbitrary routes, SQL and forward references are rejected rather than executed',async()=>{
 const f=setup();try{await complete(f);f.recipe.steps.find(s=>s.id==='approve').body.fingerprint=ref('review','fingerprint');f.recipe.steps.push(f.request('forbidden','/api/operations/restore-review',{confirm:true},'POST',next));const {dir}=f.save(),r=await runPipelineComparison(dir);for(const row of r.rows){const v=row.result.value;assert.equal(v.rows.find(r=>r.id==='approve').status,'failed');assert.equal(v.rows.find(r=>r.id==='forbidden').status,'failed');assert.equal(v.rows.find(r=>r.id==='ledger').value.fills.length,0);}
 assert.throws(()=>resolveReplayValue(ref('missing','id'),{}));assert.throws(()=>resolveReplayValue(ref('x','__proto__'),{x:{value:{}}}));assert.throws(()=>validateReplayRecipe({...f.recipe,steps:[{id:'sql',at,kind:'sql',text:'DELETE FROM news'}]}));
 }finally{f.close();}
});
test('source or installed-dependency drift refuses execution before a durable start; archive reports do not load candidate roots',async()=>{
 const f=setup();try{f.recipe.steps=f.recipe.steps.slice(0,3);f.recipe.model.mode='recorded';const {dir}=f.save(),file=join(f.roots.candidate,'prototype/server/triage.mjs');writeFileSync(file,readFileSync(file,'utf8')+'\n// changed after freeze\n');await assert.rejects(runPipelineComparison(dir),/environment-changed/);assert(!existsSync(join(dir,'execution.json')));renameSync(f.roots.baseline,f.roots.baseline+'-moved');renameSync(f.roots.candidate,f.roots.candidate+'-moved');assert.equal(readPipelineComparison(dir).summary.notStarted,2);const out=spawnSync(process.execPath,[cli,'report',dir],{encoding:'utf8'});assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).summary.notStarted,2);
 }finally{f.close();}
});
test('read-only reports validate every step denominator and immutable database table hash',async()=>{
 const f=setup();try{f.recipe.steps=f.recipe.steps.slice(0,3);f.recipe.model.mode='recorded';const {dir}=f.save();await runPipelineComparison(dir);const file=join(dir,'baseline.result.json'),v=JSON.parse(readFileSync(file,'utf8'));delete v.value.modelSummary;const {hash:oldHash,...oldData}=v;writeFileSync(file,JSON.stringify({...oldData,hash:digest(oldData)}));assert.equal(readPipelineComparison(dir).rows[0].modelSummary.started,0);v.value.tables.news.rows[0].payload='changed';const {hash,...data}=v;writeFileSync(file,JSON.stringify({...data,hash:digest(data)}));assert.throws(()=>readPipelineComparison(dir));
 }finally{f.close();}
});
test('cancellation preserves the live slot and never starts the other version; concurrent run is excluded',async()=>{
 const f=setup();try{
  f.recipe.steps=f.recipe.steps.slice(0,3);f.recipe.model.mode='recorded';
  const changed=join(f.roots.baseline,'prototype/server/service.mjs');writeFileSync(changed,readFileSync(changed,'utf8').replace('const storageMonitor=storageConfig?',"awaitNever(); const storageMonitor=storageConfig?").replace('export function createService',"function awaitNever(){const until=Date.now()+600000;while(true){};}\nexport function createService"));
  const {dir}=f.save(),controller=new AbortController(),running=runPipelineComparison(dir,{signal:controller.signal,timeoutMs:10000});
  for(let i=0;i<200&&!existsSync(join(dir,'baseline.started.json'));i++)await new Promise(r=>setTimeout(r,10));
  assert(existsSync(join(dir,'baseline.started.json')));await assert.rejects(runPipelineComparison(dir),/EEXIST/);controller.abort();const r=await running;assert.equal(r.summary.cancelled,1);assert.equal(r.summary.notStarted,1);assert(!existsSync(join(dir,'candidate-data')));assert.equal(readPipelineComparison(dir).summary.cancelled,1);
 }finally{f.close();}
});
test('same implementations, backwards chronology and incompatible config fail without creating a plan',()=>{
 const f=setup();try{assert.throws(()=>freezePipelineComparison({...f.spec(),sources:{baseline:f.roots.baseline,candidate:f.roots.baseline}}),/两份不同/);f.recipe.steps[1].at='2026-10-02T13:00:00.000Z';assert.throws(()=>freezePipelineComparison(f.spec()));f.recipe.steps[1].at=at;f.recipe.model.config.effort='invented';assert.throws(()=>freezePipelineComparison(f.spec()));}finally{f.close();}
});
test('older production static-schema contract is generated by that candidate rather than substituted with a new schema',async()=>{
 const f=setup();try{const file=join(f.roots.baseline,'prototype/server/codex-research.mjs');writeFileSync(file,readFileSync(file,'utf8').replace('export function codexDraftSchema(packet){','export const codexDraftSchema=null;\nfunction internalDraftSchema(packet){').replace('schema:codexDraftSchema(packet)','schema:CODEX_DRAFT_SCHEMA'));await complete(f);const {dir}=f.save(),r=await runPipelineComparison(dir);assert.equal(r.summary.completed,2);const a=r.rows[0].result.value,b=r.rows[1].result.value;assert.equal(a.summary.failed,0);assert.equal(a.summary.rejected,0);assert.notEqual(a.modelCalls[0].contract.schemaHash,b.modelCalls[0].contract.schemaHash);assert(Object.hasOwn(b.modelCalls[0].contract,'schemaVersion'));assert.equal(a.modelCalls[0].contract.schemaHash,digest(a.modelCalls[0].schema));assert.equal(a.rows.find(r=>r.id==='ledger').value.fills.length,1);}finally{f.close();}
});
test('automatic discovery retains all screening levels, reads full source before model and never adopts or orders during replay',async()=>{
 const f=setup();try{f.recipe.steps=f.recipe.steps.slice(0,3);f.recipe.steps.push({id:'discovery-resume',at,kind:'task',name:'discovery',action:'resume',input:null},{id:'discovery-run',at,kind:'task',name:'discovery',action:'run',input:null},f.request('automatic-data','/api/data',{},'GET'),f.request('automatic-runs',['/api/research/',ref('automatic-data','research','topics',0,'id'),'/model-runs'],{},'GET'),{id:'automatic-wait',at,kind:'wait',lane:'research',runId:ref('automatic-runs','runs',0,'id')},{id:'discovery-next',at,kind:'task',name:'discovery',action:'run',input:null},f.request('automatic-queue','/api/research-pipeline',{},'GET'));
 const {dir}=f.save(),r=await runPipelineComparison(dir);assert.equal(r.summary.completed,2,JSON.stringify(r.rows.map(({role,status,result})=>({role,status,failure:result?.failure}))));for(const arm of r.rows){const v=arm.result.value;assert.equal(v.summary.failed,0,JSON.stringify(v.rows.filter(r=>r.status==='failed')));assert.equal(v.summary.rejected,0);assert.equal(v.tables.screening_samples.rows.length,2);assert.equal(v.modelCalls.length,1);const q=v.rows.at(-1).value;assert.equal(q.counts.skipped,1);assert.equal(q.counts.candidate,1);const t=JSON.parse(v.tables.research_topics.rows[0].payload);assert.equal(t.version,2);assert(!t.dossier);assert(t.evidence.some(e=>e.materialId));assert.equal(v.tables.market_sim_book_steady.rows.length,0);assert.equal(v.tables.market_sim_book_aggressive.rows.length,0);assert.equal(v.unusedResponses.length,0);}assert.equal(r.coverage.paired.approvals,false);assert.equal(r.coverage.paired.fills,false);
 }finally{f.close();}
});
test('a missing model record is counted even without an explicit wait step and CLI cannot report a successful complete workflow',async()=>{
 const f=setup();try{f.recipe.steps=f.recipe.steps.slice(0,7);f.recipe.model.mode='recorded';const {dir}=f.save(),out=spawnSync(process.execPath,[cli,'run',dir],{encoding:'utf8',timeout:30000});assert.equal(out.status,2,out.stderr);const r=readPipelineComparison(dir);assert.equal(r.summary.completed,2);for(const arm of r.rows){const v=arm.result.value;assert.equal(v.summary.failed,0);assert.equal(v.summary.rejected,0);assert.equal(v.modelSummary.started,1);assert.equal(v.modelSummary.failed,1);assert.equal(v.modelSummary.candidate,0);}assert.equal(r.coverage.paired.validModel,false);}finally{f.close();}
});
test('summary screening replay preserves every revision and level without repeating full inbox snapshots',async()=>{
 const f=setup();try{f.recipe.model.mode='recorded';f.recipe.steps=f.recipe.steps.slice(0,3);f.recipe.steps[1].view='summary';f.recipe.steps.push({id:'revision',at:next,kind:'ingest',items:[{id:digest('https://www.reuters.com/synthetic-one'),title:'Company files for bankruptcy',url:'https://example.com/one',publisher:'Synthetic',publishedAt:at}]},{id:'summary-next',at:next,kind:'screen',view:'summary'});const {dir}=f.save(),r=await runPipelineComparison(dir);for(const arm of r.rows){const v=arm.result.value;assert.equal(v.summary.failed,0);const s=v.rows.find(r=>r.id==='summary-next').value;assert.equal(s.total,3);assert(s.buckets.some(b=>b.bucket==='quiet'));assert(!Object.hasOwn(s,'inbox'));assert.equal(v.tables.screening_samples.rows.length,3);assert.equal(v.tables.revisions.rows.length,3);assert.equal(v.tables.news.rows.length,2);assert(v.tables.revisions.rows.some(r=>r.news_id===digest('https://www.reuters.com/synthetic-one')&&r.version===2));}assert.throws(()=>validateReplayRecipe({...f.recipe,steps:[{id:'bad-view',at,kind:'screen',view:'truncate'}]}));}finally{f.close();}
});
test('model call wall time stays distinct from frozen recipe and original production trace timestamps',async()=>{
 const f=setup();try{f.recipe.steps=f.recipe.steps.slice(0,8);const {dir}=f.save(),r=await runPipelineComparison(dir);for(const arm of r.rows){const c=arm.result.value.modelCalls[0];assert.equal(c.status,'candidate');assert.equal(c.at,at);assert.equal(c.result.trace.startedAt,at);assert(Number.isFinite(Date.parse(c.wallStartedAt)));assert(Number.isFinite(Date.parse(c.wallFinishedAt)));assert(Date.parse(c.wallStartedAt)<=Date.parse(c.wallFinishedAt));assert.notEqual(c.wallStartedAt,c.result.trace.startedAt);}}finally{f.close();}
});

test('nested intake failure remains visible and makes run CLI fail even when scheduler steps succeed',async()=>{
 const f=setup();try{f.recipe.model.mode='recorded';const q=officialQueries({newsHkmaEnabled:true},at).find(q=>q.id==='hkma');f.recipe.responses.push({id:'hkma-error',at,url:sourcePageUrl(q,1),status:502,headers:{'content-type':'text/html'},body:'synthetic gateway failure'});f.recipe.steps=f.recipe.steps.slice(0,2);f.recipe.steps[1].view='summary';f.recipe.steps.unshift(f.request('enable-hkma','/api/settings',{newsHkmaEnabled:true},'PATCH'));
 const {dir}=f.save(),out=spawnSync(process.execPath,[cli,'run',dir],{encoding:'utf8',timeout:30000});assert.equal(out.status,2,out.stderr);const r=readPipelineComparison(dir);assert.equal(r.summary.completed,2);for(const arm of r.rows){assert.equal(arm.result.value.summary.failed,0);assert.equal(arm.intakeSummary.attempted,2);assert.equal(arm.intakeSummary.error,1);assert.equal(arm.intakeSummary.ok,1);const failed=arm.intake.find(r=>r.queryId==='hkma');assert.equal(failed.ingestCommitted,false);assert.equal(failed.coverage,'incomplete');assert.equal(failed.state,'error');}const printed=JSON.parse(out.stdout);assert.equal(printed.intake[0].summary.error,1);assert.equal(printed.intake[1].summary.error,1);}finally{f.close();}
});
