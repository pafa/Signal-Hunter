import {digest} from './codex-research.mjs';
import {comparisonSummary} from './semantic-materials.mjs';

// This is navigation through saved succession records, never a new judgement.
// A broken chain leaves research visible separately instead of hiding it.
export function clusterResearchHistory(record,versions){
 if(versions.length!==record.version||versions.at(-1)?.snapshotHash!==record.snapshotHash)return [];
 const links=new Map(),current=new Set(record.members.filter(m=>m.kind==='event').map(m=>m.id));
 for(let i=0;i<versions.length;i++){
  const v=versions[i],{snapshotHash,...value}=v,previous=versions[i-1];
  if(v.version!==i+1||v.id!==record.id||digest(value)!==snapshotHash||i&&v.previousVersion!==previous.version)return [];
  if(!v.replacement)continue;
  if(!previous||v.replacement.previousSnapshotHash!==previous.snapshotHash)return [];
  for(const {before,after} of v.replacement.mappings){
   const old=previous.members.find(m=>m.kind==='event'&&m.id===before.id),next=v.members.find(m=>m.kind==='event'&&m.id===after.id);
   if(!old||!next||digest(comparisonSummary(old))!==digest(before)||digest(comparisonSummary(next))!==digest(after)||before.documentId!==after.documentId||after.materialRevision<=before.materialRevision||links.has(before.id))return [];
   links.set(before.id,{topicId:before.id,replacedByTopicId:after.id,materialRevision:before.materialRevision,clusterVersion:v.version,replacedAt:v.updatedAt});
  }
 }
 return [...links.values()].flatMap(link=>{
  if(current.has(link.topicId))return [];
  const seen=new Set([link.topicId]);let id=link.replacedByTopicId;
  while(!current.has(id)){if(seen.has(id)||!links.has(id))return [];seen.add(id);id=links.get(id).replacedByTopicId;}
  return [{...link,currentTopicId:id}];
 });
}
