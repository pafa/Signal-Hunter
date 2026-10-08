import {researchActor} from './research-actor.mjs';
import {clusterResearchHistory} from './event-cluster-lineage.mjs';
import {randomUUID} from 'node:crypto';
import {digest} from './codex-research.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {clusterErrors} from '../shared/event-cluster-labels.mjs';
const algorithm='complete-pair-consistency-1';
const same=new Set(['repeat','followup','reversal']);
const memberKey=r=>r.kind==='event'?`event:${r.id}`:r.kind==='material'?`material:${r.documentId}`:`news:${r.id}`;
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
 const summary=record=>({...(record.actor?{actor:record.actor}:{}),id:record.id,version:record.version,status:record.status,title:record.title,confirmedAt:record.confirmedAt,updatedAt:record.updatedAt,memberCount:record.members.length,batchId:record.batchId,health:health(record)});
 const persist=record=>{
  const saved={...record,snapshotHash:digest(record)},payload=JSON.stringify(saved);
  db.prepare('INSERT INTO event_clusters VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,status=excluded.status,payload=excluded.payload').run(saved.id,saved.version,saved.status,payload);
  db.prepare('INSERT INTO event_cluster_versions VALUES(?,?,?)').run(saved.id,saved.version,payload);
  db.prepare('DELETE FROM event_cluster_members WHERE cluster_id=?').run(saved.id);
  if(saved.status==='active')for(const member of saved.members)db.prepare('INSERT INTO event_cluster_members VALUES(?,?)').run(memberKey(member),saved.id);
  return {id:saved.id,version:saved.version};
 };
 const command=(action,id,input,fn,provenance={})=>{
  if(!text(input?.requestId,80)||!/^[-a-zA-Z0-9]{16,80}$/.test(input.requestId))fail(0);
  db.exec('BEGIN IMMEDIATE');try{
   writeAllowed();const hash=digest({action,id,input,...provenance}),old=db.prepare('SELECT * FROM event_cluster_commands WHERE request_id=?').get(input.requestId);
   if(old){if(old.request_hash!==hash)fail(6);db.exec('COMMIT');return JSON.parse(old.response);}
   const result=fn();db.prepare('INSERT INTO event_cluster_commands VALUES(?,?,?)').run(input.requestId,hash,JSON.stringify(result));db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 };
 const groupPairs=group=>group.pairs.map(p=>({left:comparisonSummary(group.members[group.indices.indexOf(p.left)]),right:comparisonSummary(group.members[group.indices.indexOf(p.right)]),basis:p.basis}));
 const replacementPlan=(id,input)=>{
  if(!keys(input,'batchId,groupId,version,replacements')||!text(input.batchId,80)||!text(input.groupId,80)||!Number.isSafeInteger(input.version)||input.version<1||!Array.isArray(input.replacements)||!input.replacements.length||input.replacements.length>10)fail(7);
  const old=read(id),{snapshotHash,...oldValue}=old;
  if(snapshotHash!==digest(oldValue))fail(8);
  if(old.status!=='active'||old.version!==input.version)fail(5);
  const preview=api.preview(input.batchId),group=preview.groups.find(g=>g.id===input.groupId);
  if(!group||group.state!=='ready')fail(2);
  if(group.overlaps.some(c=>c.id!==id))fail(3);
  const retained=new Set(group.members.map(memberKey)),missing=old.members.filter(m=>!retained.has(memberKey(m)));
  const seenBefore=new Set(),seenAfter=new Set(),mappings=[];
  for(const link of input.replacements){
   if(!keys(link,'beforeId,afterId')||!text(link.beforeId,80)||!text(link.afterId,80)||seenBefore.has(link.beforeId)||seenAfter.has(link.afterId))fail(7);
   const before=missing.find(m=>m.kind==='event'&&m.id===link.beforeId),after=group.members.find(m=>m.kind==='event'&&m.id===link.afterId);
   if(!before||!after||old.members.some(m=>memberKey(m)===memberKey(after))||before.documentId!==after.documentId||!Number.isSafeInteger(before.materialRevision)||!Number.isSafeInteger(after.materialRevision)||after.materialRevision<=before.materialRevision)fail(7);
   seenBefore.add(link.beforeId);seenAfter.add(link.afterId);mappings.push({before:comparisonSummary(before),after:comparisonSummary(after)});
  }
  if(missing.length!==mappings.length)fail(7);
  mappings.sort((a,b)=>a.before.id.localeCompare(b.before.id));
  const value={clusterId:id,version:old.version,previousSnapshotHash:snapshotHash,batchId:input.batchId,groupId:group.id,groupHash:group.hash,planHash:preview.planHash,mappings,members:group.members,pairs:groupPairs(group)};
  return {...value,previewHash:digest(value)};
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
  save(input,actor,beforeCommit=()=>{}){
   const provenance=researchActor(actor);
   if(!keys(input,'batchId,groupId,previewHash,clusterId,version,title,note,requestId')||!text(input.batchId,80)||!text(input.groupId,80)||!text(input.previewHash,80)||typeof input.clusterId!=='string'||!Number.isSafeInteger(input.version)||input.version<0||!text(input.title,140)||!text(input.note,1200))fail(0);
   return command('save','',input,()=>{
    const preview=api.preview(input.batchId),group=preview.groups.find(g=>g.id===input.groupId);if(!group||group.hash!==input.previewHash)fail(1);
    if(group.state!=='ready')fail(2);if(!group.canSave)fail(3);
    const existing=group.overlaps[0];if((existing?.id||'')!==input.clusterId||(existing?.version||0)!==input.version)fail(5);
    const old=existing?read(existing.id):null;if(old?.status==='archived')fail(5);
    const at=new Date(now()).toISOString();
    const record={...provenance,id:old?.id||randomUUID(),version:(old?.version||0)+1,status:'active',title:input.title.trim(),note:input.note.trim(),confirmedAt:old?.confirmedAt||at,updatedAt:at,algorithm,method:actor?'system-model-pair-cluster':'human-confirmed-model-pair-cluster',batchId:input.batchId,planHash:preview.planHash,groupHash:group.hash,members:group.members,pairs:groupPairs(group),previousVersion:old?.version||null};
    beforeCommit({id:record.id,version:record.version});return persist(record);
   },provenance);
  },
  replacementPreview(id,input){return replacementPlan(id,input);},
  replace(id,input,actor,beforeCommit=()=>{}){
   const provenance=researchActor(actor);
   if(!keys(input,'batchId,groupId,version,replacements,previewHash,note,requestId')||!text(input.previewHash,80)||!text(input.note,1200)||!Array.isArray(input.replacements))fail(7);
   // Normalize command fields so retries do not depend on JSON property or mapping order.
   const normalized={batchId:input.batchId,groupId:input.groupId,version:input.version,replacements:input.replacements.map(m=>{
    if(!keys(m,'beforeId,afterId')||!text(m.beforeId,80)||!text(m.afterId,80))fail(7);return {beforeId:m.beforeId,afterId:m.afterId};
   }).sort((a,b)=>a.beforeId.localeCompare(b.beforeId)),previewHash:input.previewHash,note:input.note.trim(),requestId:input.requestId};
   return command('replace',id,normalized,()=>{
    const {batchId,groupId,version,replacements}=normalized,plan=replacementPlan(id,{batchId,groupId,version,replacements});
    if(plan.previewHash!==normalized.previewHash)fail(1);
    const old=read(id),at=new Date(now()).toISOString();
    const record={...provenance,id,version:old.version+1,status:'active',title:old.title,note:normalized.note,confirmedAt:old.confirmedAt,updatedAt:at,algorithm,method:actor?'system-model-event-succession':'human-reviewed-event-succession',batchId,planHash:plan.planHash,groupHash:plan.groupHash,members:plan.members,pairs:plan.pairs,previousVersion:old.version,replacement:{previousSnapshotHash:plan.previousSnapshotHash,previewHash:plan.previewHash,mappings:plan.mappings,method:actor?'system-complete-pair-same-document-new-revision':'human-reviewed-same-document-new-revision'}};
    beforeCommit({id,version:record.version});return persist(record);
   },provenance);
  },
  archive(id,input){
   if(!keys(input,'version,note,requestId')||!Number.isSafeInteger(input.version)||input.version<1||!text(input.note,1200))fail(0);
   return command('archive',id,input,()=>{const old=read(id);if(old.status==='archived'||old.version!==input.version)fail(5);const {snapshotHash,...value}=old;return persist({...value,version:old.version+1,status:'archived',note:input.note.trim(),updatedAt:new Date(now()).toISOString(),previousVersion:old.version});});
  },
  get(id){const record=read(id);return {...record,health:health(record),history:db.prepare('SELECT payload FROM event_cluster_versions WHERE cluster_id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(r.payload))};},
  workbench(topics){
   // Only scoped occurrence identity binds research to an event. Shared article
   // evidence alone cannot prove that two research topics are the same event.
   const active=new Set(topics.filter(t=>t.status==='active'&&t.eventExtraction).map(t=>t.id));
   const scoped=new Set(topics.filter(t=>t.eventExtraction).map(t=>t.id));
   const owners=new Map(db.prepare('SELECT member_key,cluster_id FROM event_cluster_members').all().map(r=>[r.member_key,r.cluster_id]));
   return db.prepare("SELECT payload FROM event_clusters WHERE status='active' ORDER BY id").all().flatMap(row=>{
    const record=JSON.parse(row.payload),topicIds=record.members.filter(m=>m.kind==='event'&&active.has(m.id)).map(m=>m.id);
    if(!topicIds.length)return [];
    const versions=db.prepare('SELECT payload FROM event_cluster_versions WHERE cluster_id=? ORDER BY version').all(record.id).map(r=>JSON.parse(r.payload));
    const history=clusterResearchHistory(record,versions).filter(h=>scoped.has(h.topicId)&&topicIds.includes(h.currentTopicId)&&!owners.has(`event:${h.topicId}`));
    return [{...summary(record),topicIds,history}];
   });
  },
  list(params={}){
   if(Object.keys(params).some(k=>!['offset','q','status'].includes(k)))fail(0);const offset=Number(params.offset??0),q=params.q??'',status=params.status??'active',limit=20;
   if(!Number.isSafeInteger(offset)||offset<0||typeof q!=='string'||q.length>140||!['active','archived','all'].includes(status))fail(0);
   const where="(?='all' OR status=?) AND instr(lower(json_extract(payload,'$.title')),lower(?))>0",args=[status,status,q.trim()];
   const total=db.prepare(`SELECT count(*) n FROM event_clusters WHERE ${where}`).get(...args).n,rows=db.prepare(`SELECT payload FROM event_clusters WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args,limit,offset);
   return {items:rows.map(r=>summary(JSON.parse(r.payload))),total,offset,limit};
  },
  forResearch(topic){
   const refs=topic.evidence.filter(e=>!topic.eventExtraction||!e.materialId).flatMap(e=>e.materialId?[{kind:'material',id:e.materialId,revision:e.materialRevision}]:e.newsId?[{id:e.newsId,revision:e.newsRevision}]:[]);
   if(topic.eventExtraction)refs.push({kind:'event',id:topic.id,revision:1});
   const keys=refs.flatMap(r=>{if(r.kind!=='material')return [memberKey(r)];const m=db.prepare('SELECT document_id FROM research_materials WHERE id=?').get(r.id);return m?[`material:${m.document_id}`]:[];});
   if(!keys.length)return [];
   const rows=db.prepare('SELECT DISTINCT c.payload FROM event_clusters c JOIN event_cluster_members m ON m.cluster_id=c.id WHERE m.member_key IN (SELECT value FROM json_each(?)) ORDER BY c.id').all(JSON.stringify(keys));
   const retired=topic.eventExtraction?db.prepare(`SELECT v.cluster_id,v.version FROM event_cluster_versions v JOIN event_clusters c ON c.id=v.cluster_id, json_each(v.payload,'$.replacement.mappings') m
    WHERE c.status='active' AND json_extract(m.value,'$.before.kind')='event' AND json_extract(m.value,'$.before.id')=? ORDER BY v.version`).all(topic.id):[];
   const ids=new Set(rows.map(row=>JSON.parse(row.payload).id));for(const r of retired)if(!ids.has(r.cluster_id)){rows.push({payload:JSON.stringify(read(r.cluster_id))});ids.add(r.cluster_id);}
   return rows.map(row=>{const c=JSON.parse(row.payload),matched=c.members.filter(m=>refs.some(r=>exact(m,r))),historicalVersions=retired.filter(r=>r.cluster_id===c.id).map(r=>r.version-1);return {...summary(c),matchedMembers:matched.map(comparisonSummary),bindingCurrent:matched.length>0,...(historicalVersions.length?{historicalVersions}: {})};});
  }
 };
 return api;
}
