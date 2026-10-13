import {businessFactTargets} from '../shared/business-facts.mjs';
import {reviewHasActiveScope} from '../shared/research-watch.mjs';
import {openHoldingsReviewSignals} from './holdings-review-signals.mjs';
import {digest} from './codex-research.mjs';
import {automaticResearchPacket} from './research-output-contract.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {HOLDINGS_REVIEW_VERSION} from './system-monitoring-revisions.mjs';
const parse=r=>r&&JSON.parse(r.payload);
// Trigger episodes belong to a condition definition, not a model run. An
// unchanged true condition cannot recursively schedule every newly saved run.
export function openHoldingsReview(store,research,{holdingSymbols,getReviewContext,now,guard,transaction,audit,settings,configHash,fingerprint,insert,valid}){
 const db=store.db,signals=openHoldingsReviewSignals(db,{now,transaction,guard});
 return {step(context){
  if(!settings().automatic)return null;
  const held=new Set(holdingSymbols());
  const ctx=getReviewContext();if(!ctx)return null;
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j JOIN research_topics t ON t.id=j.topic_id WHERE j.kind='dossier' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(t.payload,'$.version')=json_extract(j.payload,'$.adoptedVersion') AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs n WHERE n.topic_id=j.topic_id AND n.status IN ('queued','running')) ORDER BY j.rowid").all();
  for(const row of rows){
   const p=parse(row),topic=research.get(row.topic_id),subject=ctx.subjects?.find(s=>s.kind==='research'&&s.id===topic.id&&s.runId===row.run_id&&s.version===topic.version);
   if(!subject?.ready||!subject.fresh||subject.changed||topic.status!=='active'||p.configHash!==configHash()||store.newsById(p.newsId)?.revision!==p.newsRevision||!['completed','observing'].includes(db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(row.item_id)?.status)||topic.dossier?.actor?.policy!==SYSTEM_RESEARCH_ACTOR.policy)continue;
   // A current composite owns observation cadence; do not invalidate it by also refreshing its members.
   const covered=ctx.subjects?.some(s=>s.kind==='event-cluster'&&s.current?.memberVersions?.some(([id])=>id===topic.id));
   const stoppedAfter=db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND rowid>(SELECT rowid FROM research_pipeline_event_jobs WHERE id=?) AND status IN ('cancelled','observing')").get(topic.id,row.id);
   const reviewSubject={...subject,automaticReview:subject.automaticReview&&!stoppedAfter,assessments:covered?subject.assessments.filter(a=>held.has(a.symbol)):subject.assessments};
   const triggers=signals.collect(topic.id,reviewSubject,held,ctx,context).filter(t=>!covered||!['observation','capability'].includes(t.kind));
   if(!triggers.length)continue;
   const at=new Date(now()).toISOString(),baseHash=digest(topic),id=digest([HOLDINGS_REVIEW_VERSION,topic.id,topic.version,triggers.map(t=>[t.id,t.episode])]);
   const facts=businessFactTargets(subject.assessments);
   const review={...(facts.length?{businessFacts:facts}:{}),schema:HOLDINGS_REVIEW_VERSION,sourceJobId:row.id,baseVersion:topic.version,baseRunId:row.run_id,baseHash,preparedAt:at,triggers,resetPrices:!!settings().researchPrices,priorPrices:[...new Map([...(topic.monitoringReview?.priorPrices||[]),...(topic.researchPrices||[])].map(x=>[digest(x),x])).values()]};
   const check=()=>{context.assertActive();guard();if(!settings().automatic||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload||digest(research.get(topic.id))!==baseHash||!reviewHasActiveScope(triggers,holdingSymbols()))throw Error('持仓复核依据或配置已变化');};
   research.prepareMonitoringResearch(topic.id,{version:topic.version,review},SYSTEM_RESEARCH_ACTOR,check,next=>{
    const packet=automaticResearchPacket(research.packet(topic.id)),payload={...p,researchPrices:!!settings().researchPrices,financialSources:!!settings().financialSources,financial:{attempts:[],results:next.financialSources||[]},topicVersion:next.version,packet,eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),executionHash:fingerprint('dossier',packet),monitoringFollowup:{schema:review.schema,sourceJobId:row.id,baseVersion:topic.version,baseRunId:row.run_id,baseHash,preparedHash:digest(next),preparations:[]},prices:{attempts:[],results:next.researchPrices||[]},createdAt:at,retryAt:null,previousRunId:null,reason:triggers.some(t=>t.kind==='capability')?'旧版带原文的业务前提缺少可表达协议，后台追加一次新版复核；旧判断保留':triggers.some(t=>t.kind==='observation')?'观察研究到达后台每日复核时点，沿原队列补充价量并更新判断':'持仓的研究条件或复核期限已触发，后台补充当前价量并更新判断'};
    for(const k of ['financialFollowup','identityFollowup','documentFollowup','documentScopeChanged','documentPreparation','adoptedVersion','finishedAt','relationCoverage'])delete payload[k];
    const job={id,item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued'};insert(job,payload);valid({...job,payload:JSON.stringify(payload)});
    signals.consume(triggers,id);
    audit(row.item_id,triggers.some(t=>t.kind==='capability')?'research-capability-review-queued':triggers.some(t=>t.kind==='observation')?'observation-review-queued':'holdings-review-queued',{jobId:id,topicId:topic.id,version:next.version,symbols:[...new Set(triggers.map(t=>t.symbol))],triggers:triggers.map(t=>({kind:t.kind,group:t.group,episode:t.episode}))});
   });
   return {ok:true,holdingsReview:'queued',eventJobId:id};
  }
  return null;
 }};
}
