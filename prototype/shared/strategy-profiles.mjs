// Proposed paper-research parameters, not empirically optimized or return promises.
export const STRATEGY_PROFILE_VERSION='two-sleeves/2026-10-02';
export const strategyProfiles={
 aggressive:{id:'aggressive',version:STRATEGY_PROFILE_VERSION,name:'激进热点池',allocationUSD:500000,entry:'cn-main-board-limit-up',description:'先限A股主板普通股涨停；需要涨停价、可卖盘和排队后可成交数量。',suggestedConfig:{issuerCapPct:10,themeCapPct:25,cashFloorPct:40,feeBps:10,slippageBps:5,maxHoldDays:10,maxOrderMinutes:15,quoteMaxAgeSeconds:30,allowOvernight:true},risk:{hardStopPct:5,trailingArmPct:8,trailingDrawdownPct:4,poolWarningPct:6,poolStopPct:10},initialPositionPct:5},
 steady:{id:'steady',version:STRATEGY_PROFILE_VERSION,name:'稳健长期池',allocationUSD:500000,entry:'fundamental-long-only',description:'分散、低换手、基于研究的长期持有；不复制热点追板交易。',suggestedConfig:{issuerCapPct:12,themeCapPct:25,cashFloorPct:20,feeBps:10,slippageBps:5,maxHoldDays:365,maxOrderMinutes:60,quoteMaxAgeSeconds:60,allowOvernight:true},risk:{hardStopPct:12,trailingArmPct:20,trailingDrawdownPct:8,poolWarningPct:10,poolStopPct:15},initialPositionPct:6}
};
