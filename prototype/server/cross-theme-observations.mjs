import {hash} from './providers.mjs';
import {amount,quoteIssues,issuerIssues,working,sum} from './market-sim-risk.mjs';
const ENGINE='cross-theme-review/2',accountId='cross-theme';
const digest=x=>hash(JSON.stringify(x));
// Evidence overlap is a review condition, not a correlation estimate or a new trading limit.
export function crossThemeCandidates(snapshots,topics,clustersForTopic=()=>[]){
 const byTopic=new Map(topics.map(t=>[t.id,t])),groups=new Map(),missing=[],entries=[];
 const add=(kind,id,entry,basis,current)=>{
  const key=kind+':'+id,g=groups.get(key)||{kind,id,entries:new Map(),bases:new Map(),current:true};
  g.entries.set(entry.key,entry);g.bases.set(entry.topicId,basis);g.current&&=current;groups.set(key,g);
 };
 for(const s of snapshots){
  if(!s.book)continue;const {book:b,quotes,at}=s;
  for(const x of [...b.lots.map(l=>({kind:'lot',record:l})),...b.orders.filter(o=>working(o)&&o.side==='buy'&&o.qty>o.filledQty).map(o=>({kind:'buy-order',record:o}))]){
   const r=x.record,q=quotes[r.symbol],issuer=x.kind==='lot'?r.issuerId:r.approval?.evidence?.quotes?.[r.symbol]?.issuerId,issues=[...quoteIssues(r.symbol,q,b.config,at),...issuerIssues(r.symbol,issuer,q)],qty=x.kind==='lot'?r.qty:r.qty-r.filledQty;
   const topic=byTopic.get(r.topicId),entry={key:`${s.accountId}:${x.kind}:${r.id}`,accountId:s.accountId,kind:x.kind,id:r.id,topicId:r.topicId,topicVersion:topic?.version??null,topicTitle:topic?.title||'研究缺失',symbol:r.symbol,qty,record:structuredClone(r),quote:q?structuredClone(q):null,bookVersion:b.version,valueCents:null};
   if(!issues.length)try{entry.valueCents=amount(qty,q.mark,q.fx.usdPerUnit);}catch{issues.push('估值金额无效');}
   entry.valuationIssues=issues;entries.push(entry);
   // Both fills and approvals retain their original issuer; changed quotes cannot regroup exposure.
   const identityOK=typeof issuer==='string'&&!!issuer&&q?.issuerId===issuer&&!issues.length;
   if(typeof issuer==='string'&&issuer)add('issuer',issuer,entry,{issuerId:issuer,verified:identityOK},identityOK);
   if(!identityOK)missing.push(`${entry.key}：发行人或估值输入未核验`);
   if(!topic)missing.push(`${entry.key}：研究缺失`);
  }
 }
 const clusters=new Map();
 for(const entry of entries){
  const topic=byTopic.get(entry.topicId);if(!topic)continue;
  if(!clusters.has(topic.id))clusters.set(topic.id,clustersForTopic(topic));
  for(const c of clusters.get(topic.id)){
   const current=c.status==='active'&&c.health?.current===true&&c.bindingCurrent===true;
   add('event-cluster',c.id,entry,structuredClone(c),current);
   if(!current)missing.push(`${topic.id}：事件簇 ${c.id} 关联需要重新核对`);
  }
 }
 const candidates=[];
 for(const g of groups.values()){
  const rows=[...g.entries.values()].sort((a,b)=>a.key.localeCompare(b.key)),topicIds=[...new Set(rows.map(r=>r.topicId))].sort();
  if(topicIds.length<2)continue;
  const bases=[...g.bases.entries()].sort(([a],[b])=>a.localeCompare(b)),known=rows.every(r=>r.valueCents!==null),valueCents=known?sum(rows.map(r=>r.valueCents)):null;
  const reason=g.kind==='issuer'?'多个研究主题暴露于同一发行人，需合并复核':'多个研究主题关联同一已确认事件簇，需复核共同风险';
  const key=digest([ENGINE,g.kind,g.id]),identity={bases,entries:rows.map(r=>({key:r.key,qty:r.qty,topicVersion:r.topicVersion}))};
  const input={ruleVersion:ENGINE,reviewKind:'cross-theme',accountId,evaluatedAt:snapshots[0]?.at,groupKind:g.kind,groupId:g.id,bases,entries:rows,topics:topicIds.map(id=>structuredClone(byTopic.get(id)||{id,status:'missing'})),metrics:{valueCents,knownValuation:known,topicCount:topicIds.length,accountCount:new Set(rows.map(r=>r.accountId)).size,lotCount:rows.filter(r=>r.kind==='lot').length,buyOrderCount:rows.filter(r=>r.kind==='buy-order').length},scope:'已持仓与已批准未成交买单；买单按剩余数量和当前估值列示，不代表已成交。仅识别发行人和已确认事件簇重叠，不证明其他主题独立，不估计相关系数或新增仓位限额。'};
  candidates.push({key,accountId,state:g.current?'hit':'unknown',reason:g.current?reason:'跨主题关联依据失效或行情未知，保留旧待办并等待复核',fingerprint:digest(identity),hit:{kind:'cross-theme-review',accountId,title:'跨主题共同风险复核',topicId:null,topicVersion:null,reason,symbols:[...new Set(rows.map(r=>r.symbol))].sort(),affectedPositions:[],input}});
 }
 if(entries.length)candidates.push({key:digest([ENGINE,'coverage']),accountId,state:missing.length?'unknown':'clear',reason:missing.length?'跨主题识别有缺失或失效依据；未命中不能视为风险独立':'已检查发行人及当前事件簇重叠；不覆盖未识别的共同风险',fingerprint:'coverage',hit:null});
 return candidates;
}
