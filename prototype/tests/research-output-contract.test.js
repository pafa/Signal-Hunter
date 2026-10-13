import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RESEARCH_OUTPUT_CONTRACT,useStoredOutputContract} from '../server/research-output-contract.mjs';
import {MATERIALITY_ID_PATTERN,MATERIALITY_TEXT_LIMITS} from '../shared/company-materiality.mjs';
import {CodexResearchError,digest,codexPrompt,codexDraftSchema,validatePacket,validateCodexDraft,generateCodexDraft,rejectedOutputDiagnostic} from '../server/codex-research.mjs';
import {researchOutputFeedback,researchFeedbackPrompt} from '../server/research-output-feedback.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {financialFixture,financialDossier,financialBody} from './helpers/research-financials-fixture.mjs';
import {fixture,output,config} from './automatic-research-fixture.mjs';

const raw=p=>JSON.parse(financialDossier(p).rawOutput);
const diagnostic=value=>{const rawOutput=JSON.stringify(value);return {stage:'schema',rawOutput,outputHash:digest(rawOutput)};};
const bad=p=>{const v=raw(p);v.companyAssessments[0].financials.metrics[0].id='background_revenue';return v;};
const failure=p=>{const d=diagnostic(bad(p)),e=new CodexResearchError('output',{inputHash:p.inputHash,outputHash:d.outputHash});Object.defineProperty(e,'outputDiagnostic',{value:d});return e;};
const good=(p,c)=>{const r=financialDossier(p);if(c.researchFeedback){r.trace.researchFeedbackHash=digest(c.researchFeedback);r.trace.promptHash=digest(codexPrompt(p,c.researchFeedback));}return r;};
const fields=(p,f)=>codexDraftSchema(p,f).properties.companyAssessments.items.properties.financials.properties.metrics.items.properties;

test('new packets bind producer constraints while legacy inputs and validation remain unchanged',async()=>{
 const f=financialFixture();try{
  const p=f.packet,legacy=useStoredOutputContract(p,{});assert.equal(p.outputContract,RESEARCH_OUTPUT_CONTRACT);assert.equal(legacy.inputHash,p.inputHash);assert.deepEqual(legacy.input,p.input);validatePacket(legacy);
  assert.deepEqual(fields(p).id,{type:'string',pattern:MATERIALITY_ID_PATTERN});assert.deepEqual(fields(legacy).id,{type:'string'});
  for(const [key,maxLength] of Object.entries(MATERIALITY_TEXT_LIMITS))assert.deepEqual(fields(p)[key],{type:'string',minLength:1,maxLength,pattern:'\\S'});
  assert.match(codexPrompt(p),/不能使用下划线/);assert(!codexPrompt(legacy).includes('不能使用下划线'));
  for(const id of ['background_revenue','中文',' ','a'.repeat(81)]){const v=raw(p);v.companyAssessments[0].financials.metrics[0].id=id;assert.throws(()=>validateCodexDraft(v,p));assert.throws(()=>validateCodexDraft(v,legacy));}
  for(const outputContract of [null,'unknown/1'])assert.throws(()=>validatePacket({...p,outputContract}));
 }finally{await f.close();}
});

test('format feedback identifies only bounded paths and preserves rejected facts and evidence',async()=>{
 const f=financialFixture();try{
  const v=bad(f.packet);v.companyAssessments[0].financials.metrics[0].label='x'.repeat(121);const d=diagnostic(v),before=JSON.stringify({packet:f.packet,d}),fb=researchOutputFeedback(d,f.packet);
  assert.equal(fb.version,'research-output-feedback/2');assert.deepEqual(fb.issues.map(i=>i.code),['financial-metric-id-format','financial-metric-text-format']);assert.equal(fb.issues[0].path,'companyAssessments[0].financials.metrics[0].id');assert.equal(fb.issues[1].maxLength,120);assert.equal(fb.previousOutputHash,d.outputHash);assert.equal(fb.inputHash,f.packet.inputHash);
  assert.equal(JSON.stringify({packet:f.packet,d}),before);assert(!JSON.stringify(fb).includes('background_revenue'));assert(!researchFeedbackPrompt(fb).includes(financialBody));assert.match(researchFeedbackPrompt(fb),/不删指标/);
  const duplicate=raw(f.packet);duplicate.companyAssessments[0].financials.metrics.push(structuredClone(duplicate.companyAssessments[0].financials.metrics[0]));assert.equal(researchOutputFeedback(diagnostic(duplicate),f.packet).issues[0].code,'financial-metric-id-duplicate');
  assert.equal(researchOutputFeedback({...d,outputHash:'wrong'},f.packet),null);assert.equal(researchOutputFeedback({...d,stage:'json'},f.packet),null);assert.equal(researchOutputFeedback(d,{...f.packet,input:{...f.packet.input,financialValueRules:'unknown/9'}}),null);
 }finally{await f.close();}
});

test('actual CLI transport constrains first generation and a legacy failed-output retry without patching output',async()=>{
 const f=financialFixture(),dir=mkdtempSync(join(tmpdir(),'research-contract-'));try{
  const binary=join(dir,'codex.mjs'),rejected=JSON.stringify(bad(f.packet)),accepted=financialDossier(f.packet).rawOutput;
  writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}let input='';for await(const c of process.stdin)input+=c;const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8')),pattern=schema.properties.companyAssessments.items.properties.financials.properties.metrics.items.properties.id.pattern;const raw=pattern===${JSON.stringify(MATERIALITY_ID_PATTERN)}&&input.includes('不能使用下划线')?${JSON.stringify(accepted)}:${JSON.stringify(rejected)};fs.writeFileSync(args[args.indexOf('--output-last-message')+1],raw);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:raw}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);chmodSync(binary,0o700);
  const settings={binary,model:'test-model',timeoutMs:10000},first=await generateCodexDraft(f.packet,settings);assert.equal(first.rawOutput,accepted);assert.equal(first.trace.outputContract,RESEARCH_OUTPUT_CONTRACT);assert.equal(first.trace.schemaHash,digest(codexDraftSchema(f.packet)));
  const legacy=useStoredOutputContract(f.packet,{});let error;try{await generateCodexDraft(legacy,settings);}catch(e){error=e;}assert.equal(error.code,'output');const d=rejectedOutputDiagnostic(error,legacy.inputHash),fb=researchOutputFeedback(d,legacy);assert.equal(fb.version,'research-output-feedback/2');
  const retried=await generateCodexDraft(legacy,{...settings,researchFeedback:fb});assert.equal(retried.rawOutput,accepted);assert.equal(retried.trace.schemaHash,digest(codexDraftSchema(legacy,fb)));assert.equal(retried.trace.promptHash,digest(codexPrompt(legacy,fb)));assert.equal(retried.trace.researchFeedbackHash,digest(fb));assert.equal(d.rawOutput,rejected);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

const words='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。';
const make=options=>fixture({...options,fetcher:async()=>{throw Error('synthetic test must not fetch network');},sourceReader:async url=>({url,title:'合成 NVIDIA 研究',sourceName:'合成',body:words+financialBody+'仅为流程检查。'.repeat(80),scope:'extracted-text'}),extractionRunner:p=>output(p,'decomposition',{events:[{title:'NVIDIA 合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote:words,quoteField:'body',boundaryReason:'具体事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']}),identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:words,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成冻结别名'}],scopeNote:'合成',missingEvidence:['历史身份']})});
const jobs=f=>f.queue.snapshot().events.items;

test('legacy automatic queue survives restart and quota wait, then regenerates with feedback and no human checkpoint',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-output-contract-')),path=join(dir,'test.sqlite');let f=make({path,researchRunner:p=>{throw failure(p);}});try{
  const paper=f.service.paper.snapshot();f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:2,includeClues:false});f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='dossier'));
  // Synthetic fixture construction only: model the legacy queue before the new
  // output contract existed. Production code must never rewrite this packet.
  const row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier'").get(),p=JSON.parse(row.payload);delete p.packet.outputContract;const stable={...p.packet};delete stable.generatedAt;p.executionHash=digest({kind:'dossier',packet:stable,prompt:codexPrompt(stable),schema:codexDraftSchema(stable),configHash:digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs})});f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);
  assert.equal(jobs(f).find(j=>j.id===row.id).stale,false);f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:3,includeClues:false});await f.until(()=>jobs(f).find(j=>j.id===row.id).status==='failed');await f.step();const failed=f.store.db.prepare("SELECT payload FROM model_research_runs WHERE status='failed'").all();assert.equal(jobs(f).find(j=>j.id===row.id).status,'queued');await f.close();
  const seen=[];f=make({path,researchRunner:(packet,c)=>{seen.push({packet,feedback:c.researchFeedback});return good(packet,c);}});f.advance(60001);await f.drive(3);assert.equal(f.calls.dossier,0);assert.equal(jobs(f).find(j=>j.id===row.id).stale,false);f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false});await f.until(()=>jobs(f).find(j=>j.id===row.id).status==='completed');assert.equal(f.calls.dossier,1);assert.equal(seen[0].packet.outputContract,undefined);assert.equal(seen[0].feedback.version,'research-output-feedback/2');assert.equal(jobs(f).find(j=>j.id===row.id).attempts.length,2);assert.deepEqual(f.store.db.prepare("SELECT payload FROM model_research_runs WHERE status='failed'").all(),failed);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('stored contract metadata cannot replace changed current research input',async()=>{
 const f=financialFixture();try{const changed=structuredClone(f.packet);changed.input.title='different';changed.inputHash=digest(changed.input);assert.throws(()=>f.service.modelResearch.startAutomatic(f.topic.id,{version:f.topic.version},()=>{},SYSTEM_RESEARCH_ACTOR,null,changed),/原队列研究输入已变化/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_research_runs').get().n,0);}finally{await f.close();}
});
