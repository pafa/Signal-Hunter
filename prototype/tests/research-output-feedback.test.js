import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {researchOutputFeedback,researchFeedbackPrompt} from '../server/research-output-feedback.mjs';
import {CodexResearchError,digest,codexPrompt,validateCodexDraft,generateCodexDraft,rejectedOutputDiagnostic} from '../server/codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {financialFixture,financialDossier,financialBody} from './helpers/research-financials-fixture.mjs';
import {fixture,output,two} from './automatic-research-fixture.mjs';
function rejected(packet){
 const draft=financialDossier(packet),body=JSON.parse(draft.rawOutput),datum=body.companyAssessments[0].financials.metrics[0].baseline;
 datum.citations.push({...datum.citations[0],quote:'FY2027 diluted earnings per share guidance is USD 2.50 per share.'});
 const rawOutput=JSON.stringify(body),trace={...draft.trace,promptHash:digest(codexPrompt(packet)),outputHash:digest(rawOutput)};assert.throws(()=>validateCodexDraft(body,packet));
 const error=new CodexResearchError('output',trace);Object.defineProperty(error,'outputDiagnostic',{value:{stage:'schema',rawOutput}});return {error,diagnostic:{stage:'schema',rawOutput,outputHash:trace.outputHash}};
}
function repaired(packet,config){const r=financialDossier(packet);if(config.researchFeedback){r.trace.researchFeedbackHash=digest(config.researchFeedback);r.trace.promptHash=digest(codexPrompt(packet,config.researchFeedback));}return r;}
const words='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。';
function make(options={}){return fixture({...options,
 sourceReader:async url=>({url,title:'NVIDIA 合成研究',sourceName:'合成',body:words+financialBody+'这些材料仅测试自动重试，不是市场事实。'.repeat(30),scope:'extracted-text'}),
 extractionRunner:p=>output(p,'decomposition',{events:[{title:'NVIDIA合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote:words,quoteField:'body',boundaryReason:'具体回购事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']}),
 identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote:words,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成冻结别名'}],scopeNote:'合成',missingEvidence:['历史身份']})});}
const jobs=f=>f.queue.snapshot().events.items;

test('feedback pinpoints only unsupported literal citations without editing facts, output or input',async()=>{
 const f=financialFixture();try{const {diagnostic}=rejected(f.packet),before=JSON.stringify({diagnostic,packet:f.packet}),feedback=researchOutputFeedback(diagnostic,f.packet);
  assert.deepEqual(feedback.issues,[{code:'financial-source-literal-mismatch',path:'companyAssessments[0].financials.metrics[0].baseline',value:100,unit:'USD million',unsupportedCitationIndexes:[1]}]);assert.equal(feedback.previousOutputHash,diagnostic.outputHash);assert.equal(feedback.inputHash,f.packet.inputHash);assert.equal(JSON.stringify({diagnostic,packet:f.packet}),before);assert(!researchFeedbackPrompt(feedback).includes(financialBody));assert.match(researchFeedbackPrompt(feedback),/不是新来源/);
  assert.equal(researchOutputFeedback({...diagnostic,outputHash:'bad'},f.packet),null);assert.equal(researchOutputFeedback({...diagnostic,stage:'json'},f.packet),null);
  const invalid=JSON.parse(diagnostic.rawOutput);invalid.companyAssessments[0].financials.metrics[0].baseline.citations[1].quote='invented unsupported text';const rawOutput=JSON.stringify(invalid);assert.equal(researchOutputFeedback({stage:'schema',rawOutput,outputHash:digest(rawOutput)},f.packet),null);
  const old=structuredClone(f.packet);old.input.evidence[0].material.revision++;assert.equal(researchOutputFeedback(diagnostic,old),null);
 }finally{await f.close();}
});
test('internal retry preserves rejected output and accepts only a complete newly validated research run',async()=>{
 let count=0;const configs=[];const f=financialFixture({runner:(p,c)=>{configs.push(c.researchFeedback);if(!count++)throw rejected(p).error;return repaired(p,c);}});try{
  const a=f.service.modelResearch.start(f.topic.id,{version:f.topic.version}),failed=await f.service.modelResearch.wait(a.id);assert.equal(failed.status,'failed');const saved=JSON.stringify(failed),paper=f.service.paper.snapshot();assert.throws(()=>f.service.modelResearch.startAutomatic(f.topic.id,{version:f.topic.version},()=>{},{kind:'system'},a.id));
  const b=f.service.modelResearch.startAutomatic(f.topic.id,{version:f.topic.version},()=>{},SYSTEM_RESEARCH_ACTOR,a.id),good=await f.service.modelResearch.wait(b.id);assert.equal(good.status,'candidate');assert.equal(good.repair.previousRunId,a.id);assert.equal(configs[1].issues.length,1);assert.equal(good.candidate.trace.researchFeedbackHash,digest(configs[1]));assert.equal(JSON.stringify(f.service.modelResearch.get(f.topic.id,a.id)),saved);f.service.modelResearch.adopt(f.topic.id,b.id,{version:f.topic.version},SYSTEM_RESEARCH_ACTOR);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.research.get(f.topic.id).dossier.sourceModelRun.id,b.id);
 }finally{await f.close();}
});
test('ordinary starts and stale, cancelled, corrupt, successful or legacy records do not carry retry feedback',async()=>{
 const seen=[];let first=true;const f=financialFixture({runner:(p,c)=>{seen.push(c.researchFeedback);if(first){first=false;throw rejected(p).error;}return repaired(p,c);}});try{
  const a=f.service.modelResearch.start(f.topic.id,{version:f.topic.version});await f.service.modelResearch.wait(a.id);const saved=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(a.id).payload;
  const normal=f.service.modelResearch.start(f.topic.id,{version:f.topic.version});await f.service.modelResearch.wait(normal.id);assert.equal(seen.at(-1),null);
  for(const change of [r=>r.status='cancelled',r=>r.status='candidate',r=>delete r.executionHash,r=>r.executionHash='changed',r=>r.outputDiagnostic.outputHash='changed',r=>r.failure.trace.inputHash='changed',r=>r.topicId='another']){const r=JSON.parse(saved);change(r);f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(r),a.id);const s=f.service.modelResearch.startAutomatic(f.topic.id,{version:f.topic.version},()=>{},SYSTEM_RESEARCH_ACTOR,a.id);await f.service.modelResearch.wait(s.id);assert.equal(seen.at(-1),null);}
  f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(saved,a.id);const t=f.service.research.addCompany(f.topic.id,{version:f.topic.version,symbol:'AAPL.US',note:'新增研究主体'}),s=f.service.modelResearch.startAutomatic(t.id,{version:t.version},()=>{},SYSTEM_RESEARCH_ACTOR,a.id);await f.service.modelResearch.wait(s.id);assert.equal(seen.at(-1),null);
 }finally{await f.close();}
});
test('provider cannot claim repaired completion without the exact feedback and sent-prompt hashes',async()=>{
 let calls=0;const f=financialFixture({runner:(p,c)=>{if(!calls++)throw rejected(p).error;const good=repaired(p,c);good.trace.researchFeedbackHash='wrong';return good;}});try{const a=f.service.modelResearch.start(f.topic.id,{version:f.topic.version});await f.service.modelResearch.wait(a.id);const b=f.service.modelResearch.startAutomatic(f.topic.id,{version:f.topic.version},()=>{},SYSTEM_RESEARCH_ACTOR,a.id);assert.equal((await f.service.modelResearch.wait(b.id)).status,'failed');assert.equal(f.service.research.get(f.topic.id).dossier,undefined);}finally{await f.close();}
});
test('automatic retry survives restart, pause and budget waits, then saves research without a user checkpoint',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-feedback-')),path=join(dir,'test.sqlite');let f=make({path,researchRunner:p=>{throw rejected(p).error;}});try{
  const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='failed'));await f.step();assert.equal(jobs(f).find(j=>j.kind==='dossier').status,'queued');const count=f.queue.snapshot().callsInLast24Hours,failedRows=f.store.db.prepare("SELECT payload FROM model_research_runs WHERE status='failed'").all();await f.close();
  const feedback=[];f=make({path,researchRunner:(p,c)=>{feedback.push(c.researchFeedback);return repaired(p,c);}});f.advance(60001);for(const name of Object.keys(f.service.operations().tasks))f.service.controlOperation(name,'pause');await f.service.tick();await f.finish();assert.equal(f.calls.dossier,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM news').get().n,1,'the paused synthetic retry test must not fetch unrelated public news');
  f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:count,includeClues:false});await f.drive(3);assert.equal(f.calls.dossier,0);f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false});await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='completed'));assert.equal(f.calls.dossier,1);assert.equal(feedback[0].issues.length,1);assert.equal(jobs(f).find(j=>j.kind==='dossier').attempts.length,2);assert.deepEqual(f.store.db.prepare("SELECT payload FROM model_research_runs WHERE status='failed'").all(),failedRows);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('repeated bad output reaches the original three-attempt limit and remains observable',async()=>{
 const seen=[];const f=make({researchRunner:(p,c)=>{seen.push(c.researchFeedback);throw rejected(p).error;}});try{f.add(1);await f.drive();f.advance(60001);await f.drive();f.advance(120001);await f.drive();const j=jobs(f).find(j=>j.kind==='dossier');assert.equal(j.status,'observing');assert.equal(j.attempts.length,3);assert.equal(seen[0],null);assert(seen[1]&&seen[2]);await f.drive();assert.equal(f.calls.dossier,3);}finally{await f.close();}
});
test('event synthesis uses the same guarded feedback path and preserves its failed attempt',async()=>{
 let calls=0;const feedback=[];const f=make({researchRunner:financialDossier,synthesisRunner:(p,c)=>{feedback.push(c.researchFeedback);if(!calls++)throw rejected(p).error;return repaired(p,c);}});try{const c=await two(f),old=f.queue.synthesis.detail(c.id).selected;assert.equal(old.status,'queued');assert.equal(old.attemptRuns[0].status,'failed');f.advance(60001);await f.drive();const result=f.queue.synthesis.detail(c.id).selected;assert.equal(result.status,'completed');assert.equal(result.attemptRuns.length,2);assert.equal(result.run.repair.previousRunId,old.attemptRuns[0].id);assert.equal(feedback[1].issues.length,1);assert.deepEqual(result.attemptRuns[0],old.attemptRuns[0]);}finally{await f.close();}
});

test('Codex sends feedback and retains both the rejected and corrected complete outputs',async()=>{
 const f=financialFixture(),dir=mkdtempSync(join(tmpdir(),'feedback-cli-'));try{
  const raw=rejected(f.packet).diagnostic.rawOutput,good=financialDossier(f.packet).rawOutput,binary=join(dir,'codex.mjs');
  writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}let input='';for await(const c of process.stdin)input+=c;const repairing=input.includes('research-output-feedback/1');const raw=repairing?${JSON.stringify(good)}:${JSON.stringify(raw)};fs.writeFileSync(args[args.indexOf('--output-last-message')+1],raw);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:raw}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);chmodSync(binary,0o700);
  const config={binary,model:'test-model',timeoutMs:10000};let error;try{await generateCodexDraft(f.packet,config);}catch(e){error=e;}assert.equal(error.code,'output');const diagnostic=rejectedOutputDiagnostic(error,f.packet.inputHash),feedback=researchOutputFeedback(diagnostic,f.packet);assert(feedback);
  const result=await generateCodexDraft(f.packet,{...config,researchFeedback:feedback});assert.equal(result.status,'candidate');assert.equal(result.rawOutput,good);assert.equal(result.trace.researchFeedbackHash,digest(feedback));assert.equal(result.trace.promptHash,digest(codexPrompt(f.packet,feedback)));assert.equal(diagnostic.rawOutput,raw);assert.deepEqual(result.companyAssessments,financialDossier(f.packet).companyAssessments);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('completed turns have bounded exit grace while hung, cancelled, bad-exit and duplicate-completion calls fail',async()=>{
 const f=financialFixture(),dir=mkdtempSync(join(tmpdir(),'codex-exit-'));try{
  const raw=financialDossier(f.packet).rawOutput,binary=join(dir,'codex.mjs');
  writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}for await(const c of process.stdin){}const mode=args[args.indexOf('--model')+1];fs.writeFileSync(args[args.indexOf('--output-last-message')+1],${JSON.stringify(raw)});console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));if(mode==='duplicate')console.log(JSON.stringify({type:'turn.completed'}));if(mode==='bad-exit')process.exitCode=1;await new Promise(r=>setTimeout(r,mode==='hung'?10000:2200));`);chmodSync(binary,0o700);
  const config={binary,timeoutMs:2000};const result=await generateCodexDraft(f.packet,{...config,model:'clean'}),d=result.trace.runtime.inference;assert(d.durationMs>2000);assert(d.milestones.turnCompletedMs<2000);assert.equal(d.completionExitTimeoutMs,5000);assert.equal(d.deadlinePhase,'completion-exit');assert.equal(result.rawOutput,raw);
  await assert.rejects(generateCodexDraft(f.packet,{...config,model:'hung'}),e=>e.code==='process'&&e.trace.runtime.inference.deadlinePhase==='completion-exit'&&e.trace.runtime.inference.turnCompleted&&e.trace.runtime.inference.milestones.terminationRequestedMs>=5000);
  await assert.rejects(generateCodexDraft(f.packet,{...config,model:'bad-exit'}),e=>e.code==='process'&&e.trace.runtime.inference.exitCode===1);
  await assert.rejects(generateCodexDraft(f.packet,{...config,model:'duplicate'}),e=>e.code==='protocol');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1200);try{await assert.rejects(generateCodexDraft(f.packet,{...config,model:'clean',signal:controller.signal}),e=>e.code==='cancelled');}finally{clearTimeout(timer);}
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('an early completion retains the original process deadline instead of shortening it to five seconds',async t=>{
 const originalTimer=globalThis.setTimeout;let earlyExitCallbacks=0;
 // A timer callback can arrive before the monotonic deadline. Exercise that
 // path deterministically instead of depending on a fractional timer race.
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
  if(!earlyExitCallbacks&&delay>5000&&delay<9000){earlyExitCallbacks++;return originalTimer(callback,1,...args);}
  return originalTimer(callback,delay,...args);
 });
 const f=financialFixture(),dir=mkdtempSync(join(tmpdir(),'codex-early-exit-'));try{
  const raw=financialDossier(f.packet).rawOutput,binary=join(dir,'codex.mjs');
  writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}for await(const c of process.stdin){}fs.writeFileSync(args[args.indexOf('--output-last-message')+1],${JSON.stringify(raw)});console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));await new Promise(r=>setTimeout(r,args[args.indexOf('--model')+1]==='hung-early'?15000:6000));`);chmodSync(binary,0o700);
  const [result]=await Promise.all([generateCodexDraft(f.packet,{binary,model:'early-completion',timeoutMs:9000}),assert.rejects(generateCodexDraft(f.packet,{binary,model:'hung-early',timeoutMs:9000}),e=>e.code==='process'&&e.trace.runtime.inference.deadlinePhase==='completion-exit'&&e.trace.runtime.inference.completionExitDeadlineMs===9000&&e.trace.runtime.inference.milestones.terminationRequestedMs>=9000)]),d=result.trace.runtime.inference;
  assert.equal(result.rawOutput,raw);assert.equal(d.exitCode,0);assert.equal(d.termination,null);
  assert(d.durationMs>=6000);assert(d.durationMs<9000);assert(d.milestones.turnCompletedMs<4000);
  assert(d.completionExitTimeoutMs>5000);assert.equal(d.completionExitDeadlineMs,9000);
  assert.equal(earlyExitCallbacks,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
