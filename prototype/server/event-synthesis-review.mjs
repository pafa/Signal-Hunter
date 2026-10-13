import {researchCapabilityReview,validCapabilityReviewTrigger} from '../shared/research-capability.mjs';
import {hasBusinessFacts,businessFactTargets} from '../shared/business-facts.mjs';
import {isWatchResearch,validWatchReviewTrigger,reviewHasActiveScope} from '../shared/research-watch.mjs';
import {researchVolumeComparison} from './research-volume-comparison.mjs';
import {digest,validatePacket} from './codex-research.mjs';
import {openMaterials,immutableMaterialSnapshot} from './research-materials.mjs';
import {openHoldingsReviewSignals,reviewSignalId} from './holdings-review-signals.mjs';
import {packetQuantities} from '../shared/source-quantities.mjs';
import {materialityReviewTargets} from './materiality-review.mjs';
import {companyAssessmentTargets} from './company-assessment.mjs';
export const SYNTHESIS_REVIEW_VERSION='composite-holdings-review/1';
const parse=r=>JSON.parse(r.payload),same=(a,b)=>digest(a)===digest(b);
const reviewHash=r=>digest([SYNTHESIS_REVIEW_VERSION,r]);
export function synthesisSourceBasis(row){return parse(row).monitoringReview?.sourceBasisHash||row.basis_hash;}
export function synthesisMatchesBasis(row,hash){const r=parse(row).monitoringReview;return r?r.schema===SYNTHESIS_REVIEW_VERSION&&r.sourceBasisHash===hash&&reviewHash(r)===row.basis_hash:row.basis_hash===hash;}
function updatePricePacket(packet,results,readMaterial){
 const input=structuredClone(packet.input);input.evidence=input.evidence.filter(e=>!e.reviewPrice);const kept=new Set(input.evidence.map(e=>e.id));input.eventSynthesis.sourceGroups=input.eventSynthesis.sourceGroups.map(g=>({...g,evidenceIds:g.evidenceIds.filter(id=>kept.has(id))})).filter(g=>g.evidenceIds.length);
 delete input.researchPrices;
 if(results){
  input.researchPrices=results;
  for(const result of results.filter(r=>r.status==='saved')){
   const m=readMaterial({id:result.materialId,revision:result.materialRevision});
   if(m.method!=='public-market'||m.marketSource.symbol!==result.symbol||m.marketSource.interval!==result.interval)throw Error('综合复核价量原件与证券周期不符');
   const id=`material:review-${m.id}`;
   input.evidence.push({id,materialId:m.id,materialRevision:m.revision,material:m,sourceName:m.sourceName,url:m.url,publishedAt:null,availableAt:m.availableAt,contentScope:m.scope,claim:m.title,stance:'context',verification:'unverified',reviewPrice:true});
   const group=input.eventSynthesis.sourceGroups.find(g=>g.document===m.documentId);if(group)group.evidenceIds.push(id);else input.eventSynthesis.sourceGroups.push({document:m.documentId,evidenceIds:[id],reviewPrice:true,scope:'本轮综合复核价量；不是独立新闻证据或可成交报价'});
  }
 }
 input.quantityEvidence=packetQuantities(input.evidence);input.materialityReview=materialityReviewTargets(input);input.companyAssessment=companyAssessmentTargets(input);
 return validatePacket({...packet,input,inputHash:digest(input)});
}
export function openSynthesisReview(store,{now,transaction,guard,audit,settings,holdingSymbols,getReviewContext,priceSources,basis,read,rows,completed,executionHash,makePacket}){
 const db=store.db,signals=openHoldingsReviewSignals(db,{now,transaction,guard}),materials=openMaterials(db,{clock:()=>new Date(now()).toISOString()}),at=()=>new Date(now()).toISOString();
 function validate(row){
  const p=parse(row),r=p.monitoringReview;if(!r)return;
  const parent=read(r.sourceJobId),owner=`event-cluster:${row.cluster_id}`;
  const fail=()=>{throw Error('综合持仓复核依据不连续');};
  if(r.schema!==SYNTHESIS_REVIEW_VERSION||parent.cluster_id!==row.cluster_id||parent.version!==r.baseVersion||parent.run_id!==r.baseRunId||parent.version>=row.version||parent.execution_hash!==row.execution_hash||synthesisSourceBasis(parent)!==r.sourceBasisHash||digest(parent)!==r.baseHash||reviewHash(r)!==row.basis_hash||!same(p.packet.input.monitoringReview,r)||!r.triggers?.length)fail();
  const prior=completed(parent);if(!same(r.businessFacts||[],businessFactTargets(prior.candidate.companyAssessments)))fail();
  for(const t of r.triggers){
   const a=prior.candidate.companyAssessments?.find(a=>a.symbol===t.symbol),n=Date.parse(r.preparedAt);
   if(!a||!Number.isFinite(n)||t.id!==reviewSignalId(owner,t)||!Number.isSafeInteger(t.episode)||t.episode<1)fail();
   if(t.kind==='capability'){
    if(!validCapabilityReviewTrigger(t,a,prior.packet)||Date.parse(prior.createdAt)>n)fail();
   }else if(t.kind==='deadline'){
    const value=t.group==='validUntil'?a.recommendation?.validUntil:t.group==='holdingHorizon'&&a.recommendation?.holdingHorizon?.status==='defined'?a.recommendation.holdingHorizon.until:null;
    if(t.value!==value||!Number.isFinite(Date.parse(value))||Date.parse(value)>n)fail();
   }else if(t.kind==='observation'){
    if(!validWatchReviewTrigger(t,a,parse(parent).updatedAt||parse(parent).createdAt,r.preparedAt))fail();
   }else if(t.kind==='condition'){
    const c=t.check,age=n-Date.parse(c?.checkedAt);
    if(!['exitCondition','invalidation','nextCheck'].includes(t.group)||!same(t.definition,a.monitoring?.[t.group])||t.definition.status!=='defined'||!c?.current||c.status!=='true'||c.symbol!==t.symbol||c.group!==t.group||c.subject.kind!=='event-cluster'||c.subject.id!==row.cluster_id||c.subject.runId!==r.baseRunId||c.subject.version!==r.baseVersion||!Number.isFinite(age)||age<0||age>120000)fail();
   }else fail();
  }
  if(!same(p.packet.input.researchPrices||[],p.prices.results))fail();
  const rebuilt=updatePricePacket(p.packet,p.prices.results,ref=>immutableMaterialSnapshot(db,ref));if(rebuilt.inputHash!==p.inputHash||updatePricePacket(p.packet,null).inputHash!==p.initialInputHash)fail();
  if(['queued','running'].includes(row.status)&&!reviewHasActiveScope(r.triggers,holdingSymbols()))throw Error('持仓已结束');
 }
 return {
  validate,
  discover(context){
   if(!settings().automatic)return null;const held=new Set(holdingSymbols());
   const ctx=getReviewContext();if(!ctx)return null;
   for(const subject of ctx.subjects||[]){
    if(subject.kind!=='event-cluster'||!subject.ready||!subject.fresh||subject.changed||!subject.assessments?.some(a=>held.has(a.symbol)||isWatchResearch(a.recommendation)||hasBusinessFacts(a)||subject.automaticReview&&researchCapabilityReview(a,subject)))continue;
    const history=rows(subject.id),parent=history.find(r=>r.version===subject.version&&r.run_id===subject.runId&&r.status==='completed');
    if(!parent||history.some(r=>['queued','running'].includes(r.status))||history[0].id!==parent.id)continue;
    const b=basis(subject.id);if(!synthesisMatchesBasis(parent,b.hash)||parent.execution_hash!==executionHash())continue;
    const run=completed(parent),triggers=signals.collect(`event-cluster:${subject.id}`,subject,held,ctx,context);if(!triggers.length)continue;
    const facts=businessFactTargets(subject.assessments);
    const review={...(facts.length?{businessFacts:facts}:{}),schema:SYNTHESIS_REVIEW_VERSION,sourceJobId:parent.id,baseVersion:parent.version,baseRunId:parent.run_id,baseHash:digest(parent),sourceBasisHash:b.hash,preparedAt:at(),triggers};
    const version=history[0].version+1,hash=reviewHash(review),id=digest({clusterId:subject.id,basis:hash,execution:executionHash()});
    const priorSynthesis={version:parent.version,clusterVersion:parse(parent).clusterVersion,createdAt:run.createdAt,sections:run.candidate.sections,missingEvidence:run.candidate.missingEvidence,scope:'历史综合判断，仅用于变化比较；不是当前独立证据'};
    const initialPacket=makePacket(b.cluster,b.members,{version,generatedAt:at(),priorSynthesis,documentContext:b.documentContext,monitoringReview:review});
    const packet=updatePricePacket(initialPacket,[],ref=>immutableMaterialSnapshot(db,ref));
    const p={title:b.cluster.title,clusterVersion:b.cluster.version,createdAt:at(),automatic:true,members:b.members.map(m=>({topicId:m.topic.id,topicVersion:m.topic.version,inputHash:m.packet.inputHash})),packet,inputHash:packet.inputHash,initialInputHash:initialPacket.inputHash,monitoringReview:review,researchPrices:!!settings().researchPrices,prices:{attempts:[],results:[]},attemptCount:0,reason:triggers.some(t=>t.kind==='capability')?'旧综合的业务前提缺少可表达协议，后台追加一次新版复核；旧综合保留':triggers.some(t=>t.kind==='observation')?'观察综合到达后台每日复核时点，沿原队列补充价量并更新判断':'持仓的综合条件或期限已触发，后台补充价量并更新综合判断'};
    transaction(()=>{context.assertActive();guard();if(!settings().automatic||digest(read(parent.id))!==review.baseHash||basis(subject.id).hash!==b.hash||!reviewHasActiveScope(triggers,holdingSymbols()))throw Error('综合持仓复核依据已变化');db.prepare('INSERT INTO event_cluster_research VALUES(?,?,?,?,?,?,NULL,?)').run(id,subject.id,version,hash,executionHash(),'queued',JSON.stringify(p));validate(read(id));signals.consume(triggers,id);audit(id,triggers.some(t=>t.kind==='capability')?'synthesis-capability-review-queued':triggers.some(t=>t.kind==='observation')?'synthesis-observation-review-queued':'synthesis-holdings-review-queued',{clusterId:subject.id,title:p.title,symbols:[...new Set(triggers.map(t=>t.symbol))]});});
    return {ok:true,synthesisHoldingsReview:'queued',synthesisId:id};
   }
   return null;
  },
  async prepare(row,context,valid){
   let current=row;const p=parse(row);if(!p.monitoringReview||!p.researchPrices||!settings().researchPrices||!priceSources)return null;
   const done=new Set(p.prices.results.map(r=>r.symbol+':'+r.interval)),target=p.packet.input.companies.flatMap(c=>['1d','1m'].map(interval=>({symbol:c.symbol,interval}))).find(t=>!done.has(t.symbol+':'+t.interval));if(!target)return null;
   const {symbol,interval}=target;
   const check=()=>{context.assertActive();guard();const latest=read(row.id);if(!settings().automatic||!settings().researchPrices||latest.status!=='queued'||latest.run_id||latest.payload!==current.payload)throw Error('综合价量任务或配置已有变化');valid(latest);};
   const previous=p.prices.attempts.filter(a=>a.symbol===symbol&&a.interval===interval&&a.state==='started').length,exhausted=previous>=3,attempt=Math.min(previous+1,3),started=exhausted?p.prices:{...p.prices,attempts:[...p.prices.attempts,{symbol,interval,attempt,state:'started',at:at()}]};
   if(!exhausted)transaction(()=>{check();db.prepare('UPDATE event_cluster_research SET payload=? WHERE id=?').run(JSON.stringify({...p,prices:started,reason:`正在补充综合研究 ${symbol} ${interval} 价量依据`}),row.id);audit(row.id,'synthesis-review-price-started',{clusterId:row.cluster_id,symbol,interval,attempt});});
   current=read(row.id);
   const finish=(result,material)=>{
    const prepared=material?materials.prepare(`event-cluster:${row.cluster_id}`,material,'public-market'):null;
    const final={...result,symbol,interval,attempt,at:at(),...(prepared?{materialId:prepared.material.id,materialRevision:prepared.material.revision}:{})};
    const other=started.results.find(r=>r.symbol===symbol&&r.interval!==interval);
    if(other)final.volumeComparison=researchVolumeComparison(symbol,[other.status==='saved'?materials.get(other.materialId):null,prepared?.material||null],sha=>db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(sha)?.body);
    const prices={results:[...started.results,final],attempts:[...started.attempts,{...final,state:final.status}]};
    const packet=updatePricePacket(p.packet,prices.results,ref=>ref.id===prepared?.material.id?prepared.material:immutableMaterialSnapshot(db,ref));
    transaction(()=>{check();prepared?.persist();const next={...parse(current),prices,packet,inputHash:packet.inputHash,nextRetryAt:null,reason:final.status==='saved'?'综合价量已保存，继续研判':final.reason};db.prepare('UPDATE event_cluster_research SET payload=? WHERE id=?').run(JSON.stringify(next),row.id);validate(read(row.id));audit(row.id,'synthesis-review-price-'+final.status,{clusterId:row.cluster_id,symbol,interval,attempt,reason:final.reason||null});});
    return {ok:true,synthesisPrice:final.status,synthesisId:row.id};
   };
   if(exhausted)return finish({status:'unavailable',reason:'综合价量已尝试三次，含中断；保留缺口继续研判'},null);
   let material,error;try{material=await priceSources.read(symbol,interval,{...context,assertActive:check});}catch(e){error=e;}
   check();
   if(!error)return finish({status:'saved',source:material.marketSource.provider,dataAt:material.marketSource.diagnostics.dataAt,receivedAt:material.marketSource.source.receivedAt,dataState:material.marketSource.diagnostics.dataState},material);
   const reason=String(error.message||error).slice(0,240);if(attempt>=3)return finish({status:'unavailable',reason:'综合价量三次未完成：'+reason+'；保留缺口继续研判'},null);
   transaction(()=>{check();db.prepare('UPDATE event_cluster_research SET payload=? WHERE id=?').run(JSON.stringify({...parse(current),prices:{...started,attempts:[...started.attempts,{symbol,interval,attempt,state:'failed',at:at(),reason}]},nextRetryAt:now()+60000*attempt,reason:'综合价量等待重试：'+reason}),row.id);audit(row.id,'synthesis-review-price-retry',{clusterId:row.cluster_id,symbol,interval,attempt,reason});});
   return {ok:true,synthesisPrice:'retry',synthesisId:row.id};
  }
 };
}
