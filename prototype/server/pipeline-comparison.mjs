import {mkdirSync,readFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './codex-research.mjs';
import {validateReplayRecipe} from './pipeline-replay.mjs';
import {comparisonImplementation as implementation,comparisonFileHash as fileHash,invokeComparisonWorker as invoke} from './source-comparison.mjs';
import {comparisonRecipe,comparisonSources,readComparisonArtifact as read,writeComparisonArtifact as write,sealComparisonArtifact as seal,checkComparisonArtifact as check,encodeComparisonArtifact as encode} from './model-comparison.mjs';
const roles=['baseline','candidate'],format='pipeline-comparison/1',worker=fileURLToPath(new URL('../scripts/pipeline-comparison-worker.mjs',import.meta.url));
const workerText=readFileSync(worker,'utf8'),loadedHostHash=digest(comparisonSources());
const hostSources=()=>({...comparisonSources(),'prototype/scripts/pipeline-comparison-worker.mjs':{text:readFileSync(worker,'utf8'),sha256:digest(readFileSync(worker,'utf8'))},'prototype/scripts/compare-pipeline.mjs':{text:readFileSync(new URL('../scripts/compare-pipeline.mjs',import.meta.url),'utf8'),sha256:digest(readFileSync(new URL('../scripts/compare-pipeline.mjs',import.meta.url),'utf8'))}});
const fail=()=>{throw Error('全流程对照计划、冻结环境或完整结果无效');};
export function freezePipelineComparison(spec,{now=Date.now}={}){
 if(!spec||Object.keys(spec).sort().join(',')!=='recipe,sources,title'||typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>100||Object.keys(spec.sources||{}).sort().join(',')!=='baseline,candidate')fail();
 validateReplayRecipe(spec.recipe);comparisonRecipe(spec.recipe.model.config);
 const implementations=Object.fromEntries(roles.map(role=>[role,implementation(spec.sources[role])])),sources=hostSources();
 if(implementations.baseline.sourceHash===implementations.candidate.sourceHash)throw Error('需要两份不同的已审阅源码候选');
 return seal({format,title:spec.title.trim(),frozenAt:new Date(now()).toISOString(),recipe:structuredClone(spec.recipe),recipeHash:digest(spec.recipe),implementations,hostSources:sources,hostHash:digest(sources),worker:{text:workerText,hash:digest(workerText)},node:{path:process.execPath,version:process.versions.node,hash:fileHash(process.execPath)},binaryHash:spec.recipe.model.mode==='live-codex'?fileHash(spec.recipe.model.config.binary):null,forwardEligible:false,scope:'frozen-stream-full-pipeline-diagnostic',limitations:['同一时间线在空白独立研究库运行真实服务、解析、初筛、材料构造、模型校验、持仓复核和模拟账本；未覆盖的阶段明确报告','外部输入仅使用冻结响应及显式模拟报价；无原始响应的直接入库输入单独标记，不冒充采集验证','录制模型结果须匹配完整材料包、提示词、schema及执行配置；不匹配保留失败，禁止改写trace','批准回放绑定原审查指纹；版本改变导致拒绝时不自动补批，不操作个人数据库或真实交易','固定实验时钟与UUID序列可能影响候选内部生成身份；结果差异不自动归因为策略改善','子进程运行已审阅代码，不是不可信代码安全沙箱；不冻结系统、代理环境或远端模型权重','开发回放，不是独立留出、真实可成交行情或长期收益证明；不自动采纳或晋升候选']});
}
function validatePlan(value){
 const p=check(value);if(p.format!==format||p.scope!=='frozen-stream-full-pipeline-diagnostic'||p.forwardEligible!==false||!Number.isFinite(Date.parse(p.frozenAt))||digest(p.recipe)!==p.recipeHash||digest(p.hostSources)!==p.hostHash||digest(p.worker?.text)!==p.worker.hash)fail();validateReplayRecipe(p.recipe);comparisonRecipe(p.recipe.model.config);
 for(const role of roles){const i=p.implementations[role];if(!isAbsolute(i.root)||digest(i.sources)!==i.sourceHash||digest(i.dependencies.files)!==i.dependencies.hash)fail();}return p;
}
export function savePipelineComparison(directory,plan){validatePlan(plan);encode(plan);mkdirSync(directory,{mode:0o700});write(join(directory,'plan.json'),plan);return plan.hash;}
function replayCheck(plan,value){
 if(value?.format!=='pipeline-replay-result/1'||value.recipeHash!==plan.recipeHash||value.forwardEligible!==false||!Array.isArray(value.rows)||!Array.isArray(value.network)||!Array.isArray(value.modelCalls)||value.rows.length>plan.recipe.steps.length||value.summary?.executed!==value.rows.length||value.summary.planned!==plan.recipe.steps.length)fail();
 for(let i=0;i<value.rows.length;i++){const r=value.rows[i],s=plan.recipe.steps[i];if(r.id!==s.id||r.at!==s.at||r.kind!==s.kind||!['succeeded','rejected','failed','skipped'].includes(r.status))fail();}
 for(const status of ['succeeded','rejected','failed','skipped'])if(value.summary[status]!==value.rows.filter(r=>r.status===status).length)fail();if(value.summary.notStarted!==plan.recipe.steps.length-value.rows.length)fail();
 if(value.modelSummary&&(value.modelSummary.started!==value.modelCalls.length||['candidate','failed','unfinished'].some(k=>value.modelSummary[k]!==value.modelCalls.filter(c=>c.status===(k==='unfinished'?'running':k)).length)))fail();
 for(const c of value.modelCalls){if(!['candidate','failed','running'].includes(c.status))fail();if(c.status==='candidate'){if(digest(c.packet)!==c.contract?.packetHash||digest(c.prompt)!==c.contract.promptHash||digest(c.schema)!==c.contract.schemaHash||digest(c.result?.rawOutput)!==c.result?.trace?.outputHash)fail();for(const [k,v] of Object.entries(c.contract))if(k!=='packetHash'&&c.result.trace[k]!==v)fail();}}
 if(!value.tables||Object.values(value.tables).some(t=>!Array.isArray(t.rows)||digest(t.rows)!==t.hash))fail();return value;
}
export function readPipelineComparison(directory){
 const plan=validatePlan(read(join(directory,'plan.json'))),rows=roles.map(role=>{const start=read(join(directory,role+'.started.json'),true),result=read(join(directory,role+'.result.json'),true);
  if(start){check(start);if(start.planHash!==plan.hash||start.role!==role)fail();}if(result){check(result);if(!start||result.planHash!==plan.hash||result.role!==role||!['completed','failed','cancelled'].includes(result.status))fail();if(result.value)replayCheck(plan,result.value);}
  const calls=result?.value?.modelCalls??[],intake=(result?.value?.tables.news_intake_runs?.rows??[]).map(row=>{const p=JSON.parse(row.payload);return {id:p.id,queryId:p.queryId,state:p.state,coverage:p.coverage,ingestCommitted:p.ingestCommitted,rawCount:p.rawCount,acceptedCount:p.acceptedCount,rejectedCount:p.rejectedCount,outsideWindow:p.outsideWindow,possiblyTruncated:p.possiblyTruncated,...(p.error?{error:p.error}:{})};}),intakeSummary={attempted:intake.length,...Object.fromEntries(['ok','partial','error','cancelled','interrupted','running'].map(state=>[state,intake.filter(r=>r.state===state).length]))};
  return {role,status:result?result.status:start?'unfinished':'not-started',result,intake,intakeSummary,modelSummary:{started:calls.length,candidate:calls.filter(c=>c.status==='candidate').length,failed:calls.filter(c=>c.status==='failed').length,unfinished:calls.filter(c=>c.status==='running').length}};});
 const a=rows[0].result?.value,b=rows[1].result?.value;
 const steps=plan.recipe.steps.map(s=>{const left=a?.rows.find(r=>r.id===s.id),right=b?.rows.find(r=>r.id===s.id);return {id:s.id,kind:s.kind,baseline:left?.status??'not-started',candidate:right?.status??'not-started',changed:!!left&&!!right&&digest(left)!==digest(right)};});
 const tables=[...new Set([...Object.keys(a?.tables??{}),...Object.keys(b?.tables??{})])].sort().map(name=>({name,baselineRows:a?.tables[name]?.rows.length??null,candidateRows:b?.tables[name]?.rows.length??null,changed:!a?.tables[name]||!b?.tables[name]||digest(a.tables[name])!==digest(b.tables[name])}));
 const stages=v=>{
  const books=['aggressive','steady'].map(role=>v?.tables['market_sim_book_'+role]?.rows.map(r=>JSON.parse(r.payload))??[]).flat();
  return {intake:!!v?.tables.news_intake_runs?.rows.some(r=>JSON.parse(r.payload).ingestCommitted),screening:!!v?.tables.screening_samples?.rows.length,materials:!!v?.tables.research_materials?.rows.length,modelInvocation:!!v?.modelCalls.length,validModel:!!v?.modelCalls.some(c=>c.status==='candidate'),observations:plan.recipe.steps.some(s=>s.kind==='task'&&s.name==='observations'&&s.action==='run'&&v?.rows.some(r=>r.id===s.id&&r.status==='succeeded')),orders:books.some(b=>b.orders.length),riskReview:!!v?.rows.some(r=>r.request?.method==='GET'&&r.request.path.includes('/market-simulation/orders/')&&r.request.path.includes('/review')&&r.status==='succeeded'),approvals:books.some(b=>b.orders.some(o=>o.approval)),execution:!!v?.rows.some(r=>r.status==='succeeded'&&(r.request?.method==='POST'&&r.request.path.includes('/market-simulation/process')||plan.recipe.steps.some(s=>s.id===r.id&&s.kind==='task'&&s.name==='execution'&&s.action==='run'))),fills:books.some(b=>b.fills.length),ledger:books.length>0};
 };
 const coverage={baseline:stages(a),candidate:stages(b)};coverage.paired=Object.fromEntries(Object.keys(coverage.baseline).map(k=>[k,coverage.baseline[k]&&coverage.candidate[k]]));const reached=coverage.paired;
 return {plan,rows,steps,tables,reached,coverage,comparison:{sourceChanged:true,dependenciesChanged:plan.implementations.baseline.dependencies.hash!==plan.implementations.candidate.dependencies.hash,changedSteps:steps.filter(r=>r.changed).length,changedTables:tables.filter(r=>r.changed).length},summary:{planned:2,completed:rows.filter(r=>r.status==='completed').length,failed:rows.filter(r=>r.status==='failed').length,cancelled:rows.filter(r=>r.status==='cancelled').length,unfinished:rows.filter(r=>r.status==='unfinished').length,notStarted:rows.filter(r=>r.status==='not-started').length},forwardEligible:false};
}
export async function runPipelineComparison(directory,{signal,now=Date.now,timeoutMs=600000}={}){
 const p=validatePlan(read(join(directory,'plan.json')));
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>3600000)fail();
 const hostCurrent=()=>{if(loadedHostHash!==digest(comparisonSources())||p.hostHash!==digest(hostSources())||p.node.path!==process.execPath||p.node.version!==process.versions.node||p.node.hash!==fileHash(process.execPath)||p.worker.hash!==digest(readFileSync(worker,'utf8')))throw Error('environment-changed');};
 const armCurrent=role=>{if(digest(implementation(p.implementations[role].root))!==digest(p.implementations[role])||p.binaryHash!==null&&p.binaryHash!==fileHash(p.recipe.model.config.binary))throw Error('environment-changed');};
 hostCurrent();roles.forEach(armCurrent);if(signal?.aborted)throw Error('cancelled');
 write(join(directory,'execution.json'),seal({planHash:p.hash,startedAt:new Date(now()).toISOString(),pid:process.pid}));
 for(const role of roles){if(signal?.aborted)break;hostCurrent();armCurrent(role);const startedAt=new Date(now()).toISOString();write(join(directory,role+'.started.json'),seal({planHash:p.hash,role,startedAt}));let result;
  try{const data=join(directory,role+'-data');mkdirSync(data,{mode:0o700});const response=await invoke(p.implementations[role].root,'run-pipeline',{recipe:p.recipe,directory:data},{signal,timeoutMs,workerPath:worker});hostCurrent();armCurrent(role);
   if(response.ok){replayCheck(p,response.value);result={status:response.value.cancelled?'cancelled':'completed',value:response.value};}else result={status:response.failure?.code==='cancelled'?'cancelled':'failed',failure:response.failure};
  }catch(e){result={status:signal?.aborted?'cancelled':'failed',failure:{code:['environment-changed','timeout','limit','protocol'].includes(e.message)?e.message:'process',message:'候选回放或完整记录校验未通过；独立库保留'}};}
  write(join(directory,role+'.result.json'),seal({planHash:p.hash,role,startedAt,finishedAt:new Date(now()).toISOString(),...result}));
 }
 const report=readPipelineComparison(directory);write(join(directory,'completion.json'),seal({planHash:p.hash,finishedAt:new Date(now()).toISOString(),summary:report.summary}));return report;
}
