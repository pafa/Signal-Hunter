import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {digest} from './codex-research.mjs';
import {collectEvaluationSources} from './evaluation-baseline.mjs';
import {instrument} from '../shared/securities.mjs';
import {evaluationTime} from '../shared/evaluation.mjs';
import {eventPriceObservations} from './event-prices.mjs';
import {EVENT_PRICE_WINDOWS} from '../shared/event-prices.mjs';
import {PRICE_COLLECTION_VERSION,PRICE_COLLECTION_POLICY as policy,priceCollectionErrors} from '../shared/price-collection.mjs';
const fail=i=>{throw Error(priceCollectionErrors[i]);},stamp=evaluationTime,iso=t=>new Date(t).toISOString();
const root=fileURLToPath(new URL('../../',import.meta.url)),sources=()=>collectEvaluationSources(root);
let loadedSources=null;try{loadedSources=sources();}catch{}
const sourceHash=loadedSources?digest(loadedSources):null;
const sourceKey=p=>JSON.stringify([p.provider,p.timezone,p.currency,p.adjustment]);
const wrap=p=>({...p,hash:digest(p)});
function checked(row){if(!row)fail(5);const p=JSON.parse(row.payload),{hash,...value}=p;if(hash!==digest(value)||row.plan_id&&row.plan_id!==p.planId||row.symbol&&row.symbol!==p.symbol||row.window&&row.window!==p.window||row.version!==undefined&&row.version!==p.version||row.state&&row.state!==p.state||row.benchmark_state&&row.benchmark_state!==p.benchmarkState||row.due_at!==undefined&&row.due_at!==p.dueAt||row.deadline!==undefined&&row.deadline!==p.deadline)fail(4);return p;}

// Plans freeze the original screening and policy. Boundary revisions and provider
// attempts are append-only, including no-symbol, missed and interrupted cases.
export function openPriceCollection(store,{enabled=false,now=Date.now,rulesHash,fetchQuote,isPaused=()=>true}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS price_collection_configs(version INTEGER PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS price_collection_cursor(id INTEGER PRIMARY KEY CHECK(id=1),sample_row INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS price_collection_plans(id TEXT PRIMARY KEY,sample_id TEXT UNIQUE NOT NULL,sample_row INTEGER UNIQUE NOT NULL,config_version INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS price_collection_boundaries(plan_id TEXT NOT NULL,symbol TEXT NOT NULL,window TEXT NOT NULL,state TEXT NOT NULL,benchmark_state TEXT NOT NULL,due_at INTEGER NOT NULL,deadline INTEGER NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(plan_id,symbol,window));
 CREATE INDEX IF NOT EXISTS price_collection_due ON price_collection_boundaries(state,due_at,deadline);
 CREATE TABLE IF NOT EXISTS price_collection_history(plan_id TEXT NOT NULL,symbol TEXT NOT NULL,window TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(plan_id,symbol,window,version));
 CREATE TABLE IF NOT EXISTS price_collection_attempts(id INTEGER PRIMARY KEY,token TEXT NOT NULL,symbol TEXT NOT NULL,attempted_at INTEGER NOT NULL,completed_at INTEGER,outcome TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS price_collection_symbol_attempt ON price_collection_attempts(symbol,attempted_at);`);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const restore=()=>db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1';
 const guard=()=>{if(!enabled)fail(1);if(restore())throw Error('恢复副本需先完成核对确认');};
 const current=()=>{const row=db.prepare('SELECT * FROM price_collection_configs ORDER BY version DESC LIMIT 1').get();return row?checked(row):null;};
 const assertSources=()=>{if(!sourceHash||digest(sources())!==sourceHash)fail(6);};
 const configSummary=c=>c?(({sources,...summary})=>summary)(c):null;
 function configure(data){
  guard();if(!isPaused())fail(7);
  if(!data||Object.keys(data).sort().join(',')!=='benchmarks,requestId,version'||!Number.isSafeInteger(data.version)||data.version<0||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(data.requestId)||!data.benchmarks||Array.isArray(data.benchmarks)||typeof data.benchmarks!=='object'||Object.keys(data.benchmarks).some(k=>!['USD','HKD','CNY'].includes(k)))fail(0);
  const benchmarks={};for(const [currency,value] of Object.entries(data.benchmarks)){let spec;try{if(typeof value!=='string')throw Error();spec=instrument(value);}catch{fail(0);}if(spec.currency!==currency)fail(0);benchmarks[currency]=spec.symbol;}
  assertSources();const requestHash=digest(data);
  return transaction(()=>{
   guard();const previous=db.prepare('SELECT * FROM price_collection_configs WHERE request_id=?').get(data.requestId);
   if(previous){if(previous.request_hash!==requestHash)fail(3);return configSummary(checked(previous));}
   const old=current();if((old?.version||0)!==data.version)fail(2);
   const at=iso(now()),config=wrap({version:data.version+1,createdAt:at,activatedAt:old?.activatedAt||at,rulesHash,sourceHash,sources:loadedSources,policy,benchmarks,forwardEligible:false});
   db.prepare('INSERT INTO price_collection_configs VALUES(?,?,?,?)').run(config.version,data.requestId,requestHash,JSON.stringify(config));
   if(!old)db.prepare('INSERT INTO price_collection_cursor VALUES(1,?)').run(db.prepare('SELECT coalesce(max(rowid),0) n FROM screening_samples').get().n);
   return configSummary(config);
  });
 }
 const rowOf=(id,symbol,window)=>db.prepare('SELECT * FROM price_collection_boundaries WHERE plan_id=? AND symbol=? AND window=?').get(id,symbol,window);
 function saveBoundary(p){
  const previous=rowOf(p.planId,p.symbol,p.window),version=(previous?.version||0)+1,value=wrap({...p,version,recordedAt:iso(now())});
  db.prepare('INSERT INTO price_collection_history VALUES(?,?,?,?,?)').run(p.planId,p.symbol,p.window,version,JSON.stringify(value));
  db.prepare('INSERT INTO price_collection_boundaries VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(plan_id,symbol,window) DO UPDATE SET state=excluded.state,benchmark_state=excluded.benchmark_state,due_at=excluded.due_at,deadline=excluded.deadline,version=excluded.version,payload=excluded.payload')
   .run(p.planId,p.symbol,p.window,p.state,p.benchmarkState,p.dueAt,p.deadline,version,JSON.stringify(value));return value;
 }
 function boundary(plan,symbol,window,min,max,source=null){return {planId:plan.id,symbol,window,minAt:min,maxAt:max,dueAt:min+60000,deadline:max+policy.receiptGraceMs,state:'pending',point:null,benchmark:plan.benchmarks[instrument(symbol).currency]||null,benchmarkState:plan.benchmarks[instrument(symbol).currency]?(plan.benchmarks[instrument(symbol).currency]===symbol?'same-symbol':'pending'):'not-configured',benchmarkPoint:null,source,reason:'waiting-for-observation',forwardEligible:false};}
 function enroll(context,config){
  return transaction(()=>{
   context.assertActive();guard();const cursor=db.prepare('SELECT sample_row FROM price_collection_cursor WHERE id=1').get().sample_row;
   const rows=db.prepare('SELECT rowid sample_row,* FROM screening_samples WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,policy.enrollmentLimitPerRun);
   for(const row of rows){
    const s=JSON.parse(row.payload);if(s.id!==row.id||s.rulesHash!==row.rules_hash||s.inputHash!==digest(s.input)||s.decisionAt!==row.recorded_at)fail(4);
    const decided=stamp(s.decisionAt),seen=stamp(s.input.firstSeen),available=stamp(s.input.availableAt),start=stamp(config.activatedAt);
    let exclusion=null;
    if(decided===null||seen===null||available===null||seen>available||available>decided)exclusion='invalid-availability-or-decision-time';
    else if(decided<start||available<start)exclusion='input-available-before-activation';
    else if(decided>now()||available>now())exclusion='future-input-or-decision-time';
    else if(row.rules_hash!==config.rulesHash)exclusion='screening-rules-changed';
    if(!Array.isArray(s.triage?.companies)||s.triage.companies.length>50)fail(4);
    const symbols=[],invalidSymbols=[];
    for(const symbol of [...new Set(s.triage.companies.map(c=>c.symbol))].sort())try{const spec=instrument(symbol);if(spec.symbol!==symbol)throw Error();symbols.push(symbol);}catch{invalidSymbols.push(symbol??null);}
    const p=wrap({id:randomUUID(),sampleRow:row.sample_row,sample:s,symbols,invalidSymbols,configVersion:config.version,benchmarks:config.benchmarks,policy,sourceHash:config.sourceHash,rulesHash:config.rulesHash,enrolledAt:iso(now()),exclusion,reason:exclusion||(!symbols.length?'no-usable-symbol':'scheduled'),forwardEligible:false});
    db.prepare('INSERT INTO price_collection_plans VALUES(?,?,?,?,?)').run(p.id,s.id,row.sample_row,config.version,JSON.stringify(p));
    if(!exclusion)for(const symbol of symbols)saveBoundary(boundary(p,symbol,'baseline',decided+60000,decided+policy.maximumBoundaryDelayMs));
   }
   if(rows.length)db.prepare('UPDATE price_collection_cursor SET sample_row=? WHERE id=1').run(rows.at(-1).sample_row);
   return rows.length;
  });
 }
 function observations(symbol,p){
  const rows=db.prepare('SELECT * FROM quote_snapshots WHERE symbol=? AND received_at>=? AND received_at<=? ORDER BY received_at,id LIMIT 501').all(symbol,iso(p.dueAt),iso(Math.min(now(),p.deadline)));
  if(rows.length>500||rows.reduce((n,r)=>n+Buffer.byteLength(r.payload),0)>8*1024*1024)fail(8);
  return eventPriceObservations(rows,iso(now())).points;
 }
 function reconcile(context){
  // Future windows do not require scanning their price archives. Due work is
  // bounded per round without dropping or relabelling the remaining plans.
  const rows=db.prepare("SELECT b.* FROM price_collection_boundaries b JOIN price_collection_plans p ON p.id=b.plan_id WHERE b.due_at<=? AND (b.state='pending' OR b.benchmark_state='pending') AND json_extract(p.payload,'$.sourceHash')=? ORDER BY b.deadline,b.plan_id,b.symbol,b.window LIMIT 1000").all(now(),sourceHash);
  for(const row of rows){
   context.assertActive();guard();const plan=checked(db.prepare('SELECT payload FROM price_collection_plans WHERE id=?').get(row.plan_id));if(plan.sourceHash!==sourceHash)continue;
   const p=checked(row),{hash,version,recordedAt,...next}=p;let changed=false;
   if(!p.point){const point=observations(p.symbol,p).find(v=>v.stamp>=p.minAt&&v.stamp<=p.maxAt&&(!p.source||sourceKey(v)===p.source));
    if(point){next.point=point;next.state='observed';next.reason='completed-observation-within-receipt-deadline';changed=true;}
    else if(now()>p.deadline){next.state='missed';next.reason='no-valid-observation-by-deadline';next.benchmarkState=p.benchmarkState==='pending'?'security-price-missing':p.benchmarkState;changed=true;}
   }
   if(next.point&&p.benchmarkState==='pending'){
    const point=observations(p.benchmark,p).find(v=>v.stamp===next.point.stamp&&v.provider===next.point.provider&&v.currency===next.point.currency&&v.adjustment===next.point.adjustment);
    if(point){next.benchmarkPoint=point;next.benchmarkState='observed';changed=true;}
    else if(now()>p.deadline){next.benchmarkState='missed';changed=true;}
   }
   if(changed)transaction(()=>{
    context.assertActive();guard();saveBoundary(next);
    if(p.window==='baseline'&&!p.point){
     if(next.point)for(const w of EVENT_PRICE_WINDOWS)saveBoundary(boundary(plan,p.symbol,w.id,next.point.stamp+w.ms,next.point.stamp+w.ms+policy.maximumBoundaryDelayMs,sourceKey(next.point)));
     else if(next.state==='missed')for(const w of EVENT_PRICE_WINDOWS)saveBoundary({...boundary(plan,p.symbol,w.id,p.maxAt+w.ms,p.maxAt+w.ms+policy.maximumBoundaryDelayMs),state:'no-baseline',benchmarkState:'security-price-missing',reason:'baseline-window-missed'});
    }
   });
  }
 }
 let flight=null;
 async function measure(context){
  guard();context.assertActive();const config=current();if(!config)return {skipped:'not-activated'};assertSources();if(config.sourceHash!==sourceHash||config.rulesHash!==rulesHash)fail(6);
  // A former process may have ended after reserving a request. Its original
  // timestamp remains the cooldown anchor; never repeat an unconfirmed read.
  db.prepare("UPDATE price_collection_attempts SET completed_at=?,outcome='interrupted' WHERE outcome='running' AND token<>?").run(now(),context.token);
  const enrolled=enroll(context,config);reconcile(context);
  const due=db.prepare("SELECT b.* FROM price_collection_boundaries b JOIN price_collection_plans p ON p.id=b.plan_id WHERE b.due_at<=? AND b.deadline>=? AND (b.state='pending' OR b.benchmark_state='pending') AND json_extract(p.payload,'$.sourceHash')=? ORDER BY b.deadline,b.plan_id,b.symbol,b.window LIMIT 1000").all(now(),now(),sourceHash);
  const requested=new Set(),results=[];
  for(const r of due){const p=checked(r);if(p.state==='pending')requested.add(p.symbol);if(p.benchmarkState==='pending')requested.add(p.benchmark);}
  let attempts=0;
  for(const symbol of requested){
   context.assertActive();guard();const last=db.prepare('SELECT max(attempted_at) at FROM price_collection_attempts WHERE symbol=?').get(symbol).at;
   if(last!==null&&now()-last<policy.minimumRequestIntervalMs){results.push({skipped:'symbol-cooldown'});continue;}
   if(attempts>=policy.requestLimitPerRun){results.push({skipped:'round-capacity-deferred'});continue;}
   attempts++;
   const id=db.prepare("INSERT INTO price_collection_attempts(token,symbol,attempted_at,outcome,payload) VALUES(?,?,?,'running','{}')").run(context.token,symbol,now()).lastInsertRowid;
   let result;try{result=await fetchQuote(symbol,context);}catch{context.assertActive();guard();result={error:'上游连接失败'};}
   context.assertActive();guard();const value={...result,completedAt:iso(now())},outcome=result?.error?'failed':result?.skipped?'skipped':'ok';
   db.prepare('UPDATE price_collection_attempts SET completed_at=?,outcome=?,payload=? WHERE id=?').run(now(),outcome,JSON.stringify(value),id);results.push(result||{ok:true});
  }
  reconcile(context);return results.length?results:enrolled?{ok:true,enrolled}:{skipped:'no-due-boundaries'};
 }
 return {
  configure,
  activate(){guard();const old=current();if(old)return configSummary(old);return configure({version:0,requestId:randomUUID(),benchmarks:{}});},
  step(context){if(flight)return flight;flight=measure(context).finally(()=>flight=null);return flight;},
  snapshot(){
   const config=current();return {enabled,configured:!!config,config:configSummary(config),sourceHash,policy,sourceCurrent:!config||config.sourceHash===sourceHash&&config.rulesHash===rulesHash,
    plans:db.prepare('SELECT count(*) n FROM price_collection_plans').get().n,
    planReasons:db.prepare("SELECT json_extract(payload,'$.reason') reason,count(*) count FROM price_collection_plans GROUP BY reason").all(),
    boundaries:db.prepare('SELECT window,state,benchmark_state benchmarkState,count(*) count FROM price_collection_boundaries GROUP BY window,state,benchmark_state').all(),
    pendingEnrollment:config?db.prepare('SELECT count(*) n FROM screening_samples WHERE rowid>(SELECT sample_row FROM price_collection_cursor WHERE id=1)').get().n:0,
    incompatiblePlans:db.prepare("SELECT count(*) n FROM price_collection_plans WHERE json_extract(payload,'$.sourceHash')<>?").get(sourceHash).n,
    attempts:db.prepare('SELECT outcome,count(*) count FROM price_collection_attempts GROUP BY outcome').all(),
    recent:db.prepare('SELECT id,payload FROM price_collection_plans ORDER BY sample_row DESC LIMIT 20').all().map(r=>{const p=checked(r);return {id:p.id,sampleId:p.sample.id,title:p.sample.input.title,decisionAt:p.sample.decisionAt,bucket:p.sample.triage.bucket,symbols:p.symbols,reason:p.reason,configVersion:p.configVersion};}),forwardEligible:false};
  },
  get(id){const p=checked(db.prepare('SELECT payload FROM price_collection_plans WHERE id=?').get(id));return {plan:p,config:checked(db.prepare('SELECT payload FROM price_collection_configs WHERE version=?').get(p.configVersion)),boundaries:db.prepare('SELECT * FROM price_collection_boundaries WHERE plan_id=? ORDER BY symbol,due_at,window').all(id).map(checked),history:db.prepare('SELECT payload FROM price_collection_history WHERE plan_id=? ORDER BY symbol,window,version').all(id).map(checked)};}
 };
}
