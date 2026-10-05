import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const lanes=['research','semantic','material','company'],tasks=['news','daily','minutes','discovery','semantic','observations','execution','pricecollection'];
const bad=()=>{throw Error('冻结回放配方、引用或时间无效');};
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const key=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v);
const own=(v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k)&&!['__proto__','prototype','constructor'].includes(k);
// References select a prior recorded result. There is no expression evaluator,
// arbitrary service-method dispatch, SQL, path lookup or silent fallback.
export function resolveReplayValue(value,results){
 if(Array.isArray(value))return value.map(v=>resolveReplayValue(v,results));
 if(value&&typeof value==='object'){
  if(Object.hasOwn(value,'$ref')){
   if(!exact(value,'$ref,path')||!key(value.$ref)||!Array.isArray(value.path)||value.path.length>20||!Object.hasOwn(results,value.$ref)||results[value.$ref].status!=='succeeded')bad();
   let found=results[value.$ref].value;for(const part of value.path){if(!(typeof part==='string'||Number.isSafeInteger(part))||!own(found,part))bad();found=found[part];}return structuredClone(found);
  }
  if(Object.keys(value).some(k=>!own(value,k)))bad();
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveReplayValue(v,results)]));
 }
 return value;
}
export function validateReplayRecipe(recipe){
 if(!exact(recipe,'version,seed,startedAt,model,responses,steps')||recipe.version!=='pipeline-replay/1'||!key(recipe.seed)||!instant(recipe.startedAt)||!exact(recipe.model,'mode,config,records')||!['recorded','live-codex'].includes(recipe.model.mode)||!Array.isArray(recipe.model.records)||recipe.model.records.length>1000||recipe.model.mode==='live-codex'&&recipe.model.records.length)bad();
 if(!Array.isArray(recipe.responses)||recipe.responses.length>2000||!Array.isArray(recipe.steps)||!recipe.steps.length||recipe.steps.length>1000||Buffer.byteLength(JSON.stringify(recipe))>12*1024*1024)bad();
 const ids=new Set();
 for(const r of recipe.responses){if(!exact(r,'id,at,url,status,headers,body')||!key(r.id)||ids.has(r.id)||!instant(r.at)||typeof r.url!=='string'||!/^https:\/\//.test(r.url)||typeof r.body!=='string'||Buffer.byteLength(r.body)>8*1024*1024||!Number.isSafeInteger(r.status)||r.status<200||r.status>599||!r.headers||typeof r.headers!=='object'||Object.values(r.headers).some(v=>typeof v!=='string'))bad();const u=new URL(r.url);if(u.username||u.password||u.hash)bad();ids.add(r.id);}
 const records=new Set();for(const r of recipe.model.records){if(!exact(r,'id,at,lane,contract,result')||!key(r.id)||records.has(r.id)||!instant(r.at)||!lanes.includes(r.lane)||!r.contract||!r.result)bad();records.add(r.id);}
 let at=recipe.startedAt;ids.clear();
 for(const s of recipe.steps){if(!key(s.id)||ids.has(s.id)||!instant(s.at)||s.at<at)bad();ids.add(s.id);at=s.at;
  if(s.kind==='request'){if(!exact(s,'id,at,kind,method,path,body')||!['GET','POST','PATCH','DELETE'].includes(s.method)||!(typeof s.path==='string'||Array.isArray(s.path)))bad();}
  else if(s.kind==='task'){if(!exact(s,'id,at,kind,name,action,input')||!tasks.includes(s.name)||!['pause','resume','run','cancel','retry'].includes(s.action))bad();}
  else if(s.kind==='market'){if(!exact(s,'id,at,kind,inputs')||!s.inputs||typeof s.inputs!=='object')bad();}
  else if(s.kind==='wait'){if(!exact(s,'id,at,kind,lane,runId')||!lanes.includes(s.lane))bad();}
  else if(s.kind==='screen'){if(!(exact(s,'id,at,kind')||exact(s,'id,at,kind,view')&&['full','summary'].includes(s.view)))bad();}
  else if(s.kind==='ingest'){if(!exact(s,'id,at,kind,items')||!Array.isArray(s.items)||s.items.length>2000||s.items.some(n=>typeof n.id!=='string'||!n.id.match(/^[a-f0-9]{64}$/)||typeof n.publishedAt!=='string'||!Number.isFinite(Date.parse(n.publishedAt))||Date.parse(n.publishedAt)>Date.parse(s.at)))bad();}
  else bad();
 }
 return recipe;
}
function apiPath(path){
 if(typeof path!=='string'||path.length>4000||!path.startsWith('/api/')||path.includes('#')||path.includes('\\'))bad();
 const u=new URL(path,'http://127.0.0.1:4179');
 // Ordinary research/market interfaces only. System setup, files, backups,
 // restore acknowledgement and scheduler's fire-and-forget tick are excluded.
 if(!/^\/api\/(?:data|health|settings|news(?:\/|$)|research(?:\/|$)|research-pipeline(?:\/|$)|market-simulation(?:\/|$)|observations(?:\/|$)|observation-rules(?:\/|$)|events(?:\/|$)|semantic-events(?:\/|$)|semantic-batches(?:\/|$)|event-clusters(?:\/|$)|forward-evaluations(?:\/|$)|forward-windows(?:\/|$)|evaluations(?:\/|$)|price-collection(?:\/|$)|security-directory(?:\?|$)|reference-fx(?:\/|$)|daily(?:\/|$)|quotes(?:\/|$)|watchlist(?:\?|$)|bars(?:\?|$))/.test(u.pathname))bad();
 return path;
}
export async function replayPipeline(root,recipe,{databasePath,signal}={}){
 validateReplayRecipe(recipe);
 const load=file=>import(pathToFileURL(join(root,'prototype/server',file)).href);
 const [stores,services,handlers,runtime,codex,semantic,material,company,article]=await Promise.all(['store.mjs','service.mjs','index.mjs','runtime.mjs','codex-research.mjs','semantic-events.mjs','material-events.mjs','company-entities.mjs','source-reader.mjs'].map(load));
 const [time,scope,researchRuns]=await Promise.all(['semantic-time.mjs','article-extraction.mjs','model-research-runs.mjs'].map(load));
 let at=recipe.startedAt,stepId=null,inputs={quotes:{}};const results={},rows=[],calls=[],network=[],usedResponses=new Set(),usedRecords=new Set();
 const fetchRaw=async(url)=>{
  const match=recipe.responses.find(r=>r.url===String(url)&&r.at<=at&&!usedResponses.has(r.id));
  const entry={stepId,at,url:String(url),responseId:match?.id??null,status:match?'recorded':'missing'};network.push(entry);
  if(!match)throw Error('没有当时可用的冻结响应；未请求网络');usedResponses.add(match.id);return match;
 };
 const fetcher=async url=>{const r=await fetchRaw(url);return new Response([204,205,304].includes(r.status)?null:r.body,{status:r.status,headers:r.headers});};
 const sourceReader=url=>article.readPublicArticle(url,{resolver:async()=>[{address:'93.184.216.34',family:4}],request:async url=>{const r=await fetchRaw(url.href);return {status:r.status,headers:r.headers,body:r.body};}});
 const contracts={
  research:p=>({prompt:codex.codexPrompt(p),schema:typeof codex.codexDraftSchema==='function'?codex.codexDraftSchema(p):codex.CODEX_DRAFT_SCHEMA,promptVersion:codex.CODEX_PROMPT_VERSION,...(codex.CODEX_SCHEMA_VERSION?{schemaVersion:codex.CODEX_SCHEMA_VERSION}:{})}),
  semantic:p=>({prompt:semantic.comparisonPrompt(p),schema:p.schema===semantic.SEMANTIC_VERSION?semantic.SEMANTIC_SCHEMA:semantic.MATERIAL_SEMANTIC_SCHEMA,promptVersion:`${p.schema}/${time.TIME_PROMPT_VERSION}${p.schema!==semantic.SEMANTIC_VERSION?'/'+scope.ARTICLE_SCOPE_VERSION:''}`}),
  material:p=>({prompt:material.materialEventsPrompt(p),schema:material.MATERIAL_EVENTS_SCHEMA,promptVersion:material.MATERIAL_EVENTS_VERSION}),
  company:p=>({prompt:company.companyEntitiesPrompt(p),schema:company.COMPANY_ENTITIES_SCHEMA,promptVersion:company.COMPANY_ENTITIES_VERSION})
 };
 const generators={research:codex.generateCodexDraft,semantic:semantic.generateComparison,material:material.generateMaterialEvents,company:company.generateCompanyEntities};
 const runner=lane=>async(packet,config)=>{
  const wallTime=()=>new Date(globalThis.__signalReplayWallNow?.()??Date.now()).toISOString();
  const call={stepId,at,lane,packet,status:'running',wallStartedAt:wallTime()};calls.push(call);
  try{const c=contracts[lane](packet),contract={packetHash:hash(packet),inputHash:packet.inputHash,promptHash:hash(c.prompt),schemaHash:hash(c.schema),promptVersion:c.promptVersion,...(c.schemaVersion?{schemaVersion:c.schemaVersion}:{}),model:config.model,effort:config.effort};Object.assign(call,{contract,prompt:c.prompt,schema:c.schema});let result;
   if(recipe.model.mode==='live-codex')result=await generators[lane](packet,config);
   else{const r=recipe.model.records.find(r=>r.at<=at&&r.lane===lane&&hash(r.contract)===hash(contract)&&!usedRecords.has(r.id));if(!r)throw new codex.CodexResearchError('packet');usedRecords.add(r.id);call.recordId=r.id;result=structuredClone(r.result);}
   for(const [k,v] of Object.entries(contract))if(!['packetHash'].includes(k)&&result.trace?.[k]!==v)throw new codex.CodexResearchError('output');
   if(lane==='research')researchRuns.validateCandidate(result,packet,{model:config.model,topicId:packet.input.topicId});
   else if(lane==='semantic')semantic.validateComparisonCandidate(result,packet,config.model,{requireTimeEvidence:true});
   else{if(result.status!=='candidate'||result.reviewStatus!=='unreviewed'||typeof result.rawOutput!=='string'||hash(result.rawOutput)!==result.trace.outputHash)throw new codex.CodexResearchError('output');const parsed=lane==='material'?material.validateMaterialEvents(JSON.parse(result.rawOutput),packet):company.validateCompanyEntities(JSON.parse(result.rawOutput),packet);if(hash(parsed)!==hash(lane==='material'?result.decomposition:result.resolution))throw new codex.CodexResearchError('output');}
   call.status='candidate';call.result=result;return result;
  }catch(e){call.status='failed';call.failure={code:e instanceof codex.CodexResearchError?e.code:'process'};throw e;}finally{call.wallFinishedAt=wallTime();}
 };
 const store=stores.openStore(databasePath);runtime.assertDatabaseMode(store,'research');
 const service=services.createService(store,{mode:'research',now:()=>Date.parse(at),fetcher,sourceReader,modelConfig:recipe.model.config,modelRunner:runner('research'),semanticRunner:runner('semantic'),materialEventRunner:runner('material'),companyEntityRunner:runner('company'),marketInputs:()=>structuredClone(inputs)}),handler=handlers.createHandler(store,service);
 const apis={research:service.modelResearch,semantic:service.semanticEvents,material:service.materialEvents,company:service.companyEntities};
 const abort=()=>{void service.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 async function request(s){
  const p=resolveReplayValue(s.path,results),path=apiPath(Array.isArray(p)?p.map(v=>{if(typeof v!=='string'&&typeof v!=='number')bad();return String(v);}).join(''):p),body=resolveReplayValue(s.body,results);
  // Frozen original approvals must remain literal. A changed review in a new
  // version is evidence of invalidation, never authorization to copy its hash.
  if(s.method==='POST'&&/^\/api\/market-simulation\/orders\/[^/]+(?:\?|$)/.test(path)&&body.action==='approve'&&(typeof s.body.fingerprint!=='string'||s.body.fingerprint!==body.fingerprint))throw Error('回放批准必须绑定冻结的原审查指纹');
  let status,text;await handler({method:s.method,url:path,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}}, {writeHead:code=>status=code,end:value=>text=value});
  return {httpStatus:status,status:status<400?'succeeded':'rejected',value:JSON.parse(text),request:{method:s.method,path,body}};
 }
 try{
  for(const s of recipe.steps){if(signal?.aborted)break;at=s.at;globalThis.__signalReplayClock?.(Date.parse(at));stepId=s.id;let row;
   try{
    if(s.kind==='request')row=await request(s);
    else if(s.kind==='task'){const value=s.action==='run'?await service.runOperation(s.name,resolveReplayValue(s.input,results)):service.controlOperation(s.name,s.action);row={status:value?.outcome==='error'?'failed':value?.outcome==='skipped'||value?.skipped?'skipped':'succeeded',value};}
    else if(s.kind==='market'){inputs=resolveReplayValue(s.inputs,results);row={status:'succeeded',value:structuredClone(inputs)};}
    else if(s.kind==='wait'){const value=await apis[s.lane].wait(resolveReplayValue(s.runId,results));row={status:['failed','cancelled','interrupted'].includes(value.status)?'failed':'succeeded',value};}
    else if(s.kind==='screen'){service.research.process();row={status:'succeeded',value:s.view==='summary'?service.research.screenings.stats():service.research.snapshot()};}
    else if(s.kind==='ingest'){row={status:'succeeded',value:store.ingest(s.items,at)};}
   }catch(e){row={status:'failed',failure:{code:'replay',message:String(e.message).slice(0,300)},value:null};}
   const record={id:s.id,at,kind:s.kind,...row};results[s.id]=record;rows.push(record);
  }
  await service.close();
  const tables={};let bytes=0,total=0;
  for(const t of store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
   const quote='"'+t.name.replaceAll('"','""')+'"',count=store.db.prepare(`SELECT count(*) n FROM ${quote}`).get().n;
   if(total+count>50000)throw Error('回放存储超过完整导出上限');
   const data=store.db.prepare(`SELECT * FROM ${quote}`).all().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?String(v):v]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   bytes+=Buffer.byteLength(JSON.stringify(data));total+=count;if(bytes>24*1024*1024)throw Error('回放存储超过完整导出上限');tables[t.name]={sql:t.sql,rows:data,hash:hash(data)};
  }
  return {format:'pipeline-replay-result/1',recipeHash:hash(recipe),rows,modelCalls:calls,modelSummary:{started:calls.length,candidate:calls.filter(c=>c.status==='candidate').length,failed:calls.filter(c=>c.status==='failed').length,unfinished:calls.filter(c=>c.status==='running').length},network,unusedResponses:recipe.responses.filter(r=>!usedResponses.has(r.id)).map(r=>r.id),unusedModelRecords:recipe.model.records.filter(r=>!usedRecords.has(r.id)).map(r=>r.id),tables,storage:{tables:Object.keys(tables).length,rows:total,bytes},summary:{planned:recipe.steps.length,executed:rows.length,succeeded:rows.filter(r=>r.status==='succeeded').length,rejected:rows.filter(r=>r.status==='rejected').length,failed:rows.filter(r=>r.status==='failed').length,skipped:rows.filter(r=>r.status==='skipped').length,notStarted:recipe.steps.length-rows.length},cancelled:!!signal?.aborted,forwardEligible:false};
 }finally{signal?.removeEventListener('abort',abort);await service.close();store.close();}
}
