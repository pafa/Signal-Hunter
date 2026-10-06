import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync,readdirSync,cpSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {collectEvaluationSources} from '../server/evaluation-baseline.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {freezeSourceComparison,saveSourceComparison,runSourceComparison,readSourceComparison} from '../server/source-comparison.mjs';
import {digest} from '../server/codex-research.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
function setup(){
 const directory=mkdtempSync(join(tmpdir(),'source-pair-')),sources=collectEvaluationSources(root),store=openStore(':memory:'),research=openResearch(store,{seed:false});
 const packet=research.packet(research.create({title:'Synthetic source comparison',summary:'Test-only $& material; no investment facts'}).id);
 const roots={};
 for(const role of ['baseline','candidate']){
  const path=join(directory,role);roots[role]=path;
  for(const [file,data] of Object.entries(sources)){mkdirSync(dirname(join(path,file)),{recursive:true});writeFileSync(join(path,file),data.text);}
  symlinkSync(join(root,'prototype/node_modules'),join(path,'prototype/node_modules'),'dir');
 }
 const changed=join(roots.candidate,'prototype/server/codex-research.mjs');writeFileSync(changed,readFileSync(changed,'utf8').replace("'codex-research-8'","'codex-research-8-source-test'").replace('你是新闻事件研究助手。','SOURCE_CANDIDATE 你是新闻事件研究助手。'));
 const binary=join(directory,'fake-codex.mjs');writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(args.includes('--version')){console.log('codex-cli 0.160.0-fixture');process.exit(0);}
let prompt='';for await(const c of process.stdin)prompt+=c;
if(value('--model')==='fail'){console.log(JSON.stringify({type:'turn.failed'}));process.exit(1);}
if(value('--model')==='hang'){console.log(JSON.stringify({type:'turn.started'}));setInterval(()=>{},1000);await new Promise(()=>{});}
const custom=prompt.includes('SOURCE_CANDIDATE');
const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:[custom?'候选源码实际运行':'基线源码实际运行'],sourceIds:[]})),missingEvidence:['合成测试，不是投资事实'],materialityReviews:[]};
fs.writeFileSync(value('--output-last-message'),JSON.stringify(d));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`);chmodSync(binary,0o700);
 const arm={binary,model:'fixture',effort:'low',timeoutMs:10000},spec={title:'Synthetic source pair',packets:[packet],arms:{baseline:arm,candidate:{...arm}},sources:roots};
 return {directory,store,roots,spec,async save(name='plan'){const plan=await freezeSourceComparison(spec);saveSourceComparison(join(directory,name),plan);return plan;},close(){store.close();rmSync(directory,{recursive:true,force:true});}};
}
test('source comparison runs each frozen implementation in a separate process with identical packets',async()=>{
 const f=setup();try{const p=await f.save(),dir=join(f.directory,'plan'),r=await runSourceComparison(dir);
  assert.equal(r.summary.completePairs,1,JSON.stringify(r.rows.map(v=>({status:v.status,failure:v.result?.failure}))));assert.equal(r.summary.successful,2);assert.equal(r.comparison.sourceChanged,true);assert.equal(r.comparison.promptChanged,true);assert.equal(r.comparison.schemaChanged,false);assert.deepEqual(r.comparison.executionFields,[]);assert.equal(r.comparison.dependenciesChanged,false);
  assert.equal(r.rows[0].result.candidate.sections[0].paragraphs[0],'基线源码实际运行');assert.equal(r.rows[1].result.candidate.sections[0].paragraphs[0],'候选源码实际运行');assert.notEqual(p.implementations.baseline.sourceHash,p.implementations.candidate.sourceHash);
  for(const row of r.rows)assert.equal(row.result.candidate.trace.inputHash,p.inputs[0].packet.inputHash);
  const before=readdirSync(dir).map(n=>[n,readFileSync(join(dir,n),'utf8')]);assert.deepEqual(readSourceComparison(dir).summary,r.summary);assert.deepEqual(readdirSync(dir).map(n=>[n,readFileSync(join(dir,n),'utf8')]),before);
  await assert.rejects(runSourceComparison(dir),/EEXIST/);assert.equal(r.forwardEligible,false);
 }finally{f.close();}
});
test('source or binary changes after freezing stop before an execution record is created',async()=>{
 for(const target of ['source','binary']){const f=setup();try{await f.save();const path=target==='source'?join(f.roots.candidate,'prototype/server/codex-research.mjs'):f.spec.arms.candidate.binary;writeFileSync(path,readFileSync(path,'utf8')+'\n// changed');
  await assert.rejects(runSourceComparison(join(f.directory,'plan')),/environment-changed/);assert.deepEqual(readdirSync(join(f.directory,'plan')),['plan.json']);
 }finally{f.close();}}
});
test('source contract cannot substitute another version trace; rejected candidate keeps full denominator',async()=>{
 const f=setup();try{const path=join(f.roots.candidate,'prototype/server/codex-research.mjs');writeFileSync(path,readFileSync(path,'utf8').replace('promptHash:digest(prompt)','promptHash:"wrong"'));
  await f.save();const r=await runSourceComparison(join(f.directory,'plan'));assert.equal(r.summary.successful,1);assert.equal(r.summary.failed,1);assert.equal(r.summary.completePairs,0);
 }finally{f.close();}
});
test('one failed subprocess does not suppress the other arm or promote a partial pair',async()=>{
 const f=setup();try{f.spec.arms.baseline.model='fail';await f.save();const r=await runSourceComparison(join(f.directory,'plan'));assert.equal(r.summary.failed,1);assert.equal(r.summary.successful,1);assert.equal(r.summary.completePairs,0);assert.equal(r.rows[0].result.failure.code,'process');assert.equal(r.rows[0].result.failure.trace.model,'fail');
 }finally{f.close();}
});
test('same source and invalid source specifications fail before creating an experiment',async()=>{
 const f=setup();try{await assert.rejects(freezeSourceComparison({...f.spec,sources:{baseline:f.roots.baseline,candidate:f.roots.baseline}}),/两份不同源码/);await assert.rejects(freezeSourceComparison({...f.spec,sources:{baseline:'relative',candidate:f.roots.candidate}}));await assert.rejects(freezeSourceComparison({...f.spec,extra:true}));
 }finally{f.close();}
});
test('CLI selects source plans explicitly and reports them without invoking candidates again',async()=>{
 const f=setup();try{const spec=join(f.directory,'spec.json'),dir=join(f.directory,'cli'),script=fileURLToPath(new URL('../scripts/compare-models.mjs',import.meta.url));writeFileSync(spec,JSON.stringify(f.spec));
  const frozen=JSON.parse(execFileSync(process.execPath,[script,'freeze',spec,dir],{encoding:'utf8'}));assert.equal(frozen.executed,false);assert.equal(frozen.calls,2);
  const report=JSON.parse(execFileSync(process.execPath,[script,'run',dir],{encoding:'utf8'}));assert.equal(report.summary.completePairs,1);assert.equal(report.comparison.sourceChanged,true);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[script,'report',dir],{encoding:'utf8'})).summary,report.summary);
  const p=JSON.parse(readFileSync(join(dir,'plan.json'),'utf8'));p.inputs[0].packet.input.title='tampered';writeFileSync(join(dir,'plan.json'),JSON.stringify(p));assert.throws(()=>readSourceComparison(dir));
 }finally{f.close();}
});

test('installed dependency content changes cannot reuse the frozen candidate environment',async()=>{
 const f=setup();try{
  const dependencyAlias=join(f.directory,'dependency-alias');symlinkSync(join(root,'prototype/node_modules'),dependencyAlias,'dir');
  const sourceManifest=join(dependencyAlias,'jsdom/package.json'),originalManifest=readFileSync(sourceManifest);
  // Resolve the root alias before copying; keep internal package links intact.
  // Copying the alias itself would make this drift fixture edit shared dependencies.
  const installed=join(f.directory,'deps/node_modules');mkdirSync(dirname(installed),{recursive:true});cpSync(realpathSync(dependencyAlias),installed,{recursive:true,verbatimSymlinks:true,filter:path=>!path.includes('/node_modules/.vite')});
  assert.equal(lstatSync(installed).isDirectory(),true);assert.notEqual(realpathSync(installed),realpathSync(dependencyAlias));
  for(const path of Object.values(f.roots)){rmSync(join(path,'prototype/node_modules'));symlinkSync(installed,join(path,'prototype/node_modules'),'dir');}
  await f.save();const manifest=join(installed,'jsdom/package.json');writeFileSync(manifest,readFileSync(manifest,'utf8')+'\n');
  await assert.rejects(runSourceComparison(join(f.directory,'plan')),/environment-changed/);assert.deepEqual(readdirSync(join(f.directory,'plan')),['plan.json']);
  assert.deepEqual(readFileSync(sourceManifest),originalManifest,'dependency drift must remain inside the isolated fixture');
 }finally{f.close();}
});
test('concurrent invocation is excluded and cancellation preserves the unstarted candidate slot',async()=>{
 const f=setup();try{f.spec.arms.baseline.model='hang';f.spec.arms.baseline.timeoutMs=20000;await f.save();const dir=join(f.directory,'plan'),controller=new AbortController();
  const running=runSourceComparison(dir,{signal:controller.signal});
  await new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(readdirSync(dir).includes('0-baseline.started.json')){clearInterval(timer);resolve();}else if(Date.now()-start>10000){clearInterval(timer);reject(Error('not started'));}},50);});
  assert.equal(readSourceComparison(dir).summary.unfinished,1);await assert.rejects(runSourceComparison(dir),/EEXIST/);
  controller.abort();const r=await running;assert.equal(r.summary.cancelled,1);assert.equal(r.summary.notStarted,1);assert.equal(r.summary.completePairs,0);
 }finally{f.close();}
});
test('large UTF-8 packets survive worker pipe boundaries without changing evidence hashes',async()=>{
 const f=setup();try{const packet=f.spec.packets[0];packet.input.summary='界'.repeat(30000)+' $&';packet.inputHash=digest(packet.input);await f.save();const r=await runSourceComparison(join(f.directory,'plan'));assert.equal(r.summary.completePairs,1);for(const row of r.rows)assert.equal(row.result.candidate.trace.inputHash,packet.inputHash);
 }finally{f.close();}
});
