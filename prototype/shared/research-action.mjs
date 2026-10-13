import {businessReviewSchedule} from './business-facts.mjs';
import {isWatchResearch,watchReviewSchedule} from './research-watch.mjs';
import {COMPANY_ANALYSIS_FIELDS} from './company-directory.mjs';
export const RESEARCH_ACTION_VERSION='research-action/1';
export const RESEARCH_ACTIONS={unknown:'暂不能判断',watch:'继续观察',buy:'考虑买入',hold:'有持仓时考虑继续持有',reduce:'有持仓时考虑减仓',exit:'有持仓时考虑退出'};
export const RESEARCH_ACTION_STATES={historical:'仅供历史参考',unknown:'尚不能形成行动倾向',observing:'继续观察',holding:'持有倾向仍需持仓核对',waiting:'等待研究条件',conditional:'研究条件已满足'};

export function researchActionLabel(state,{holding=false}={}){
 if(!state)return '当前判断待更新';
 if(state.state==='unknown')return '尚不能形成行动倾向';
 if(state.state==='historical')return '原判断待更新 · 仅供历史参考';
 const label=holding&&state.action==='buy'?'考虑买入，已有持仓继续跟踪':RESEARCH_ACTIONS[state.action]||RESEARCH_ACTIONS.unknown;
 return state.state==='waiting'?`${label} · 等待研究条件`:label;
}

// This projection is upstream of account sizing and execution. Business impact,
// valuation and condition hits must never substitute for explicit intent.
export function researchActionReadiness(assessment,{subject,checks=[],at}={}){
 const value=assessment.recommendation,watch=isWatchResearch(value),schedule=subject?.automaticReview?watchReviewSchedule(value,subject?.preparedAt,at):null,business=subject?.automaticReview?businessReviewSchedule(assessment,subject?.preparedAt,at):null,base={version:RESEARCH_ACTION_VERSION,symbol:assessment.symbol,action:value?.action||'unknown',checkedAt:at,executable:false,semanticVerified:false,
  judgment:subject?.ready&&(value?.version===RESEARCH_ACTION_VERSION||watch)?{reason:value.reason,validUntil:value.validUntil,holdingHorizon:value.holdingHorizon,...(schedule?{watchReview:schedule}:{}),...(business?{businessReview:business}:{}),invalidation:assessment.analysis?.invalidation?.text||null,countercase:assessment.analysis?.countercase?.text||null}:null};
 const result=(state,reasons)=>({...base,state,reasons});
 if(!value)return result('unknown',['此历史协议未保存行动倾向；不从影响方向或旧文字推导买卖。']);
 if((value.version!==RESEARCH_ACTION_VERSION&&!watch)||!Object.hasOwn(RESEARCH_ACTIONS,value.action))return result('unknown',['保存的行动倾向无法核对。']);
 const now=Date.parse(at),prepared=Date.parse(subject?.preparedAt);
 if(!Number.isFinite(now)||!Number.isFinite(prepared)||prepared>now)return result('historical',['当前检查或保存研判的可用时间无法核对。']);
 if(!subject?.ready||!subject.fresh||subject.changed||subject.current?.status!=='active'||!subject.current.companies?.some(c=>c.symbol===assessment.symbol))return result('historical',[subject?.reason||'当前研究依据无法核对。']);
 if(value.action==='unknown')return result('unknown',[value.reason]);
 if(watch)return result('observing',[value.reason,!schedule?'此记录未纳入后台自动观察复核，仍只表示有依据的观察判断；买卖期限未知。':schedule.due?'已到后台每日复核时点，按原任务和调用额度等待接续；不表示出现买卖信号。':'后台按保存后24小时的系统节奏复核；不是交易有效期或预计卖出日。']);
 if(!Number.isFinite(Date.parse(value.validUntil))||Date.parse(value.validUntil)<=now)return result('historical',['行动倾向的复核期限已到，等待后台形成新版判断。']);
 if(value.action==='watch')return result('observing',[value.reason]);
 const reasons=[],required=value.action==='buy'?['entryCondition','exitCondition','invalidation','nextCheck']:value.action==='hold'?['exitCondition','invalidation','nextCheck']:['exitCondition','nextCheck'];
 const current={};
 if(['buy','hold'].includes(value.action))for(const key of ['impactMechanism','businessExposure','magnitudeBasis','pricedIn','duration','countercase']){
  const d=assessment.analysis?.[key];
  if(!d||!['source','inference'].includes(d.basis)||!d.citations?.length)reasons.push(COMPANY_ANALYSIS_FIELDS[key]+'仍缺少有引用的判断。');
 }
 for(const key of required){
  const label={entryCondition:'进入',exitCondition:'退出',invalidation:'失效',nextCheck:'复核'}[key],g=assessment.monitoring?.[key];
  if(g?.status!=='defined'){reasons.push(label+'条件尚不能自动判断。');continue;}
  // A different run, security or composite cannot lend its trigger to this one.
  const matches=checks.filter(c=>c.symbol===assessment.symbol&&c.group===key&&c.subject.kind===subject.kind&&c.subject.id===subject.id&&c.subject.runId===subject.runId&&c.subject.version===subject.version),c=matches.length===1?matches[0]:null,age=now-Date.parse(c?.checkedAt);
  if(!c?.current||!Number.isFinite(age)||age<0||age>120000||!['true','false'].includes(c.status)){reasons.push(label+'条件没有当前有效的后台检查。');continue;}
  current[key]=c.status;
 }
 if(value.action==='buy'){
  if(assessment.financials?.valuation?.status!=='defined'||Date.parse(assessment.financials.valuation.horizonAt)<=now||!Number.isFinite(Date.parse(assessment.financials?.valuation?.horizonAt)))reasons.push('缺少仍在窗口内的估值情景。');
  if(value.holdingHorizon?.status!=='defined'||Date.parse(value.holdingHorizon.until)<=now||!Number.isFinite(Date.parse(value.holdingHorizon?.until)))reasons.push('持有复核窗口尚不明确或已经到期。');
  if(current.entryCondition==='false')reasons.push('进入条件尚未满足。');
 }
 if(value.action==='hold'&&value.holdingHorizon?.status==='defined'&&(!Number.isFinite(Date.parse(value.holdingHorizon.until))||Date.parse(value.holdingHorizon.until)<=now))reasons.push('持有复核窗口已经到期，等待新版判断。');
 if(['buy','hold'].includes(value.action)){
  if(current.exitCondition==='true')reasons.push('退出条件已触发，需要重新研判。');
  if(current.invalidation==='true')reasons.push('原判断的失效条件已触发，需要重新研判。');
 }
 if(['reduce','exit'].includes(value.action)&&current.exitCondition==='false')reasons.push('退出条件尚未满足；不因利空或反证自行卖出。');
 if(current.nextCheck==='true')reasons.push('本版复核条件已触发，等待新版判断。');
 if(reasons.length)return result('waiting',reasons);
 if(value.action==='hold')return result('holding',['这是对已有持仓的研究倾向；仍需核对对应批次、成本与当前风险。']);
 return result('conditional',['研究层条件已满足；对应账户仍须核对分配、持仓、行情、费用与有效期，完整方案在原首页和组合页查看，最后由本人决定。']);
}
