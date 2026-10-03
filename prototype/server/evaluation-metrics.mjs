import {claimsOf} from '../shared/claims.mjs';
import {evaluationTime,outcomeLabel} from '../shared/evaluation.mjs';
import {EVALUATION_METRICS_VERSION} from '../shared/evaluation-review.mjs';
const ratio=(a,b)=>b?a/b:null;
const probability=p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=100;
function confusion(rows){
 const counts={tp:0,fp:0,fn:0,tn:0};
 for(const r of rows)counts[r.predicted?(r.label==='major'?'tp':'fp'):(r.label==='major'?'fn':'tn')]++;
 return {...counts,n:rows.length,precision:ratio(counts.tp,counts.tp+counts.fp),recallWithinCohort:ratio(counts.tp,counts.tp+counts.fn),accuracy:ratio(counts.tp+counts.tn,rows.length)};
}
export function screeningMetrics(samples,labels){
 const rows=samples.map(s=>{const l=labels[s.id];return {sampleId:s.id,newsId:s.input.id,decisionAt:s.decisionAt,predicted:['review','quiet','clue'].includes(s.triage.bucket)?s.triage.bucket==='review':null,label:l?.verdict||null,clusterId:l?.clusterId||null,exposure:l?.exposure||null};});
 const known=rows.filter(r=>['major','ordinary'].includes(r.label)&&r.predicted!==null),groups=new Map();
 // The representative is fixed by prediction time and id, never chosen by label or success.
 for(const r of rows.filter(r=>r.clusterId).sort((a,b)=>Date.parse(a.decisionAt)-Date.parse(b.decisionAt)||a.sampleId.localeCompare(b.sampleId))){if(!groups.has(r.clusterId))groups.set(r.clusterId,[]);groups.get(r.clusterId).push(r);}
 const representatives=[...groups.values()].map(g=>g[0]),clusterKnown=representatives.filter(r=>['major','ordinary'].includes(r.label)&&r.predicted!==null);
 return {total:rows.length,unknownPrediction:rows.filter(r=>r.predicted===null).length,reviewed:rows.filter(r=>r.label).length,unclear:rows.filter(r=>r.label==='unclear').length,unreviewed:rows.filter(r=>!r.label).length,unknownCluster:rows.filter(r=>!r.clusterId).length,unseenAttested:rows.filter(r=>r.exposure==='unseen-attested').length,alreadySeen:rows.filter(r=>r.exposure==='already-seen').length,raw:confusion(known),clusterCount:groups.size,clusterRepresentatives:confusion(clusterKnown),clusterUnclear:representatives.length-clusterKnown.length,duplicateClusterSamples:rows.filter(r=>r.clusterId).length-groups.size,representativeIds:representatives.map(r=>r.sampleId),rows,scope:'冻结窗口内已保存的标题初筛样本；召回率仅限此样本集，不是全部新闻或独立来源覆盖率',independentValidation:false};
}
function aggregate(cases,key){
 const scored=cases.filter(c=>c[key]!==null),bins=Array.from({length:5},(_,i)=>({lower:i/5,upper:(i+1)/5,n:0,probabilityTotal:0,outcomeTotal:0}));
 for(const c of scored){const p=c[key]/100,b=bins[Math.min(4,Math.floor(p*5))];b.n++;b.probabilityTotal+=p;b.outcomeTotal+=c.label;}
 return {n:scored.length,brier:scored.length?scored.reduce((sum,c)=>sum+(c[key]/100-c.label)**2,0)/scored.length:null,bins:bins.map(b=>({lower:b.lower,upper:b.upper,n:b.n,meanProbability:ratio(b.probabilityTotal,b.n),observedFrequency:ratio(b.outcomeTotal,b.n)}))};
}
export function claimMetrics(versions,asOf){
 const byTopic=new Map(),cases=[];
 for(const row of versions){if(evaluationTime(row.recorded_at)===null||Date.parse(row.recorded_at)>Date.parse(asOf))continue;const topic=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;if(!byTopic.has(row.topic_id))byTopic.set(row.topic_id,[]);byTopic.get(row.topic_id).push({topic,at:row.recorded_at,version:row.version});}
 for(const [topicId,history] of byTopic){
  history.sort((a,b)=>a.version-b.version);const current=history.at(-1).topic;
  for(const c of claimsOf(current)){
   const row={topicId,claimId:c.id,claim:c.claim,kind:c.kind,outcome:c.outcome,first:null,last:null,label:null,reason:null};
   const timeline=history.map(h=>({...h,claim:claimsOf(h.topic).find(x=>x.id===c.id)})).filter(h=>h.claim);
   const mature=outcomeLabel(c,{now:asOf});
   if(!mature.mature){row.reason='结局未成熟或缺少有效依据';cases.push(row);continue;}
   if(!c.evidenceIds.every(id=>{const e=(current.evidence||[]).find(e=>e.id===id),at=evaluationTime(e?.availableAt||e?.firstSeen);return at!==null&&at<=Date.parse(c.resolvedAt);})){row.reason='结局证据可用时间缺失或晚于结局';cases.push(row);continue;}
   if(timeline.some(h=>h.claim.claim!==c.claim||h.claim.kind!==c.kind||h.claim.resolveBy!==c.resolveBy)){row.reason='主张身份或截止日跨版本变化';cases.push(row);continue;}
   const firstOutcome=timeline.find(h=>['true','false','partial'].includes(h.claim.outcome));
   const firstResolved=evaluationTime(firstOutcome?.claim.resolvedAt);
   const cutoff=Math.min(Date.parse(c.resolvedAt),firstOutcome?Date.parse(firstOutcome.at):Infinity,firstResolved===null?Infinity:firstResolved);
   const before=timeline.filter(h=>{const at=evaluationTime(h.claim.assessedAt||h.claim.firstAssessedAt);return at!==null&&at<cutoff&&Date.parse(h.at)<cutoff&&!['true','false','partial'].includes(h.claim.outcome);});
   const first=timeline[0],last=before.filter(h=>probability(h.claim.probability)).at(-1);
   if(before.includes(first)&&probability(first.claim.probability))row.first=first.claim.probability;
   if(last)row.last=last.claim.probability;
   row.label=mature.label;row.reason=row.first===null&&row.last===null?'结局前没有可核验概率':null;cases.push(row);
  }
 }
 const paired=cases.filter(c=>c.first!==null&&c.last!==null),kinds=Object.fromEntries([...new Set(cases.map(c=>c.kind))].map(k=>[k,{first:aggregate(cases.filter(c=>c.kind===k),'first'),last:aggregate(cases.filter(c=>c.kind===k),'last')}]));
 return {total:cases.length,matureBinary:cases.filter(c=>c.label!==null).length,unscored:cases.filter(c=>c.first===null&&c.last===null).length,first:aggregate(cases,'first'),last:aggregate(cases,'last'),paired:{n:paired.length,first:aggregate(paired,'first').brier,last:aggregate(paired,'last').brier},kinds,cases,scope:'主张级描述统计；结局时间是人工登记时间，未核验事件实际发生时间；同主题或跨主题主张可能相关，未证明独立事件或样本外校准'};
}
export function evaluateBatch(batch,labels,at){return {metricsVersion:EVALUATION_METRICS_VERSION,asOf:batch.frozenAt,sealedAt:at,inputHash:batch.inputHash,rulesHash:batch.rulesHash,sourceHash:batch.sourceHash,screening:screeningMetrics(batch.samples,labels),claims:claimMetrics(batch.claimVersions,batch.frozenAt),priceChanges:{available:false,reason:'未配置固定观察窗口和经核验价格基准，不用场景价填充'},trading:{available:false,reason:'模拟账本独立；本报告不把标题后上涨或场景收益当作成交收益'},forwardEligible:false,limitations:['回溯诊断批次；不是前向独立验证','隐藏规则只减少界面提示，不能证明评审者从未见过结果','事件簇由人工标注；重复簇只使用最早判断样本作为代表','标签与结局均需人工核验，未成熟/未知项目保留且不填零']};}
