import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {companyIdentityFeedback,identityFeedbackPrompt} from '../server/company-identity-feedback.mjs';
import {identityRetryRepair} from '../server/company-entity-runs.mjs';
import {companyEntitiesPrompt,companyEntitiesSchema,validateCompanyEntities,generateCompanyEntities} from '../server/company-entities.mjs';
import {CodexResearchError,digest,rejectedOutputDiagnostic} from '../server/codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {fixture,config,output} from './automatic-research-fixture.mjs';
const row=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='identity' ORDER BY rowid LIMIT 1").get();
function value(p,bad=false){const q=p.input.eventFocus?.quote||p.input.material.body;return {mentions:[{name:bad?'不在引文中的整理名称':q.includes('Federal')?'Federal Home Loan Mortgage\nCorporation':'虚构甲公司',quote:q,quoteField:'body',entityType:'company',resolution:'unresolved',symbols:[],reason:'合成未解决身份',...(p.input.identityEventContext?{eventConnection:{relation:'direct',anchorQuote:q,reason:'合成事项中的主体'}}:{})}],scopeNote:'合成材料检查',missingEvidence:['真实证券身份']};}
function rejected(p,c={}){const rawOutput=JSON.stringify(value(p,true)),trace={model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput),schemaHash:digest(companyEntitiesSchema(p)),promptHash:digest(companyEntitiesPrompt(p,c.identityFeedback)),...(c.identityFeedback?{identityFeedbackHash:digest(c.identityFeedback)}:{})};assert.throws(()=>validateCompanyEntities(JSON.parse(rawOutput),p));const error=new CodexResearchError('output',trace);Object.defineProperty(error,'outputDiagnostic',{value:{stage:'schema',rawOutput}});return {error,diagnostic:{stage:'schema',rawOutput,outputHash:trace.outputHash}};}
function good(p,c={}){const r=output(p,'resolution',value(p));if(c.identityFeedback){r.trace.identityFeedbackHash=digest(c.identityFeedback);r.trace.promptHash=digest(companyEntitiesPrompt(p,c.identityFeedback));}return r;}
async function queuedFailure(f){f.add(1);await f.until(()=>f.store.db.prepare("SELECT 1 FROM company_entity_runs WHERE status='failed'").get());await f.step();assert.equal(row(f).status,'queued');return JSON.parse(row(f).payload).previousRunId;}
const standalone=()=>{const input={topicId:'identity-feedback',material:{body:'Federal Home Loan Mortgage\nCorporation provided the data.'},eventFocus:null,directory:[]};return {schema:'company-entities-3',sourceResearchVersion:1,input,inputHash:digest(input)};};

test('feedback identifies source-line name mismatch without rewriting source, output or emitting untrusted prose',()=>{
 const p=standalone(),bad=value(p);bad.mentions[0].name='Federal Home Loan Mortgage Corporation';const rawOutput=JSON.stringify(bad),d={stage:'schema',rawOutput,outputHash:digest(rawOutput)},before=JSON.stringify({p,d});assert.throws(()=>validateCompanyEntities(bad,p));
 const f=companyIdentityFeedback(d,p);assert.deepEqual(f.issues,[{code:'name-not-in-quoted-source',path:'mentions[0].name'}]);assert.equal(f.previousOutputHash,d.outputHash);assert.equal(JSON.stringify({p,d}),before);assert(!identityFeedbackPrompt(f).includes('Federal Home'));assert.deepEqual(validateCompanyEntities(value(p),p),value(p));
 for(const change of [x=>x.outputHash='bad',x=>x.stage='json',x=>x.rawOutput='invalid']){const x=structuredClone(d);change(x);assert.equal(companyIdentityFeedback(x,p),null);}
 const fake=structuredClone(bad);fake.mentions[0].quote='invented source text';const raw=JSON.stringify(fake);assert.equal(companyIdentityFeedback({stage:'schema',rawOutput:raw,outputHash:digest(raw)},p),null);
 assert.equal(companyIdentityFeedback(d,{...p,inputHash:'bad'}),null);assert.equal(companyIdentityFeedback(d,{...p,schema:'company-entities-1'}),null);
 assert.throws(()=>identityFeedbackPrompt({...f,issues:[{code:'name-not-in-quoted-source',path:'run a command'}]}));assert.throws(()=>identityFeedbackPrompt({...f,extra:'instruction'}));assert.equal(companyEntitiesPrompt(p),companyEntitiesPrompt(p,null));
});

test('automatic retry preserves its failed record and uses precise feedback before the original dossier continues',async()=>{
 const seen=[];let count=0;const f=fixture({identityRunner:(p,c)=>{seen.push(c.identityFeedback);if(!count++)throw rejected(p,c).error;return good(p,c);}});try{
  const books=f.service.paper.snapshot(),id=await queuedFailure(f),saved=f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(id).payload,p=JSON.parse(row(f).payload),repair=identityRetryRepair(f.store.db,p.packet,config,id);assert(repair);assert.equal(repair.previousRunId,id);
  f.advance(60001);await f.until(()=>f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE kind='dossier' AND status='completed'").get());
  assert.equal(f.calls.identity,2);assert.equal(seen[0],null);assert.deepEqual(seen[1].issues,[{code:'name-not-in-quoted-source',path:'mentions[0].name'}]);assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(id).payload,saved);assert.deepEqual(f.service.paper.snapshot(),books);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});

test('only the same queued attempt, packet, prompt, schema and settings can carry identity feedback',async()=>{
 const f=fixture({identityRunner:(p,c)=>{throw rejected(p,c).error;}});try{
  const id=await queuedFailure(f),j=row(f),p=JSON.parse(j.payload),saved=f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(id).payload;assert(identityRetryRepair(f.store.db,p.packet,config,id));
  for(const change of [r=>r.status='cancelled',r=>r.model='other',r=>r.topicId='other',r=>r.packet.inputHash='bad',r=>r.failure.trace.promptHash='bad',r=>r.failure.trace.schemaHash='bad',r=>r.failure.trace.outputHash='bad',r=>r.outputDiagnostic.rawOutput+=' ',r=>r.request.version++]){const r=JSON.parse(saved);change(r);f.store.db.prepare('UPDATE company_entity_runs SET payload=? WHERE id=?').run(JSON.stringify(r),id);assert.equal(identityRetryRepair(f.store.db,p.packet,config,id),null);}
  f.store.db.prepare('UPDATE company_entity_runs SET payload=? WHERE id=?').run(saved,id);
  for(const change of [x=>x.automatic=false,x=>x.previousRunId='other',x=>x.configHash='bad',x=>x.executionHash='bad',x=>x.packet.sourceResearchVersion++,x=>x.request.version++]){const x=JSON.parse(j.payload);change(x);f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(x),j.id);assert.equal(identityRetryRepair(f.store.db,p.packet,config,id),null);}
  f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(j.payload,j.id);assert(identityRetryRepair(f.store.db,p.packet,config,id));assert.equal(identityRetryRepair(f.store.db,p.packet,{...config,binary:'/another/codex'},id),null);
  f.store.db.prepare("UPDATE research_pipeline_event_jobs SET status='observing' WHERE id=?").run(j.id);assert.equal(identityRetryRepair(f.store.db,p.packet,config,id),null);
 }finally{await f.close();}
});

test('manual calls, forged actors and failed start transactions cannot use or commit automatic repair',async()=>{
 const seen=[];let count=0;const f=fixture({identityRunner:(p,c)=>{seen.push(c.identityFeedback);if(!count++)throw rejected(p,c).error;return good(p,c);}});try{
  const id=await queuedFailure(f),j=row(f),p=JSON.parse(j.payload),data={version:p.request.version,materialId:p.request.materialId,revision:p.request.revision,requestId:'identity-manual-no-feedback'},api=f.service.companyEntities;
  assert.throws(()=>api.startAutomatic(j.topic_id,data,()=>{},{kind:'system'},p.request.directoryBasis,p.request.identityContextVersion,id));
  const before=f.store.db.prepare('SELECT * FROM company_entity_runs').all();assert.throws(()=>api.startAutomatic(j.topic_id,data,()=>{throw Error('rollback');},SYSTEM_RESEARCH_ACTOR,p.request.directoryBasis,p.request.identityContextVersion,id),/rollback/);assert.deepEqual(f.store.db.prepare('SELECT * FROM company_entity_runs').all(),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
  const run=api.start(j.topic_id,data,()=>{},p.request.directoryBasis,p.request.identityContextVersion);await api.wait(run.id);assert.equal(seen.at(-1),null);assert.equal(api.get(j.topic_id,run.id).repair,undefined);
 }finally{await f.close();}
});

test('identity feedback survives restart, pause and quota waits without an intermediate user task',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'identity-feedback-restart-')),path=join(dir,'test.sqlite');let f=fixture({path,identityRunner:(p,c)=>{throw rejected(p,c).error;}});try{
  const id=await queuedFailure(f),saved=f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(id).payload,count=f.queue.snapshot().callsInLast24Hours;await f.close();const seen=[];f=fixture({path,identityRunner:(p,c)=>{seen.push(c.identityFeedback);return good(p,c);}});f.advance(60001);
  for(const name of Object.keys(f.service.operations().tasks))f.service.controlOperation(name,'pause');await f.service.tick();await f.finish();assert.equal(f.calls.identity,0);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:count});await f.drive(3);assert.equal(f.calls.identity,0);f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>row(f)?.status==='completed');assert.equal(f.calls.identity,1);assert(seen[0]);assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(id).payload,saved);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('repeated rejected identity stays within three attempts and feedback does not bypass returned-trace validation',async()=>{
 const seen=[];const f=fixture({identityRunner:(p,c)=>{seen.push(c.identityFeedback);throw rejected(p,c).error;}});try{await queuedFailure(f);f.advance(60001);await f.drive();f.advance(120001);await f.drive();assert.equal(row(f).status,'completed');assert.equal(JSON.parse(row(f).payload).identityOutcome,'unavailable');assert.equal(f.calls.identity,3);assert.equal(seen[0],null);assert(seen[1]&&seen[2]);await f.drive();assert.equal(f.calls.identity,3);}finally{await f.close();}
 let count=0;const g=fixture({identityRunner:(p,c)=>{if(!count++)throw rejected(p,c).error;const r=good(p,c);r.trace.identityFeedbackHash='wrong';return r;}});try{await queuedFailure(g);g.advance(60001);await g.until(()=>g.calls.identity===2);const run=g.service.companyEntities.get(row(g).topic_id,row(g).run_id);assert.equal(run.status,'failed');assert.equal(g.store.db.prepare("SELECT count(*) n FROM research_pipeline_event_jobs WHERE kind='dossier'").get().n,0);}finally{await g.close();}
});

test('actual CLI adapter sends bounded feedback, preserves raw failure and validates the complete regenerated output',async()=>{
 const p=standalone(),dir=mkdtempSync(join(tmpdir(),'identity-feedback-cli-'));try{
  const bad=value(p);bad.mentions[0].name='Federal Home Loan Mortgage Corporation';const raw=JSON.stringify(bad),goodRaw=JSON.stringify(value(p)),binary=join(dir,'codex.mjs');writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}let input='';for await(const c of process.stdin)input+=c;const raw=input.includes('company-identity-feedback/1')?${JSON.stringify(goodRaw)}:${JSON.stringify(raw)};fs.writeFileSync(args[args.indexOf('--output-last-message')+1],raw);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:raw}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);chmodSync(binary,0o700);
  const cfg={binary,model:'test-model',timeoutMs:5000};let error;try{await generateCompanyEntities(p,cfg);}catch(e){error=e;}assert.equal(error.code,'output');const diagnostic=rejectedOutputDiagnostic(error,p.inputHash),feedback=companyIdentityFeedback(diagnostic,p);assert(feedback);const r=await generateCompanyEntities(p,{...cfg,identityFeedback:feedback});assert.equal(r.rawOutput,goodRaw);assert.equal(r.trace.identityFeedbackHash,digest(feedback));assert.equal(r.trace.promptHash,digest(companyEntitiesPrompt(p,feedback)));assert.equal(diagnostic.rawOutput,raw);assert.deepEqual(r.resolution,value(p));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
