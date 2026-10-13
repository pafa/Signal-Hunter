import {hash} from './providers.mjs';
import {evaluateObservation,observationInstant} from './observation-rules.mjs';
import {evidenceStamp} from '../shared/review-state.mjs';
import {claimsOf} from '../shared/claims.mjs';
import {instrument} from '../shared/securities.mjs';
import {projectActualResearch} from './actual-research.mjs';
import {actualCheckHash,actualCheckChanged,actualCheckMissing} from './actual-check-response.mjs';

const ENGINE='actual-holding-review/1',digest=v=>hash(JSON.stringify(v));
const stamp=e=>JSON.stringify([evidenceStamp(e),e.materialRevision??null]);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const isPrice=c=>['price','daily-anomaly','minute-anomaly'].includes(c.type);
const withoutCheck=({check,...rule})=>rule;

// Research observations only. No ledger, price, baseline or trading permission
// is inferred from a holding snapshot; an absent input stays unknown.
export function actualReviewCandidates(record,topic,baseline,rules,at,{quote,check,previous=new Map(),researchView=null}={}){
 if(observationInstant(at)===null)throw Error('实际持仓巡检时间无效');
 const candidates=[],reference={recordId:record.id,recordVersion:record.version,topicId:record.topicId,boundVersion:record.topicVersion},base={ruleVersion:ENGINE,record:structuredClone(record),evaluatedAt:at,currentTopicVersion:topic?.version??null,baselineAvailable:!!baseline,baselineHash:baseline?digest(baseline):null,...(researchView?{researchContextHash:researchView.contextHash,monitoringLink:researchView.link}:{})};
 const add=(kind,state,reason,{identity=null,metrics={},evidence=[],rule=null,results=[],temporal=null}={})=>{
  const key=digest([ENGINE,record.id,kind]),fingerprint=digest([reference,identity]);
  candidates.push({key,fingerprint,state,reason,recordId:record.id,recordVersion:record.version,topicId:record.topicId,topicVersion:topic?.version??null,ruleId:rule?.id||null,ruleVersion:rule?.version??null,temporal,
   hit:{kind:'actual-review',title:`${record.accountKind==='manual-simulation'?'手动模拟':'实际持仓'} · ${record.account} · ${record.symbol}`,topicId:record.topicId,topicVersion:topic?.version??null,reason,symbols:[record.symbol],affectedPositions:[{symbol:record.symbol,topicId:record.topicId,openedAt:null,lifecycleId:`actual:${record.id}`,recordId:record.id,recordVersion:record.version}],input:{...base,reviewKind:kind,metrics,evidence,definition:rule,results}}});
 };
 const linked=!!topic&&topic.status==='active'&&topic.companies?.some(c=>c.symbol===record.symbol);
 add('research-status',!record.topicId||!topic?'unknown':linked?'clear':'hit',!record.topicId?'未绑定原研究，不能判断原假设':!topic?'关联研究不可用':linked?'关联研究有效且仍包含此证券':topic.status!=='active'?'关联研究已归档，需复核':'关联研究已移除此证券，需复核',{identity:[topic?.status||null,linked]});
 add('research-version',!topic?'unknown':topic.version!==record.topicVersion?'hit':'clear',!topic?'当前研究不可用':topic.version!==record.topicVersion?'持仓绑定研究与当前版本不同，需复核原假设':'当前研究与持仓绑定版本一致',{identity:topic?.version??null,metrics:{boundVersion:record.topicVersion,currentVersion:topic?.version??null}});
 const old=new Set((baseline?.evidence||[]).map(stamp)),against=(topic?.evidence||[]).filter(e=>e.stance==='against'&&!old.has(stamp(e)));
 add('counterevidence',!linked||!baseline?'unknown':against.length?'hit':'clear',!linked?'研究或证券关联不可用':!baseline?'绑定研究历史缺失，无法判断新增反向线索':against.length?'绑定基线之外出现新增或修订的反向线索':'未发现绑定基线之外的反向线索',{identity:against.map(stamp).sort(),evidence:against.map(e=>({id:e.id,claim:e.claim,verification:e.verification,stamp:stamp(e)}))});
 const zone=instrument(record.symbol).marketTimezone,today=new Date(at).toLocaleDateString('en-CA',{timeZone:zone});
 const deadlines=[{kind:'research',id:record.topicId,value:topic?.hypothesis?.reviewAt},...claimsOf(topic||{}).filter(c=>['open','unresolved'].includes(c.outcome)).map(c=>({kind:'claim',id:c.id,value:c.resolveBy}))].filter(d=>d.value);
 const valid=deadlines.filter(d=>day(d.value)||observationInstant(d.value)!==null),due=valid.filter(d=>day(d.value)?d.value<=today:Date.parse(d.value)<=Date.parse(at));
 add('review-due',!linked?'unknown':due.length?'hit':!valid.length||valid.length!==deadlines.length?'unknown':'clear',!linked?'研究或证券关联不可用':due.length?'研究或未解决主张已到复核期限':!valid.length?'未定义可计算的复核期限':valid.length!==deadlines.length?'部分复核期限无法解析':'当前复核期限尚未到达',{identity:{deadlines,due},metrics:{marketTimezone:zone,localDate:today,deadlines,due,dateBasis:'仅日期的期限按证券市场当地日检查，不推断开收盘时刻'}});
 const applicable=rules.filter(r=>r.topicId===record.topicId).map(withoutCheck),priceRules=applicable.filter(r=>r.definition.conditions.some(c=>isPrice(c)&&c.symbol===record.symbol));
 const covered=priceRules.some(r=>r.active&&r.definition.conditions.filter(isPrice).every(c=>c.symbol===record.symbol));
 add('price-coverage',covered?'clear':'unknown',covered?'已有针对该证券的价格观察条件；数据有效性逐项检查':'没有已启用且仅针对该证券的价格观察条件；不从长文编造止盈止损阈值',{identity:priceRules.map(r=>[r.id,r.version,r.active])});
 for(const rule of applicable){
  const priceConditions=rule.definition.conditions.filter(isPrice);if(priceConditions.length&&!priceConditions.some(c=>c.symbol===record.symbol))continue;
  const kind='condition:'+rule.id,key=digest([ENGINE,record.id,kind]),fingerprint=digest([reference,[rule.id,rule.version]]),prior=previous.get(key);
  const armedAt=[record.recordedAt,rule.updatedAt||rule.createdAt].filter(Boolean).sort().at(-1);
  const result=!rule.active?{state:'unknown',reason:'观察条件已暂停，旧触发不视为解除',results:[]}:!linked?{state:'unknown',reason:'研究或证券关联不可用',results:[]}:priceConditions.some(c=>c.symbol!==record.symbol)?{state:'unknown',reason:'跨证券组合条件不自动移用到单项实际持仓',results:[]}:
   evaluateObservation({...rule,updatedAt:armedAt},topic,{at,quote,check,offline:false,previous:prior?.fingerprint===fingerprint?prior:null});
  add(kind,{true:'hit',false:'clear',unknown:'unknown'}[result.state],result.state==='unknown'?`${rule.definition.label}：${result.reason}`:`观察条件：${rule.definition.label}`,{identity:[rule.id,rule.version],rule,results:result.results,temporal:result.temporal||null,metrics:{result:result.state,armedAt}});
 }
 if(researchView){
  const v=researchView,current=v.link.status==='current',replace=(kind,state,reason,extra={})=>{const i=candidates.findIndex(c=>c.hit.input.reviewKind===kind);candidates.splice(i,1);add(kind,state,reason,extra);};
  add('research-continuity',current?'clear':'unknown',v.link.reason,{identity:v.link,metrics:{origins:v.origins,currentBinding:v.currentBinding}});
  // A verified successor replaces the old research checks, not the recorded
  // holding or its manually configured price rules. No intermediate approval.
  if(current){
   replace('research-status','clear','当前监控研究已核对且包含此确切证券',{identity:v.currentBinding});
   replace('research-version','clear','已自动跟踪当前研究版本；原始关联及历史仍保留',{identity:v.currentBinding,metrics:{origins:v.origins,currentBinding:v.currentBinding}});
   replace('counterevidence',v.against.length?'hit':'clear',v.against.length?'当前监控研究出现原始关联之外的新增或修订反向线索':'当前监控研究未发现原始关联之外的反向线索',{identity:v.against.map(e=>e.stamp).sort(),evidence:v.against});
   replace('review-due',v.due.length?'hit':v.deadlines.length?'clear':'unknown',v.due.length?'当前判断或持有复核窗口已到期':v.deadlines.length?'当前研判复核期限尚未到达':'当前研究未提供可核对的复核期限',{identity:{binding:v.currentBinding,deadlines:v.deadlines,due:v.due},metrics:{deadlines:v.deadlines,due:v.due}});
   if(v.conditions.some(c=>c.definition?.status==='defined'&&c.definition.conditions.some(k=>k.type==='price')))replace('price-coverage','clear','已接入此证券当前系统研判的价格条件；行情有效性按下列检查记录',{identity:v.currentBinding});
  }else if(v.origins.length>1||v.link.links.some(l=>l.status!=='legacy')){
   // Do not declare an earlier trigger recovered by looking at an unrelated
   // original member while its current event association is unresolved.
   for(const kind of ['research-status','research-version','counterevidence','review-due'])replace(kind,'unknown',v.link.reason,{identity:v.link});
  }
  for(const c of v.conditions.filter(c=>c.key!=='entryCondition'))add('research-'+c.key,{true:'hit',false:'clear',unknown:'unknown'}[c.status],`${c.label}：${c.reason}`,{identity:{binding:v.currentBinding,key:c.key,definition:c.definition},metrics:{researchCondition:c}});
  add('research-exit-advice',v.exitAdvice.state==='review'?'hit':v.exitAdvice.state==='monitor'?'clear':'unknown',v.exitAdvice.state==='review'?`${v.exitAdvice.label}；请结合走势和持仓决定`:v.exitAdvice.reason,{identity:{binding:v.currentBinding,action:v.action?.action||null},metrics:{exitAdvice:v.exitAdvice,action:v.action}});
 }
 return candidates;
}

export function openActualObservations(store,{getHoldings=()=>null,getTopicVersion=()=>null,getRules=()=>[],priceEnabled=()=>true,getResearchContext}={}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS actual_observation_states(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT id,payload FROM actual_observation_states').all().map(r=>({id:r.id,...JSON.parse(r.payload)}));
 const save=(id,state)=>db.prepare('INSERT INTO actual_observation_states VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(state));
 return {
  detail(recordId,checkId,expectedHash){
   const row=db.prepare('SELECT id,payload FROM actual_observation_states WHERE id=?').get(checkId);
   const check=row?{id:row.id,...JSON.parse(row.payload)}:null;
   if(!check||check.recordId!==recordId||check.status==='retired')throw Error(actualCheckMissing);
   const hash=actualCheckHash(check);
   if(hash!==expectedHash)throw Error(actualCheckChanged);
   return {recordId,checkId,hash,check};
  },
  // The inbox owns one transaction covering condition states and emitted history.
  evaluate(topics,at){
   const snapshot=getHoldings();if(!snapshot?.enabled)return [];
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');
   if(observationInstant(at)===null)throw Error('实际持仓巡检时间无效');
   const previous=new Map(rows().map(r=>[r.id,r]));if([...previous.values()].some(r=>Date.parse(r.checkedAt)>Date.parse(at)))throw Error('实际持仓巡检时钟倒退，本轮未保存');
   const topicsById=new Map(topics.map(t=>[t.id,t])),rules=getRules(),checks=store.checks(),cache=new Map(),baselines=new Map(),seen=new Set(),hits=[];
   const activeRecords=snapshot.records.filter(r=>r.quantity!=='0');
   const researchContext=activeRecords.length?getResearchContext?.(topics,snapshot.records,at):null;
   const quote=(s,i)=>{if(!priceEnabled(s,i))return null;const key=i+s;if(!cache.has(key))cache.set(key,i==='1d'?store.daily(s):store.quote(s));return cache.get(key);};
   for(const record of activeRecords){
    const key=JSON.stringify([record.topicId,record.topicVersion]);if(!baselines.has(key)){let baseline=null;try{baseline=record.topicId?getTopicVersion(record.topicId,record.topicVersion):null;}catch{}if(baseline?.id!==record.topicId||baseline?.version!==record.topicVersion)baseline=null;baselines.set(key,baseline);}
    const researchView=researchContext?projectActualResearch(record,topics,{...researchContext,getTopicVersion},at):null;
    const candidates=actualReviewCandidates(record,topicsById.get(record.topicId),baselines.get(key),rules,at,{quote,check:(s,i)=>checks[(i==='1d'?'daily:':'')+s],previous,researchView});
    for(const c of candidates){
     seen.add(c.key);const old=previous.get(c.key),state={recordId:c.recordId,recordVersion:c.recordVersion,topicId:c.topicId,topicVersion:c.topicVersion,ruleId:c.ruleId,ruleVersion:c.ruleVersion,reviewKind:c.hit.input.reviewKind,status:c.state,reason:c.reason,checkedAt:at,episode:old?.episode||0,active:old?.active||false,fingerprint:c.fingerprint,activeFingerprint:old?.activeFingerprint||null,lastTodoId:old?.lastTodoId||null,lastHitAt:old?.lastHitAt||null,temporal:c.temporal,details:c.hit.input,...(researchView?{researchContextHash:researchView.contextHash}:{})};
     if(c.state==='hit'&&(!old?.active||old.activeFingerprint!==c.fingerprint)){
      state.episode++;state.active=true;state.activeFingerprint=c.fingerprint;state.lastHitAt=at;state.lastTodoId=digest([c.key,state.episode,c.fingerprint]);hits.push({...c.hit,id:state.lastTodoId,input:{...c.hit.input,episode:state.episode}});
     }else if(c.state==='clear')state.active=false;
     // Unknown input preserves an existing hit; receipts never edit this state.
     save(c.key,state);
    }
   }
   for(const [id,old] of previous)if(!seen.has(id)&&old.status!=='retired')save(id,{...old,status:'retired',active:false,checkedAt:at,reason:'持仓不再持有或对应条件已移除；历史触发仍保留'});
   return hits;
  },
  checks:()=>rows().filter(r=>r.status!=='retired'),
 };
}
