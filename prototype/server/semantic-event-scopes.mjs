import {digest} from './codex-research.mjs';
import {materialComparisonSnapshot,comparisonSummary} from './semantic-materials.mjs';
import {validateMaterialEvents} from './material-events.mjs';
import {semanticErrors} from '../shared/semantic-labels.mjs';
const fail=()=>{throw new Error(semanticErrors[11]);};
// A reviewed occurrence has its own identity; sharing a document does not share an event.
// Scope v1 is immutable. Editing a research note does not revise the occurrence.
// Archival, changed material or lost provenance makes it unavailable, preserving history.
export function eventComparisonSnapshot(db,ref){
 try{
  const topic=JSON.parse(db.prepare('SELECT payload FROM research_topics WHERE id=?').get(ref.id)?.payload),origin=topic.eventExtraction;
  if(topic.id!==ref.id||ref.revision!==1||topic.status!=='active'||topic.origin!=='material-event-review'||!origin)fail();
  const run=JSON.parse(db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(origin.runId)?.payload),packet=run.packet,candidate=run.candidate;
  const decision=JSON.parse(db.prepare('SELECT payload FROM material_event_decisions WHERE run_id=? AND event_index=? ORDER BY version DESC LIMIT 1').get(origin.runId,origin.eventIndex)?.payload);
  if(run.status!=='candidate'||run.id!==origin.runId||packet.inputHash!==digest(packet.input))fail();
  if(origin.inputHash!==packet.inputHash||origin.sourceTopicId!==packet.input.topicId||origin.sourceTopicVersion!==packet.input.topicVersion)fail();
  if(digest(candidate.trace)!==digest(origin.modelTrace)||candidate.trace.inputHash!==packet.inputHash)fail();
  if(digest(candidate.rawOutput)!==candidate.trace.outputHash||digest(JSON.parse(candidate.rawOutput))!==digest(candidate.decomposition))fail();
  if(digest(origin.event)!==digest(candidate.decomposition.events[origin.eventIndex]))fail();
  if(decision.action!=='create'||decision.topicId!==topic.id||decision.inputHash!==packet.inputHash||decision.note!==origin.reviewNote)fail();
  // Legacy v1 time purposes remain unspecified. Validate without rewriting old records.
  const checked=structuredClone(candidate.decomposition);
  if(packet.schema==='material-events-1')for(const e of checked.events)e.timeRole=e.timeEvidence?.basis==='unknown'?'unknown':'unclear';
  else if(packet.schema!=='material-events-2')fail();
  validateMaterialEvents(checked,packet);
  const m=materialComparisonSnapshot(db,packet.input.material);
  if(digest(m)!==digest(packet.input.material)||!topic.evidence.some(e=>e.materialId===m.id&&e.materialRevision===m.revision))fail();
  const initial=JSON.parse(db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=1').get(topic.id)?.payload);
  if(digest(initial.eventExtraction)!==digest(origin))fail();
  return {...m,kind:'event',id:topic.id,revision:1,materialId:m.id,materialRevision:m.revision,eventFocus:structuredClone(origin.event),eventProvenance:structuredClone(origin),reviewedAt:decision.at};
 }catch{fail();}
}
export function comparisonEvents(db,params={}){
 if(Object.keys(params).some(k=>!['q','offset','limit'].includes(k)))throw new Error(semanticErrors[7]);
 const q=params.q??'',offset=Number(params.offset??0),limit=Number(params.limit??20);
 if(typeof q!=='string'||q.length>200||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error(semanticErrors[7]);
 const where="json_extract(payload,'$.origin')='material-event-review' AND json_extract(payload,'$.status')='active' AND instr(lower(json_extract(payload,'$.title')),lower(?))>0";
 const total=db.prepare(`SELECT count(*) n FROM research_topics WHERE ${where}`).get(q.trim()).n;
 const rows=db.prepare(`SELECT id,payload FROM research_topics WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(q.trim(),limit,offset);
 const items=rows.map(row=>{const t=JSON.parse(row.payload);try{return {...comparisonSummary(eventComparisonSnapshot(db,{id:t.id,revision:1})),selectable:true};}catch{return {kind:'event',id:t.id,revision:1,title:t.title,selectable:false,unavailableReason:semanticErrors[11]};}});
 return {items,total,offset,limit};
}
