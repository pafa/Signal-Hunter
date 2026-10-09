import {researchActor,SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {initializeModelLease,claimModelLease,releaseModelLease} from './model-lease.mjs';
import {randomUUID} from 'node:crypto';
import {generateCodexDraft,validatePacket,validateCodexDraft,CodexResearchError,digest,rejectedOutputDiagnostic} from './codex-research.mjs';

export function validateCandidate(result,packet,{model,topicId}){
 validatePacket(packet);
 const output={sections:result?.sections,missingEvidence:result?.missingEvidence,...(result?.companyAssessments===undefined?{}:{companyAssessments:result.companyAssessments}),...(result?.materialityReviews===undefined?{}:{materialityReviews:result.materialityReviews}),...(result?.sourceRequests===undefined?{}:{sourceRequests:result.sourceRequests})};
 validateCodexDraft(output,packet);
 if(result.status!=='candidate'||result.reviewStatus!=='unreviewed'||packet.input.topicId!==topicId||result.trace?.inputHash!==packet.inputHash||result.trace?.model!==model||result.trace?.topicVersion!==packet.input.topicVersion||result.trace?.topicId!==topicId||typeof result.rawOutput!=='string'||digest(result.rawOutput)!==result.trace.outputHash)throw new CodexResearchError('output');
 let raw;try{raw=validateCodexDraft(JSON.parse(result.rawOutput),packet);}catch{throw new CodexResearchError('output');}
 if(digest(raw)!==digest(output))throw new CodexResearchError('output');
}

export function openModelResearchRuns(store,research,{enabled=false,config={},runner=generateCodexDraft,now=()=>Date.now(),onStart=()=>{}}={}){
 const db=store.db,jobs=new Map();let closed=false;initializeModelLease(db);
 db.exec(`CREATE TABLE IF NOT EXISTS model_research_runs(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS model_research_topic ON model_research_runs(topic_id,created_at);
 CREATE TABLE IF NOT EXISTS model_research_requests(request_id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,topic_version INTEGER NOT NULL,run_id TEXT NOT NULL UNIQUE REFERENCES model_research_runs(id),input_hash TEXT NOT NULL);`);
 const expiredView=(run,expiresAt)=>run.status==='running'&&expiresAt<now()?{...run,status:'interrupted',failure:{code:'interrupted',message:'上次调用未完成；保留输入，可手动重新生成'}}:run;
 const read=id=>{const row=db.prepare('SELECT payload,expires_at FROM model_research_runs WHERE id=?').get(id);if(!row)throw new Error('模型研判记录不存在');return expiredView(JSON.parse(row.payload),row.expires_at);};
 const write=run=>db.prepare('UPDATE model_research_runs SET status=?,payload=? WHERE id=?').run(run.status,JSON.stringify(run),run.id);
 function recover(){
  if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')return;
  const rows=db.prepare("SELECT payload FROM model_research_runs WHERE status='running' AND expires_at<?").all(now());
  for(const row of rows){const run=JSON.parse(row.payload);write({...run,status:'interrupted',finishedAt:new Date(now()).toISOString(),failure:{code:'interrupted',message:'上次调用未完成；保留输入，可手动重新生成'}});}
 }
 recover();
 const summary=run=>({id:run.id,topicId:run.topicId,topicVersion:run.packet.input.topicVersion,inputHash:run.packet.inputHash,status:run.status,createdAt:run.createdAt,finishedAt:run.finishedAt||null,model:run.model,effort:run.effort,failure:run.failure||null,acceptedVersion:run.acceptedVersion||null,...(run.requestId?{requestId:run.requestId}:{})});
 function priorRequest(topicId,version,requestId){
  if(requestId===undefined)return null;
  const row=db.prepare('SELECT * FROM model_research_requests WHERE request_id=?').get(requestId);
  if(!row)return null;
  if(row.topic_id!==topicId||row.topic_version!==version)throw new Error('模型生成请求标识已用于其他输入');
  // Resolve the frozen original, even when today's topic, config or model changed.
  // An incomplete receipt must never fall through into a replacement model call.
  let run;try{
   run=read(row.run_id);validatePacket(run.packet);
   if(run.id!==row.run_id||run.topicId!==topicId||run.packet.input.topicId!==topicId||run.packet.input.topicVersion!==version||run.packet.inputHash!==row.input_hash||run.requestId!==requestId)throw new Error();
  }catch{throw new Error('模型生成请求记录不完整，请核对运行记录');}
  return summary(run);
 }
 function start(topicId,data={},beforeCommit=()=>{},systemPacket=null){
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!['version','requestId'].includes(key))||!Number.isSafeInteger(data.version)||data.version<1||Object.hasOwn(data,'requestId')&&(typeof data.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(data.requestId)))throw new Error('模型生成请求参数无效');
   const {version,requestId}=data;
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');
   if(closed)throw new Error('当前未启用本机 Codex 研判');
   const prior=priorRequest(topicId,version,requestId);if(prior)return prior;
   if(!enabled)throw new Error('当前未启用本机 Codex 研判');
   if(!config.binary||!config.model)throw new Error('请先配置本机 Codex 路径与模型');
   const packet=validatePacket(systemPacket||research.packet(topicId));if(version!==packet.input.topicVersion)throw new Error('研究已更新，请刷新后再生成');
   if(!systemPacket&&research.get(topicId).status==='archived')throw new Error('归档研究不能开始模型研判');
   const timeoutMs=config.timeoutMs??180000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000)throw new Error('模型超时配置无效');
   const run={...(systemPacket?{actor:SYSTEM_RESEARCH_ACTOR,subject:'event-cluster'}:{}),id:randomUUID(),topicId,status:'running',packet,model:config.model,effort:config.effort||'high',createdAt:new Date(now()).toISOString(),...(requestId?{requestId}:{})};
   db.exec('BEGIN IMMEDIATE');try{
    // Another process may have registered this identity since the first lookup.
    const committed=priorRequest(topicId,version,requestId);if(committed){db.exec('COMMIT');return committed;}
    recover();if(db.prepare("SELECT 1 FROM model_research_runs WHERE status='running'").get())throw new Error('已有模型研判正在运行，请等待或取消后再试');
    claimModelLease(db,run.id,now(),timeoutMs+30000);
    db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run(run.id,topicId,run.status,run.createdAt,now()+timeoutMs+30000,JSON.stringify(run));
    if(requestId)db.prepare('INSERT INTO model_research_requests VALUES(?,?,?,?,?)').run(requestId,topicId,version,run.id,packet.inputHash);
    onStart(run);beforeCommit(run);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const controller=new AbortController();
   const done=Promise.resolve().then(()=>runner(structuredClone(packet),{...config,timeoutMs,signal:controller.signal})).then(result=>{
    if(controller.signal.aborted)throw new CodexResearchError('cancelled');
    // Independently revalidate injected/provider output before persisting it as a candidate.
    validateCandidate(result,packet,{model:run.model,topicId});
    write({...run,status:'candidate',finishedAt:new Date(now()).toISOString(),candidate:result});
   }).catch(error=>{
    const failure=error instanceof CodexResearchError?{code:error.code,message:error.message,trace:error.trace}:{code:'process',message:'模型调用失败；原研究保留，可检查配置后重试'};
    write({...run,status:failure.code==='cancelled'?'cancelled':'failed',finishedAt:new Date(now()).toISOString(),failure,outputDiagnostic:rejectedOutputDiagnostic(error,packet.inputHash)});
   }).finally(()=>{jobs.delete(run.id);releaseModelLease(db,run.id);});
   // HTTP starts return before completion. Observe storage failures even when nobody calls wait().
   // The initial input record remains available for interrupted-run recovery; do not log raw SQL.
   void done.catch(()=>console.error('模型研判记录保存失败；候选未确认落库，请检查本机存储。'));
   jobs.set(run.id,{controller,done});return summary(run);
 }
 const api={
  status(){return {enabled:enabled&&!closed,provider:'local-codex-cli',model:config.model||null,effort:config.effort||'high'};},
  list(topicId){research.get(topicId);return db.prepare('SELECT payload,expires_at FROM model_research_runs WHERE topic_id=? ORDER BY rowid DESC LIMIT 50').all(topicId).map(row=>summary(expiredView(JSON.parse(row.payload),row.expires_at)));},
  get(topicId,id){const run=read(id);if(run.topicId!==topicId)throw new Error('模型研判不属于此研究');return run;},
  start(topicId,data,beforeCommit){return start(topicId,data,beforeCommit);},
  startCluster(packet,beforeCommit,actor){
   if(actor!==SYSTEM_RESEARCH_ACTOR||packet?.input?.eventSynthesis?.version!=='event-synthesis/1'||packet.input.topicId!==`event-cluster:${packet.input.eventSynthesis.clusterId}`)throw Error('事件综合研判只能由自动研究内部调用');
   return start(packet.input.topicId,{version:packet.input.topicVersion},beforeCommit,packet);
  },
  completeCluster(id,packet,actor,beforeCommit){
   if(actor!==SYSTEM_RESEARCH_ACTOR)throw Error('事件综合研判只能由自动研究内部保存');
   const run=read(id);validateCandidate(run.candidate,run.packet,{model:run.model,topicId:run.topicId});validatePacket(packet);
   if(run.subject!=='event-cluster'||run.status!=='candidate'||run.packet.inputHash!==packet.inputHash)throw Error('事件综合研判输入或状态已变化');
   db.exec('BEGIN IMMEDIATE');try{
    if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');
    if(digest(read(id))!==digest(run))throw Error('事件综合研判已有新状态');
    beforeCommit(run);write({...run,actor,status:'adopted',acceptedVersion:packet.input.topicVersion,acceptedAt:new Date(now()).toISOString()});db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return read(id);
  },
  async wait(id){await jobs.get(id)?.done;return read(id);},
  cancel(topicId,id){api.get(topicId,id);const job=jobs.get(id);if(!job)throw new Error('此调用不在本实例运行；已结束或等待中断恢复');job.controller.abort();return {id,status:'cancelling'};},
  adopt(topicId,id,{version}={},actor){
   const provenance=researchActor(actor);
   const run=api.get(topicId,id);if(run.status!=='candidate')throw new Error('此模型结果不可采纳或已经处理');
   validateCandidate(run.candidate,run.packet,{model:run.model,topicId});
   const packet=research.packet(topicId);if(version!==packet.input.topicVersion||packet.inputHash!==run.packet.inputHash)throw new Error('研究或材料已变化；此候选保留在历史中，请重新生成');
   return research.adoptModelDraft(topicId,{version,runId:id},run.candidate,()=>{
    const current=read(id);if(current.status!=='candidate')throw new Error('此候选已被处理');
    // Bind the transaction to the exact stored record checked above, including
    // its original model configuration, rather than today's configured model.
    if(digest(current)!==digest(run))throw new CodexResearchError('output');
    write({...run,...provenance,status:'adopted',acceptedVersion:version+1,acceptedAt:new Date(now()).toISOString()});
   },actor);
  },
  async close(){closed=true;for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(job=>job.done));}
 };
 return api;
}
