// This capability is passed by the internal queue, never deserialized from HTTP.
// Provenance distinguishes system judgments from the user's final decisions.
export const SYSTEM_RESEARCH_ACTOR = Object.freeze({kind:'system',policy:'automatic-research/1'});
export function researchActor(actor){
 if(actor===undefined)return {};
 if(actor!==SYSTEM_RESEARCH_ACTOR)throw new Error('研究处理来源无效');
 return {actor:SYSTEM_RESEARCH_ACTOR};
}

// Read-only ownership survives retries because attempts are append-only. The
// expression is supplied only by internal SQL projections, never by a request.
export function automaticRunPredicate(expression){
 return `EXISTS(SELECT 1 FROM research_pipeline_attempts a WHERE a.run_id=${expression} AND (
  EXISTS(SELECT 1 FROM research_pipeline_event_jobs j WHERE j.id=a.item_id AND json_extract(j.payload,'$.automatic')=1) OR
  EXISTS(SELECT 1 FROM research_pipeline_relations j WHERE j.id=a.item_id AND json_extract(j.payload,'$.automatic')=1) OR
  EXISTS(SELECT 1 FROM research_pipeline_cluster_jobs j WHERE j.id=a.item_id AND json_extract(j.payload,'$.automatic')=1) OR
  EXISTS(SELECT 1 FROM event_cluster_research j WHERE j.id=a.item_id AND json_extract(j.payload,'$.automatic')=1)))`;
}
