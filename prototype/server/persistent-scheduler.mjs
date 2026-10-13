import {randomUUID} from 'node:crypto';
import {summarizeResults} from './scheduler.mjs';

// Persistent background lanes. Market execution, if registered, is simulation only.
export function createPersistentScheduler(db, tasks, {now=Date.now, intervals={}, leaseMs=90000, maxFailures=3, initiallyPaused=[],idleBackoff=[],recoverBlocked=()=>false}={}) {
 db.exec(`CREATE TABLE IF NOT EXISTS operation_tasks(
  name TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'waiting',
  token TEXT, lease_until INTEGER, next_run INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, completed_at TEXT, last_success_at TEXT, summary TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS operation_runs(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT UNIQUE NOT NULL, started_at TEXT NOT NULL,
  completed_at TEXT, outcome TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS operation_audit(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS operation_runs_name ON operation_runs(name,id);`);
 if(!db.prepare('PRAGMA table_info(operation_runs)').all().some(c=>c.name==='input'))db.exec("ALTER TABLE operation_runs ADD COLUMN input TEXT NOT NULL DEFAULT 'null'");
 const restored=db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1';
 for(const name of Object.keys(tasks))db.prepare('INSERT OR IGNORE INTO operation_tasks(name,paused) VALUES(?,?)').run(name,Number(restored||initiallyPaused.includes(name)));
 const flights=new Map(),controllers=new Map();
 let stopped=false;
 const iso=()=>new Date(now()).toISOString();
 const row=name=>db.prepare('SELECT * FROM operation_tasks WHERE name=?').get(name);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 function claim(name,force,input) {
  if(stopped)return null;
  return transaction(()=>{
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')return null;
   const old=row(name),at=now();
   if(!old||old.paused||old.token&&old.lease_until>at||!force&&(old.state==='blocked'&&!recoverBlocked(name)||old.next_run>at))return null;
   if(old.token&&input===null)input=JSON.parse(db.prepare('SELECT input FROM operation_runs WHERE token=?').get(old.token)?.input||'null');
   if(old.token)db.prepare("UPDATE operation_runs SET completed_at=?,outcome='interrupted',summary=? WHERE token=? AND outcome='running'")
    .run(iso(),JSON.stringify({error:'执行租约中断，已安排恢复'}),old.token);
   const token=randomUUID();
   db.prepare("UPDATE operation_tasks SET state='running',token=?,lease_until=?,started_at=? WHERE name=?")
    .run(token,at+leaseMs,iso(),name);
   db.prepare("INSERT INTO operation_runs(name,token,started_at,outcome,input) VALUES(?,?,?,'running',?)").run(name,token,iso(),JSON.stringify(input));
   return {token,input};
  });
 }
 function run(name,{force=false,input=null}={}) {
  if(!Object.hasOwn(tasks,name))return Promise.reject(new Error('未知任务'));
  if(flights.has(name))return flights.get(name);
  const claimed=claim(name,force,input);
  if(!claimed)return Promise.resolve({skipped:'paused-or-not-due'});
  const {token}=claimed;
  const controller=new AbortController();controllers.set(name,controller);
  const assertActive=()=>{
   const current=row(name);
   if(controller.signal.aborted||current?.token!==token||current.paused||current.lease_until<=now())
    throw new Error('任务已暂停、取消或执行租约已失效');
  };
  const heartbeat=setInterval(()=>{
   try {
    const changed=db.prepare('UPDATE operation_tasks SET lease_until=? WHERE name=? AND token=? AND paused=0 AND lease_until>?')
     .run(now()+leaseMs,name,token,now()).changes;
    if(!changed)controller.abort();
   }catch{controller.abort();}
  },Math.max(20,Math.floor(leaseMs/3)));heartbeat.unref();
  const finish=summary=>transaction(()=>{
   const current=row(name);
   if(current?.token!==token)return {skipped:'superseded'};
   const cancelled=controller.signal.aborted||!!current.paused;
   const failed=summary.outcome==='error',failures=failed?current.failures+1:summary.outcome==='skipped'?current.failures:0;
   const state=cancelled?'waiting':failed&&failures>=maxFailures?'blocked':'waiting';
   const quiet=idleBackoff.includes(name)&&summary.outcome==='skipped'&&summary.skipReasons?.every(r=>['no-queued-items','no-change','model-disabled','offline','call-limit'].includes(r.reason));
   const quietChecks=quiet?(JSON.parse(current.summary).quietChecks||0)+1:0;
   const wait=quiet?Math.min(60000,Math.max(intervals[name]??10000,30000*quietChecks)):failed?Math.max(intervals[name]??60000,Math.min(30000*2**(failures-1),900000)):(intervals[name]??60000);
   const result=cancelled?{outcome:'cancelled',error:'已暂停/取消；已提交结果保留'}:{...summary,...(quiet?{quietChecks}:{})};
   db.prepare('UPDATE operation_tasks SET token=NULL,lease_until=NULL,state=?,failures=?,next_run=?,completed_at=?,last_success_at=?,summary=? WHERE name=?')
    .run(state,failures,now()+wait,iso(),!cancelled&&summary.succeeded>0?iso():current.last_success_at,JSON.stringify(result),name);
   db.prepare('UPDATE operation_runs SET completed_at=?,outcome=?,summary=? WHERE token=?')
    .run(iso(),result.outcome,JSON.stringify(result),token);
   return result;
  });
  const job=Promise.resolve().then(()=>{assertActive();return tasks[name]({signal:controller.signal,assertActive,token,input:claimed.input});})
   .then(result=>finish(summarizeResults(result)),error=>finish({outcome:'error',failed:1,succeeded:0,skipped:0,error:String(error.message).slice(0,160)}))
   .finally(()=>{clearInterval(heartbeat);flights.delete(name);controllers.delete(name);});
  flights.set(name,job);return job;
 }
 function controlMany(names,action,{withinTransaction=false}={}) {
  if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(name=>!Object.hasOwn(tasks,name))||!['pause','resume','retry','cancel'].includes(action))throw new Error('任务或操作无效');
  if(withinTransaction&&(!db.isTransaction||action!=='resume'))throw new Error('任务组合操作需要活动配置事务');
  const apply=()=>{for(const name of names){
   const current=row(name);
   if((action==='retry'||action==='resume')&&db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');
   if(action==='retry'&&current.paused)throw new Error('任务已暂停，请先恢复');
   if(action==='pause'||action==='cancel')db.prepare('UPDATE operation_tasks SET paused=1 WHERE name=?').run(name);
   else if(action==='resume')db.prepare("UPDATE operation_tasks SET paused=0,state=CASE WHEN token IS NULL THEN 'waiting' ELSE state END,failures=0,next_run=0 WHERE name=?").run(name);
   else db.prepare("UPDATE operation_tasks SET state=CASE WHEN token IS NULL THEN 'waiting' ELSE state END,failures=0,next_run=0 WHERE name=?").run(name);
   db.prepare('INSERT INTO operation_audit(name,action,at) VALUES(?,?,?)').run(name,action,iso());
  }};
  if(withinTransaction)apply();else transaction(apply);
  if(action==='pause'||action==='cancel')for(const name of names)controllers.get(name)?.abort();
  return snapshot();
 }
 const control=(name,action)=>controlMany([name],action);
 function snapshot(){
  return Object.fromEntries(Object.keys(tasks).map(name=>{
   const r=row(name),summary=JSON.parse(r.summary);
   return [name,{...summary,persistent:true,paused:!!r.paused,state:r.state,running:!!r.token&&r.lease_until>now(),recovering:!!r.token&&r.lease_until<=now(),
    startedAt:r.started_at,completedAt:r.completed_at,lastSuccessAt:r.last_success_at,nextRunAt:r.next_run>0?new Date(r.next_run).toISOString():null,
    consecutiveFailures:r.failures,blocked:r.state==='blocked',...(recoverBlocked(name)?{automaticRecovery:true}:{}),leaseUntil:r.lease_until?new Date(r.lease_until).toISOString():null}];
  }));
 }
 return {run,runAll:()=>Promise.all(Object.keys(tasks).map(name=>run(name))),control,controlMany,snapshot,
  history:()=>db.prepare('SELECT name,started_at AS startedAt,completed_at AS completedAt,outcome,summary,input FROM operation_runs ORDER BY id DESC LIMIT 50').all().map(r=>({...r,summary:JSON.parse(r.summary),input:JSON.parse(r.input)})),
  async stop(){stopped=true;for(const c of controllers.values())c.abort();await Promise.allSettled(flights.values());}
 };
}
