import {digest} from './codex-research.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {semanticErrors} from '../shared/semantic-labels.mjs';
const positive=new Set(['repeat','followup','reversal','related','analogy']);
const other=side=>side==='left'?'right':'left';
const fail=()=>{throw new Error(semanticErrors[10]);};
function evidenceIds(topic,record){
 return (topic.evidence||[]).filter(e=>{
  if(record.kind==='event')return topic.id===record.id&&record.revision===1&&digest(topic.eventExtraction)===digest(record.eventProvenance)&&e.materialId===record.materialId&&e.materialRevision===record.materialRevision;
  // Whole-document relationships cannot establish the identity of a selected occurrence.
  if(topic.eventExtraction&&e.materialId)return false;
  return record.kind==='material'?e.materialId===record.id&&e.materialRevision===record.revision:e.newsId===record.id&&e.newsRevision===record.revision;
 }).map(e=>e.id).sort();
}
const usable=run=>run.active&&run.status==='candidate'&&positive.has(run.candidate?.comparison.relation);
function basis(run,source,target,sourceSide){
 const sourceEvidenceIds=evidenceIds(source,run.packet.input[sourceSide]),targetEvidenceIds=evidenceIds(target,run.packet.input[other(sourceSide)]);
 if(!usable(run)||!sourceEvidenceIds.length||!targetEvidenceIds.length)fail();
 const value={runId:run.id,decisionVersion:run.decisionVersion,inputHash:run.packet.inputHash,outputHash:run.candidate.trace.outputHash,model:run.model,promptVersion:run.candidate.trace.promptVersion,relation:run.candidate.comparison.relation,sourceSide,sourceEvidenceIds,targetEvidenceIds,source:comparisonSummary(run.packet.input[sourceSide]),target:comparisonSummary(run.packet.input[other(sourceSide)]),comparison:structuredClone(run.candidate.comparison),...(run.decision.actor?{actor:run.decision.actor}:{}),decisionAt:run.decision.at,decisionNote:run.decision.note};
 return {...value,hash:digest(value)};
}
export function freezeSemanticBasis(semanticEvents,source,target,input){
 if(!semanticEvents||!input||Object.keys(input).sort().join(',')!=='decisionVersion,runId,sourceSide'||typeof input.runId!=='string'||!Number.isSafeInteger(input.decisionVersion)||input.decisionVersion<1||!['left','right'].includes(input.sourceSide))fail();
 let run;try{run=semanticEvents.get(input.runId);}catch{fail();}
 if(run.decisionVersion!==input.decisionVersion)fail();
 return basis(run,source,target,input.sourceSide);
}
export function semanticBasisStatus(semanticEvents,source,target,saved){
 if(!saved)return null;
 try{
  const {hash,...value}=saved;if(hash!==digest(value))fail();
  const current=freezeSemanticBasis(semanticEvents,source,target,{runId:saved.runId,decisionVersion:saved.decisionVersion,sourceSide:saved.sourceSide});
  if(current.hash!==saved.hash)fail();
  return {current:true,message:'比较决定与两侧证据版本仍匹配'};
 }catch{return {current:false,message:'比较决定或证据已变化，需重新核对；原关联与冻结依据保留'};}
}
export function semanticResearchCandidates(store,semanticEvents,topic,topics,params={}){
 if(!params||Object.keys(params).some(k=>k!=='semanticOffset'))throw new Error(semanticErrors[7]);
 const offset=Number(params.semanticOffset??0),limit=20;if(!Number.isSafeInteger(offset)||offset<0)throw new Error(semanticErrors[7]);
 const empty={items:[],total:0,offset,limit,acceptedPairs:0};if(!semanticEvents)return empty;
 const ids=[...new Set([...(topic.eventExtraction?[topic.id]:[]),...topic.evidence.flatMap(e=>[e.materialId,e.newsId].filter(Boolean))])];if(!ids.length)return empty;
 // Read every relevant latest decision, including runs older than the comparison UI's latest 50.
 const rows=store.db.prepare(`SELECT r.id FROM semantic_runs r JOIN semantic_decisions d ON d.pair_key=r.pair_key AND d.run_id=r.id
 WHERE d.version=(SELECT MAX(version) FROM semantic_decisions WHERE pair_key=d.pair_key)
 AND json_extract(d.payload,'$.action')='accept'
 AND (json_extract(r.payload,'$.packet.input.left.id') IN (SELECT value FROM json_each(?)) OR json_extract(r.payload,'$.packet.input.right.id') IN (SELECT value FROM json_each(?)))
 ORDER BY json_extract(d.payload,'$.at') DESC,r.id`).all(JSON.stringify(ids),JSON.stringify(ids));
 const matches=[],targets=topics.filter(t=>t.id!==topic.id).sort((a,b)=>a.id.localeCompare(b.id));let acceptedPairs=0;
 for(const row of rows){
  const run=semanticEvents.get(row.id);if(!usable(run))continue;
  const sides=['left','right'].filter(s=>evidenceIds(topic,run.packet.input[s]).length);if(!sides.length)continue;acceptedPairs++;
  for(const target of targets)for(const sourceSide of sides){
   if(!evidenceIds(target,run.packet.input[other(sourceSide)]).length)continue;
   matches.push({run,target,sourceSide});
  }
 }
 const items=matches.slice(offset,offset+limit).map(({run,target,sourceSide})=>({id:`${run.id}:${sourceSide}:${target.id}`,topicId:target.id,title:target.title,version:target.version,status:target.status,basis:basis(run,topic,target,sourceSide)}));
 return {items,total:matches.length,offset,limit,acceptedPairs};
}
