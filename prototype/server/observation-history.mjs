const decode=r=>({...JSON.parse(r.payload),state:r.state,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at});
export function observationSummary(db){
 const counts={pending:0,read:0,completed:0};for(const r of db.prepare('SELECT state,count(*) n FROM observation_todos GROUP BY state').all())counts[r.state]=r.n;
 const newest=db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM observation_todos').get().n,receipt=db.prepare('SELECT COALESCE(MAX(id),0) n FROM observation_receipts').get().n;
 return {counts,total:Object.values(counts).reduce((a,b)=>a+b,0),pending:counts.pending+counts.read,revision:`${newest}:${receipt}`,retention:'所有待办与回执持续保留；完成不会删除，旧条件命中不会被新版本覆盖'};
}
export function observationPage(db,params={}){
 const bad=()=>{throw new Error('待办分页参数无效');};
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!['state','before','ceiling'].includes(k)))bad();
 const state=params.state??'pending';if(!['all','pending','completed'].includes(state))bad();
 for(const key of ['before','ceiling'])if(params[key]!==undefined&&(!/^\d+$/.test(String(params[key]))||!Number.isSafeInteger(Number(params[key]))))bad();
 if(params.before!==undefined&&params.ceiling===undefined)bad();
 db.exec('BEGIN');try{
 const summary=observationSummary(db),max=Number(summary.revision.split(':')[0]),ceiling=params.ceiling===undefined?max:Number(params.ceiling);if(ceiling>max)bad();
 let cursor=null;if(params.before!==undefined){cursor=db.prepare('SELECT rowid,created_at FROM observation_todos WHERE rowid=? AND rowid<=?').get(Number(params.before),ceiling);if(!cursor)bad();}
 const filter=state==='all'?'':state==='pending'?" AND state!='completed'":" AND state='completed'",base=' FROM observation_todos WHERE rowid<=?'+filter;
 const total=db.prepare('SELECT COUNT(*) n'+base).get(ceiling).n;
 const rows=db.prepare('SELECT rowid,*'+base+(cursor?' AND (created_at<? OR (created_at=? AND rowid<?))':'')+' ORDER BY created_at DESC,rowid DESC LIMIT 51').all(ceiling,...(cursor?[cursor.created_at,cursor.created_at,cursor.rowid]:[]));
 db.exec('COMMIT');return {items:rows.slice(0,50).map(decode),total,state,ceiling,nextCursor:rows.length>50?String(rows[49].rowid):null,revision:summary.revision,retention:summary.retention};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
