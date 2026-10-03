import {initializeModelLease,claimModelLease,releaseModelLease} from './model-lease.mjs';
import {randomUUID} from 'node:crypto';
import {generateCodexDraft,validatePacket,validateCodexDraft,CodexResearchError,digest} from './codex-research.mjs';

function validateCandidate(result,packet,{model,topicId}){
 validatePacket(packet);
 validateCodexDraft({sections:result?.sections,missingEvidence:result?.missingEvidence},packet);
 if(result.status!=='candidate'||result.reviewStatus!=='unreviewed'||packet.input.topicId!==topicId||result.trace?.inputHash!==packet.inputHash||result.trace?.model!==model||result.trace?.topicVersion!==packet.input.topicVersion||result.trace?.topicId!==topicId||typeof result.rawOutput!=='string'||digest(result.rawOutput)!==result.trace.outputHash)throw new CodexResearchError('output');
 let raw;try{raw=validateCodexDraft(JSON.parse(result.rawOutput),packet);}catch{throw new CodexResearchError('output');}
 if(digest(raw)!==digest({sections:result.sections,missingEvidence:result.missingEvidence}))throw new CodexResearchError('output');
}

export function openModelResearchRuns(store,research,{enabled=false,config={},runner=generateCodexDraft,now=()=>Date.now()}={}){
 const db=store.db,jobs=new Map();let closed=false;initializeModelLease(db);
 db.exec(`CREATE TABLE IF NOT EXISTS model_research_runs(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS model_research_topic ON model_research_runs(topic_id,created_at);`);
 const expiredView=(run,expiresAt)=>run.status==='running'&&expiresAt<now()?{...run,status:'interrupted',failure:{code:'interrupted',message:'上次调用未完成；保留输入，可手动重新生成'}}:run;
 const read=id=>{const row=db.prepare('SELECT payload,expires_at FROM model_research_runs WHERE id=?').get(id);if(!row)throw new Error('模型研判记录不存在');return expiredView(JSON.parse(row.payload),row.expires_at);};
 const write=run=>db.prepare('UPDATE model_research_runs SET status=?,payload=? WHERE id=?').run(run.status,JSON.stringify(run),run.id);
 function recover(){
  if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')return;
  const rows=db.prepare("SELECT payload FROM model_research_runs WHERE status='running' AND expires_at<?").all(now());
  for(const row of rows){const run=JSON.parse(row.payload);write({...run,status:'interrupted',finishedAt:new Date(now()).toISOString(),failure:{code:'interrupted',message:'上次调用未完成；保留输入，可手动重新生成'}});}
 }
 recover();
 const summary=run=>({id:run.id,topicId:run.topicId,topicVersion:run.packet.input.topicVersion,inputHash:run.packet.inputHash,status:run.status,createdAt:run.createdAt,finishedAt:run.finishedAt||null,model:run.model,effort:run.effort,failure:run.failure||null,acceptedVersion:run.acceptedVersion||null});
 const api={
  status(){return {enabled:enabled&&!closed,provider:'local-codex-cli',model:config.model||null,effort:config.effort||'high'};},
  list(topicId){research.get(topicId);return db.prepare('SELECT payload,expires_at FROM model_research_runs WHERE topic_id=? ORDER BY rowid DESC LIMIT 50').all(topicId).map(row=>summary(expiredView(JSON.parse(row.payload),row.expires_at)));},
  get(topicId,id){const run=read(id);if(run.topicId!==topicId)throw new Error('模型研判不属于此研究');return run;},
  start(topicId,{version}={}){
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');
   if(!enabled||closed)throw new Error('当前未启用本机 Codex 研判');
   if(!config.binary||!config.model)throw new Error('请先配置本机 Codex 路径与模型');
   const packet=validatePacket(research.packet(topicId));if(version!==packet.input.topicVersion)throw new Error('研究已更新，请刷新后再生成');
   if(research.get(topicId).status==='archived')throw new Error('归档研究不能开始模型研判');
   const timeoutMs=config.timeoutMs??180000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000)throw new Error('模型超时配置无效');
   const run={id:randomUUID(),topicId,status:'running',packet,model:config.model,effort:config.effort||'high',createdAt:new Date(now()).toISOString()};
   db.exec('BEGIN IMMEDIATE');try{
    recover();if(db.prepare("SELECT 1 FROM model_research_runs WHERE status='running'").get())throw new Error('已有模型研判正在运行，请等待或取消后再试');
    claimModelLease(db,run.id,now(),timeoutMs+30000);
    db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run(run.id,topicId,run.status,run.createdAt,now()+timeoutMs+30000,JSON.stringify(run));db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const controller=new AbortController();
   const done=Promise.resolve().then(()=>runner(structuredClone(packet),{...config,timeoutMs,signal:controller.signal})).then(result=>{
    if(controller.signal.aborted)throw new CodexResearchError('cancelled');
    // Independently revalidate injected/provider output before persisting it as a candidate.
    validateCandidate(result,packet,{model:run.model,topicId});
    write({...run,status:'candidate',finishedAt:new Date(now()).toISOString(),candidate:result});
   }).catch(error=>{
    const failure=error instanceof CodexResearchError?{code:error.code,message:error.message,trace:error.trace}:{code:'process',message:'模型调用失败；原研究保留，可检查配置后重试'};
    write({...run,status:failure.code==='cancelled'?'cancelled':'failed',finishedAt:new Date(now()).toISOString(),failure});
   }).finally(()=>{jobs.delete(run.id);releaseModelLease(db,run.id);});
   // HTTP starts return before completion. Observe storage failures even when nobody calls wait().
   // The initial input record remains available for interrupted-run recovery; do not log raw SQL.
   void done.catch(()=>console.error('模型研判记录保存失败；候选未确认落库，请检查本机存储。'));
   jobs.set(run.id,{controller,done});return summary(run);
  },
  async wait(id){await jobs.get(id)?.done;return read(id);},
  cancel(topicId,id){api.get(topicId,id);const job=jobs.get(id);if(!job)throw new Error('此调用不在本实例运行；已结束或等待中断恢复');job.controller.abort();return {id,status:'cancelling'};},
  adopt(topicId,id,{version}={}){
   const run=api.get(topicId,id);if(run.status!=='candidate')throw new Error('此模型结果不可采纳或已经处理');
   validateCandidate(run.candidate,run.packet,{model:run.model,topicId});
   const packet=research.packet(topicId);if(version!==packet.input.topicVersion||packet.inputHash!==run.packet.inputHash)throw new Error('研究或材料已变化；此候选保留在历史中，请重新生成');
   return research.adoptModelDraft(topicId,{version,runId:id},run.candidate,()=>{
    const current=read(id);if(current.status!=='candidate')throw new Error('此候选已被处理');
    // Bind the transaction to the exact stored record checked above, including
    // its original model configuration, rather than today's configured model.
    if(digest(current)!==digest(run))throw new CodexResearchError('output');
    write({...run,status:'adopted',acceptedVersion:version+1,acceptedAt:new Date(now()).toISOString()});
   });
  },
  async close(){closed=true;for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(job=>job.done));}
 };
 return api;
}
