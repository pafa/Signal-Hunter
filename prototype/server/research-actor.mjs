// This capability is passed by the internal queue, never deserialized from HTTP.
// Provenance distinguishes system judgments from the user's final decisions.
export const SYSTEM_RESEARCH_ACTOR = Object.freeze({kind:'system',policy:'automatic-research/1'});
export function researchActor(actor){
 if(actor===undefined)return {};
 if(actor!==SYSTEM_RESEARCH_ACTOR)throw new Error('研究处理来源无效');
 return {actor:SYSTEM_RESEARCH_ACTOR};
}
