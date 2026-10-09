import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';import {openResearch} from '../server/research.mjs';
import {freezeModelComparison,saveModelComparison,runModelComparison,readModelComparison} from '../server/model-comparison.mjs';
import {digest,codexPrompt,CODEX_PROMPT_VERSION,codexDraftSchema,CODEX_SCHEMA_VERSION,CodexResearchError} from '../server/codex-research.mjs';
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'model-pair-')),store=openStore(':memory:'),research=openResearch(store,{seed:false});
 const packets=[0,1].map(i=>research.packet(research.create({title:'Synthetic '+i,summary:'Diagnostic fixture only'}).id));
 const arm={binary:process.execPath,model:'fixture',effort:'low',timeoutMs:5000},spec={title:'Synthetic pair',packets,arms:{baseline:arm,candidate:{...arm,effort:'high'}}};
 return {dir,spec,store,research,plan(){return freezeModelComparison(spec);},save(){const p=this.plan();saveModelComparison(join(dir,'plan'),p);return p;},close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
function result(p,a){const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['Synthetic unknown evidence'],sourceIds:[]})),missingEvidence:['All real facts']},rawOutput=JSON.stringify(d);return {status:'candidate',reviewStatus:'unreviewed',...d,rawOutput,trace:{model:a.model,effort:a.effort,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,promptVersion:CODEX_PROMPT_VERSION,promptHash:digest(codexPrompt(p)),schemaHash:digest(codexDraftSchema(p)),schemaVersion:CODEX_SCHEMA_VERSION,outputHash:digest(rawOutput)}};}
test('two arms use identical frozen packets in predeclared alternating order; all results remain separate from research',async()=>{
 const f=setup();try{const p=f.save(),history=JSON.stringify(f.research.list()),calls=[],dir=join(f.dir,'plan');
 f.spec.packets[0].input.title='Changed after freezing';
 const r=await runModelComparison(dir,{runner:async(packet,arm)=>{calls.push({hash:digest(packet),effort:arm.effort});return result(packet,arm);}});
 assert.deepEqual(calls.map(c=>c.effort),['low','high','high','low']);assert.equal(calls[0].hash,calls[1].hash);assert.equal(calls[2].hash,calls[3].hash);assert.equal(calls[0].hash,p.inputs[0].packetHash);
 assert.deepEqual(r.summary,{planned:4,successful:4,failed:0,cancelled:0,unfinished:0,notStarted:0,completePairs:2});assert.equal(r.forwardEligible,false);assert.equal(JSON.stringify(f.research.list()),history);
 assert.deepEqual(readModelComparison(dir).summary,r.summary);await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('never repeat')}),/EEXIST/);
 assert.throws(()=>saveModelComparison(dir,p),/EEXIST/);
 }finally{f.close();}
});
test('failed and forged outputs retain paired denominators and safe errors, without suppressing the other arm',async()=>{
 const f=setup();try{f.save();let count=0;const r=await runModelComparison(join(f.dir,'plan'),{runner:async(p,a)=>{count++;if(count===1)throw Error('PRIVATE_DIAGNOSTIC');const v=result(p,a);if(count===3)v.trace.effort='wrong';return v;}});
 assert.equal(count,4);assert.equal(r.summary.failed,2);assert.equal(r.summary.completePairs,0);assert.equal(r.summary.successful,2);assert(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC'));
 }finally{f.close();}
});
test('cancellation preserves the started call and every unstarted slot; concurrent execution cannot start twice',async()=>{
 const f=setup();try{f.save();const dir=join(f.dir,'plan'),controller=new AbortController();let release,started;const ready=new Promise(r=>started=r);
 const running=runModelComparison(dir,{signal:controller.signal,runner:async()=>{started();await new Promise(r=>release=r);throw new CodexResearchError('cancelled');}});await ready;
 assert.equal(readModelComparison(dir).summary.unfinished,1);await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('concurrent call')}),/EEXIST/);
 controller.abort();release();const r=await running;assert.equal(r.summary.cancelled,1);assert.equal(r.summary.notStarted,3);assert.equal(r.summary.planned,4);
 }finally{f.close();}
});
test('modified plan, candidate record, executable or source fingerprints cannot silently enter a comparison',async()=>{
 for(const mode of ['plan','binary','result','source']){const f=setup();try{const binary=join(f.dir,'fake-binary');writeFileSync(binary,'frozen executable');for(const arm of Object.values(f.spec.arms))arm.binary=binary;
 f.save();const dir=join(f.dir,'plan');
 if(mode==='binary'){writeFileSync(binary,'changed');await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('changed binary')}),/已变化/);assert(!readdirSync(dir).includes('execution.json'));}
 if(mode==='plan'){const path=join(dir,'plan.json'),p=JSON.parse(readFileSync(path));p.inputs[0].packet.input.title='tampered';writeFileSync(path,JSON.stringify(p));assert.throws(()=>readModelComparison(dir));}
 if(mode==='source'){const path=join(dir,'plan.json'),{hash,...p}=JSON.parse(readFileSync(path));p.sources['prototype/server/model-comparison.mjs'].text+='\n// another candidate';p.sourceHash=digest(p.sources);writeFileSync(path,JSON.stringify({...p,hash:digest(p)}));await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('changed source')}),/已变化/);assert(!readdirSync(dir).includes('execution.json'));}
 if(mode==='result'){await runModelComparison(dir,{runner:async(p,a)=>result(p,a)});const path=join(dir,'0-baseline.result.json'),r=JSON.parse(readFileSync(path));r.candidate.rawOutput='{}';writeFileSync(path,JSON.stringify(r));assert.throws(()=>readModelComparison(dir));}
 }finally{f.close();}}
});
test('bounds and duplicate input checks precede output creation; CLI freeze and report make no model calls',()=>{
 const f=setup();try{for(const spec of [{...f.spec,packets:[]},{...f.spec,packets:[f.spec.packets[0],f.spec.packets[0]]},{...f.spec,arms:{...f.spec.arms,candidate:f.spec.arms.baseline}},{...f.spec,extra:true}])assert.throws(()=>freezeModelComparison(spec));
 const input=join(f.dir,'spec.json'),dir=join(f.dir,'cli');writeFileSync(input,JSON.stringify(f.spec));const script=new URL('../scripts/compare-models.mjs',import.meta.url);
 const p=JSON.parse(execFileSync(process.execPath,[fileURLToPath(script),'freeze',input,dir],{encoding:'utf8'}));assert.equal(p.executed,false);assert.equal(p.calls,4);
 const r=JSON.parse(execFileSync(process.execPath,[fileURLToPath(script),'report',dir],{encoding:'utf8'}));assert.equal(r.summary.notStarted,4);assert.deepEqual(readdirSync(dir),['plan.json']);
 }finally{f.close();}
});
test('CLI run exercises existing structured Codex subprocess protocol and preserves a failed arm',()=>{
 const f=setup();try{
  const binary=join(f.dir,'codex.mjs');writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(args.includes('--version')){console.log('codex-cli 0.160.0-fixture');process.exit(0);}
let text='';for await(const part of process.stdin)text+=part;
const event=x=>console.log(JSON.stringify(x));event({type:'turn.started'});
if(value('--model')==='fail'){event({type:'turn.failed',error:{message:'private failure'}});process.exit(1);}
const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['Synthetic only'],sourceIds:[]})),missingEvidence:['Real evidence']};
fs.writeFileSync(value('--output-last-message'),JSON.stringify(d));event({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}});
`);chmodSync(binary,0o700);for(const arm of Object.values(f.spec.arms))arm.binary=binary;f.spec.packets=f.spec.packets.slice(0,1);f.spec.arms.candidate.model='fail';f.save();
  const script=fileURLToPath(new URL('../scripts/compare-models.mjs',import.meta.url)),dir=join(f.dir,'plan');let stdout;
  try{execFileSync(process.execPath,[script,'run',dir],{encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.fail('partial failure exits 2');}catch(e){assert.equal(e.status,2);stdout=e.stdout;}
  const report=JSON.parse(stdout);assert.equal(report.summary.successful,1);assert.equal(report.summary.failed,1);assert.equal(report.summary.completePairs,0);
  const saved=readModelComparison(dir);assert.match(saved.rows[0].result.candidate.trace.cliVersion,/fixture/);assert.equal(saved.rows[0].result.candidate.trace.toolCallsObserved,0);assert.equal(saved.rows[1].result.failure.code,'process');assert.equal(saved.rows[1].result.failure.trace.model,'fail');assert.equal(saved.rows[1].result.failure.trace.promptHash,saved.plan.inputs[0].promptHash);assert(!JSON.stringify(saved.rows[1]).includes('private failure'));
 }finally{f.close();}
});
test('SIGKILL leaves frozen inputs and an unfinished slot; report never guesses termination or retries',async()=>{
 const f=setup();let child;try{const p=f.save(),dir=join(f.dir,'plan'),before=readFileSync(join(dir,'plan.json'),'utf8');
  const module=new URL('../server/model-comparison.mjs',import.meta.url).href;
  child=spawn(process.execPath,['--input-type=module','-e',`import {runModelComparison} from ${JSON.stringify(module)};await runModelComparison(${JSON.stringify(dir)},{runner:async()=>{console.log('READY');await new Promise(()=>{setInterval(()=>{},1000);});}});`],{stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child did not start')),10000);child.stdout.on('data',b=>{if(String(b).includes('READY')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited before start'));});});
  assert.equal(child.kill('SIGKILL'),true);assert.equal((await closed).signal,'SIGKILL');const r=readModelComparison(dir);assert.equal(r.plan.hash,p.hash);assert.equal(r.summary.unfinished,1);assert.equal(r.summary.notStarted,3);assert.equal(readFileSync(join(dir,'plan.json'),'utf8'),before);await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('no retry')}),/EEXIST/);
 }finally{child?.kill('SIGKILL');f.close();}
});
test('v2 freezes each input schema and rejects a template-only trace; v1 archives remain read-only',async()=>{
 const f=setup();try{
  const p=f.save(),dir=join(f.dir,'plan');assert.equal(p.format,'model-comparison/2');
  for(const i of p.inputs){assert.deepEqual(i.schema,codexDraftSchema(i.packet));assert.equal(i.schemaHash,digest(i.schema));}
  const r=await runModelComparison(dir,{runner:async(packet,arm)=>{const value=result(packet,arm);value.trace.schemaHash=p.schemaHash;return value;}});assert.equal(r.summary.failed,4);
  // Build the former on-disk format, including correctly sealed independent results.
  const old=structuredClone(p);delete old.hash;old.format='model-comparison/1';delete old.schemaVersion;
  for(const i of old.inputs){delete i.schema;delete i.schemaHash;}old.hash=digest(old);
  const legacy=join(f.dir,'legacy');saveModelComparison(legacy,old);
  const seal=v=>({...v,hash:digest(v)});
  for(const slot of old.slots){const candidate=result(old.inputs[slot.input].packet,old.arms[slot.arm]);candidate.trace.schemaHash=old.schemaHash;delete candidate.trace.schemaVersion;
   writeFileSync(join(legacy,slot.id+'.started.json'),JSON.stringify(seal({planHash:old.hash,slotId:slot.id})));
   writeFileSync(join(legacy,slot.id+'.result.json'),JSON.stringify(seal({planHash:old.hash,slotId:slot.id,status:'candidate',candidate})));
  }
  const before=readdirSync(legacy).map(name=>[name,readFileSync(join(legacy,name),'utf8')]);assert.equal(readModelComparison(legacy).summary.successful,4);
  await assert.rejects(runModelComparison(legacy,{runner:()=>assert.fail('legacy must not run')}),/已变化/);
  assert.deepEqual(readdirSync(legacy).map(name=>[name,readFileSync(join(legacy,name),'utf8')]),before);
 }finally{f.close();}
});

function promptSpec(f){
 f.spec.arms.candidate={...f.spec.arms.baseline};
 f.spec.prompts={baseline:null,candidate:{version:'experiment/uncertainty-1',instructions:'SYNTHETIC_PROMPT_VARIANT: first explain unknown quantities. Return the five required sections in order, sourceIds from the packet only, missingEvidence and materialityReviews.'}};
 return f.spec;
}
function promptResult(packet,arm,contract){const r=result(packet,arm);r.trace.promptHash=contract.promptHash;r.trace.promptVersion=contract.promptVersion;return r;}
test('v3 compares different prompts with the same model and exact packets without changing production prompt',async()=>{
 const f=setup();try{promptSpec(f);const builtin=codexPrompt(f.spec.packets[0]),p=f.save(),dir=join(f.dir,'plan'),seen=[];
  assert.equal(p.format,'model-comparison/3');f.spec.prompts.candidate.instructions='Changed after freeze';
  const r=await runModelComparison(dir,{runner:async(packet,arm,contract)=>{seen.push({packet:JSON.stringify(packet),prompt:contract.prompt});return promptResult(packet,arm,contract);}});
  assert.equal(r.summary.completePairs,2);assert.equal(seen[0].packet,seen[1].packet);assert.equal(seen[2].packet,seen[3].packet);
  assert.equal(seen[0].prompt,builtin);assert(seen[1].prompt.includes('SYNTHETIC_PROMPT_VARIANT'));assert(seen[2].prompt.includes('SYNTHETIC_PROMPT_VARIANT'));assert(!seen[1].prompt.includes('Changed after freeze'));
  assert.equal(codexPrompt(f.spec.packets[0]),builtin);assert.equal(r.comparison.promptChanged,true);assert.deepEqual(r.comparison.executionFields,[]);assert.equal(r.comparison.sourceChanged,false);
  assert.equal(r.comparison.prompts.candidate.version,'experiment/uncertainty-1');assert.equal(r.forwardEligible,false);
  await assert.rejects(runModelComparison(dir),/EEXIST/);
 }finally{f.close();}
});
test('prompt recipes reject empty, extra, oversized, unnamed or identical experiments',()=>{
 const f=setup();try{promptSpec(f);for(const prompts of [null,{}, {baseline:null,candidate:null},{...f.spec.prompts,extra:null},{baseline:null,candidate:{version:'codex-research-11',instructions:'test'}},{baseline:null,candidate:{version:'experiment/a',instructions:''}},{baseline:null,candidate:{version:'experiment/a',instructions:'界'.repeat(22000)}},{baseline:null,candidate:{version:'experiment/a',instructions:'test',extra:1}}])assert.throws(()=>freezeModelComparison({...f.spec,prompts}));
  const same={version:'experiment/a',instructions:'same'};assert.throws(()=>freezeModelComparison({...f.spec,prompts:{baseline:same,candidate:{...same,version:'experiment/b'}}}));
 }finally{f.close();}
});
test('custom prompt trace cannot be substituted with the production trace; cancelled pairs stay incomplete',async()=>{
 const f=setup();try{promptSpec(f);f.save();const r=await runModelComparison(join(f.dir,'plan'),{runner:async(p,a)=>result(p,a)});assert.equal(r.summary.successful,2);assert.equal(r.summary.failed,2);assert.equal(r.summary.completePairs,0);
  const second=join(f.dir,'cancel');saveModelComparison(second,f.plan());const c=new AbortController();let calls=0;
  const cancelled=await runModelComparison(second,{signal:c.signal,runner:async(p,a,contract)=>{calls++;if(calls===2)c.abort();return promptResult(p,a,contract);}});
  assert.equal(calls,2);assert.equal(cancelled.summary.successful,1);assert.equal(cancelled.summary.cancelled,1);assert.equal(cancelled.summary.notStarted,2);assert.equal(cancelled.summary.completePairs,0);
 }finally{f.close();}
});
test('resealed prompt changes and mismatched hashes fail before execution; complete archives read without calling Codex',async()=>{
 for(const mode of ['instruction','render','hash']){const f=setup();try{promptSpec(f);const p=f.save(),dir=join(f.dir,'plan');delete p.hash;
  if(mode==='instruction')p.prompts.candidate.instructions+=' changed';
  else {p.inputs[0].prompts.candidate.prompt+=' changed';if(mode==='render')p.inputs[0].prompts.candidate.promptHash=digest(p.inputs[0].prompts.candidate.prompt);}
  p.hash=digest(p);writeFileSync(join(dir,'plan.json'),JSON.stringify(p));await assert.rejects(runModelComparison(dir,{runner:()=>assert.fail('changed prompt must not run')}));assert(!readdirSync(dir).includes('execution.json'));
 }finally{f.close();}}
});
test('CLI v3 sends frozen custom instructions and the exact packet through the actual subprocess adapter',()=>{
 const f=setup();try{promptSpec(f);f.spec.packets=f.spec.packets.slice(0,1);const packet=f.spec.packets[0];packet.input.summary='Literal $& ${notATemplate} {{RESEARCH_PACKET}} marker';packet.inputHash=digest(packet.input);
 const binary=join(f.dir,'prompt-codex.mjs');writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(args.includes('--version')){console.log('codex-cli 0.160.0-fixture');process.exit(0);}
let prompt='';for await(const part of process.stdin)prompt+=part;
const custom=prompt.includes('SYNTHETIC_PROMPT_VARIANT');
if(!prompt.includes(${JSON.stringify(JSON.stringify(packet))})||!args.includes('read-only')||!args.includes('--ignore-user-config'))process.exit(1);
const schema=JSON.parse(fs.readFileSync(value('--output-schema'),'utf8'));if(!schema.properties.sections)process.exit(1);
const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:[custom?'Custom prompt used':'Production prompt used'],sourceIds:[]})),missingEvidence:['Synthetic evidence only'],materialityReviews:[]};
fs.writeFileSync(value('--output-last-message'),JSON.stringify(d));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:5,output_tokens:8}}));
`);chmodSync(binary,0o700);for(const arm of Object.values(f.spec.arms))arm.binary=binary;
 const spec=join(f.dir,'spec.json'),dir=join(f.dir,'cli'),script=fileURLToPath(new URL('../scripts/compare-models.mjs',import.meta.url));writeFileSync(spec,JSON.stringify(f.spec));
 const frozen=JSON.parse(execFileSync(process.execPath,[script,'freeze',spec,dir],{encoding:'utf8'}));assert.equal(frozen.executed,false);assert.equal(frozen.calls,2);
 const r=JSON.parse(execFileSync(process.execPath,[script,'run',dir],{encoding:'utf8'}));assert.equal(r.summary.completePairs,1);assert(r.comparison.promptChanged);assert.deepEqual(r.comparison.executionFields,[]);
 const saved=readModelComparison(dir);assert.equal(saved.rows[0].result.candidate.sections[0].paragraphs[0],'Production prompt used');assert.equal(saved.rows[1].result.candidate.sections[0].paragraphs[0],'Custom prompt used');
 for(const row of saved.rows){assert.equal(row.result.candidate.trace.promptHash,saved.plan.inputs[0].prompts[row.arm].promptHash);assert.equal(row.result.candidate.trace.toolCallsObserved,0);}
 const before=readdirSync(dir).map(n=>[n,readFileSync(join(dir,n),'utf8')]);assert.equal(JSON.parse(execFileSync(process.execPath,[script,'report',dir],{encoding:'utf8'})).summary.completePairs,1);assert.deepEqual(readdirSync(dir).map(n=>[n,readFileSync(join(dir,n),'utf8')]),before);
 }finally{f.close();}
});
