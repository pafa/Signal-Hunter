import {readFileSync,readdirSync,lstatSync,realpathSync,readlinkSync,mkdirSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {digest,codexEnvironment,validatePacket} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {comparisonRecipe,comparisonInputs,comparisonSlots,comparisonSources,readComparisonArtifact as read,writeComparisonArtifact as write,sealComparisonArtifact as seal,checkComparisonArtifact as check,encodeComparisonArtifact as encode} from './model-comparison.mjs';
const worker=fileURLToPath(new URL('../scripts/source-comparison-worker.mjs',import.meta.url));
const workerText=readFileSync(worker,'utf8'),loadedHostHash=digest(comparisonSources());
const roles=['baseline','candidate'],format='source-comparison/1';
const fail=()=>{throw Error('源码对照计划、候选运行环境或记录不完整');};
const fileHash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function dependencies(root){
 const directory=realpathSync(join(root,'prototype/node_modules')),files={},excludedRootCaches=['.vite','.vite-temp'];let bytes=0,count=0;
 function walk(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(path===directory&&excludedRootCaches.includes(entry.name))continue;
  const absolute=join(path,entry.name),key=relative(directory,absolute),stat=lstatSync(absolute);
  if(++count>50000)fail();
  if(stat.isSymbolicLink()){
   const target=realpathSync(absolute),rel=relative(directory,target);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))fail();
   files[key]={link:readlinkSync(absolute)};
  }else if(stat.isDirectory())walk(absolute);
  else if(stat.isFile()){bytes+=stat.size;if(bytes>1024*1024*1024||stat.size>128*1024*1024)fail();files[key]={sha256:fileHash(absolute),bytes:stat.size};}
  else fail();
 }}
 walk(directory);return {directory,files,hash:digest(files),bytes,excludedRootCaches};
}
function implementation(path){
 if(typeof path!=='string'||!isAbsolute(path))fail();
 const root=realpathSync(path),sources=collectEvaluationSources(root),installed=dependencies(root);
 return {root,sources,sourceHash:digest(sources),dependencies:installed};
}
function validContract(c,input){
 if(!c||c.packetHash!==input.packetHash||typeof c.prompt!=='string'||Buffer.byteLength(c.prompt)>1048576||digest(c.prompt)!==c.promptHash||!c.schema||digest(c.schema)!==c.schemaHash||typeof c.promptVersion!=='string'||!c.promptVersion||typeof c.schemaVersion!=='string'||!c.schemaVersion)fail();
 return c;
}
async function invoke(root,action,payload,{signal,timeoutMs=30000,workerPath=worker}={}){
 if(signal?.aborted)throw Error('cancelled');
 const cwd=await mkdtemp(join(tmpdir(),'signal-source-comparison-'));
 try{return await new Promise((resolvePromise,reject)=>{
  const child=spawn(process.execPath,[workerPath],{cwd,env:codexEnvironment(),stdio:['pipe','pipe','pipe'],shell:false});
  let output='',bytes=0,errorBytes=0,failure,killer;
  const stop=reason=>{if(failure)return;failure=reason;child.kill('SIGTERM');killer=setTimeout(()=>child.kill('SIGKILL'),3000);};
  const abort=()=>stop('cancelled'),timer=setTimeout(()=>stop('timeout'),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{bytes+=Buffer.byteLength(b);if(bytes>32*1024*1024){stop('limit');return;}output+=b;});
  child.stderr.on('data',b=>{errorBytes+=b.length;if(errorBytes>1048576)stop('limit');});
  child.stdin.on('error',()=>{});child.on('error',()=>{failure||='process';});
  child.on('close',code=>{clearTimeout(timer);clearTimeout(killer);signal?.removeEventListener('abort',abort);
   if(failure||code!==0){reject(Error(failure||'process'));return;}
   try{const value=JSON.parse(output);if(typeof value?.ok!=='boolean')fail();resolvePromise(value);}catch{reject(Error('protocol'));}
  });
  child.stdin.end(JSON.stringify({root,action,...payload}));
 });}finally{await rm(cwd,{recursive:true,force:true});}
}
export async function freezeSourceComparison(spec,{signal,now=Date.now}={}){
 if(!spec||Object.keys(spec).sort().join(',')!=='arms,packets,sources,title'||typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>100||Object.keys(spec.arms||{}).sort().join(',')!=='baseline,candidate'||Object.keys(spec.sources||{}).sort().join(',')!=='baseline,candidate')fail();
 const arms=Object.fromEntries(roles.map(role=>[role,comparisonRecipe(spec.arms[role])])),inputs=comparisonInputs(spec.packets).map(({packet,packetHash})=>({packet,packetHash,contracts:{}}));
 const implementations=Object.fromEntries(roles.map(role=>[role,implementation(spec.sources[role])])),hostSources=comparisonSources();
 if(implementations.baseline.sourceHash===implementations.candidate.sourceHash)throw Error('源码对照需要两份不同源码；仅模型或提示词配置对照使用原入口');
 for(const role of roles){
  const response=await invoke(implementations[role].root,'prepare',{packets:inputs.map(i=>i.packet)},{signal});
  if(!response.ok||!Array.isArray(response.value)||response.value.length!==inputs.length)fail();
  response.value.forEach((c,index)=>{inputs[index].contracts[role]=validContract(c,inputs[index]);});
  if(digest(implementation(implementations[role].root))!==digest(implementations[role]))fail();
 }
 const p=seal({format,title:spec.title.trim(),frozenAt:new Date(now()).toISOString(),arms,inputs,slots:comparisonSlots(inputs),implementations,hostSources,hostHash:digest(hostSources),worker:{text:workerText,hash:digest(workerText)},node:{path:process.execPath,version:process.versions.node,hash:fileHash(process.execPath)},binaries:Object.fromEntries(roles.map(role=>[role,fileHash(arms[role].binary)])),forwardEligible:false,scope:'selected-packets-source-diagnostic',limitations:['仅比较五章研判入口；不运行两个版本的采集、初筛、材料构造或交易全流程','同一冻结材料由各候选生成自己的提示词与schema，再通过共同五章结果校验；契约不兼容明确拒收','运行已审阅的本机候选源码；子进程不是任意不可信代码的安全沙箱','源码、Node和已安装依赖指纹冻结；不冻结操作系统、继承代理环境或远端模型权重','选定历史材料属于开发诊断，不自动评分、晋升、采纳或形成独立前向结论']});
 validatePlan(p);return p;
}
function validatePlan(value){
 const p=check(value);if(p.format!==format||p.forwardEligible!==false||p.scope!=='selected-packets-source-diagnostic'||!Number.isFinite(Date.parse(p.frozenAt))||!Array.isArray(p.inputs)||!p.inputs.length||p.inputs.length>20||digest(p.hostSources)!==p.hostHash||digest(p.worker?.text)!==p.worker?.hash)fail();
 for(const role of roles){comparisonRecipe(p.arms[role]);const impl=p.implementations[role];if(!isAbsolute(impl.root)||digest(impl.sources)!==impl.sourceHash||digest(impl.dependencies.files)!==impl.dependencies.hash)fail();}
 for(const i of p.inputs){validatePacket(i.packet);if(digest(i.packet)!==i.packetHash)fail();for(const role of roles)validContract(i.contracts?.[role],i);}
 if(new Set(p.inputs.map(i=>i.packet.inputHash)).size!==p.inputs.length||digest(comparisonSlots(p.inputs))!==digest(p.slots))fail();return p;
}
export function saveSourceComparison(directory,plan){validatePlan(plan);encode(plan);mkdirSync(directory,{mode:0o700});write(join(directory,'plan.json'),plan);return plan.hash;}
function candidateCheck(p,slot,candidate){
 const input=p.inputs[slot.input],contract=input.contracts[slot.arm],arm=p.arms[slot.arm];validateCandidate(candidate,input.packet,{model:arm.model,topicId:input.packet.input.topicId});
 for(const [key,value] of Object.entries({model:arm.model,effort:arm.effort,promptVersion:contract.promptVersion,promptHash:contract.promptHash,schemaVersion:contract.schemaVersion,schemaHash:contract.schemaHash}))if(candidate.trace[key]!==value)fail();
}
export function readSourceComparison(directory){
 const p=validatePlan(read(join(directory,'plan.json'))),rows=p.slots.map(slot=>{
  const start=read(join(directory,slot.id+'.started.json'),true),result=read(join(directory,slot.id+'.result.json'),true);
  if(start){check(start);if(start.planHash!==p.hash||start.slotId!==slot.id)fail();}
  if(result){check(result);if(!start||result.planHash!==p.hash||result.slotId!==slot.id||!['candidate','failed','cancelled'].includes(result.status))fail();if(result.status==='candidate')candidateCheck(p,slot,result.candidate);}
  return {...slot,status:result?result.status:start?'unfinished':'not-started',start,result};
 });
 const pairs=p.inputs.map((input,index)=>({input:index,inputHash:input.packet.inputHash,baseline:rows.find(r=>r.input===index&&r.arm==='baseline').status,candidate:rows.find(r=>r.input===index&&r.arm==='candidate').status}));
 return {plan:p,rows,pairs,comparison:{sourceChanged:true,sourceHashes:Object.fromEntries(roles.map(role=>[role,p.implementations[role].sourceHash])),dependenciesChanged:p.implementations.baseline.dependencies.hash!==p.implementations.candidate.dependencies.hash,executionFields:['binary','model','effort','timeoutMs'].filter(k=>p.arms.baseline[k]!==p.arms.candidate[k]),promptChanged:p.inputs.some(i=>i.contracts.baseline.promptHash!==i.contracts.candidate.promptHash),schemaChanged:p.inputs.some(i=>i.contracts.baseline.schemaHash!==i.contracts.candidate.schemaHash)},summary:{planned:rows.length,successful:rows.filter(r=>r.status==='candidate').length,failed:rows.filter(r=>r.status==='failed').length,cancelled:rows.filter(r=>r.status==='cancelled').length,unfinished:rows.filter(r=>r.status==='unfinished').length,notStarted:rows.filter(r=>r.status==='not-started').length,completePairs:pairs.filter(r=>r.baseline==='candidate'&&r.candidate==='candidate').length},forwardEligible:false};
}
export async function runSourceComparison(directory,{signal,now=Date.now}={}){
 const p=validatePlan(read(join(directory,'plan.json')));
 const hostCurrent=()=>{if(p.hostHash!==loadedHostHash||p.hostHash!==digest(comparisonSources())||p.worker.hash!==digest(readFileSync(worker,'utf8'))||p.node.path!==process.execPath||p.node.version!==process.versions.node||p.node.hash!==fileHash(process.execPath))throw Error('environment-changed');};
 const armCurrent=role=>{if(p.binaries[role]!==fileHash(p.arms[role].binary)||digest(implementation(p.implementations[role].root))!==digest(p.implementations[role]))throw Error('environment-changed');};
 hostCurrent();for(const role of roles)armCurrent(role);if(signal?.aborted)throw Error('cancelled');
 write(join(directory,'execution.json'),seal({planHash:p.hash,startedAt:new Date(now()).toISOString(),pid:process.pid}));
 for(const slot of p.slots){
  if(signal?.aborted)break;hostCurrent();armCurrent(slot.arm);
  const startedAt=new Date(now()).toISOString();write(join(directory,slot.id+'.started.json'),seal({planHash:p.hash,slotId:slot.id,startedAt}));
  let result;const input=p.inputs[slot.input],arm=p.arms[slot.arm];
  try{
   const response=await invoke(p.implementations[slot.arm].root,'run',{packet:input.packet,config:arm},{signal,timeoutMs:arm.timeoutMs+15000});
   hostCurrent();armCurrent(slot.arm);
   if(signal?.aborted)throw Error('cancelled');
   if(response.ok){if(digest(response.value.contract)!==digest(input.contracts[slot.arm]))fail();candidateCheck(p,slot,response.value.candidate);result={status:'candidate',candidate:response.value.candidate};}
   else result={status:response.failure?.code==='cancelled'?'cancelled':'failed',failure:response.failure,outputDiagnostic:response.outputDiagnostic};
  }catch(error){result={status:signal?.aborted||error.message==='cancelled'?'cancelled':'failed',failure:{code:['environment-changed','timeout','limit','protocol'].includes(error.message)?error.message:'process',message:'源码候选调用、环境或结果校验未通过'}};}
  write(join(directory,slot.id+'.result.json'),seal({planHash:p.hash,slotId:slot.id,startedAt,finishedAt:new Date(now()).toISOString(),...result}));
 }
 const report=readSourceComparison(directory);write(join(directory,'completion.json'),seal({planHash:p.hash,finishedAt:new Date(now()).toISOString(),summary:report.summary}));return report;
}

// Reuse the same bounded dependency manifest and subprocess transport for full-pipeline experiments.
export {implementation as comparisonImplementation,fileHash as comparisonFileHash,invoke as invokeComparisonWorker};
