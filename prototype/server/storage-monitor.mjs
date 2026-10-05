import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {previewStorageRetention,retentionPolicy} from './storage-retention.mjs';

// Filesystem paths come from bootstrap, never from task input. Final reports are
// append-only. A process crash is recorded by the persistent scheduler instead.
export function openStorageMonitor(db,{databasePath,backupRoot,policy:input={},now=Date.now,timeoutMs=60000}={}){
 const policy=retentionPolicy(input),scopeId=createHash('sha256').update(JSON.stringify([resolve(databasePath),resolve(backupRoot)])).digest('hex');
 db.exec(`CREATE TABLE IF NOT EXISTS storage_checks(
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL, outcome TEXT NOT NULL, report TEXT NOT NULL)`);
 const decode=r=>r?{id:r.id,startedAt:r.started_at,completedAt:r.completed_at,outcome:r.outcome,...JSON.parse(r.report)}:null;
 const previous=token=>decode(db.prepare('SELECT * FROM storage_checks WHERE token=?').get(token));
 const flights=new Map();
 async function measure(context){
  context.assertActive();
  const old=previous(context.token);if(old)return old.outcome==='failed'?{error:'容量检查失败'}:old.outcome==='interrupted'?{skipped:'interrupted'}:{ok:true};
  const startedAt=new Date(now()).toISOString(),deadline=AbortSignal.timeout(timeoutMs),signal=AbortSignal.any([context.signal,deadline]);
  let outcome,report;
  try{
   const result=await previewStorageRetention(databasePath,backupRoot,{policy,now:now(),signal});
   context.assertActive();signal.throwIfAborted();
   outcome='ok';report={version:'storage-monitor/1',scopeId,policy,databaseBytes:result.databaseBytes,backupBytes:result.observedBackupBytes,freeBytes:result.freeBytes,capacityComplete:result.capacityComplete,
    verifiedBackups:result.snapshots.filter(s=>s.verified).length,unverifiedBackups:result.snapshots.filter(s=>!s.verified).length,
    candidateBackups:result.snapshots.filter(s=>s.candidate).length,candidateBytes:result.candidateBytes,
    warnings:result.warnings.map(w=>({kind:w.kind,...(w.entries===undefined?{}:{entries:w.entries})}))};
  }catch{
   let inactive=false;try{context.assertActive();}catch{inactive=true;}
   outcome=context.signal.aborted||inactive?'interrupted':'failed';
   report={version:'storage-monitor/1',scopeId,policy,reason:outcome==='interrupted'?'cancelled-or-lease-lost':deadline.aborted?'scan-timeout':'scan-unavailable'};
  }
  db.prepare('INSERT INTO storage_checks(token,started_at,completed_at,outcome,report) VALUES(?,?,?,?,?)').run(context.token,startedAt,new Date(now()).toISOString(),outcome,JSON.stringify(report));
  return outcome==='failed'?{error:'容量检查失败'}:outcome==='interrupted'?{skipped:'interrupted'}:{ok:true};
 }
 return {
  check(context){if(flights.has(context.token))return flights.get(context.token);const job=measure(context).finally(()=>flights.delete(context.token));flights.set(context.token,job);return job;},
  snapshot(){return {scopeId,policy,intervalSeconds:3600,timeoutSeconds:timeoutMs/1000,total:db.prepare('SELECT count(*) AS n FROM storage_checks').get().n,
   latest:decode(db.prepare('SELECT * FROM storage_checks ORDER BY id DESC LIMIT 1').get()),
   lastSuccess:decode(db.prepare("SELECT * FROM storage_checks WHERE outcome='ok' ORDER BY id DESC LIMIT 1").get()),
   history:db.prepare('SELECT * FROM storage_checks ORDER BY id DESC LIMIT 20').all().map(decode)};}
 };
}
