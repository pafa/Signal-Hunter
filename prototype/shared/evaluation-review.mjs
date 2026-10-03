export const evaluationVerdicts={major:'重大候选',ordinary:'普通资讯',unclear:'信息不足'};
export const evaluationErrors=['评估批次参数无效','评估批次不存在','评估批次版本已变化，请刷新','评估批次已经封存，不能改写标签','评估窗口没有样本','窗口样本超过5000条，请缩短时间窗口','评估标签或事件簇说明无效','请完成全部样本标注，信息不足也须说明','评估请求标识重复或无效','恢复副本需先完成核对确认','请先完成封存，再查看规则结果和统计','评估来源指纹校验失败'];
export const EVALUATION_METRICS_VERSION='research-evaluation/1';

// One label contract for retrospective cohorts and frozen forward inputs.
export function validateEvaluationLabel(l){
 const text=(x,n=1200)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
 const fail=()=>{throw new Error(evaluationErrors[6]);};
 if(!l||!Object.hasOwn(evaluationVerdicts,l.verdict)||!['unseen-attested','already-seen'].includes(l.exposure)||!text(l.reviewer,100)||!text(l.reason)||typeof l.clusterId!=='string'||l.clusterId.length>100||l.clusterId.trim()&&!/^[a-zA-Z0-9_-]+$/.test(l.clusterId.trim()))fail();
 const fields={};for(const k of ['novelty','scale','mechanism']){if(typeof l[k]!=='string'||l[k].length>1200||l.verdict==='major'&&!l[k].trim())fail();fields[k]=l[k].trim();}
 return {...fields,verdict:l.verdict,clusterId:l.clusterId.trim()||null,reviewer:l.reviewer.trim(),reason:l.reason.trim(),exposure:l.exposure};
}
