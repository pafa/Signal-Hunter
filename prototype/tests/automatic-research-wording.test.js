import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {automaticResearchPacket,AUTOMATIC_RESEARCH_WORKFLOW,useStoredOutputContract,useStoredResearchWorkflow} from '../server/research-output-contract.mjs';
import {codexPrompt,codexDraftSchema,digest,validatePacket} from '../server/codex-research.mjs';
import {fixture,config,dossier} from './automatic-research-fixture.mjs';
const row=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' ORDER BY rowid LIMIT 1").get();

test('automatic wording keeps old prompts byte-identical, evidence unchanged and trading authority separate',()=>{
 const input={topicId:'workflow-test',topicVersion:1,title:'合成研究',evidence:[]},manual={schema:'event-research-packet-1',analysisMode:'assistant-review-required',outputContract:'research-output-contract/2',input,inputHash:digest(input)},saved=JSON.stringify(manual);
 // Frozen with the R98 program before this wording change.
 assert.equal(digest(codexPrompt(manual)),'7858aae6e81d929f32c513a4fde4fcfaedec9663abff1c5a32f8e1e057f46028');
 const automatic=validatePacket(automaticResearchPacket(manual));assert.equal(JSON.stringify(manual),saved);assert.equal(automatic.inputHash,manual.inputHash);assert.deepEqual(automatic.input,manual.input);assert.deepEqual(codexDraftSchema(automatic),codexDraftSchema(manual));
 const prompt=codexPrompt(automatic);assert.match(prompt,/中间结果不要求本人逐项采纳/);assert.match(prompt,/最终买卖由本人决定/);assert.match(prompt,/不要声称结果已经保存/);assert(!prompt.includes('用中文输出待本人复核的研判草稿'));
 for(const value of [null,'automatic-approval','unknown/1'])assert.throws(()=>validatePacket({...manual,researchWorkflow:value}),e=>e.code==='packet');
 assert.equal(digest(codexPrompt(useStoredOutputContract(automatic,manual))),digest(codexPrompt(manual)));
 assert.equal(useStoredOutputContract(manual,automatic).researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);
 const newEvidence={...manual,input:{...input,title:'新证据'},inputHash:digest({...input,title:'新证据'})};
 assert.equal(useStoredResearchWorkflow(newEvidence,automatic).researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(useStoredResearchWorkflow(newEvidence,manual).researchWorkflow,undefined);assert.equal(useStoredResearchWorkflow(newEvidence,automatic).inputHash,newEvidence.inputHash);
});

test('new automatic dossiers carry the frozen wording policy through dispatch and save without a human checkpoint or order',async()=>{
 const packets=[];const f=fixture({researchRunner:p=>{packets.push(p);return dossier(p);}});try{
  const books=f.service.paper.snapshot();f.add(1);await f.until(()=>row(f)?.status==='completed');
  const j=row(f),p=JSON.parse(j.payload),run=f.service.modelResearch.get(j.topic_id,j.run_id);
  assert.equal(p.packet.researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(packets.length,1);assert.equal(packets[0].researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(run.packet.researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(run.status,'adopted');assert.equal(run.actor.kind,'system');
  assert.equal(f.service.research.packet(j.topic_id).researchWorkflow,undefined,'manual material exports keep their own workflow');assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);assert.deepEqual(f.service.paper.snapshot(),books);
 }finally{await f.close();}
});

test('a frozen legacy automatic dossier survives restart and quota wait without adopting the new prompt or rewriting its input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-research-wording-')),path=join(dir,'test.sqlite');let f=fixture({path});try{
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:2});f.add(1);await f.until(()=>!!row(f));
  const j=row(f),p=JSON.parse(j.payload);delete p.packet.researchWorkflow;
  // Construct a pre-change queue fixture; production never rewrites old packets.
  const stable={...p.packet};delete stable.generatedAt;p.executionHash=digest({kind:'dossier',packet:stable,prompt:codexPrompt(stable),schema:codexDraftSchema(stable),configHash:digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs})});f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),j.id);
  const prompt=codexPrompt(p.packet),books=f.service.paper.snapshot();await f.close();const received=[];f=fixture({path,researchRunner:packet=>{received.push(packet);return dossier(packet);}});
  assert.equal(f.queue.snapshot().events.items.find(x=>x.id===j.id).stale,false);await f.drive(3);assert.equal(f.calls.dossier,0);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});await f.until(()=>row(f)?.status==='completed');
  assert.equal(received.length,1);assert.equal(received[0].researchWorkflow,undefined);assert.equal(codexPrompt(received[0]),prompt);assert.deepEqual(JSON.parse(row(f).payload).packet,p.packet);assert.deepEqual(f.service.paper.snapshot(),books);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
