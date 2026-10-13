import {MATERIALITY_ID_PATTERN,MATERIALITY_TEXT_LIMITS} from '../shared/company-materiality.mjs';

// Generation metadata, not a change to the frozen evidence/input hash.
export const RESEARCH_OUTPUT_CONTRACT='research-output-contract/2';
export const RESEARCH_OUTPUT_CONTRACTS=['research-output-contract/1',RESEARCH_OUTPUT_CONTRACT];
// Describes generation wording only. Adoption authority remains with the queue
// and SYSTEM_RESEARCH_ACTOR; this marker never approves a trade or a model run.
export const AUTOMATIC_RESEARCH_WORKFLOW='automatic-research-wording/1';
export const automaticResearchPacket=packet=>({...packet,researchWorkflow:AUTOMATIC_RESEARCH_WORKFLOW});
export function useStoredResearchWorkflow(packet,stored){
 const result={...packet};
 if(Object.hasOwn(stored,'researchWorkflow'))result.researchWorkflow=stored.researchWorkflow;
 else delete result.researchWorkflow;
 return result;
}
export function useStoredOutputContract(packet,stored){
 const result=useStoredResearchWorkflow(packet,stored);
 if(Object.hasOwn(stored,'businessFactContract'))result.businessFactContract=stored.businessFactContract;
 else delete result.businessFactContract;
 if(Object.hasOwn(stored,'watchReviewContract'))result.watchReviewContract=stored.watchReviewContract;
 else delete result.watchReviewContract;
 if(Object.hasOwn(stored,'outputContract'))result.outputContract=stored.outputContract;
 else delete result.outputContract;
 return result;
}
export function constrainFinancialMetricSchema(financials){
 if(!financials)return;
 const fields=financials.properties.metrics.items.properties;
 fields.id={type:'string',pattern:MATERIALITY_ID_PATTERN};
 for(const [key,maxLength] of Object.entries(MATERIALITY_TEXT_LIMITS))fields[key]={type:'string',minLength:1,maxLength,pattern:'\\S'};
 fields.comparable={type:'boolean',enum:[true]};
}
export const FINANCIAL_METRIC_FORMAT_INSTRUCTIONS=`财务metrics沿用原量级字段约束：id必须在本证券内唯一，只能使用1至80位英文字母、数字或连字符，例如background-revenue；不能使用下划线、空格或中文作为id。label、scope、period、unit、basis均须非空，分别最多120、200、160、80、1200字符。这些是记录格式，不改变原文、财务值、单位、期间、引用或事实判断；标识符合法不等于财务语义已核实。不得删除有依据的指标来规避格式要求。\n`;
