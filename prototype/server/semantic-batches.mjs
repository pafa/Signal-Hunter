import {randomUUID} from 'node:crypto';
import {digest} from './codex-research.mjs';
import {comparisonPacket,comparisonPrompt,SEMANTIC_VERSION,SEMANTIC_SCHEMA,MATERIAL_SEMANTIC_SCHEMA} from './semantic-events.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {batchErrors} from '../shared/semantic-batch-labels.mjs';
import {semanticErrors} from '../shared/semantic-labels.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';
const fail=i=>{throw new Error(batchErrors[i]);};
const ref=r=>({id:r.id,revision:r.revision,...(r.kind?{kind:r.kind}:{})});
const executionHash=packet=>digest({packet,prompt:comparisonPrompt(packet),schema:packet.schema===SEMANTIC_VERSION?SEMANTIC_SCHEMA:MATERIAL_SEMANTIC_SCHEMA});
export function openSemanticBatches(store,semantic,{enabled=false,config={},now=Date.now}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS semantic_batches(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS semantic_batch_items(batch_id TEXT NOT NULL,ordinal INTEGER NOT NULL,status TEXT NOT NULL,run_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(batch_id,ordinal));
 CREATE TABLE IF NOT EXISTS semantic_batch_audit(id INTEGER PRIMARY KEY,batch_id TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);`);
 const configHash=()=>digest({binary:config.binary,model:config.model,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 const at=()=>new Date(now()).toISOString(),writeAllowed=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{writeAllowed();const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const audit=(id,action,payload={})=>db.prepare('INSERT INTO semantic_batch_audit(batch_id,action,at,payload) VALUES(?,?,?,?)').run(id,action,at(),JSON.stringify(payload));
 const read=id=>{const row=db.prepare('SELECT payload FROM semantic_batches WHERE id=?').get(id);if(!row)fail(2);return JSON.parse(row.payload);};
 const rows=id=>db.prepare('SELECT i.*,r.status AS run_status,r.expires_at AS run_expires FROM semantic_batch_items i LEFT JOIN semantic_runs r ON r.id=i.run_id WHERE i.batch_id=? ORDER BY i.ordinal').all(id);
 const itemView=row=>{const item=JSON.parse(row.payload),run=row.run_id?semantic.get(row.run_id):null;return {...item,status:run?.status||row.status,runId:row.run_id,failure:run?.failure?.message||item.failure||null,relation:run?.candidate?.comparison.relation||null,stale:run?.stale||false};};
 const project=(batch,details=false)=>{const records=rows(batch.id),counts={};for(const row of records){const status=(row.run_status==='running'&&row.run_expires<now()?'interrupted':row.run_status)||row.status;counts[status]=(counts[status]||0)+1;}const state=batch.state==='active'&&!counts.queued&&!counts.running?'completed':batch.state;return {id:batch.id,requestId:batch.requestId,state,createdAt:batch.createdAt,model:batch.plan.model,planHash:batch.plan.planHash,inputCount:batch.plan.inputs.length,pairCount:records.length,counts,...(batch.owner?{owner:batch.owner}:{}),...(details?{inputs:batch.plan.inputs.map(comparisonSummary),items:records.map(itemView),audit:db.prepare('SELECT action,at,payload FROM semantic_batch_audit WHERE batch_id=? ORDER BY id').all(batch.id).map(r=>({...r,payload:JSON.parse(r.payload)}))}:{})};};
 function plan(input){
  if(!input||Object.keys(input).join(',')!=='inputs'||!Array.isArray(input.inputs)||input.inputs.length<2||input.inputs.length>10)fail(0);
  const keys=input.inputs.map(r=>`${r?.kind||'news'}:${r?.id}`);if(new Set(keys).size!==keys.length)fail(0);
  const inputs=[],pairs=[];
  for(let left=0;left<input.inputs.length;left++)for(let right=left+1;right<input.inputs.length;right++){
   const packet=comparisonPacket(store,{left:input.inputs[left],right:input.inputs[right]});inputs[left]=packet.input.left;inputs[right]=packet.input.right;pairs.push({left,right,inputHash:packet.inputHash,executionHash:executionHash(packet)});
  }
  const value={schema:'semantic-batch-1',inputs,pairs,model:config.model||null,configHash:configHash()};return {...value,planHash:digest(value)};
 }
 const api={
  preview(input){const p=plan(input);return {...p,inputs:p.inputs.map(comparisonSummary),maximumCalls:p.pairs.length};},
  list(){return {enabled:enabled&&semantic.status().enabled,batches:db.prepare('SELECT payload FROM semantic_batches ORDER BY rowid DESC LIMIT 50').all().map(r=>project(JSON.parse(r.payload)))};},
  get(id){return project(read(id),true);},
  create(input,{owner=null,reuseRunIds=[],beforeCommit=()=>{}}={}){
   writeAllowed();if(!enabled||!semantic.status().enabled)throw new Error('当前未启用本机 Codex 研判');
   if(!config.binary||!config.model)throw new Error('请先配置本机 Codex 路径与模型');
   if(!input||Object.keys(input).sort().join(',')!=='inputs,planHash,requestId'||typeof input.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(input.requestId)||typeof input.planHash!=='string')fail(3);
   const batch=transaction(()=>{
    const old=db.prepare('SELECT payload FROM semantic_batches WHERE request_id=?').get(input.requestId);if(old){const b=JSON.parse(old.payload);if(b.requestHash!==digest(input))fail(3);return b;}
    const p=plan({inputs:input.inputs});if(p.planHash!==input.planHash)fail(1);
    const b={id:randomUUID(),requestId:input.requestId,requestHash:digest(input),createdAt:at(),state:'active',plan:p,...(owner?{owner}:{})};
    const reusable=reuseRunIds.map(id=>semantic.get(id)).filter(r=>r.status==='candidate'&&!r.stale&&r.model===p.model&&(!r.decision||r.decision.runId===r.id&&r.decision.action==='accept'));
    db.prepare('INSERT INTO semantic_batches VALUES(?,?,?)').run(b.id,b.requestId,JSON.stringify(b));
    for(const [ordinal,pair] of p.pairs.entries()){const reused=reusable.find(r=>r.packet.inputHash===pair.inputHash&&executionHash(r.packet)===pair.executionHash);db.prepare('INSERT INTO semantic_batch_items VALUES(?,?,?,?,?)').run(b.id,ordinal,reused?'candidate':'queued',reused?.id||null,JSON.stringify({ordinal,...pair,attempts:[],...(reused?{reusedRunId:reused.id}:{})}));}
    beforeCommit(b);audit(b.id,'create',{planHash:p.planHash,maximumCalls:p.pairs.length,reusedPairs:p.pairs.filter(pair=>reusable.some(r=>r.packet.inputHash===pair.inputHash&&executionHash(r.packet)===pair.executionHash)).length});return b;
   });return project(batch,true);
  },
  control(id,input,beforeCommit=()=>{}){
   if(!input||Object.keys(input).sort().join(',')!==(['pause','resume','cancel'].includes(input.action)?'action':'action,ordinal')||!['pause','resume','cancel','retry'].includes(input.action))fail(3);
   transaction(()=>{
    const b=read(id);if(input.action==='retry'){
     if(b.state==='cancelled'||!Number.isSafeInteger(input.ordinal))fail(6);const row=db.prepare('SELECT * FROM semantic_batch_items WHERE batch_id=? AND ordinal=?').get(id,input.ordinal);if(!row||!['failed','interrupted','cancelled'].includes(itemView(row).status))fail(6);
     const item=JSON.parse(row.payload);db.prepare("UPDATE semantic_batch_items SET status='queued',run_id=NULL,payload=? WHERE batch_id=? AND ordinal=?").run(JSON.stringify({...item,failure:null}),id,input.ordinal);audit(id,'retry',{ordinal:input.ordinal,previousRun:row.run_id});beforeCommit();return;
    }
    if(b.state==='cancelled')fail(3);b.state={pause:'paused',resume:'active',cancel:'cancelled'}[input.action];db.prepare('UPDATE semantic_batches SET payload=? WHERE id=?').run(JSON.stringify(b),id);
    if(input.action==='cancel')db.prepare("UPDATE semantic_batch_items SET status='cancelled' WHERE batch_id=? AND status='queued'").run(id);audit(id,input.action);beforeCommit();
   });return api.get(id);
  },
  step(context,{batchId=null,beforeCommit=()=>{},actor}={}){
   context.assertActive();writeAllowed();if(!enabled||!semantic.status().enabled)return {skipped:'model-disabled'};
   const row=db.prepare("SELECT i.* FROM semantic_batch_items i JOIN semantic_batches b ON b.id=i.batch_id WHERE i.status='queued' AND json_extract(b.payload,'$.state')='active' AND ((? IS NULL AND json_extract(b.payload,'$.owner') IS NULL) OR (b.id=? AND json_extract(b.payload,'$.owner')='research-pipeline')) ORDER BY b.rowid,i.ordinal LIMIT 1").get(batchId,batchId);if(!row)return {skipped:'no-queued-items'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   const b=read(row.batch_id),item=JSON.parse(row.payload),pair={left:ref(b.plan.inputs[item.left]),right:ref(b.plan.inputs[item.right])};
   try{
    if(configHash()!==b.plan.configHash)fail(4);
    const started=semantic.start(pair,run=>{
     context.assertActive();writeAllowed();const latest=read(b.id),pending=db.prepare('SELECT status FROM semantic_batch_items WHERE batch_id=? AND ordinal=?').get(b.id,item.ordinal);if(latest.state!=='active'||pending?.status!=='queued')fail(3);
     if(executionHash(run.packet)!==item.executionHash||executionHash(comparisonPacket(store,pair))!==item.executionHash)fail(5);
     beforeCommit(run,b.id,item.ordinal);
     db.prepare("UPDATE semantic_batch_items SET status='running',run_id=?,payload=? WHERE batch_id=? AND ordinal=?").run(run.id,JSON.stringify({...item,attempts:[...item.attempts,run.id]}),b.id,item.ordinal);audit(b.id,'start',{ordinal:item.ordinal,runId:run.id});
    },actor);return {ok:true,batchId:b.id,ordinal:item.ordinal,runId:started.id};
   }catch(error){
    context.assertActive();if(error.message==='已有模型研判正在运行，请等待或取消后再试')return {skipped:'model-busy'};
    if(!batchErrors.includes(error.message)&&!semanticErrors.includes(error.message)&&error.code!=='packet')throw error;
    transaction(()=>{context.assertActive();const latest=read(b.id),pending=db.prepare('SELECT status FROM semantic_batch_items WHERE batch_id=? AND ordinal=?').get(b.id,item.ordinal);if(latest.state!=='active'||pending?.status!=='queued')return;
     db.prepare("UPDATE semantic_batch_items SET status='invalidated',payload=? WHERE batch_id=? AND ordinal=?").run(JSON.stringify({...item,failure:safeErrorText(error)}),b.id,item.ordinal);audit(b.id,'invalidated',{ordinal:item.ordinal,reason:safeErrorText(error)});
    });return {ok:true,invalidated:true,reason:safeErrorText(error),batchId:b.id,ordinal:item.ordinal};
   }
  }
 };
 return api;
}
