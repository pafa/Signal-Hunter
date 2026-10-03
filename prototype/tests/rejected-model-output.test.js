import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {runStructuredCodex,CodexResearchError,rejectedOutputDiagnostic,digest} from '../server/codex-research.mjs';
const raw='{"untrusted":"diagnostic-only <script>never execute</script>"}',exec=promisify(execFile);
async function cli(){
 const dir=await mkdtemp(join(tmpdir(),'signal-rejected-output-')),binary=join(dir,'codex');
 await writeFile(binary,`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(args.includes('--version')){console.log('codex-cli 0.160.0-test');process.exit(0);}
for await(const c of process.stdin){}
const model=value('--model'),out=value('--output-last-message');
fs.writeFileSync(${JSON.stringify(join(dir,'cwd'))},process.cwd());
console.error('private stderr must never be retained');
if(model==='tool'){console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));process.exit(0);}
if(model==='symlink'){fs.writeFileSync('target','{}');fs.symlinkSync('target',out);}
else fs.writeFileSync(out,model==='oversize'?'x'.repeat(262145):model==='invalid-json'?'not JSON':${JSON.stringify(raw)});
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`);await chmod(binary,0o700);return {dir,binary,close:()=>rm(dir,{recursive:true,force:true})};
}
const request={prompt:'Synthetic diagnostic',schema:{type:'object'},promptVersion:'test',inputHash:'frozen-test-input',validate:()=>{throw new CodexResearchError('output');}};
test('only bounded completed output is retained; errors and unsafe output files carry no model text',async()=>{
 const c=await cli();try{
  for(const [model,stage] of [['invalid-json','json'],['schema','schema'],['oversize',null],['symlink',null],['tool',null]]){
   let error;try{await runStructuredCodex(request,{binary:c.binary,model,timeoutMs:5000});}catch(e){error=e;}
   assert.ok(error instanceof CodexResearchError);const diagnostic=rejectedOutputDiagnostic(error,request.inputHash);
   if(stage){assert.equal(diagnostic.stage,stage);assert.equal(diagnostic.rawOutput,stage==='json'?'not JSON':raw);assert.equal(diagnostic.outputHash,digest(diagnostic.rawOutput));assert.equal(rejectedOutputDiagnostic(error,'another-input'),undefined);}
   else assert.equal(diagnostic,undefined);
   assert.doesNotMatch(JSON.stringify(error)+error.message,/diagnostic-only|not JSON|private stderr/);
   await assert.rejects(readdir(await readFile(join(c.dir,'cwd'),'utf8')),e=>e.code==='ENOENT');
  }
 }finally{await c.close();}
});
test('diagnostic extraction requires matching output hash, input hash, stage and UTF-8 byte limit',()=>{
 for(const [code,stage,text,hash] of [['process','schema',raw,digest(raw)],['output','other',raw,digest(raw)],['output','json',raw,'wrong'],['output','json','字'.repeat(90000),digest('字'.repeat(90000))]]){
  const e=new CodexResearchError(code,{inputHash:request.inputHash,outputHash:hash});e.outputDiagnostic={stage,rawOutput:text};
  assert.equal(rejectedOutputDiagnostic(e,request.inputHash),undefined);
 }
});
test('all four persistent model workflows retain rejected output across restart without creating candidates or changing research',async()=>{
 const c=await cli(),path=join(c.dir,'fixture.sqlite'),config={binary:c.binary,model:'schema',timeoutMs:5000};
 let store=openStore(path),service=createService(store,{mode:'research',modelConfig:config});
 try{
  const at='2026-10-03T00:00:00Z',news=['a','b'].map(id=>({id:digest(id),title:'合成测试公告 '+id,url:'https://example.com/'+id,publisher:'合成',publishedAt:at}));store.ingest(news,at);
  let topic=service.research.create({title:'合成研究',summary:'不是真实事件'});
  topic=service.research.saveMaterial(topic.id,{version:topic.version,title:'合成材料',sourceName:'合成',body:'虚构公司宣布拟收购，尚未完成。',scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'仅测试'});
  const material=service.research.materialList(topic.id).materials[0],input={version:topic.version,materialId:material.id,revision:material.revision,requestId:'diagnostic-test-0001'},book=service.paper.snapshot(),history=service.research.history(topic.id);
  const saved=[];
  for(const [name,start] of [['modelResearch',()=>service.modelResearch.start(topic.id,{version:topic.version})],['materialEvents',()=>service.materialEvents.start(topic.id,input)],['companyEntities',()=>service.companyEntities.start(topic.id,input)],['semanticEvents',()=>service.semanticEvents.start({left:{id:news[0].id,revision:1},right:{id:news[1].id,revision:1}})]]){
   const id=start().id,run=await service[name].wait(id);assert.equal(run.status,'failed');assert.equal(run.failure.code,'output');assert.equal(run.candidate,undefined);
   assert.deepEqual(run.outputDiagnostic,{stage:'schema',rawOutput:raw,outputHash:digest(raw)});assert.equal(run.failure.trace.inputHash,run.packet.inputHash);
   const list=name==='semanticEvents'?service[name].list():service[name].list(topic.id);assert.doesNotMatch(JSON.stringify(list),/diagnostic-only/);
   saved.push({name,id,diagnostic:run.outputDiagnostic});
  }
  assert.throws(()=>service.modelResearch.adopt(topic.id,saved[0].id,{version:topic.version}),/不可采纳/);
  assert.throws(()=>service.materialEvents.decide(topic.id,saved[1].id,{eventIndex:0,version:0,action:'create',note:'不得确认失败'}));
  assert.throws(()=>service.companyEntities.decide(topic.id,saved[2].id,{mentionIndex:0,version:0,action:'link',symbol:'NVDA.US',topicVersion:topic.version,note:'不得确认失败'}));
  assert.throws(()=>service.semanticEvents.decide(saved[3].id,{version:0,action:'accept',note:'不得确认失败'}));
  assert.deepEqual(service.research.get(topic.id),topic);assert.deepEqual(service.research.history(topic.id),history);assert.deepEqual(service.paper.snapshot(),book);
  await service.close();store.close();store=openStore(path);service=createService(store,{mode:'research',modelConfig:config});
  for(const {name,id,diagnostic} of saved){const run=name==='semanticEvents'?service[name].get(id):service[name].get(topic.id,id);assert.equal(run.status,'failed');assert.deepEqual(run.outputDiagnostic,diagnostic);}
 }finally{await service.close();store.close();await c.close();}
});
test('CLI writes rejected output only to private failure file, never to terminal output',async()=>{
 const c=await cli(),store=openStore(':memory:'),service=createService(store,{mode:'research'});try{
  const topic=service.research.create({title:'合成失败诊断',summary:'仅测试CLI留档'}),packet=service.research.packet(topic.id),input=join(c.dir,'input.json'),out=join(c.dir,'out');await writeFile(input,JSON.stringify(packet));
  const script=fileURLToPath(new URL('../scripts/codex-research.mjs',import.meta.url));let failed;
  try{await exec(process.execPath,[script,input,out],{env:{...process.env,SIGNAL_CODEX_BIN:c.binary,SIGNAL_CODEX_MODEL:'schema'}});}catch(e){failed=e;}
  assert.equal(failed.code,2);assert.doesNotMatch(failed.stdout+failed.stderr,/diagnostic-only|private stderr/);
  const record=JSON.parse(await readFile(join(out,'failure.json'),'utf8'));assert.equal(record.outputDiagnostic.rawOutput,raw);assert.equal(record.outputDiagnostic.outputHash,record.trace.outputHash);assert.equal(record.status,'failed');assert.deepEqual((await readdir(out)).sort(),['failure.json','input.json']);
 }finally{await service.close();store.close();await c.close();}
});
