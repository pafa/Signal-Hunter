import {BUSINESS_FACT_CONTRACT} from './business-facts.mjs';
export const RESEARCH_CAPABILITY_REVIEW='research-business-capability/1';
// A narrowly identified missing representation, not permission to reopen every
// old result, failed model run, or unknown without source-backed prerequisites.
export function researchCapabilityReview(assessment,protocols={}){
 if(protocols.businessFactContract!==undefined)return null;
 const conditions=Object.entries(assessment?.monitoring||{}).filter(([key,g])=>g.status==='unknown'&&['source','inference'].includes(assessment.analysis?.[key]?.basis)&&assessment.analysis[key].citations?.some(c=>c.field==='body')).map(([group,definition])=>({group,definition,analysis:assessment.analysis[group]}));
 if(!conditions.length)return null;
 return {policy:RESEARCH_CAPABILITY_REVIEW,from:null,to:BUSINESS_FACT_CONTRACT,symbol:assessment.symbol,conditions};
}
export function validCapabilityReviewTrigger(trigger,assessment,protocols){
 const proof=researchCapabilityReview(assessment,protocols);
 return !!proof&&trigger.kind==='capability'&&trigger.group==='businessRepresentation'&&trigger.symbol===assessment.symbol&&trigger.policy===RESEARCH_CAPABILITY_REVIEW&&JSON.stringify(trigger.proof)===JSON.stringify(proof);
}
