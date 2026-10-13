import {digest} from './codex-research.mjs';
import {revisionMembers,revisionMappingResult,REVISION_COMPARISON_VERSION} from './revision-comparison.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {validateComparisonCandidate} from './semantic-events.mjs';
import {readSnapshotCache} from './read-snapshot-cache.mjs';
const ref=id=>({kind:'event',id,revision:1});
// Display history can retain an earlier, still-valid correspondence after its
// right side has been superseded. Validate BOTH immutable scopes and every
// decision again. This adapter is private to the read projection; it cannot
// authorize current research, monitoring or orders with historical inputs.
function historicalMapping(store,batch,semantic){
 if(!batch.revision?.sourceRunId)return null;
 const members=revisionMembers(store,batch.revision),before=new Set(members.map(m=>m.id));
 if(before.size!==batch.revisionPreviousIds?.length||batch.revisionPreviousIds.some(id=>!before.has(id)))return null;
 return revisionMappingResult(batch,{get(id){
  const r=semantic.get(id),p=r.packet;
  if(r.status!=='candidate'||p.schema!==REVISION_COMPARISON_VERSION||r.decision?.action!=='accept'||r.decision.runId!==r.id||digest(p.input)!==p.inputHash)throw Error('对应依据无法核对');
  validateComparisonCandidate(r.candidate,p,r.model);
  const left=eventComparisonSnapshot(store.db,ref(p.input.left.id),{historical:true}),right=eventComparisonSnapshot(store.db,ref(p.input.right.id),{historical:true});
  if(!before.has(left.id)||before.has(right.id)||!members.some(m=>digest(m)===digest(comparisonSummary(left)))||left.documentId!==right.documentId||left.materialRevision>=right.materialRevision||digest({left,right,revision:batch.revision})!==p.inputHash)throw Error('原始事项范围已有变化');
  return {...r,stale:false,active:true};
 }});
}
export function openSourceResearchHistory(store,semantic,batches){
 const db=store.db,memo=readSnapshotCache(db,{limit:1,maxBytes:4*1024*1024});
 return {project(topics){return memo(JSON.stringify(topics.map(t=>[t.id,t.version,t.status,t.title])),()=>{
  const byId=new Map(topics.map(t=>[t.id,t])),nodes=new Map(),edges=[],warnings=new Set();
  for(const row of db.prepare("SELECT id,batch_id,payload FROM research_pipeline_cluster_jobs WHERE status='completed' AND json_extract(payload,'$.mode')='holding-revision' ORDER BY rowid").all()){
   const p=JSON.parse(row.payload);let evidence;
   try{evidence=historicalMapping(store,batches.get(row.batch_id),semantic);if(!evidence||digest(evidence)!==p.evidenceHash)throw Error();}
   catch{for(const id of [...p.previousIds,...(p.source?.topics||[]).map(t=>t.id)])warnings.add(id);continue;}
   const savedAt=db.prepare("SELECT at FROM research_pipeline_audit WHERE item_id=? AND action='holding-succession-completed' ORDER BY id DESC LIMIT 1").get(row.id)?.at||null;
   for(const m of evidence.mappings){
    const pair=evidence.pairs.find(q=>q.left.id===m.beforeId&&q.right.id===m.afterId);
    nodes.set(m.beforeId,pair.left);nodes.set(m.afterId,pair.right);edges.push({...m,batchId:row.batch_id,savedAt});
   }
  }
  const adjacent=new Map([...nodes.keys()].map(id=>[id,new Set()]));
  for(const e of edges){adjacent.get(e.beforeId).add(e.afterId);adjacent.get(e.afterId).add(e.beforeId);}
  const visited=new Set(),groups=[];
  for(const root of nodes.keys()){
   if(visited.has(root))continue;
   const ids=[],pending=[root];while(pending.length){const id=pending.pop();if(visited.has(id))continue;visited.add(id);ids.push(id);pending.push(...adjacent.get(id));}
   const members=ids.map(id=>nodes.get(id)).sort((a,b)=>a.materialRevision-b.materialRevision||a.id.localeCompare(b.id)),current=members.at(-1);
   // A shared old anchor proves a lineage, but never chooses between two
   // occurrences from the same revision or two different documents.
   let valid=members.length>1&&new Set(members.map(m=>m.documentId)).size===1&&new Set(members.map(m=>m.materialRevision)).size===members.length&&members.every(m=>byId.get(m.id)?.status==='active');
   if(valid)try{
    const job=JSON.parse(db.prepare("SELECT payload FROM research_pipeline_event_jobs WHERE kind='extract' AND status='completed' AND run_id=?").get(current.eventProvenance.runId)?.payload||'null');
    valid=!!job?.automatic&&job.packet?.inputHash===current.eventProvenance.inputHash&&store.newsById(job.newsId)?.revision===job.newsRevision&&digest(comparisonSummary(eventComparisonSnapshot(db,ref(current.id))))===digest(current);
   }catch{valid=false;}
   if(!valid){for(const id of ids)warnings.add(id);continue;}
   const evidenceEdges=edges.filter(e=>ids.includes(e.beforeId)&&ids.includes(e.afterId)),batchIds=[...new Set(evidenceEdges.map(e=>e.batchId))].sort();
   groups.push({id:`source-history:${members[0].id}`,title:byId.get(current.id).title,currentTopicId:current.id,materialRevision:current.materialRevision,documentId:current.documentId,batchIds,
    history:members.slice(0,-1).map(m=>({kind:'source-succession',topicId:m.id,currentTopicId:current.id,materialRevision:m.materialRevision,replacedAt:evidenceEdges.filter(e=>e.beforeId===m.id||e.afterId===m.id).map(e=>e.savedAt||'').sort().at(-1)||null,batchIds}))});
   for(const id of ids)warnings.delete(id);
  }
  return {groups,warnings:[...warnings].sort()};
 });}};
}
