// A review acknowledges evidence as it existed, not all future changes to an event.
export const evidenceStamp=e=>JSON.stringify([e.id,e.newsRevision??null,e.claim,e.stance,e.verification,e.interpretation??null,e.review??null]);
export const latestReview=(book,position)=>(book?.reviews||[]).filter(r=>r.symbol===position.symbol&&r.at>=position.openedAt&&(position.lifecycleId?r.positionLifecycleId===position.lifecycleId:!r.positionLifecycleId)).at(-1);
export function reviewedVersion(book,position){
 const r=latestReview(book,position);
 return r&&r.result!=='verify'&&r.topicId===position.topicId?r.reviewedResearchVersion??position.researchVersion:position.researchVersion;
}
export function pendingCounterevidence(topic,book,positions){
 return topic.evidence.filter(e=>e.stance==='against'&&positions.some(p=>{
  const r=latestReview(book,p);
  return !r||r.result==='verify'||r.topicId!==topic.id||!r.reviewedEvidence?.includes(evidenceStamp(e));
 }));
}

export const positionReference=p=>({symbol:p.symbol,topicId:p.topicId,openedAt:p.openedAt,lifecycleId:p.lifecycleId||`legacy:${JSON.stringify([p.symbol,p.topicId,p.openedAt])}`});
