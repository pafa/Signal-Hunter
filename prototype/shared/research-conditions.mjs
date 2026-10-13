import {BUSINESS_FACT_VERDICTS} from './business-facts.mjs';
export const RESEARCH_CONDITION_FIELDS={entryCondition:'进入观察',exitCondition:'减仓 / 退出观察',invalidation:'判断失效',nextCheck:'后续复核'};
export const RESEARCH_CONDITION_TYPES={price:'价格条件',at:'复核时间','research-change':'研究版本变化',counterevidence:'新增或修订反证'};
export function describeResearchCondition(c){
 if(c.type==='business-fact')return `业务事实：${c.claim} · ${BUSINESS_FACT_VERDICTS[c.verdict]||'仍待核对'}`;
 if(c.type==='price')return `${c.interval==='1m'?'分钟':'日线'}观察价 ${c.operator==='gte'?'≥':'≤'} ${c.value}（证券原币）`;
 if(c.type==='at')return `到达 ${c.at}`;
 return RESEARCH_CONDITION_TYPES[c.type]||'未知条件';
}
