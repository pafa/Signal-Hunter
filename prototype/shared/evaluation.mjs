// Eligibility only: this does not score returns or claim a calibrated probability.
export const EVALUATION_VERSION='forward-research/0.2.0';
export const FORWARD_START='2026-09-26T00:00:00+08:00';
export const LABELS=['major','ordinary','unclear','false-positive','missed','no-signal','rejected','expired','unfilled','loss'];
export function evaluationTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const at=Date.parse(value),day=Date.parse(value.slice(0,10)+'T12:00:00Z');
 return Number.isFinite(at)&&Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10)?at:null;
}
export function forwardEligibility(record,baseline){
 const reasons=[],time=evaluationTime;
 if(baseline.protocolVersion!==EVALUATION_VERSION)reasons.push('评估协议版本不匹配');
 if(record.origin!=='forward-capture')reasons.push('非前向首次采集');
 if(!record.clusterId||!record.clusterReviewedAt)reasons.push('事件簇身份尚未人工核验');
 if(!Array.isArray(baseline.excludedTopicIds)||!Array.isArray(baseline.excludedClusterIds))reasons.push('缺少冻结的排除样本清单');
 else if(baseline.excludedTopicIds.includes(record.topicId)||baseline.excludedClusterIds.includes(record.clusterId))reasons.push('已见开发样本或同一事件簇');
 const seen=time(record.firstSeen),available=time(record.availableAt),decided=time(record.decisionAt),start=time(baseline.forwardStart);
 const frozen=time(baseline.frozenAt);
 if(frozen===null||start===null||frozen>start)reasons.push('基线冻结或前向开始时间无效');
 if(start===null||seen===null||seen<start||frozen===null||seen<frozen)reasons.push('首次获取早于留出窗口或缺失');
 if(available===null||decided===null||seen===null||available>decided||seen>available)reasons.push('无法证明判断时已可用');
 if(time(record.clusterReviewedAt)===null||time(record.clusterReviewedAt)>decided)reasons.push('簇核验未在判断前冻结');
 if(!record.inputHash||record.rulesHash!==baseline.rulesHash)reasons.push('输入快照或固定基线指纹缺失 / 不一致');
 return {eligible:reasons.length===0,reasons};
}
export function outcomeLabel(claim,{now=new Date().toISOString()}={}){
 const resolved=evaluationTime(claim.resolvedAt),at=evaluationTime(now),forecast=claim.firstAssessedAt===undefined?null:evaluationTime(claim.firstAssessedAt);
 if(!['true','false'].includes(claim.outcome)||!Array.isArray(claim.evidenceIds)||!claim.evidenceIds.length||typeof claim.resolutionReason!=='string'||!claim.resolutionReason.trim()||resolved===null||at===null||resolved>at||claim.firstAssessedAt!==undefined&&(forecast===null||forecast>resolved))return {mature:false,label:null,reason:'未解决、部分兑现、结局依据或时间顺序无效，单列留存'};
 return {mature:true,label:claim.outcome==='true'?1:0,reason:'人工结局；仍需复核，不能自动证明模型有效'};
}
