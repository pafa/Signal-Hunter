import {randomUUID} from 'node:crypto';
import {initializeModelLease,claimModelLease,releaseModelLease} from './model-lease.mjs';
import {digest,CodexResearchError,rejectedOutputDiagnostic} from './codex-research.mjs';
import {COMPANY_ENTITIES_VERSION,companyEntitiesPacket,validateCompanyEntities,generateCompanyEntities} from './company-entities.mjs';

function validateSavedCandidate({packet,candidate,model,topicId}){
 // Old packets remain auditable; recomputing the current packet marks them
 // stale and prevents new linking without rewriting a stored model result.
 if(![COMPANY_ENTITIES_VERSION,'company-entities-1'].includes(packet?.schema)||packet.input?.topicId!==topicId||packet.inputHash!==digest(packet.input)||Buffer.byteLength(JSON.stringify(packet))>524288)throw new CodexResearchError('packet');
 if(candidate?.status!=='candidate'||candidate.reviewStatus!=='unreviewed'||candidate.trace?.inputHash!==packet.inputHash||candidate.trace?.model!==model||typeof candidate.rawOutput!=='string'||digest(candidate.rawOutput)!==candidate.trace.outputHash)throw new CodexResearchError('output');
 let raw;try{raw=validateCompanyEntities(JSON.parse(candidate.rawOutput),packet);}catch{throw new CodexResearchError('output');}
 if(digest(raw)!==digest(candidate.resolution))throw new CodexResearchError('output');
}

export function openCompanyEntityRuns(store,research,{enabled=false,config={},runner=generateCompanyEntities,now=()=>Date.now()}={}){
 const db=store.db,jobs=new Map();let closed=false;initializeModelLease(db);
 db.exec(`CREATE TABLE IF NOT EXISTS company_entity_runs(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS company_entity_topic ON company_entity_runs(topic_id);
 CREATE TABLE IF NOT EXISTS company_entity_decisions(run_id TEXT NOT NULL,mention_index INTEGER NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,mention_index,version));`);
 const guard=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 const expired=(r,t)=>r.status==='running'&&t<now()?{...r,status:'interrupted',failure:{message:'上次身份识别未完成；冻结材料保留，可重新发起'}}:r;
 const read=id=>{const row=db.prepare('SELECT * FROM company_entity_runs WHERE id=?').get(id);if(!row)throw new Error('材料身份识别记录不存在');return expired(JSON.parse(row.payload),row.expires_at);};
 const write=r=>db.prepare('UPDATE company_entity_runs SET status=?,payload=? WHERE id=?').run(r.status,JSON.stringify(r),r.id);
 const history=(id,index)=>db.prepare('SELECT payload FROM company_entity_decisions WHERE run_id=? AND mention_index=? ORDER BY version DESC').all(id,index).map(r=>JSON.parse(r.payload));
 const stale=r=>{try{if(r.status==='candidate')validateSavedCandidate(r);return companyEntitiesPacket(store,research,r.topicId,{...r.request,version:research.get(r.topicId).version}).inputHash!==r.packet.inputHash;}catch{return true;}};
 const summary=r=>({id:r.id,topicId:r.topicId,status:r.status,createdAt:r.createdAt,materialId:r.packet.input.material.id,materialTitle:r.packet.input.material.title,materialRevision:r.packet.input.material.revision,stale:stale(r)});
 const recover=()=>{for(const row of db.prepare("SELECT payload,expires_at FROM company_entity_runs WHERE status='running' AND expires_at<?").all(now()))write(expired(JSON.parse(row.payload),row.expires_at));};
 if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value!=='1')recover();
 const api={
  list(topicId){research.get(topicId);return {enabled:enabled&&!closed,model:config.model||null,runs:db.prepare('SELECT payload,expires_at FROM company_entity_runs WHERE topic_id=? ORDER BY rowid DESC LIMIT 50').all(topicId).map(row=>summary(expired(JSON.parse(row.payload),row.expires_at)))};},
  get(topicId,id){const r=read(id);if(r.topicId!==topicId)throw new Error('身份识别记录不属于此研究');return {...r,stale:stale(r),reviews:(r.candidate?.resolution.mentions||[]).map((_,i)=>history(id,i))};},
  start(topicId,data){
   guard();if(!data||Object.keys(data).sort().join(',')!=='materialId,requestId,revision,version'||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(data.requestId))throw new Error('身份识别请求参数无效');
   const {requestId}=data,request={version:data.version,materialId:data.materialId,revision:data.revision},prior=db.prepare('SELECT payload FROM company_entity_runs WHERE request_id=?').get(requestId);
   if(prior){const r=JSON.parse(prior.payload);if(r.topicId!==topicId||Object.keys(request).some(k=>r.request[k]!==request[k]))throw new Error('请求标识已用于其他输入');return summary(read(r.id));}
   if(!enabled||closed||!config.binary||!config.model)throw new Error('当前未启用本机 Codex 材料身份识别');
   const packet=companyEntitiesPacket(store,research,topicId,request),timeoutMs=config.timeoutMs??180000;
   if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000)throw new Error('模型超时配置无效');
   const run={id:randomUUID(),topicId,requestId,request,packet,status:'running',model:config.model,createdAt:new Date(now()).toISOString()};
   db.exec('BEGIN IMMEDIATE');try{guard();if(digest(companyEntitiesPacket(store,research,topicId,request))!==digest(packet))throw new Error('材料或研究已变化，请刷新识别');recover();claimModelLease(db,run.id,now(),timeoutMs+30000);db.prepare('INSERT INTO company_entity_runs VALUES(?,?,?,?,?,?)').run(run.id,topicId,requestId,run.status,now()+timeoutMs+30000,JSON.stringify(run));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   const controller=new AbortController();
   const done=Promise.resolve().then(()=>runner(structuredClone(packet),{...config,timeoutMs,signal:controller.signal})).then(candidate=>{
    if(controller.signal.aborted)throw new CodexResearchError('cancelled');
    validateSavedCandidate({...run,candidate});
    write({...run,status:'candidate',finishedAt:new Date(now()).toISOString(),candidate});
   }).catch(error=>{write({...run,status:controller.signal.aborted?'cancelled':'failed',finishedAt:new Date(now()).toISOString(),outputDiagnostic:rejectedOutputDiagnostic(error,packet.inputHash),failure:error instanceof CodexResearchError?{code:error.code,message:error.message,trace:error.trace}:{code:'process',message:'模型身份识别失败；原材料保留，请检查本机配置'}});}).finally(()=>{jobs.delete(run.id);releaseModelLease(db,run.id);});
   void done.catch(()=>console.error('材料身份识别记录保存失败；冻结输入保留，请检查本机存储。'));
   jobs.set(run.id,{controller,done});return summary(run);
  },
  async wait(id){await jobs.get(id)?.done;const r=read(id);return api.get(r.topicId,id);},
  cancel(topicId,id){guard();api.get(topicId,id);const job=jobs.get(id);if(!job)throw new Error('此调用不在本实例运行');job.controller.abort();return {id,status:'cancelling'};},
  decide(topicId,id,data){
   guard();if(!data||Object.keys(data).sort().join(',')!=='action,mentionIndex,note,symbol,topicVersion,version'||!['link','reject','reopen'].includes(data.action)||!Number.isSafeInteger(data.mentionIndex)||data.mentionIndex<0||!Number.isSafeInteger(data.version)||data.version<0||!Number.isSafeInteger(data.topicVersion)||data.topicVersion<1||typeof data.symbol!=='string'||typeof data.note!=='string'||!data.note.trim()||data.note.length>1200)throw new Error('身份核对参数无效');
   const r=read(id);if(r.topicId!==topicId)throw new Error('身份识别记录不属于此研究');
   const mention=r.candidate?.resolution?.mentions[data.mentionIndex];if(r.status!=='candidate'||!mention)throw new Error('没有可核对的身份候选');
   // Revalidate frozen output before a decision; a stored candidate is not trusted input.
   validateSavedCandidate(r);const frozenHash=digest(r);
   const latest=history(id,data.mentionIndex)[0],requestHash=digest({mentionIndex:data.mentionIndex,version:data.version,action:data.action,note:data.note,symbol:data.symbol,topicVersion:data.topicVersion});
   if(latest?.requestHash===requestHash)return api.get(topicId,id);
   const check=()=>{guard();if(digest(read(id))!==frozenHash)throw new CodexResearchError('output');const current=history(id,data.mentionIndex)[0],topic=research.get(topicId);if((current?.version||0)!==data.version||current?.action==='link')throw new Error('核对记录已变化；已关联证券请在公司关系中处理');if(data.action==='link'&&(stale(r)||current?.action==='reject'||topic.version!==data.topicVersion||!mention.symbols.includes(data.symbol)||!['candidate','ambiguous'].includes(mention.resolution)))throw new Error('材料、研究或身份候选已变化，请刷新核对');if(data.action!=='link'&&data.symbol)throw new Error('排除或重新核对不得指定证券');if(data.action==='reopen'&&current?.action!=='reject')throw new Error('只有已排除候选可以重新核对');};
   const decision={version:data.version+1,action:data.action,note:data.note.trim(),symbol:data.symbol,at:new Date(now()).toISOString(),requestHash,inputHash:r.packet.inputHash};
   const save=()=>db.prepare('INSERT INTO company_entity_decisions VALUES(?,?,?,?)').run(id,data.mentionIndex,decision.version,JSON.stringify(decision));
   if(data.action==='link'){
    check();const m=r.packet.input.material,identity=r.packet.input.directory.find(c=>c.symbol===data.symbol),basis={runId:id,mentionIndex:data.mentionIndex,mention,identity,inputHash:r.packet.inputHash,materialId:m.id,materialRevision:m.revision,directoryVersion:identity.directoryVersion||r.packet.input.directoryVersion,trace:r.candidate.trace,reviewNote:decision.note};
    research.addCompany(topicId,{version:data.topicVersion,symbol:data.symbol,kind:'mentioned',relationStatus:'pending',direction:'unclear',note:decision.note,url:m.url,evidenceIds:['material:'+m.id],identityReviewed:false},()=>{check();decision.researchVersion=data.topicVersion+1;save();},basis);
   }else{db.exec('BEGIN IMMEDIATE');try{check();save();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
   return api.get(topicId,id);
  },
  async close(){closed=true;for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.done));}
 };
 return api;
}
