// Current monitoring follows only saved event membership/source succession. Opening
// lots, fills and research snapshots remain immutable; this is a read projection.
export const HOLDING_RESEARCH_VERSION='holding-research/1';
const binding=s=>s?Object.fromEntries(['kind','id','runId','version'].map(k=>[k,s[k]])):null;
const same=(a,b)=>!!a&&!!b&&['kind','id','runId','version'].every(k=>a[k]===b[k]);
const topicId=s=>s.kind==='event-cluster'?`event-cluster:${s.id}`:s.id;
export function holdingResearchLinks(book,context={}){
 const subjects=context.subjects||[],clusters=context.holdingClusters||[];
 return (book?.lots||[]).map(l=>{
  const opening={topicId:l.topicId,version:l.topicVersion,researchBinding:l.researchBinding||null,symbol:l.symbol};
  const result={engine:HOLDING_RESEARCH_VERSION,lotId:l.id,opening,status:'legacy',current:null,topicId:l.topicId,relation:{kind:'same-research'},reason:'沿用原研究监控；建仓依据保留'};
  if(context.reason)return {...result,status:'waiting',reason:context.reason};
  let kind=l.researchBinding?.kind||'research',id=l.researchBinding?.id||l.topicId;
  if(kind==='research'){
   // Prefer the original event's verified membership/history. An unclustered
   // source can then follow one full-matrix link and the successor's cluster.
   for(let hop=0;hop<2;hop++){
   const matches=clusters.flatMap(c=>{const h=(c.history||[]).find(h=>h.topicId===id);return c.topicIds?.includes(id)||h?[{c,h}]:[];});
   const unresolved=(context.holdingClusterRefs?.[id]||[]).filter(c=>c.status==='active'&&!matches.some(m=>m.c.id===c.id));
   if(matches.length>1||unresolved.length)return {...result,status:'waiting',reason:'持仓的事件关联或修订接续无法唯一核对；后台继续核查',relation:{kind:'unresolved-event',clusterIds:[...new Set([...matches.map(m=>m.c.id),...unresolved.map(c=>c.id)])].sort()}};
   if(matches.length){const {c,h}=matches[0],sourceSuccession=result.relation.kind==='source-succession'?result.relation:null,currentTopicId=h?.currentTopicId||id;kind='event-cluster';id=c.id;result.topicId=`event-cluster:${id}`;result.relation={kind:h||sourceSuccession?'event-succession':'event-member',clusterId:id,clusterVersion:c.version,openingTopicId:l.topicId,currentTopicId,...(h?{succession:h}:{}),...(sourceSuccession?{sourceSuccession}:{})};
    if(c.status!=='active'||c.health?.current!==true)return {...result,status:'waiting',reason:'持仓关联事件的成员或比较依据已变化，等待后台重新核对'};
    break;
   }
   const next=hop===0?context.holdingSuccessions?.[id]:null;if(!next)break;
   result.relation={kind:'source-succession',openingTopicId:l.topicId,currentTopicId:next.topicId||null,jobId:next.jobId,batchId:next.batchId,sourceHash:next.sourceHash};
   if(next.status!=='current')return {...result,status:'waiting',reason:next.reason};
   id=next.topicId;result.topicId=id;
   }
  }
  const s=subjects.find(s=>s.kind===kind&&s.id===id);
  if(!s){if(!l.researchBinding&&result.relation.kind==='same-research')return result;return {...result,status:'waiting',reason:'当前监控研究尚未形成合格综合，原持仓与价格风险继续跟踪'};}
  result.current=binding(s);result.topicId=topicId(s);
  if(!s.ready||!s.fresh||s.changed)return {...result,status:'waiting',reason:s.reason||'当前监控研究或来源已变化，等待新版判断'};
  if(!s.current?.companies?.some(c=>c.symbol===l.symbol))return {...result,status:'waiting',reason:'当前研究已无此确切证券，不能借用其他上市地的判断'};
  return {...result,status:'current',reason:result.relation.kind==='same-research'?'跟踪本研究最新有效判断；建仓依据保留':kind==='event-cluster'?'按已核对的事件关系跟踪当前综合；建仓依据保留':'按已核对的新旧事项对应跟踪当前研究；建仓依据保留'};
 });
}
export const matchesHoldingOpening=(lot,link)=>link?.engine===HOLDING_RESEARCH_VERSION&&link.lotId===lot.id&&link.opening?.topicId===lot.topicId&&link.opening.version===lot.topicVersion&&link.opening.symbol===lot.symbol&&(lot.researchBinding?same(lot.researchBinding,link.opening.researchBinding):link.opening.researchBinding===null);
export function holdingOrderIssues(book,order,context){
 if(!order.holdingResearchLinks)return [];
 if(order.side!=='sell'||!order.targetLotIds?.length)return ['持仓接续方案缺少明确的卖出批次'];
 const current=holdingResearchLinks(book,context);
 for(const lot of book.lots.filter(l=>order.targetLotIds.includes(l.id))){
  const frozen=order.holdingResearchLinks.find(x=>x.lotId===lot.id),now=current.find(x=>x.lotId===lot.id);
  if(!matchesHoldingOpening(lot,frozen)||frozen.status!=='current'||!same(frozen.current,order.researchBinding)||JSON.stringify(frozen)!==JSON.stringify(now))return ['持仓监控关联或研究依据已变化，旧批准不能移用到新的研究'];
 }
 return [];
}
