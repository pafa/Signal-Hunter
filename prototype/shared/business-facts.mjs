// Source-based model judgments remain distinct from independently verified facts.
export const BUSINESS_FACT_CONTRACT='research-business-facts/1';
export const BUSINESS_FACT_INTERVAL_MS=86400000;
export const BUSINESS_FACT_VERDICTS={supported:'本版资料支持',contradicted:'本版资料反驳',unknown:'仍待核对'};
export const businessFacts=a=>Object.entries(a?.monitoring||{}).flatMap(([group,g])=>(g.conditions||[]).filter(c=>c.type==='business-fact').map(c=>({symbol:a.symbol,group,join:g.join,...c})));
export const hasBusinessFacts=a=>businessFacts(a).length>0;
export const businessFactTargets=assessments=>(assessments||[]).flatMap(a=>businessFacts(a).map(({symbol,group,join,claim})=>({symbol,group,join,claim})));
export const conditionSignal=c=>c.type==='business-fact'?{type:c.type,claim:c.claim}:c;
export function businessReviewSchedule(a,preparedAt,at){
 const saved=Date.parse(preparedAt),now=Date.parse(at),due=saved+BUSINESS_FACT_INTERVAL_MS;
 if(!hasBusinessFacts(a)||!Number.isFinite(saved)||!Number.isFinite(now)||saved>now||!Number.isFinite(new Date(due).getTime()))return null;
 return {policy:BUSINESS_FACT_CONTRACT,preparedAt,nextReviewAt:new Date(due).toISOString(),intervalMs:BUSINESS_FACT_INTERVAL_MS,due:due<=now};
}
