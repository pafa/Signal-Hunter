import {claimsOf} from '../shared/claims.mjs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildEvaluationBaseline,collectEvaluationSources} from './evaluation-baseline.mjs';
import {digest,codexPrompt,CODEX_PROMPT_VERSION,CODEX_DRAFT_SCHEMA,CODEX_SCHEMA_VERSION,codexDraftSchema} from './codex-research.mjs';
import {validateCandidate as validateModelCandidate} from './model-research-runs.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {forwardEligibility,evaluationTime,evaluationMemberKeys} from '../shared/evaluation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Baselines describe an immutable running candidate, not files edited beneath it.
let loadedSourceHash=null;
try{loadedSourceHash=digest(collectEvaluationSources(root));}catch{/* A minimal runtime can start, but cannot freeze a complete source baseline. */}
const same=(a,b)=>(a.kind||'news')===(b.kind||'news')&&a.id===b.id&&a.revision===b.revision;
const stateKey='forward_evaluation_baseline';
const guarded=value=>({...value,snapshotHash:digest(value)});
const checked=value=>{const {snapshotHash,...data}=value;if(snapshotHash!==digest(data))throw new Error('前向档案指纹不符');return value;};
export function openForwardEvaluations(store,research,clusters,{enabled=false,config={},now=Date.now}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS forward_baselines(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS forward_captures(run_id TEXT PRIMARY KEY,baseline_id TEXT NOT NULL,topic_id TEXT NOT NULL,payload TEXT NOT NULL);`);
 const guard=()=>{if(!enabled)throw new Error('当前模式不启用前向记录');if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 const recipe=()=>({provider:'local-codex-cli',binary:config.binary||null,model:config.model||null,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000,promptVersion:CODEX_PROMPT_VERSION,schemaHash:digest(CODEX_DRAFT_SCHEMA),schemaVersion:CODEX_SCHEMA_VERSION});
 const active=()=>db.prepare('SELECT value FROM settings WHERE key=?').get(stateKey)?.value||null;
 const baseline=id=>{const row=db.prepare('SELECT payload FROM forward_baselines WHERE id=?').get(id);if(!row)throw new Error('前向基线不存在');return checked(JSON.parse(row.payload));};
 const brief=b=>({id:b.id,title:b.title,frozenAt:b.baseline.frozenAt,rulesHash:b.baseline.rulesHash,sourceHash:b.sourceHash,execution:b.execution,forwardEligible:false});
 const api={
  list(){return {enabled,activeBaselineId:active(),totalBaselines:db.prepare('SELECT count(*) n FROM forward_baselines').get().n,totalRecords:db.prepare('SELECT count(*) n FROM forward_captures').get().n,baselines:db.prepare('SELECT payload FROM forward_baselines ORDER BY rowid DESC LIMIT 50').all().map(r=>brief(checked(JSON.parse(r.payload))))};},
  baseline,
  pause(data){
   guard();if(!data||Object.keys(data).join(',')!=='baselineId'||typeof data.baselineId!=='string')throw new Error('前向基线参数无效');
   db.exec('BEGIN IMMEDIATE');try{
    baseline(data.baselineId);const current=active();if(current&&current!==data.baselineId)throw new Error('前向基线已变化，请刷新后重试');
    db.prepare('DELETE FROM settings WHERE key=?').run(stateKey);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return api.list();
  },
  freeze(data){
   guard();if(!data||Object.keys(data).sort().join(',')!=='requestId,title'||typeof data.title!=='string'||!data.title.trim()||data.title.length>100||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId))throw new Error('前向基线参数无效');
   if(!config.binary||!config.model)throw new Error('请先配置本机 Codex 路径与模型');
   if(!loadedSourceHash)throw new Error('缺少完整候选源码，无法冻结前向基线');
   const requestHash=digest({requestId:data.requestId,title:data.title.trim()});let saved;
   db.exec('BEGIN IMMEDIATE');try{
    guard();const old=db.prepare('SELECT * FROM forward_baselines WHERE request_id=?').get(data.requestId);
    if(old){if(old.request_hash!==requestHash)throw new Error('前向请求标识已用于其他内容');saved=checked(JSON.parse(old.payload));}
    else{
     const b=buildEvaluationBaseline(db,root,{frozenAt:new Date(now()).toISOString()}),execution=recipe();
     if(digest(b.sources)!==loadedSourceHash)throw new Error('源码已变化，请重启候选服务后冻结基线');
     b.configuration.modelExecution=execution;b.configuration.scope='服务端冻结持久研究配置和指定模型执行参数；不采集凭据或继承的进程环境';b.rulesHash=digest({sources:b.sources,configuration:b.configuration});
     saved=guarded({id:randomUUID(),title:data.title.trim(),baseline:b,execution,sourceHash:digest(b.sources)});
     db.prepare('INSERT INTO forward_baselines VALUES(?,?,?,?)').run(saved.id,data.requestId,requestHash,JSON.stringify(saved));
     db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(stateKey,saved.id);
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return brief(saved);
  },
  // Called inside the model run/lease transaction, before any provider invocation.
  capture(run){
   const baselineId=active();if(!baselineId)return;
   guard();const b=baseline(baselineId),topic=research.get(run.topicId),reasons=[];
   if(topic.version!==run.packet.input.topicVersion||research.packet(run.topicId).inputHash!==run.packet.inputHash)throw new Error('研究已更新，请刷新后再生成');
   const execution={...recipe(),schemaHash:digest(codexDraftSchema(run.packet)),promptHash:digest(codexPrompt(run.packet))},sourceHash=digest(collectEvaluationSources(root));
   if(digest(recipe())!==digest(b.execution)||sourceHash!==b.sourceHash)reasons.push('代码或模型配置已不同于冻结基线');
   if(run.packet.input.sourceRevision)reasons.push('包含旧来源与历史判断');
   if(db.prepare('SELECT 1 FROM model_research_runs WHERE topic_id=? AND id<>?').get(run.topicId,run.id))reasons.push('该研究已有模型调用');
   const clusterSnapshots=clusters.forResearch(topic).map(c=>{const {history,...snapshot}=clusters.get(c.id);return snapshot;});
   const selected=clusterSnapshots.length===1?clusterSnapshots[0]:null,refs=[];
   const eventMember=topic.eventExtraction&&selected?.members.find(m=>m.kind==='event'&&m.id===topic.id);
   for(const e of run.packet.input.evidence){
    if(e.material){const m=e.material;refs.push(eventMember?.materialId===m.id&&eventMember.materialRevision===m.revision?{kind:'event',id:topic.id,revision:1,documentId:m.documentId}:{kind:'material',id:m.id,revision:m.revision,documentId:m.documentId});}
    else if(e.newsId)refs.push({kind:'news',id:e.newsId,revision:e.newsRevision});
    else reasons.push('存在未绑定原始来源的证据');
   }
   if(topic.eventExtraction&&!refs.some(r=>r.kind==='event'))reasons.push('事项缺少冻结原文');
   if(run.packet.input.relatedResearch?.length)reasons.push('包含关联研究的历史判断');
   if(!selected||!selected.health.current||!refs.length||!refs.every(ref=>selected.members.some(m=>same(ref,m))))reasons.push('研究未完整绑定单一有效事件簇');
   const members=selected?.members||[],seen=[],available=[];
   for(const m of members){
    try{
     if((m.kind||'news')==='news'){
      const n=db.prepare('SELECT first_seen FROM news WHERE id=?').get(m.id),v=db.prepare('SELECT received_at FROM revisions WHERE news_id=? AND version=?').get(m.id,m.revision);
      if(!n||!v||v.received_at!==m.availableAt)throw Error();seen.push(n.first_seen);available.push(v.received_at);
     }else{
      const material=immutableMaterialSnapshot(db,{id:m.kind==='event'?m.materialId:m.id,revision:m.kind==='event'?m.materialRevision:m.revision});
      const first=db.prepare('SELECT id,revision FROM research_materials WHERE document_id=? ORDER BY revision LIMIT 1').get(material.documentId),old=immutableMaterialSnapshot(db,first);
      if(material.documentId!==m.documentId||material.availableAt!==m.availableAt)throw Error();seen.push(old.availableAt);available.push(material.availableAt);
     }
    }catch{reasons.push('事件簇来源快照或时间无法核实');}
   }
   const time=(values,fn)=>values.length&&values.every(v=>evaluationTime(v)!==null)?new Date(fn(...values.map(v=>Date.parse(v)))).toISOString():null;
   const record={topicId:run.topicId,clusterId:selected?.id||null,clusterVersion:selected?.version||null,clusterReviewedAt:selected?.updatedAt||null,clusterMembers:members,origin:'forward-capture',firstSeen:time(seen,Math.min),availableAt:time(available,Math.max),decisionAt:run.createdAt,inputHash:run.packet.inputHash,rulesHash:b.baseline.rulesHash};
   const eligibility=forwardEligibility(record,b.baseline);reasons.push(...eligibility.reasons);
   // Count a known event/source only once, even if a different research topic or
   // cluster is created later. Failed and excluded attempts remain in this cohort.
   const keys=new Set([...members,...refs].flatMap(m=>evaluationMemberKeys(m)||[]));
   for(const row of db.prepare('SELECT payload FROM forward_captures ORDER BY rowid').iterate()){
    const prior=checked(JSON.parse(row.payload));
    if(selected&&prior.record.clusterId===selected.id||(prior.evidenceKeys||prior.record.clusterMembers.flatMap(m=>evaluationMemberKeys(m)||[])).some(key=>keys.has(key))){
     reasons.push('同事件簇或来源已有前向调用记录');break;
    }
   }
   const claimTimeline=db.prepare('SELECT version,recorded_at,payload FROM research_versions WHERE topic_id=? AND version<=? ORDER BY version').all(run.topicId,run.packet.input.topicVersion).map(row=>({version:row.version,recordedAt:row.recorded_at,claims:claimsOf(JSON.parse(row.payload))}));
   const value=guarded({claimTimeline,runId:run.id,baselineId,topicId:run.topicId,topicVersion:run.packet.input.topicVersion,topicTitle:run.packet.input.title,packetHash:digest(run.packet),evidenceKeys:[...keys].sort(),record,execution,sourceHash,clusterSnapshots,inputEligibility:{eligible:reasons.length===0,reasons:[...new Set(reasons)]},forwardEligible:false,qualification:'输入准入仅供核对；尚无独立标签、结局或模型有效性验收'});
   db.prepare('INSERT INTO forward_captures VALUES(?,?,?,?)').run(run.id,baselineId,run.topicId,JSON.stringify(value));
  },
  get(runId){
   const row=db.prepare('SELECT payload FROM forward_captures WHERE run_id=?').get(runId);if(!row)throw new Error('前向记录不存在');const capture=checked(JSON.parse(row.payload)),b=baseline(capture.baselineId);
   const saved=db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(runId);if(!saved)throw new Error('前向记录缺少原模型调用');const run=JSON.parse(saved.payload),reasons=[];
   if(digest(run.packet)!==capture.packetHash||run.model!==capture.execution.model||run.effort!==capture.execution.effort||run.topicId!==capture.topicId||run.packet.input.topicVersion!==capture.topicVersion||digest(run.packet.input)!==capture.record.inputHash||run.packet.inputHash!==capture.record.inputHash||run.createdAt!==capture.record.decisionAt||b.baseline.rulesHash!==capture.record.rulesHash)reasons.push('模型调用或冻结输入与前向记录不符');
   const trace=run.candidate?.trace||run.failure?.trace;
   if(run.candidate){try{validateModelCandidate(run.candidate,run.packet,{model:capture.execution.model,topicId:capture.topicId});}catch{reasons.push('原模型候选完整性校验失败');}}
   if(run.candidate&&!trace?.promptHash)reasons.push('实际模型执行依据缺失');
   if(trace?.promptHash)for(const key of ['model','effort','promptVersion','promptHash','schemaHash',...(capture.execution.schemaVersion?['schemaVersion']:[])])if(trace[key]!==capture.execution[key])reasons.push('实际模型执行与冻结配置不符');
   return {...capture,modelStatus:run.status,resultTrace:trace||null,executionVerified:!!trace?.promptHash&&reasons.length===0,integrity:{valid:reasons.length===0,reasons:[...new Set(reasons)]},forwardEligible:false};
  },
  records(){return db.prepare('SELECT run_id FROM forward_captures ORDER BY rowid DESC LIMIT 100').all().map(({run_id})=>{const c=api.get(run_id);return {runId:c.runId,baselineId:c.baselineId,topicId:c.topicId,topicVersion:c.topicVersion,topicTitle:c.topicTitle,modelStatus:c.modelStatus,inputEligibility:c.inputEligibility,integrity:c.integrity,forwardEligible:false};});}
 };
 return api;
}
