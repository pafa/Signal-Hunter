import {hash} from './providers.mjs';
import {evaluateObservation,observationInstant} from './observation-rules.mjs';
import {evidenceStamp} from '../shared/review-state.mjs';
import {claimsOf} from '../shared/claims.mjs';
import {instrument} from '../shared/securities.mjs';

const ENGINE='actual-holding-review/1',digest=v=>hash(JSON.stringify(v));
const stamp=e=>JSON.stringify([evidenceStamp(e),e.materialRevision??null]);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const isPrice=c=>['price','daily-anomaly','minute-anomaly'].includes(c.type);
const withoutCheck=({check,...rule})=>rule;

// Research observations only. No ledger, price, baseline or trading permission
// is inferred from a holding snapshot; an absent input stays unknown.
export function actualReviewCandidates(record,topic,baseline,rules,at,{quote,check,previous=new Map()}={}){
 if(observationInstant(at)===null)throw Error('实际持仓巡检时间无效');
 const candidates=[],reference={recordId:record.id,recordVersion:record.version,topicId:record.topicId,boundVersion:record.topicVersion},base={ruleVersion:ENGINE,record:structuredClone(record),evaluatedAt:at,currentTopicVersion:topic?.version??null,baselineAvailable:!!baseline,baselineHash:baseline?digest(baseline):null};
 const add=(kind,state,reason,{identity=null,metrics={},evidence=[],rule=null,results=[],temporal=null}={})=>{
  const key=digest([ENGINE,record.id,kind]),fingerprint=digest([reference,identity]);
  candidates.push({key,fingerprint,state,reason,recordId:record.id,recordVersion:record.version,topicId:record.topicId,topicVersion:topic?.version??null,ruleId:rule?.id||null,ruleVersion:rule?.version??null,temporal,
   hit:{kind:'actual-review',title:`实际持仓 · ${record.account} · ${record.symbol}`,topicId:record.topicId,topicVersion:topic?.version??null,reason,symbols:[record.symbol],affectedPositions:[{symbol:record.symbol,topicId:record.topicId,openedAt:null,lifecycleId:`actual:${record.id}`,recordId:record.id,recordVersion:record.version}],input:{...base,reviewKind:kind,metrics,evidence,definition:rule,results}}});
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
 return candidates;
}

export function openActualObservations(store,{getHoldings=()=>null,getTopicVersion=()=>null,getRules=()=>[],priceEnabled=()=>true}={}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS actual_observation_states(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT id,payload FROM actual_observation_states').all().map(r=>({id:r.id,...JSON.parse(r.payload)}));
 const save=(id,state)=>db.prepare('INSERT INTO actual_observation_states VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(state));
 return {
  // The inbox owns one transaction covering condition states and emitted history.
  evaluate(topics,at){
   const snapshot=getHoldings();if(!snapshot?.enabled)return [];
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');
   if(observationInstant(at)===null)throw Error('实际持仓巡检时间无效');
   const previous=new Map(rows().map(r=>[r.id,r]));if([...previous.values()].some(r=>Date.parse(r.checkedAt)>Date.parse(at)))throw Error('实际持仓巡检时钟倒退，本轮未保存');
   const topicsById=new Map(topics.map(t=>[t.id,t])),rules=getRules(),checks=store.checks(),cache=new Map(),baselines=new Map(),seen=new Set(),hits=[];
   const quote=(s,i)=>{if(!priceEnabled(s,i))return null;const key=i+s;if(!cache.has(key))cache.set(key,i==='1d'?store.daily(s):store.quote(s));return cache.get(key);};
   for(const record of snapshot.records.filter(r=>r.quantity!=='0')){
    const key=JSON.stringify([record.topicId,record.topicVersion]);if(!baselines.has(key)){let baseline=null;try{baseline=record.topicId?getTopicVersion(record.topicId,record.topicVersion):null;}catch{}if(baseline?.id!==record.topicId||baseline?.version!==record.topicVersion)baseline=null;baselines.set(key,baseline);}
    const candidates=actualReviewCandidates(record,topicsById.get(record.topicId),baselines.get(key),rules,at,{quote,check:(s,i)=>checks[(i==='1d'?'daily:':'')+s],previous});
    for(const c of candidates){
     seen.add(c.key);const old=previous.get(c.key),state={recordId:c.recordId,recordVersion:c.recordVersion,topicId:c.topicId,topicVersion:c.topicVersion,ruleId:c.ruleId,ruleVersion:c.ruleVersion,reviewKind:c.hit.input.reviewKind,status:c.state,reason:c.reason,checkedAt:at,episode:old?.episode||0,active:old?.active||false,fingerprint:c.fingerprint,activeFingerprint:old?.activeFingerprint||null,lastTodoId:old?.lastTodoId||null,lastHitAt:old?.lastHitAt||null,temporal:c.temporal,details:c.hit.input};
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
