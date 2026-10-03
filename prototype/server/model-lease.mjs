// Shared by dossier and event comparison jobs, including separate server processes.
export function initializeModelLease(db){db.exec('CREATE TABLE IF NOT EXISTS model_job_lease(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL)');}
// Caller holds BEGIN IMMEDIATE so the lease and frozen input commit together.
export function claimModelLease(db,id,now,ttl){
 db.prepare('DELETE FROM model_job_lease WHERE expires_at<?').run(now);
 if(db.prepare('SELECT 1 FROM model_job_lease').get())throw new Error('已有模型研判正在运行，请等待或取消后再试');
 db.prepare('INSERT INTO model_job_lease VALUES(1,?,?)').run(id,now+ttl);
}
export function releaseModelLease(db,id){db.prepare('DELETE FROM model_job_lease WHERE owner=?').run(id);}
