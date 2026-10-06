import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {generateComparison,validateComparisonCandidate,comparisonPrompt,SEMANTIC_SCHEMA,MATERIAL_SEMANTIC_SCHEMA,SEMANTIC_VERSION,MATERIAL_SEMANTIC_VERSION,EVENT_SEMANTIC_VERSION} from './semantic-events.mjs';
import {TIME_PROMPT_VERSION} from './semantic-time.mjs';import {ARTICLE_SCOPE_VERSION} from './article-extraction.mjs';
import {digest,CodexResearchError,rejectedOutputDiagnostic} from './codex-research.mjs';
import {semanticKinds} from '../shared/semantic-labels.mjs';
import {comparisonRecipe,comparisonSources,readComparisonArtifact as read,writeComparisonArtifact as write,sealComparisonArtifact as seal,checkComparisonArtifact as check,encodeComparisonArtifact as encode} from './model-comparison.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),format='semantic-benchmark/1',sameEvent=new Set(['repeat','followup','reversal']);
const fail=()=>{throw Error('语义评估样本、标注或冻结记录不完整');};
const text=(v,n=2000)=>typeof v==='string'&&v.trim()&&v.length<=n;
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const binaryHash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sources=()=>{const name='prototype/scripts/evaluate-semantics.mjs',source=readFileSync(join(root,name),'utf8');return {...comparisonSources(),[name]:{text:source,sha256:digest(source)}};};
const loadedHash=digest(sources());
function packetCheck(p){
 if(!keys(p,'schema,input,inputHash')||![SEMANTIC_VERSION,MATERIAL_SEMANTIC_VERSION,EVENT_SEMANTIC_VERSION].includes(p.schema)||!keys(p.input,'left,right')||p.inputHash!==digest(p.input)||Buffer.byteLength(JSON.stringify(p))>(p.schema===SEMANTIC_VERSION?65536:524288))fail();
 const records=Object.values(p.input),expected=records.some(r=>r?.kind==='event')?EVENT_SEMANTIC_VERSION:records.some(r=>r?.kind==='material')?MATERIAL_SEMANTIC_VERSION:SEMANTIC_VERSION;
 if(p.schema!==expected||p.input.left?.id===p.input.right?.id&&(p.input.left?.kind||'news')===(p.input.right?.kind||'news'))fail();
 for(const side of ['left','right']){const r=p.input[side];if(!r||!['news','material','event'].includes(r.kind||'news')||(['material','event'].includes(r.kind)?r.contentScope==='headline-only':r.contentScope!=='headline-only')||!text(r.id,200)||!Number.isSafeInteger(r.revision)||r.revision<1||!text(r.title,2000)||!['headline-only','excerpt','user-supplied-text','extracted-text'].includes(r.contentScope)||r.contentScope!=='headline-only'&&(!text(r.body,500000)||!text(r.documentId,200)))fail();}
 return p;
}
function casesOf(cases,frozenAt){
 if(!Array.isArray(cases)||!cases.length||cases.length>100)fail();const ids=new Set(),pairs=new Set(),splits=new Map();
 return cases.map(c=>{
  if(!keys(c,'id,clusterId,split,packet,reference')||!text(c.id,100)||!text(c.clusterId,100)||!['development','holdout'].includes(c.split)||ids.has(c.id))fail();ids.add(c.id);packetCheck(c.packet);
  const ref=c.reference;if(!keys(ref,'relation,reason,reviewer,reviewedAt,origin')||!Object.hasOwn(semanticKinds,ref.relation)||!text(ref.reason)||!text(ref.reviewer,200)||!['developer','external-review'].includes(ref.origin)||!Number.isFinite(Date.parse(ref.reviewedAt))||Date.parse(ref.reviewedAt)>Date.parse(frozenAt))fail();
  // Swapping orientation or changing a revision must not create a new split.
  const records=Object.values(c.packet.input),identity=r=>r.documentId?`material:${r.documentId}`:`news:${r.id}`;
  const pair=digest(records.map(identity).sort());if(pairs.has(pair))fail();pairs.add(pair);
  for(const key of ['cluster:'+c.clusterId,...records.flatMap(r=>[identity(r),...(r.url?['url:'+r.url]:[])])]){if(splits.has(key)&&splits.get(key)!==c.split)fail();splits.set(key,c.split);}
  return structuredClone(c);
 });
}
function contract(packet){const schema=packet.schema===SEMANTIC_VERSION?SEMANTIC_SCHEMA:MATERIAL_SEMANTIC_SCHEMA,prompt=comparisonPrompt(packet);return {prompt,promptHash:digest(prompt),schema,schemaHash:digest(schema),promptVersion:`${packet.schema}/${TIME_PROMPT_VERSION}${packet.schema!==SEMANTIC_VERSION?'/'+ARTICLE_SCOPE_VERSION:''}`};}
export function freezeSemanticBenchmark(spec,{now=Date.now}={}){
 if(!keys(spec,'title,config,cases')||!text(spec.title,100))fail();const frozenAt=new Date(now()).toISOString(),config=comparisonRecipe(spec.config),cases=casesOf(spec.cases,frozenAt),code=sources();
 return seal({format,title:spec.title.trim(),frozenAt,config,binaryHash:binaryHash(config.binary),cases,contracts:cases.map(c=>contract(c.packet)),sources:code,sourceHash:digest(code),forwardEligible:false,scope:'predeclared-selected-pairs',limitations:['预选成对样本，不代表全市场召回率或独立交易有效性','参考标签与development/holdout划分由提供者声明；系统只校验已知身份交叉，不证明标注独立或事件簇完整','标签和理由不传入模型；结构及引用通过与关系标签一致性分别计算','失败、取消、未开始和未完成均保留；不从通过结果中挑选最佳调用']});
}
function planCheck(value){const p=check(value);if(p.format!==format||p.forwardEligible!==false||p.scope!=='predeclared-selected-pairs'||!Number.isFinite(Date.parse(p.frozenAt)))fail();comparisonRecipe(p.config);casesOf(p.cases,p.frozenAt);if(!Array.isArray(p.contracts)||p.contracts.length!==p.cases.length||digest(p.sources)!==p.sourceHash)fail();for(const c of p.contracts)if(!c||!text(c.prompt,1048576)||digest(c.prompt)!==c.promptHash||!c.schema||digest(c.schema)!==c.schemaHash||!text(c.promptVersion,200))fail();return p;}
export function saveSemanticBenchmark(directory,plan){planCheck(plan);encode(plan);mkdirSync(directory,{mode:0o700});write(join(directory,'plan.json'),plan);return plan.hash;}
function resultCheck(plan,index,r){check(r);if(r.planHash!==plan.hash||r.index!==index||!['candidate','failed','cancelled'].includes(r.status))fail();if(r.status==='candidate'){
 const c=plan.contracts[index];validateComparisonCandidate(r.candidate,plan.cases[index].packet,plan.config.model,{requireTimeEvidence:true});
 for(const [key,value] of Object.entries({effort:plan.config.effort,promptHash:c.promptHash,schemaHash:c.schemaHash,promptVersion:c.promptVersion}))if(r.candidate.trace[key]!==value)fail();
 }return r;}
function score(rows){
 const completed=rows.filter(r=>r.status==='candidate'),correct=completed.filter(r=>r.predicted===r.expected).length,confusion={};for(const r of completed){confusion[r.expected]??={};confusion[r.expected][r.predicted]=(confusion[r.expected][r.predicted]||0)+1;}
 const labels=Object.keys(semanticKinds).map(relation=>{const actual=rows.filter(r=>r.expected===relation).length,predicted=completed.filter(r=>r.predicted===relation).length,tp=completed.filter(r=>r.predicted===relation&&r.expected===relation).length;return {relation,referenceCases:actual,predictedCases:predicted,matched:tp,precision:predicted?tp/predicted:null,recallOfPlannedReferences:actual?tp/actual:null};});
 return {planned:rows.length,completed:completed.length,correct,failed:rows.filter(r=>r.status==='failed').length,cancelled:rows.filter(r=>r.status==='cancelled').length,unfinished:rows.filter(r=>r.status==='unfinished').length,notStarted:rows.filter(r=>r.status==='not-started').length,agreementAmongCompleted:completed.length?correct/completed.length:null,agreementOfPlanned:rows.length?correct/rows.length:null,falseSameEvent:completed.filter(r=>sameEvent.has(r.predicted)&&['analogy','unrelated'].includes(r.expected)).length,sameEventDespiteUncertainReference:completed.filter(r=>sameEvent.has(r.predicted)&&['related','uncertain'].includes(r.expected)).length,missedSameEvent:completed.filter(r=>!sameEvent.has(r.predicted)&&sameEvent.has(r.expected)).length,confusion,labels};
}
export function readSemanticBenchmark(directory){
 const plan=planCheck(read(join(directory,'plan.json'))),rows=plan.cases.map((c,index)=>{
  const start=read(join(directory,`${index}.started.json`),true),result=read(join(directory,`${index}.result.json`),true);if(start){check(start);if(start.planHash!==plan.hash||start.index!==index)fail();}if(result&&!start)fail();
  const r=result?resultCheck(plan,index,result):null;return {index,id:c.id,clusterId:c.clusterId,split:c.split,labelOrigin:c.reference.origin,expected:c.reference.relation,predicted:r?.candidate?.comparison.relation||null,status:r?r.status:start?'unfinished':'not-started',result:r};
 });
 return {plan,rows,summary:score(rows),bySplit:Object.fromEntries(['development','holdout'].map(s=>[s,score(rows.filter(r=>r.split===s))])),byLabelOrigin:Object.fromEntries(['developer','external-review'].map(s=>[s,score(rows.filter(r=>r.labelOrigin===s))])),clusters:[...new Set(rows.map(r=>r.clusterId))].map(id=>({id,...score(rows.filter(r=>r.clusterId===id))})),forwardEligible:false};
}
export async function runSemanticBenchmark(directory,{runner=generateComparison,signal,now=Date.now}={}){
 const plan=planCheck(read(join(directory,'plan.json'))),current=()=>{if(plan.sourceHash!==loadedHash||plan.sourceHash!==digest(sources())||plan.binaryHash!==binaryHash(plan.config.binary)||plan.cases.some((c,i)=>digest(contract(c.packet))!==digest(plan.contracts[i])))throw Error('源码、提示词或Codex程序已变化，请另建语义评估计划');};current();if(signal?.aborted)throw new CodexResearchError('cancelled');
 write(join(directory,'execution.json'),seal({planHash:plan.hash,startedAt:new Date(now()).toISOString(),pid:process.pid}));
 for(const [index,c] of plan.cases.entries()){
  if(signal?.aborted)break;current();const startedAt=new Date(now()).toISOString();write(join(directory,`${index}.started.json`),seal({planHash:plan.hash,index,startedAt}));let result;
  try{const candidate=await runner(structuredClone(c.packet),{...plan.config,signal});if(signal?.aborted)throw new CodexResearchError('cancelled');current();result=seal({planHash:plan.hash,index,startedAt,finishedAt:new Date(now()).toISOString(),status:'candidate',candidate});resultCheck(plan,index,result);}
  catch(error){result=seal({planHash:plan.hash,index,startedAt,finishedAt:new Date(now()).toISOString(),status:signal?.aborted||error?.code==='cancelled'?'cancelled':'failed',failure:{code:error instanceof CodexResearchError?error.code:'process',message:error instanceof CodexResearchError?error.message:'语义评估调用或冻结校验失败',...(error instanceof CodexResearchError?{trace:error.trace}:{})},outputDiagnostic:rejectedOutputDiagnostic(error,c.packet.inputHash)});}
  write(join(directory,`${index}.result.json`),result);
 }
 const report=readSemanticBenchmark(directory);write(join(directory,'completion.json'),seal({planHash:plan.hash,finishedAt:new Date(now()).toISOString(),summary:report.summary}));return report;
}
