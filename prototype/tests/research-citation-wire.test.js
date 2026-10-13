import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexDraftSchema,validateCodexDraft,generateCodexDraft,digest,CODEX_SCHEMA_VERSION,CODEX_DRAFT_SCHEMA} from '../server/codex-research.mjs';
import {CITATION_WIRE_VERSION,CITATION_ID_PATTERN,expandCitationWire} from '../server/research-citation-wire.mjs';
import {financialFixture} from './helpers/research-financials-fixture.mjs';
import {actionDossier} from './helpers/research-action-fixture.mjs';

function encoded(expanded){
 const pool=[],ids=new Map();
 const visit=v=>Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='citations'?x.map(c=>{const key=JSON.stringify(c);if(!ids.has(key)){const id='q'+(ids.size+1);ids.set(key,id);pool.push({id,...c});}return ids.get(key);}):visit(x)])):v;
 const result=visit(expanded);return {wireFormat:CITATION_WIRE_VERSION,citationPool:pool,...result};
}
const full=packet=>({...JSON.parse(actionDossier(packet).rawOutput),materialityReviews:[],sourceRequests:[]});
test('shared citations restore every company, financial scenario, action and holding citation without changing legacy research',async()=>{
 const f=financialFixture();try{
  const expanded=full(f.packet),wire=encoded(expanded),before=JSON.stringify(wire),packet=JSON.stringify(f.packet);
  assert.equal(wire.citationPool.length,1);assert(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(expanded)));
  assert.deepEqual(expandCitationWire(wire),expanded);assert.deepEqual(validateCodexDraft(wire,f.packet),validateCodexDraft(expanded,f.packet));
  assert.equal(expandCitationWire(expanded),expanded);assert.equal(JSON.stringify(wire),before);assert.equal(JSON.stringify(f.packet),packet);
  const restored=expandCitationWire(wire),a=restored.companyAssessments[0];a.financials.metrics[0].baseline.citations[0].quote='changed';assert.notEqual(a.financials.metrics[0].affected.citations[0].quote,'changed');assert.notEqual(wire.citationPool[0].quote,'changed');
 }finally{await f.close();}
});
test('wire rejects dangling, duplicate, unused and mixed references and still applies original source and finance checks',async()=>{
 const f=financialFixture();try{
  const changes=[w=>delete w.wireFormat,w=>w.wireFormat='research-citations/999',w=>delete w.citationPool,w=>w.citationPool.push(w.citationPool[0]),w=>w.citationPool.push({...w.citationPool[0],id:'q999'}),w=>w.citationPool[0].id='__proto__',w=>w.citationPool[0].field='summary',w=>w.citationPool[0].extra=true,w=>w.citationPool[0].quote+=' invented',w=>w.citationPool[0].evidenceId='material:foreign',w=>w.companyAssessments[0].recommendation.citations=['missing'],w=>w.companyAssessments[0].recommendation.citations=[{...w.citationPool[0]}],w=>w.companyAssessments[0].recommendation.citations=['q1','q1'],w=>w.companyAssessments[0].financials.metrics[0].baseline.value=101,w=>w.companyAssessments[0].financials.valuation.currency='HKD',w=>w.companyAssessments[0].recommendation.validUntil='2020-01-01T00:00:00Z',w=>w.companyAssessments[0].symbol='AAPL.US',w=>w.sections[0].sourceIds=['q1']];
  for(const change of changes){const w=encoded(full(f.packet));change(w);assert.throws(()=>validateCodexDraft(w,f.packet),e=>e.code==='output');}
  const changed=structuredClone(f.packet);changed.input.evidence[0].material.revision++;assert.throws(()=>validateCodexDraft(encoded(full(f.packet)),changed),e=>e.code==='output');
 }finally{await f.close();}
});
test('schema retains all research fields and per-use reference bounds while declaring one packet-bound quote pool',async()=>{
 const f=financialFixture();try{
  const before=JSON.stringify(f.packet),schema=codexDraftSchema(f.packet),a=schema.properties.companyAssessments.items.properties;
  assert.equal(schema.properties.wireFormat.enum[0],CITATION_WIRE_VERSION);assert.deepEqual(schema.properties.citationPool.items.properties.evidenceId.enum,f.packet.input.evidence.map(e=>e.id));
  for(const d of Object.values(a.analysis.properties)){assert.deepEqual(d.properties.citations.items,{type:'string',pattern:CITATION_ID_PATTERN});assert.equal(d.properties.citations.maxItems,3);}
  assert.equal(a.financials.properties.metrics.maxItems,8);assert.deepEqual(a.financials.properties.metrics.items.properties.baseline.anyOf[0].properties.citations.items,{type:'string',pattern:CITATION_ID_PATTERN});const trade=a.recommendation.anyOf.find(v=>v.properties.version.enum.includes('research-action/1')),watch=a.recommendation.anyOf.find(v=>v.properties.version.enum.includes('research-watch/1'));
  assert.deepEqual(trade.properties.holdingHorizon.anyOf[1].properties.citations.items,{type:'string',pattern:CITATION_ID_PATTERN});
  for(const branch of [trade,watch]){assert.deepEqual(branch.properties.citations.items,{type:'string',pattern:CITATION_ID_PATTERN});assert.equal(branch.properties.citations.maxItems,3);}
  assert.deepEqual(watch.properties.validUntil,{type:'null'});assert.deepEqual(watch.properties.holdingHorizon.properties.status.enum,['unknown']);
  const legacy=structuredClone(f.packet);delete legacy.watchReviewContract;assert.deepEqual(codexDraftSchema(legacy).properties.companyAssessments.items.properties.recommendation,trade);
  assert.equal(schema.properties.materialityReviews.items.properties.citations.maxItems,CODEX_DRAFT_SCHEMA.properties.materialityReviews.items.properties.citations.maxItems);assert.equal(schema.properties.sections.items.properties.sourceIds.items.type,'string');assert.equal(JSON.stringify(f.packet),before);
  const p=structuredClone(f.packet);p.input.evidence=[];p.inputHash=digest(p.input);assert.equal(codexDraftSchema(p).properties.citationPool.maxItems,0);
 }finally{await f.close();}
});
test('actual CLI wire output keeps original bytes and hash while yielding fully checked expanded research',async()=>{
 const f=financialFixture(),dir=await mkdtemp(join(tmpdir(),'signal-wire-test-'));try{
  const expanded=full(f.packet),raw=JSON.stringify(encoded(expanded)),binary=join(dir,'codex');
  await writeFile(binary,`#!/usr/bin/env node\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version')){console.log('codex-cli 0.159.0-test');process.exit(0);}for await(const c of process.stdin){}const raw=${JSON.stringify(raw)};fs.writeFileSync(args[args.indexOf('--output-last-message')+1],raw);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:raw}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);await chmod(binary,0o700);
  const candidate=await generateCodexDraft(f.packet,{binary,model:'test-model',timeoutMs:10000});
  assert.equal(candidate.rawOutput,raw);assert.equal(candidate.trace.outputHash,digest(raw));assert.equal(candidate.trace.schemaVersion,CODEX_SCHEMA_VERSION);assert.equal(candidate.trace.inputHash,f.packet.inputHash);assert.deepEqual(candidate.companyAssessments,validateCodexDraft(expanded,f.packet).companyAssessments);assert.equal(candidate.citationPool,undefined);
 }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
test('run adoption revalidates compact raw output and never substitutes tampered expanded citations',async()=>{
 const f=financialFixture({runner:packet=>{const r=actionDossier(packet),rawOutput=JSON.stringify(encoded(full(packet)));return {...r,materialityReviews:[],sourceRequests:[],rawOutput,trace:{...r.trace,outputHash:digest(rawOutput)}};}});try{
  const before=f.service.paper.snapshot(),started=f.service.modelResearch.start(f.topic.id,{version:f.topic.version}),run=await f.service.modelResearch.wait(started.id);
  assert.equal(run.status,'candidate');const row=f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(run.id),saved=JSON.parse(row.payload);saved.candidate.companyAssessments[0].analysis.impactMechanism.citations[0].quote='invented';f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(saved),run.id);
  assert.throws(()=>f.service.modelResearch.adopt(f.topic.id,run.id,{version:f.topic.version}));f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(row.payload,run.id);
  const adopted=f.service.modelResearch.adopt(f.topic.id,run.id,{version:f.topic.version});assert.equal(adopted.dossier.sourceModelRun.id,run.id);assert.equal(f.service.modelResearch.get(f.topic.id,run.id).candidate.rawOutput,run.candidate.rawOutput);assert.deepEqual(f.service.paper.snapshot(),before);
 }finally{await f.close();}
});
