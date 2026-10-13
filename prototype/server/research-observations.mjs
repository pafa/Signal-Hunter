import {BUSINESS_FACT_INTERVAL_MS,BUSINESS_FACT_VERDICTS} from '../shared/business-facts.mjs';
import {hash} from './providers.mjs';
import {evaluateObservation,validateObservationDefinition,observationInstant} from './observation-rules.mjs';
import {validateResearchConditions} from './research-conditions.mjs';
import {RESEARCH_CONDITION_FIELDS} from '../shared/research-conditions.mjs';
import {evidenceStamp} from '../shared/review-state.mjs';
import {researchActionReadiness} from '../shared/research-action.mjs';

const ENGINE='research-condition-monitor/1',digest=v=>hash(JSON.stringify(v));
const stamp=e=>JSON.stringify([e.memberTopicId||null,e.originalEvidenceId||e.id,evidenceStamp({...e,id:e.originalEvidenceId||e.id}),e.materialRevision??null]);
const outcome=(state,reason,input={})=>({state,reason,input});
const identity=(s,symbol,key)=>digest([ENGINE,s.kind,s.id,s.runId,s.version,symbol,key]);
const unknown=reason=>({state:'unknown',reason,results:[]});

export function evaluateResearchCondition(subject,assessment,key,{at,quote,check,offline=false}={}){
 const group=assessment.monitoring[key];
 if(!subject.ready||!subject.baseline)return unknown(subject.reason);
 if(subject.preparedAt&&(observationInstant(subject.preparedAt)===null||Date.parse(subject.preparedAt)>Date.parse(at)))return unknown('保存研判的时间尚不可用');
 if(subject.current?.status!=='active'||!subject.current.companies?.some(c=>c.symbol===assessment.symbol))return unknown('研究已归档、当前输入不可用或证券关联已移除');
 if(group.status==='unknown')return unknown(group.reason);
 const results=group.conditions.map(c=>{
  if(c.type==='research-change')return outcome(subject.changed?'true':'false',subject.kind==='event-cluster'?'综合所依据的成员、来源或配置是否变化':'研究或来源版本变化',subject.kind==='event-cluster'?{baselineSynthesisVersion:subject.version,currentClusterVersion:subject.current.version,memberVersions:subject.current.memberVersions,reason:subject.reason}:{baselineVersion:subject.version,currentVersion:subject.current.version});
  if(c.type==='counterevidence'){
   const old=new Set(subject.baseline.evidence.map(stamp)),added=subject.current.evidence.filter(e=>e.stance==='against'&&!old.has(stamp(e)));
   return outcome(added.length?'true':'false','新增或修订的反向线索',{evidence:added.map(e=>({id:e.id,claim:e.claim,stamp:stamp(e),verification:e.verification}))});
  }
  if(!subject.fresh)return outcome('unknown',subject.reason);
  if(c.type==='business-fact'){
   const expired=!Number.isFinite(Date.parse(subject.preparedAt))||Date.parse(at)-Date.parse(subject.preparedAt)>=BUSINESS_FACT_INTERVAL_MS;
   return outcome(expired?'unknown':({supported:'true',contradicted:'false',unknown:'unknown'})[c.verdict],expired?'业务事实复核已到期，等待新一版资料判断':BUSINESS_FACT_VERDICTS[c.verdict]+'：'+c.reason,{businessFact:{claim:c.claim,verdict:c.verdict,reason:c.reason,citations:c.citations,preparedAt:subject.preparedAt,semanticVerified:false},executable:false});
  }
  const definition=validateObservationDefinition({label:'系统研究条件',join:'all',conditions:[c.type==='price'?{...c,symbol:assessment.symbol}:c]},subject.current);
  return evaluateObservation({definition,binding:{topicVersion:subject.version,counterevidence:[]}},subject.current,{at,quote,check,offline}).results[0];
 });
 const state=group.join==='all'?(results.some(r=>r.state==='false')?'false':results.every(r=>r.state==='true')?'true':'unknown'):(results.some(r=>r.state==='true')?'true':results.every(r=>r.state==='false')?'false':'unknown');
 return {state,reason:{true:'本组观察条件满足；需结合原研判复核',false:'本次尚未满足本组条件',unknown:'本组存在无法判断的条件'}[state],results};
}

export function openResearchObservations(store,{getSubjects=()=>[],priceEnabled=()=>true,offline=false}={}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS research_observation_states(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT id,payload FROM research_observation_states').all().map(r=>({id:r.id,...JSON.parse(r.payload)}));
 const save=(id,value)=>db.prepare('INSERT INTO research_observation_states VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(value));
 function candidates(subjects){return subjects.flatMap(s=>(s.assessments||[]).flatMap(a=>{
  if(!a.monitoring)return [];
  let valid=true;try{validateResearchConditions(a.monitoring,{symbol:a.symbol,analysis:a.analysis,businessFactContract:s.businessFactContract});}catch{valid=false;}
  return Object.keys(RESEARCH_CONDITION_FIELDS).map(key=>({id:identity(s,a.symbol,key),subject:s,assessment:a,key,valid}));
 }));}
 return {
  // Inbox transaction includes these states and the immutable emitted history.
  evaluate(topics,at){
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');
   if(observationInstant(at)===null)throw Error('观察检查时间无效');
   const previous=new Map(rows().map(r=>[r.id,r]));
   if([...previous.values()].some(r=>Date.parse(r.checkedAt)>Date.parse(at)))throw Error('观察检查时间无效');
   const checks=store.checks(),cache=new Map(),seen=new Set(),hits=[];
   const quote=(s,i)=>{if(!priceEnabled(s,i))return null;const key=i+s;if(!cache.has(key))cache.set(key,i==='1d'?store.daily(s):store.quote(s));return cache.get(key);};
   const subjects=getSubjects(topics);
   for(const c of candidates(subjects)){
    const {id,subject:s,assessment:a,key}=c,old=previous.get(id);seen.add(id);
    const result=c.valid?evaluateResearchCondition(s,a,key,{at,quote,check:(symbol,interval)=>checks[(interval==='1d'?'daily:':'')+symbol],offline}):unknown('保存的结构化条件无法核对');
    const subject={kind:s.kind,id:s.id,version:s.version,runId:s.runId,title:s.title};
    const details={engine:ENGINE,subject,symbol:a.symbol,group:key,definition:a.monitoring[key],analysis:a.analysis?.[key],baselineHash:s.baseline?digest(s.baseline):null,evaluatedAt:at,currentVersion:s.kind==='research'?s.current?.version??null:null,currentClusterVersion:s.kind==='event-cluster'?s.current?.version??null:null,basisReason:s.reason,results:result.results,synthetic:offline,executable:false};
    // Price ticks do not create new episodes. New research / counterevidence does.
    const signal=digest(result.results.filter((_,i)=>['research-change','counterevidence'].includes(a.monitoring[key]?.conditions?.[i]?.type)).map(r=>r.input));
    const state={subject,symbol:a.symbol,group:key,status:result.state,reason:result.reason,checkedAt:at,contextHash:digest([s.ready,s.fresh,s.changed,s.current]),active:old?.active||false,activeSignal:old?.activeSignal||null,episode:old?.episode||0,lastTodoId:old?.lastTodoId||null,lastHitAt:old?.lastHitAt||null,details:c.valid?details:old?.details||null};
    if(result.state==='true'&&(!old?.active||old.activeSignal!==signal)){
     state.episode++;state.active=true;state.activeSignal=signal;state.lastHitAt=at;state.lastTodoId=digest([id,state.episode,signal]);
     hits.push({id:state.lastTodoId,kind:'research-condition',topicId:s.kind==='research'?s.id:null,topicVersion:s.version,title:`${s.title} · ${a.symbol}`,reason:`${RESEARCH_CONDITION_FIELDS[key]}：${result.reason}`,symbols:[a.symbol],affectedPositions:[],input:{...details,episode:state.episode}});
    }else if(result.state==='false')state.active=false;
    save(id,state);
   }
   for(const [id,old] of previous)if(!seen.has(id)&&old.status!=='retired'){
    const unavailable=subjects.some(s=>!s.ready&&s.kind===old.subject.kind&&s.id===old.subject.id&&s.runId===old.subject.runId);
    save(id,{...old,status:unavailable?'unknown':'retired',active:unavailable?old.active:false,checkedAt:at,reason:unavailable?'保存的研究依据无法核对；旧触发未确认解除':'此版条件已被替代或移除；历史触发仍保留'});
   }
   return hits;
  },
  checks:()=>rows().filter(r=>r.status!=='retired'),
  // Reads never evaluate a condition or write a check. They invalidate stale display.
  project(topics,{at,operation,includeActions=false,includeSubjects=false}={}){
   const saved=new Map(rows().map(r=>[r.id,r])),subjects=getSubjects(topics),items=candidates(subjects),seen=new Set(items.map(c=>c.id));
   for(const old of saved.values()){const subject=subjects.find(s=>!s.ready&&s.kind===old.subject.kind&&s.id===old.subject.id&&s.runId===old.subject.runId);if(subject&&!seen.has(old.id)&&old.status!=='retired')items.push({id:old.id,subject,assessment:{symbol:old.symbol},key:old.group,valid:false});}
   const checks=items.map(c=>{
    const s=c.subject,old=saved.get(c.id),age=Date.parse(at)-Date.parse(old?.checkedAt);
    const reason=db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1'?'恢复副本等待核对':operation?.paused?'后台观察已暂停':operation?.outcome==='error'?'最近后台观察失败':!old||old.status==='retired'?'等待首次后台检查':!c.valid||!s.ready?'保存依据无法核对':c.assessment.monitoring?.[c.key]?.conditions.some(x=>x.type==='business-fact')&&Date.parse(at)-Date.parse(s.preparedAt)>=BUSINESS_FACT_INTERVAL_MS?'业务事实复核已到期，等待新版':old.contextHash!==digest([s.ready,s.fresh,s.changed,s.current])?'研究依据已有变化，等待重新检查':!Number.isFinite(age)||age<0||age>120000?'上次检查已过期，等待后台更新':null;
    return {...old,id:c.id,subject:{kind:s.kind,id:s.id,version:s.version,runId:s.runId,title:s.title},symbol:c.assessment.symbol,group:c.key,status:reason?'unknown':old.status,reason:reason||old.reason,current:!reason,lastStatus:old?.status??null};
   });
   if(!includeActions)return checks;
   const actionKey=(s,symbol)=>JSON.stringify([s.kind,s.id,s.runId,s.version,symbol]),byAction=new Map();
   for(const c of checks){const key=actionKey(c.subject,c.symbol);if(!byAction.has(key))byAction.set(key,[]);byAction.get(key).push(c);}
   const researchActions=subjects.flatMap(s=>(s.assessments||[]).map(a=>({...researchActionReadiness(a,{subject:s,checks:byAction.get(actionKey(s,a.symbol))||[],at}),subject:{kind:s.kind,id:s.id,version:s.version,runId:s.runId,title:s.title}})));
   return {researchChecks:checks,researchActions,...(includeSubjects?{subjects}:{})};
  }
 };
}
