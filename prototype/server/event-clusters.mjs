import {randomUUID} from 'node:crypto';
import {digest} from './codex-research.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {clusterErrors} from '../shared/event-cluster-labels.mjs';
const algorithm='complete-pair-consistency-1';
const same=new Set(['repeat','followup','reversal']);
const memberKey=r=>r.kind==='material'?`material:${r.documentId}`:`news:${r.id}`;
const exact=(a,b)=>a.id===b.id&&a.revision===b.revision&&(a.kind||'news')===(b.kind||'news');
const fail=i=>{throw new Error(clusterErrors[i]);};
const text=(s,max)=>typeof s==='string'&&!!s.trim()&&s.trim().length<=max;
const keys=(o,wanted)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===wanted.split(',').sort().join(',');
export function openEventClusters(store,batches,semantic,{now=Date.now}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS event_clusters(id TEXT PRIMARY KEY,version INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_cluster_versions(cluster_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(cluster_id,version));
 CREATE TABLE IF NOT EXISTS event_cluster_members(member_key TEXT PRIMARY KEY,cluster_id TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS event_cluster_by_id ON event_cluster_members(cluster_id);
 CREATE TABLE IF NOT EXISTS event_cluster_commands(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,response TEXT NOT NULL);`);
 const read=id=>{const r=db.prepare('SELECT payload FROM event_clusters WHERE id=?').get(id);if(!r)fail(4);return JSON.parse(r.payload);};
 const writeAllowed=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 const pairState=run=>{
  if(!run||run.status!=='candidate')return 'pending';
  if(run.stale)return 'stale';
  if(run.decision&&run.decision.runId!==run.id)return 'superseded';
  if(run.decision&&run.decision.action!=='accept')return 'rejected';
  return same.has(run.candidate.comparison.relation)?'same':run.candidate.comparison.relation==='uncertain'?'unknown':'different';
 };
 const basis=run=>({runId:run.id,inputHash:run.packet.inputHash,outputHash:run.candidate.trace.outputHash,model:run.model,promptVersion:run.candidate.trace.promptVersion,decisionVersion:run.decisionVersion,comparison:structuredClone(run.candidate.comparison)});
 const health=record=>{
  const {snapshotHash,...value}=record;
  if(snapshotHash!==digest(value))return {current:false,reason:'事件簇快照校验失败，保留记录供核对'};
  if(record.status==='archived')return {current:false,reason:'已归档；成员分配已释放，历史仍保留'};
  for(const pair of record.pairs){try{const run=semantic.get(pair.basis.runId);if(pairState(run)!=='same'||digest(basis(run))!==digest(pair.basis))throw Error();}catch{return {current:false,reason:'输入修订或比较决定变化，原事件簇与成员保留，需重新核对'};}}
  return {current:true,reason:'成员版本与全部组内比较仍匹配；不等于事实已核实'};
 };
 const summary=record=>({id:record.id,version:record.version,status:record.status,title:record.title,confirmedAt:record.confirmedAt,updatedAt:record.updatedAt,memberCount:record.members.length,batchId:record.batchId,health:health(record)});
 const persist=record=>{
  const saved={...record,snapshotHash:digest(record)},payload=JSON.stringify(saved);
  db.prepare('INSERT INTO event_clusters VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,status=excluded.status,payload=excluded.payload').run(saved.id,saved.version,saved.status,payload);
  db.prepare('INSERT INTO event_cluster_versions VALUES(?,?,?)').run(saved.id,saved.version,payload);
  db.prepare('DELETE FROM event_cluster_members WHERE cluster_id=?').run(saved.id);
  if(saved.status==='active')for(const member of saved.members)db.prepare('INSERT INTO event_cluster_members VALUES(?,?)').run(memberKey(member),saved.id);
  return {id:saved.id,version:saved.version};
 };
 const command=(action,id,input,fn)=>{
  if(!text(input?.requestId,80)||!/^[-a-zA-Z0-9]{16,80}$/.test(input.requestId))fail(0);
  db.exec('BEGIN IMMEDIATE');try{
   writeAllowed();const hash=digest({action,id,input}),old=db.prepare('SELECT * FROM event_cluster_commands WHERE request_id=?').get(input.requestId);
   if(old){if(old.request_hash!==hash)fail(6);db.exec('COMMIT');return JSON.parse(old.response);}
   const result=fn();db.prepare('INSERT INTO event_cluster_commands VALUES(?,?,?)').run(input.requestId,hash,JSON.stringify(result));db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 };
 const api={
  preview(batchId){
   const batch=batches.get(batchId),members=batch.inputs.map(comparisonSummary);
   const pairs=batch.items.map(item=>{
    const run=item.runId?semantic.get(item.runId):null;
    const matching=run&&exact(run.packet.input.left,members[item.left])&&exact(run.packet.input.right,members[item.right]);
    return {ordinal:item.ordinal,left:item.left,right:item.right,status:matching?pairState(run):run?'stale':'pending',relation:run?.candidate?.comparison.relation||null,runId:run?.id||null,basis:run?.status==='candidate'?basis(run):null};
   });
   // Connected components only propose a scope. Every internal pair must independently agree.
   const links=members.map(()=>new Set());for(const p of pairs)if(same.has(p.relation)){links[p.left].add(p.right);links[p.right].add(p.left);}
   const seen=new Set(),groups=[];
   for(let i=0;i<members.length;i++){
    if(seen.has(i))continue;const indices=[],queue=[i];seen.add(i);
    while(queue.length){const n=queue.shift();indices.push(n);for(const next of links[n])if(!seen.has(next)){seen.add(next);queue.push(next);}}
    indices.sort((a,b)=>a-b);const included=new Set(indices),groupPairs=pairs.filter(p=>included.has(p.left)&&included.has(p.right)),groupMembers=indices.map(n=>members[n]);
    const overlaps=[...new Set(groupMembers.flatMap(m=>{const r=db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(memberKey(m));return r?[r.cluster_id]:[];}))].sort().map(read);
    const allKeys=new Set(groupMembers.map(memberKey)),missing=overlaps.flatMap(c=>c.members.filter(m=>!allKeys.has(memberKey(m))));
    const state=indices.length===1?'single':groupPairs.length===indices.length*(indices.length-1)/2&&groupPairs.every(p=>p.status==='same')?'ready':'conflict';
    const group={id:digest({algorithm,batchId,indices}),indices,members:groupMembers,pairs:groupPairs,state,overlaps:overlaps.map(c=>({id:c.id,version:c.version,title:c.title})),missing:missing.map(comparisonSummary),canSave:state==='ready'&&overlaps.length<=1&&!missing.length};
    groups.push({...group,hash:digest({algorithm,planHash:batch.planHash,...group})});
   }
   return {algorithm,batchId,planHash:batch.planHash,inputCount:members.length,groups,unmergedPairs:pairs.filter(p=>!same.has(p.relation))};
  },
  save(input){
   if(!keys(input,'batchId,groupId,previewHash,clusterId,version,title,note,requestId')||!text(input.batchId,80)||!text(input.groupId,80)||!text(input.previewHash,80)||typeof input.clusterId!=='string'||!Number.isSafeInteger(input.version)||input.version<0||!text(input.title,140)||!text(input.note,1200))fail(0);
   return command('save','',input,()=>{
    const preview=api.preview(input.batchId),group=preview.groups.find(g=>g.id===input.groupId);if(!group||group.hash!==input.previewHash)fail(1);
    if(group.state!=='ready')fail(2);if(!group.canSave)fail(3);
    const existing=group.overlaps[0];if((existing?.id||'')!==input.clusterId||(existing?.version||0)!==input.version)fail(5);
    const old=existing?read(existing.id):null;if(old?.status==='archived')fail(5);
    const at=new Date(now()).toISOString();
    return persist({id:old?.id||randomUUID(),version:(old?.version||0)+1,status:'active',title:input.title.trim(),note:input.note.trim(),confirmedAt:old?.confirmedAt||at,updatedAt:at,algorithm,method:'human-confirmed-model-pair-cluster',batchId:input.batchId,planHash:preview.planHash,groupHash:group.hash,members:group.members,pairs:group.pairs.map(p=>({left:comparisonSummary(group.members[group.indices.indexOf(p.left)]),right:comparisonSummary(group.members[group.indices.indexOf(p.right)]),basis:p.basis})),previousVersion:old?.version||null});
   });
  },
  archive(id,input){
   if(!keys(input,'version,note,requestId')||!Number.isSafeInteger(input.version)||input.version<1||!text(input.note,1200))fail(0);
   return command('archive',id,input,()=>{const old=read(id);if(old.status==='archived'||old.version!==input.version)fail(5);const {snapshotHash,...value}=old;return persist({...value,version:old.version+1,status:'archived',note:input.note.trim(),updatedAt:new Date(now()).toISOString(),previousVersion:old.version});});
  },
  get(id){const record=read(id);return {...record,health:health(record),history:db.prepare('SELECT payload FROM event_cluster_versions WHERE cluster_id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(r.payload))};},
  list(params={}){
   if(Object.keys(params).some(k=>!['offset','q','status'].includes(k)))fail(0);const offset=Number(params.offset??0),q=params.q??'',status=params.status??'active',limit=20;
   if(!Number.isSafeInteger(offset)||offset<0||typeof q!=='string'||q.length>140||!['active','archived','all'].includes(status))fail(0);
   const where="(?='all' OR status=?) AND instr(lower(json_extract(payload,'$.title')),lower(?))>0",args=[status,status,q.trim()];
   const total=db.prepare(`SELECT count(*) n FROM event_clusters WHERE ${where}`).get(...args).n,rows=db.prepare(`SELECT payload FROM event_clusters WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args,limit,offset);
   return {items:rows.map(r=>summary(JSON.parse(r.payload))),total,offset,limit};
  },
  forResearch(topic){
   const refs=topic.evidence.flatMap(e=>e.materialId?[{kind:'material',id:e.materialId,revision:e.materialRevision}]:e.newsId?[{id:e.newsId,revision:e.newsRevision}]:[]);
   const keys=refs.flatMap(r=>{if(r.kind!=='material')return [memberKey(r)];const m=db.prepare('SELECT document_id FROM research_materials WHERE id=?').get(r.id);return m?[`material:${m.document_id}`]:[];});
   if(!keys.length)return [];
   const rows=db.prepare('SELECT DISTINCT c.payload FROM event_clusters c JOIN event_cluster_members m ON m.cluster_id=c.id WHERE m.member_key IN (SELECT value FROM json_each(?)) ORDER BY c.id').all(JSON.stringify(keys));
   return rows.map(row=>{const c=JSON.parse(row.payload),matched=c.members.filter(m=>refs.some(r=>exact(m,r)));return {...summary(c),matchedMembers:matched.map(comparisonSummary),bindingCurrent:matched.length>0};});
  }
 };
 return api;
}
