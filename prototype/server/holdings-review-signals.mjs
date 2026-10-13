import {researchCapabilityReview} from '../shared/research-capability.mjs';
import {hasBusinessFacts,conditionSignal} from '../shared/business-facts.mjs';
import {isWatchResearch,researchReviewSchedule} from '../shared/research-watch.mjs';
import {digest} from './codex-research.mjs';
import {HOLDINGS_REVIEW_VERSION} from './system-monitoring-revisions.mjs';
const parse=r=>r&&JSON.parse(r.payload);
export function reviewSignalId(owner,c){return digest([HOLDINGS_REVIEW_VERSION,owner,c.kind,c.symbol,c.group,c.kind==='capability'?[c.policy,c.proof.to]:c.kind==='deadline'?Date.parse(c.value):c.kind==='observation'?[c.policy,c.preparedAt,c.value]:[c.definition.join,c.definition.conditions.map(conditionSignal).map(digest).sort()]]);}
// Reuse one persistent episode ledger across single-event and composite research.
// A model version or a rephrased reason does not create a new condition episode.
export function openHoldingsReviewSignals(db,{now,transaction,guard}){
 db.exec('CREATE TABLE IF NOT EXISTS holdings_review_signals(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const save=(id,p)=>db.prepare('INSERT INTO holdings_review_signals VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(p));
 return {
  collect(owner,subject,held,ctx,context){
   const triggers=[];
   for(const a of subject.assessments||[]){
    const capability=subject.automaticReview&&Number.isFinite(Date.parse(subject.preparedAt))&&Date.parse(subject.preparedAt)<=now()?researchCapabilityReview(a,subject):null;
    if(!held.has(a.symbol)&&!isWatchResearch(a.recommendation)&&!hasBusinessFacts(a)&&!capability)continue;
    const candidates=capability?[{kind:'capability',symbol:a.symbol,group:'businessRepresentation',policy:capability.policy,proof:capability,state:true}]:[],schedule=researchReviewSchedule(a,subject.preparedAt,new Date(now()).toISOString());
    if(schedule)candidates.push({kind:'observation',symbol:a.symbol,group:'reviewCadence',value:schedule.nextReviewAt,policy:schedule.policy,preparedAt:schedule.preparedAt,state:schedule.due});
    for(const [group,value] of [['validUntil',a.recommendation?.validUntil],['holdingHorizon',a.recommendation?.holdingHorizon?.status==='defined'?a.recommendation.holdingHorizon.until:null]])if(held.has(a.symbol)&&Number.isFinite(Date.parse(value)))candidates.push({kind:'deadline',symbol:a.symbol,group,value,state:Date.parse(value)<=now()});
    for(const group of held.has(a.symbol)?['exitCondition','invalidation','nextCheck']:[]){
     const definition=a.monitoring?.[group],matches=(ctx.researchChecks||[]).filter(c=>c.symbol===a.symbol&&c.group===group&&c.subject.kind===subject.kind&&c.subject.id===subject.id&&c.subject.runId===subject.runId&&c.subject.version===subject.version),check=matches.length===1?matches[0]:null,age=now()-Date.parse(check?.checkedAt);
     if(definition?.status==='defined'&&check?.current&&Number.isFinite(age)&&age>=0&&age<=120000&&['true','false'].includes(check.status))candidates.push({kind:'condition',symbol:a.symbol,group,definition,check,state:check.status==='true'});
    }
    for(const candidate of candidates){
     const {state,check,...definition}=candidate,id=reviewSignalId(owner,candidate),old=parse(db.prepare('SELECT payload FROM holdings_review_signals WHERE id=?').get(id));
     const next={...old,active:state,episode:(old?.episode||0)+(state&&!old?.active?1:0),consumed:old?.consumed||0};
     if(!old||digest(next)!==digest(old))transaction(()=>{context.assertActive();guard();save(id,next);});
     if(state&&next.episode>next.consumed)triggers.push({...definition,...(check?{check}:{}),id,episode:next.episode});
    }
   }
   return triggers;
  },
  consume(triggers,jobId){for(const t of triggers){const state=parse(db.prepare('SELECT payload FROM holdings_review_signals WHERE id=?').get(t.id));if(!state?.active||state.episode!==t.episode||state.consumed>=t.episode)throw Error('持仓复核触发已变化');save(t.id,{...state,consumed:t.episode,jobId});}}
 };
}
