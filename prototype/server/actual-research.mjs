import {hash} from './providers.mjs';
import {holdingResearchLinks} from './holding-research.mjs';
import {researchActionLabel} from '../shared/research-action.mjs';
import {RESEARCH_CONDITION_FIELDS} from '../shared/research-conditions.mjs';
import {evidenceStamp} from '../shared/review-state.mjs';
import {valuationResult} from '../shared/research-financials.mjs';

const ENGINE='actual-holding-research/1',digest=v=>hash(JSON.stringify(v));
const same=(a,b)=>!!a&&!!b&&['kind','id','runId','version'].every(k=>a[k]===b[k]);
const instant=v=>Number.isFinite(Date.parse(v));
// A pooled real holding may have several recorded research origins. Never pick
// one of them by symbol, most recent date or array order.
export function actualResearchOrigins(record){
 const values=record.accountingOrigin==='actual-ledger'?record.bindings:[[record.topicId,record.topicVersion]];
 if(!Array.isArray(values)||!values.length)return [{topicId:null,version:null}];
 return [...new Map(values.map(v=>{
  const valid=Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&v[0]&&Number.isSafeInteger(v[1])&&v[1]>0;
  const origin=valid?{topicId:v[0],version:v[1]}:{topicId:null,version:null};return [JSON.stringify(origin),origin];
 })).values()];
}
// Only the immutable original references and verified event relations determine
// monitoring. This projection cannot change an account, position or order.
export function projectActualResearch(record,topics,context={},at){
 const byId=new Map(topics.map(t=>[t.id,t])),baselines=[];
 const origins=actualResearchOrigins(record).map(o=>{
  let baseline=null;try{baseline=o.topicId?context.getTopicVersion?.(o.topicId,o.version):null;}catch{}
  if(baseline?.id!==o.topicId||baseline?.version!==o.version||!baseline?.companies?.some(c=>c.symbol===record.symbol))baseline=null;
  baselines.push(baseline);
  return {...o,title:baseline?.title||byId.get(o.topicId)?.title||'未绑定原研究',baselineAvailable:!!baseline};
 });
 const links=holdingResearchLinks({lots:origins.map((o,i)=>({id:`${record.id}:${i}`,topicId:o.topicId,topicVersion:o.version,symbol:record.symbol}))},context);
 const known=origins.every(o=>o.topicId&&o.baselineAvailable),currents=links.map(l=>l.current),unique=currents.length>0&&currents.every(c=>same(c,currents[0]));
 const linked=known&&unique&&links.every(l=>l.status==='current');
 const current=known&&unique?currents[0]:null;
 const subject=current?(context.subjects||[]).find(s=>same(s,current)):null;
 const reason=!origins.every(o=>o.topicId)?'持仓含未绑定研究的记录；不猜测建仓依据':!known?'原研究历史无法完整核对，后台保留观察':!unique&&origins.length>1?'这项持仓关联不同或尚未核对的研究，不能合成一个退出判断':!linked?links.find(l=>l.status!=='current')?.reason||'等待可核对的当前研究':origins.length>1?'全部原始关联已核对到同一当前研究；数量与成本保留':links[0].reason;
 const link={engine:ENGINE,recordId:record.id,recordVersion:record.version,status:linked?'current':'waiting',current,topicId:current?(current.kind==='event-cluster'?`event-cluster:${current.id}`:current.id):null,reason,origins,links};
 const assessment=subject?.ready?subject.assessments?.find(a=>a.symbol===record.symbol):null;
 const action=linked?(context.researchActions||[]).find(a=>a.symbol===record.symbol&&same(a.subject,current))||null:null;
 const conditions=Object.entries(RESEARCH_CONDITION_FIELDS).map(([key,label])=>{
  const matched=(context.researchChecks||[]).filter(c=>c.group===key&&c.symbol===record.symbol&&same(c.subject,current)),c=matched.length===1?matched[0]:null,age=Date.parse(at)-Date.parse(c?.checkedAt);
  const valid=linked&&c?.current&&Number.isFinite(age)&&age>=0&&age<=120000;
  return {key,label,current:!!valid,status:valid?c.status:'unknown',reason:valid?c.reason:!linked?reason:c?.reason||'等待后台检查',checkedAt:c?.checkedAt||null,definition:assessment?.monitoring?.[key]||null,results:c?.details?.results||[],analysis:assessment?.analysis?.[key]||null,active:!!c?.active,lastStatus:c?.lastStatus??null,lastTodoId:c?.lastTodoId||null};
 });
 const recommendation=assessment?.recommendation;
 const currentJudgment=linked&&action&&!['historical','unknown'].includes(action.state);
 const judgement=linked?researchActionLabel(action,{holding:true}):'当前判断待更新';
 const deadlines=[{kind:'recommendation',value:recommendation?.validUntil},{kind:'horizon',value:recommendation?.holdingHorizon?.status==='defined'?recommendation.holdingHorizon.until:null}].filter(d=>d.value);
 const due=deadlines.filter(d=>instant(d.value)&&Date.parse(d.value)<=Date.parse(at));
 const evidenceKey=(e,topicId)=>JSON.stringify([e.materialId?['material',e.materialId]:e.newsId?['news',e.newsId]:[e.memberTopicId||topicId,e.originalEvidenceId||e.id],evidenceStamp({...e,id:e.originalEvidenceId||e.id}),e.materialRevision??null]);
 const old=new Set(baselines.flatMap((b,i)=>(b?.evidence||[]).map(e=>evidenceKey(e,origins[i].topicId))));
 const against=linked?(subject.current?.evidence||[]).filter(e=>e.stance==='against'&&!old.has(evidenceKey(e,current.kind==='research'?current.id:null))).map(e=>({id:e.id,claim:e.claim,verification:e.verification,stamp:evidenceKey(e,current.kind==='research'?current.id:null)})):[];
 const contextHash=digest([ENGINE,link,subject?{ready:subject.ready,fresh:subject.fresh,changed:subject.changed,current:subject.current}:null,baselines.map(b=>b?digest(b):null),action?[action.state,action.action,action.reasons]:null,conditions.map(c=>[c.key,c.current,c.status,c.active,c.lastTodoId]),due]);
 const exitCondition=conditions.find(c=>c.key==='exitCondition');
 const scheduled=[action?.judgment?.businessReview,action?.judgment?.watchReview].filter(Boolean).sort((a,b)=>Date.parse(a.nextReviewAt)-Date.parse(b.nextReviewAt))[0],validUntil=instant(recommendation?.validUntil)?recommendation.validUntil:null;
 const review=scheduled&&(!validUntil||Date.parse(scheduled.nextReviewAt)<=Date.parse(validUntil))?{at:scheduled.nextReviewAt,policy:scheduled.policy}:{at:validUntil};
 return {engine:ENGINE,contextHash,link,currentBinding:current,origins,title:subject?.title||'当前研究待形成',judgement,action,conditions,against,deadlines,due,
  exitAdvice:{state:currentJudgment&&['reduce','exit'].includes(action.action)&&action.state==='conditional'?'review':currentJudgment&&['watch','buy','hold'].includes(action.action)?'monitor':'waiting',label:currentJudgment&&['reduce','exit'].includes(action.action)?action.action==='exit'?'研究建议评估退出':'研究建议评估减仓':currentJudgment?'继续跟踪条件':'等待有效判断',reason:currentJudgment?recommendation.reason:!linked?reason:action?.reasons?.join('；')||'尚无可核对的行动倾向',quantity:null,limitPrice:null,executable:false},
  trigger:currentJudgment?recommendation.reason:null,invalidation:currentJudgment?assessment.analysis?.invalidation?.text||null:null,
  reviewAt:linked?review.at:null,
  ...(linked&&review.policy?{reviewPolicy:review.policy}:{}),
  holdingHorizon:linked&&recommendation?.holdingHorizon?.status==='defined'?recommendation.holdingHorizon.reason:null,
  horizonAt:linked&&recommendation?.holdingHorizon?.status==='defined'?recommendation.holdingHorizon.until:null,
  valuation:currentJudgment&&Date.parse(assessment?.financials?.valuation?.horizonAt)>Date.parse(at)?valuationResult(assessment.financials):null,
  risks:[...(!linked?[reason]:[]),...(action?.state==='historical'?action.reasons:[]),...(due.length?['当前判断或持有复核窗口已到期，等待新版研判']:[]),...(exitCondition.current&&exitCondition.status==='true'?['当前研究的减仓 / 退出条件已触发']:[])]};
}
