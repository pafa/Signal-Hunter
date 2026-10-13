import {openIntakeSources,INTAKE_SOURCE_VERSION} from './pipeline-intake-source.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {randomUUID} from 'node:crypto';
import {digest,CodexResearchError,rejectedOutputDiagnostic} from './codex-research.mjs';
import {claimModelLease,releaseModelLease} from './model-lease.mjs';
import {INTAKE_SCREENING_VERSION,INTAKE_BODY_VERSION,intakeBodyPacket,INTAKE_BATCH_SIZE,intakeScreeningPacket,validateIntakeScreening,generateIntakeScreening} from './intake-screening.mjs';

// A bounded second route for unselected headlines, sharing the research budget.
// Original triage is immutable. This lane only queues source reading, never orders.
export function openPipelineIntake(store,research,{config,now,settings,guard,transaction,audit,used,setState,executionHash,executionCompatible=key=>key===executionHash(),sourceReader,runner=generateIntakeScreening}){
 const db=store.db,at=()=>new Date(now()).toISOString(),hash=(version=INTAKE_SCREENING_VERSION)=>digest({version,model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000});
 db.exec(`CREATE TABLE IF NOT EXISTS intake_screening_batches(id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS intake_screening_runs(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS intake_screening_members(item_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL);`);
 const item=id=>db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(id);
 const batches=()=>db.prepare('SELECT * FROM intake_screening_batches ORDER BY rowid').all().map(r=>JSON.parse(r.payload));
 const write=b=>db.prepare('UPDATE intake_screening_batches SET status=?,payload=? WHERE id=?').run(b.status,JSON.stringify(b),b.id);
 const runs=id=>db.prepare('SELECT * FROM intake_screening_runs WHERE batch_id=? ORDER BY rowid DESC').all(id).map(r=>({...JSON.parse(r.payload),expiresAt:r.expires_at}));
 const enabled=()=>settings().automatic&&settings().screenUnselected;
 const eligible=r=>{if(!r||r.status!=='skipped')return false;const p=JSON.parse(r.payload);return p.configuration.automatic&&p.configuration.screenUnselected===true&&!p.intakeScreening&&executionCompatible(p.executionHash)&&r.rules_hash===research.screenings.rulesHash;};
 const sourceReview=openIntakeSources(store,{now,transaction,audit,setState,eligible,enabled,reader:sourceReader});
 const current=s=>{const r=item(s.id),n=store.newsById(s.newsId);return eligible(r)&&n?.revision===s.revision&&n.title===s.title&&r.rules_hash===s.rulesHash;};
 const pending=()=>db.prepare("SELECT p.* FROM research_pipeline_items p WHERE p.status='skipped' AND json_extract(p.payload,'$.configuration.automatic')=1 AND json_extract(p.payload,'$.configuration.screenUnselected')=1 AND NOT EXISTS(SELECT 1 FROM intake_screening_members m WHERE m.item_id=p.id) ORDER BY p.rowid").all();
 function validateRun(r,b){
  const c=r.candidate;if(b.packet.schema===INTAKE_BODY_VERSION)for(const s of b.packet.input.items){if(digest(immutableMaterialSnapshot(db,{id:s.material.id,revision:s.material.revision}))!==digest(s.material))throw new CodexResearchError('output');}
  if(b.packet.inputHash!==digest(b.packet.input)||b.executionHash!==hash(b.packet.schema)||!c||c.status!=='candidate'||c.reviewStatus!=='unreviewed'||c.trace?.inputHash!==b.packet.inputHash||c.trace.model!==config.model||typeof c.rawOutput!=='string'||digest(c.rawOutput)!==c.trace.outputHash||digest(validateIntakeScreening(JSON.parse(c.rawOutput),b.packet))!==digest(c.screening))throw new CodexResearchError('output');
  return c.screening;
 }
 function apply(b,r,context){
  const output=validateRun(r,b);
  return transaction(()=>{context.assertActive();if(!enabled())return null;let selected=0,observed=0,invalidated=0;
   for(const result of output.items){
    const source=b.packet.input.items.find(s=>s.id===result.id),row=item(result.id);
    if(!current(source)){invalidated++;continue;}
    const existing=research.list().some(t=>t.sourceNewsId===source.newsId&&t.sourceNewsRevision===source.revision);
    const decision={...result,batchId:b.id,runId:r.id,inputHash:b.packet.inputHash,at:at(),scope:b.packet.input.scope,materiality:'unassessed',disposition:existing?'existing-research':result.decision};
    setState(row,existing?'observing':result.decision==='research'?'queued':'skipped',{intakeScreening:decision,initialSelectionReason:JSON.parse(row.payload).selectionReason,selectionReason:existing?'existing-research':result.decision==='research'?'intake-screening':'intake-observe',reason:existing?'此新闻版本已有研究，保留现有内容':result.decision==='research'?'入口复核选择继续研究；重大性与公司影响仍待核验':'入口复核暂留观察；不代表低影响，来源修订可重新进入'});
    if(!existing&&result.decision==='research')selected++;else observed++;
   }
   const result={selected,observed,invalidated};write({...b,status:'completed',finishedAt:at(),nextRetryAt:null,result});audit(null,'intake-screening-applied',{batchId:b.id,runId:r.id,...result});return {ok:true,intakeBatchId:b.id,...result};
  });
 }
 return {
  snapshot(){const all=batches(),recent=all.slice(-5).reverse();return {version:INTAKE_BODY_VERSION,enabled:enabled(),sources:sourceReview.snapshot(),batchSize:INTAKE_BATCH_SIZE,waitingItems:pending().length,totals:{completedItems:all.filter(b=>b.status==='completed').reduce((n,b)=>n+b.packet.input.items.length,0),activeItems:all.filter(b=>['queued','running','candidate','retrying'].includes(b.status)).reduce((n,b)=>n+b.packet.input.items.length,0),unresolvedItems:db.prepare("SELECT count(*) n FROM research_pipeline_items WHERE json_extract(payload,'$.intakeFailure') IN ('input-limit','source-unavailable','material-integrity')").get().n+all.filter(b=>['unresolved','invalidated'].includes(b.status)).reduce((n,b)=>n+b.packet.input.items.length,0)},counts:all.reduce((v,b)=>(v[b.status]=(v[b.status]||0)+1,v),{}),items:recent.map(b=>({id:b.id,status:b.status,createdAt:b.createdAt,total:b.packet.input.items.length,result:b.result||null,nextRetryAt:b.nextRetryAt?new Date(b.nextRetryAt).toISOString():null,attempts:runs(b.id).length,items:b.packet.input.items.map(s=>({title:s.title,newsId:s.newsId,revision:s.revision,material:s.material?{id:s.material.id,scope:s.material.scope,receivedAt:s.material.receivedAt,characters:s.material.body.length}:null,judgment:JSON.parse(item(s.id)?.payload||'{}').intakeScreening||null}))})),limitation:'新条目先按原读取器归档正文，再分批决定是否深入研究；每批最多20条/512 KiB，共用原调用额度。旧标题批次保持原范围，入口判断均不等于重大性确认。读取失败限次后保留缺口，其他材料继续。'};},
  async step(context){
   context.assertActive();guard();if(!enabled())return null;
   let batch=batches().find(b=>['queued','running','candidate','retrying'].includes(b.status)&&(!b.nextRetryAt||b.nextRetryAt<=now()));
   if(batch&&batch.executionHash!==hash(batch.packet.schema)){transaction(()=>{context.assertActive();write({...batch,status:'invalidated',reason:'执行配置变化，保留旧输入与判断'});});return {ok:true,intakeInvalidated:batch.id};}
   if(batch){
    const last=runs(batch.id)[0];
    if(last?.status==='candidate'){try{validateRun(last,batch);}catch{transaction(()=>{context.assertActive();write({...batch,status:'invalidated',reason:'保存的判断校验不通过，保留原始记录'});});return {ok:true,intakeInvalidated:batch.id};}return apply(batch,last,context);}
    if(last?.status==='running'&&last.expiresAt>=now())return null;
    if(last?.status==='running')transaction(()=>{context.assertActive();db.prepare("UPDATE intake_screening_runs SET status='interrupted',payload=? WHERE id=?").run(JSON.stringify({...last,status:'interrupted',finishedAt:at()}),last.id);});
    if(runs(batch.id).length>=3){transaction(()=>{context.assertActive();write({...batch,status:'unresolved',reason:'3次入口复核未完成，保留缺口；其他批次继续'});});return {ok:true,intakeUnresolved:batch.id};}
   }
   if(!batch&&!pending().length)return null;
   if(used()>=settings().dailyCalls)return {skipped:'call-limit'};
   if(db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return {skipped:'model-busy'};
   if(!batch){
    const waiting=pending().filter(r=>{const s=JSON.parse(r.payload).intakeSource;return !(s?.nextRetryAt>now()||s?.status==='reading'&&s.leaseUntil>now());}).slice(0,INTAKE_BATCH_SIZE);if(!waiting.length)return null;
    const preparation=await sourceReview.prepare(waiting,context);if(preparation)return preparation;
    const body=JSON.parse(waiting[0].payload).intakeSourceVersion===INTAKE_SOURCE_VERSION;
    const rows=waiting.filter(r=>{const p=JSON.parse(r.payload);return (p.intakeSourceVersion===INTAKE_SOURCE_VERSION)===body&&(!body||p.intakeSource?.status==='ready');});if(!rows.length)return null;
    const packetFor=body?intakeBodyPacket:intakeScreeningPacket;
    const sources=[];
    transaction(()=>{context.assertActive();for(const row of rows){const n=store.newsById(row.news_id);if(n?.revision!==row.revision||!eligible(row)){setState(row,'invalidated',{reason:'来源、规则或执行配置已变化，旧入口记录保留'});continue;}let material=null;if(body){try{material=sourceReview.material(row);}catch{setState(row,'observing',{intakeFailure:'material-integrity',intakeSource:{...JSON.parse(row.payload).intakeSource,status:'invalidated'},reason:'已归档入口正文完整性不符，保留缺口；其他材料继续'});continue;}}const source={id:row.id,newsId:row.news_id,revision:row.revision,rulesHash:row.rules_hash,title:n.title,source:n.publisher||n.sourceName||n.provider||'未知',publishedAt:n.publishedAt||null,firstSeenAt:n.firstSeen||null,revisionFirstSeenAt:n.revisionFirstSeen||null,initialBucket:JSON.parse(row.payload).screening.bucket,...(body?{material}:{})};try{packetFor([...sources,source]);}catch{if(sources.length)break;setState(row,'observing',{intakeFailure:'input-limit',reason:'单条标题输入超出复核范围，保留原文与未复核记录；其他材料继续'});continue;}sources.push(source);}});
    if(!sources.length)return {ok:true,intakeObsolete:rows.length};
    batch={id:randomUUID(),status:'queued',createdAt:at(),packet:packetFor(sources),executionHash:hash(body?INTAKE_BODY_VERSION:INTAKE_SCREENING_VERSION)};
   }
   const timeoutMs=config.timeoutMs??180000,run={id:randomUUID(),batchId:batch.id,status:'running',createdAt:at(),inputHash:batch.packet.inputHash};
   if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000)throw Error('模型超时配置无效');
   transaction(()=>{context.assertActive();if(!enabled()||used()>=settings().dailyCalls)throw Error('入口复核配置或额度变化');claimModelLease(db,run.id,now(),timeoutMs+30000);
    if(!db.prepare('SELECT 1 FROM intake_screening_batches WHERE id=?').get(batch.id)){db.prepare('INSERT INTO intake_screening_batches VALUES(?,?,?)').run(batch.id,batch.status,JSON.stringify(batch));for(const s of batch.packet.input.items)db.prepare('INSERT INTO intake_screening_members VALUES(?,?)').run(s.id,batch.id);}
    write({...batch,status:'running',nextRetryAt:null});db.prepare('INSERT INTO intake_screening_runs VALUES(?,?,?,?,?)').run(run.id,batch.id,run.status,now()+timeoutMs+30000,JSON.stringify(run));
    db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(`intake:${batch.id}`,run.id,at());audit(null,'intake-screening-started',{batchId:batch.id,runId:run.id,inputHash:run.inputHash,total:batch.packet.input.items.length});
   });
   try{
    const candidate=await runner(structuredClone(batch.packet),{...config,timeoutMs,signal:context.signal});
    const finished={...run,status:'candidate',candidate,finishedAt:at()};validateRun(finished,batch);
    const owns=db.prepare('SELECT 1 FROM model_job_lease WHERE owner=? AND expires_at>=?').get(run.id,now())&&runs(batch.id)[0]?.id===run.id;
    if(!owns){db.prepare("UPDATE intake_screening_runs SET status='superseded',payload=? WHERE id=?").run(JSON.stringify({...finished,status:'superseded'}),run.id);if(runs(batch.id)[0]?.id===run.id)write({...batch,status:runs(batch.id).length>=3?'unresolved':'retrying',nextRetryAt:now()+60000});return {ok:true,intakeSuperseded:run.id};}
    db.prepare('UPDATE intake_screening_runs SET status=?,payload=? WHERE id=?').run('candidate',JSON.stringify(finished),run.id);write({...batch,status:'candidate'});
    return apply(batch,finished,context);
   }catch(error){
    // Pause or a failed adoption transaction retains validated output for resume.
    const saved=runs(batch.id)[0];if(saved?.status==='candidate')throw error;
    const count=runs(batch.id).length,status=count>=3?'unresolved':'retrying';
    db.prepare('UPDATE intake_screening_runs SET status=?,payload=? WHERE id=?').run(context.signal?.aborted?'interrupted':'failed',JSON.stringify({...run,status:context.signal?.aborted?'interrupted':'failed',finishedAt:at(),failure:{code:error instanceof CodexResearchError?error.code:'process',message:'入口复核未完成；后台限次重试，原始输入保留',...(error instanceof CodexResearchError?{trace:error.trace}:{})},outputDiagnostic:rejectedOutputDiagnostic(error,batch.packet.inputHash)}),run.id);
    if(saved?.id!==run.id)return {ok:true,intakeSuperseded:run.id};
    write({...batch,status,nextRetryAt:status==='retrying'?now()+60000*2**(count-1):null});audit(null,'intake-screening-retry',{batchId:batch.id,runId:run.id,reason:status==='retrying'?'入口判断未完成，按退避时间自动重试':'已尝试3次，保留未完成范围；其他批次继续'});return {ok:true,intakeBatchId:batch.id,intakeStatus:status};
   }finally{releaseModelLease(db,run.id);}
  }
 };
}
