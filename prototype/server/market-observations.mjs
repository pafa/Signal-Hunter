import {crossThemeCandidates} from './cross-theme-observations.mjs';
import {hash} from './providers.mjs';
import {strategyRisk} from './strategy-risk.mjs';
import {decimal} from './market-sim-risk.mjs';
import {evidenceStamp} from '../shared/review-state.mjs';
const ENGINE='market-position-review/1';
const digest=value=>hash(JSON.stringify(value));
const refs=lots=>lots.map(l=>({symbol:l.symbol,topicId:l.topicId,openedAt:l.openedAt,lifecycleId:`market:${l.id}`,lotId:l.id})).sort((a,b)=>a.lotId.localeCompare(b.lotId));

// Shared by monitoring and existing approval/execution risk checks. The book is never mutated here.
export function withMarketObservationPeaks(db,book,accountId){
 const row=db.prepare('SELECT payload FROM market_observation_peaks WHERE id=?').get(accountId);
 if(!row)return book;
 const peaks=JSON.parse(row.payload),copy=structuredClone(book);
 copy.highWaterCents=Math.max(copy.highWaterCents||copy.initialCents,peaks.highWaterCents||0);
 for(const l of copy.lots){const p=peaks.prices[l.id]?.price;if(p&&(!l.peakPrice||decimal(p)>decimal(l.peakPrice)))l.peakPrice=p;}
 return copy;
}

// This reads execution inputs but never advances execution, settlement, peaks or risk pauses.
export function marketReviewCandidates(snapshot,topics){
 const {accountId,book:b,valuation:v,risk,quotes,at,sourceNote}=snapshot;
 if(!b)return [];
 const candidates=[],byTopic=new Map(topics.map(t=>[t.id,t])),policy={configVersion:b.configVersion,config:b.config,profile:b.profile};
 const add=(scope,reviewKind,state,reason,{lots=[],topic=null,identity=null,metrics={},evidence=[]}={})=>{
  const symbols=[...new Set(lots.map(l=>l.symbol))].sort(),key=digest([ENGINE,accountId,scope,reviewKind]);
  const input={ruleVersion:ENGINE,reviewKind,accountId,evaluatedAt:at,bookVersion:b.version,...policy,monitoring:snapshot.monitoring||null,metrics,evidence,sourceNote,
   lots:structuredClone(lots),quotes:Object.fromEntries(symbols.map(s=>[s,quotes[s]||null]))};
  candidates.push({key,state,reason,accountId,fingerprint:digest([policy,identity]),hit:{kind:'market-review',accountId,title:topic?`${b.profile?.name||accountId} · ${topic.title}`:b.profile?.name||accountId,topicId:topic?.id||null,topicVersion:topic?.version??null,reason,symbols,affectedPositions:refs(lots),input}});
 };
 for(const l of b.lots){
  const t=byTopic.get(l.topicId),scope=`lot:${l.id}`,opening=b.orders.find(o=>o.id===b.fills.find(f=>f.id===l.id)?.orderId)?.researchSnapshot;
  add(scope,'research-status',!t||t.status!=='active'?'hit':'clear',!t?'持仓关联研究缺失，需核对':'持仓关联研究已归档，需核对',{lots:[l],topic:t,identity:t?.status||'missing',metrics:{openingTopicId:l.topicId}});
  add(scope,'research-version',t&&t.status==='active'&&t.version!==l.topicVersion?'hit':'clear','持仓关联研究版本已变化，需复核原交易假设',{lots:[l],topic:t,identity:t?.version,metrics:{openingVersion:l.topicVersion,currentVersion:t?.version??null}});
  const old=new Set((opening?.evidence||[]).map(evidenceStamp)),against=(t?.evidence||[]).filter(e=>e.stance==='against'&&!old.has(evidenceStamp(e)));
  add(scope,'counterevidence',!t?'unknown':against.length?'hit':'clear','持仓研究出现开仓基线之外的反向线索',{lots:[l],topic:t,identity:against.map(evidenceStamp).sort(),evidence:against,metrics:{openingBaselineAvailable:!!opening}});
  const due=Date.parse(l.holdUntil);
  add(scope,'holding-review',!Number.isFinite(due)?'unknown':due<=Date.parse(at)?'hit':'clear','持仓复核截止已到，需本人决定下一步',{lots:[l],topic:t,identity:l.holdUntil,metrics:{holdUntil:l.holdUntil}});
  const value=v.positions.find(p=>p.id===l.id),priceKnown=value?.valueCents!=null&&!!l.entryPrice;
  const exit=risk.alerts.find(a=>a.lotId===l.id&&['loss-exit-review','trailing-exit-review'].includes(a.kind));
  add(scope,'price-exit',!priceKnown?'unknown':exit?'hit':'clear',exit?.message||'价格退出条件当前无法判断或未命中',{lots:[l],topic:t,identity:exit?.kind,metrics:{alert:exit||null,entryPrice:l.entryPrice,recordedPeak:l.peakPrice,valueCents:value?.valueCents??null}});
 }
 // Unavailable valuation is itself a review task; it never means zero exposure or zero drawdown.
 add('pool','market-input',v.missing.length?'hit':'clear','持仓估值输入缺失或失效，组合风险无法完整判断',{lots:b.lots,identity:[...v.missing].sort(),metrics:{missing:v.missing}});
 const poolAlert=risk.alerts.find(a=>['pool-warning','pool-stop'].includes(a.kind));
 add('pool','drawdown',risk.drawdownPct===null?'unknown':poolAlert?'hit':'clear',poolAlert?.message||'策略池回撤当前无法判断或未命中',{lots:b.lots,identity:poolAlert?.kind,metrics:{alert:poolAlert||null,drawdownPct:risk.drawdownPct,navCents:risk.navCents,peakCents:risk.peakCents}});
 const nav=v.navCents,known=nav!==null&&nav>0;
 add('pool','cash-floor',!known?'unknown':v.availableCashCents/nav*100<b.config.cashFloorPct?'hit':'clear','扣除已批准买单预算后的可用现金低于本池底线',{lots:b.lots,identity:b.orders.filter(o=>['approved','partial'].includes(o.status)&&o.side==='buy').map(o=>o.id).sort(),metrics:{availableCashCents:v.availableCashCents,reservedCents:v.reservedCents,navCents:nav,observedPct:known?v.availableCashCents/nav*100:null,thresholdPct:b.config.cashFloorPct}});
 for(const [field,kind,threshold] of [['issuerId','issuer-cap',b.config.issuerCapPct],['topicId','theme-cap',b.config.themeCapPct]]){
  const groups=Map.groupBy(v.positions,p=>p[field]);
  for(const [id,positions] of groups){
   const identityOK=field!=='issuerId'||positions.every(p=>quotes[p.symbol]?.issuerId===p.issuerId);
   const value=known&&identityOK?positions.reduce((n,p)=>n+p.valueCents,0):null,pct=value===null?null:value/nav*100;
   add(`${kind}:${id}`,kind,pct===null?'unknown':pct>threshold?'hit':'clear',field==='issuerId'?'同一发行人跨市场持仓超过本池上限':'同一研究主题持仓超过本池上限',{lots:b.lots.filter(l=>l[field]===id),topic:field==='topicId'?byTopic.get(id):null,identity:positions.map(p=>p.id).sort(),metrics:{groupId:id,valueCents:value,navCents:nav,observedPct:pct,thresholdPct:threshold,identityVerified:identityOK}});
  }
 }
 return candidates;
}

export function openMarketObservations(db,{getSnapshots,clustersForTopic}){
 db.exec('CREATE TABLE IF NOT EXISTS market_observation_states(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS market_observation_peaks(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT id,payload FROM market_observation_states').all();
 const save=(id,state)=>db.prepare('INSERT INTO market_observation_states VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(state));
 const observePeaks=snapshot=>{
  if(!snapshot.book)return snapshot;
  const {accountId,at,valuation:v,quotes}=snapshot,book=structuredClone(snapshot.book);
  const row=db.prepare('SELECT payload FROM market_observation_peaks WHERE id=?').get(accountId),prior=row?JSON.parse(row.payload):null;
  if(prior&&Date.parse(at)<Date.parse(prior.checkedAt))throw new Error('持仓巡检时钟倒退，未消费本次条件');
  const prices={};
  for(const l of book.lots){
   let record={price:l.peakPrice||l.entryPrice||null,observedAt:null,basis:'execution-ledger',bookVersion:book.version};
   const old=prior?.prices[l.id];if(old&&(!record.price||decimal(old.price)>=decimal(record.price)))record=structuredClone(old);
   if(v.positions.find(p=>p.id===l.id)?.valueCents!=null&&(!record.price||decimal(quotes[l.symbol].mark)>decimal(record.price)))record={price:String(quotes[l.symbol].mark),observedAt:at,basis:'observation',bookVersion:book.version,quote:structuredClone(quotes[l.symbol])};
   if(record.price){l.peakPrice=record.price;prices[l.id]=record;}
  }
  const ledgerPeak=book.highWaterCents||book.initialCents,oldPeak=prior?.highWaterCents||0;
  let navPeak=oldPeak>=ledgerPeak?prior?.navPeak||{basis:'legacy-monitoring',valueCents:oldPeak}:{basis:'execution-ledger',bookVersion:book.version,valueCents:ledgerPeak};
  if(v.navCents!=null&&v.navCents>Math.max(ledgerPeak,oldPeak))navPeak={basis:'observation',observedAt:at,bookVersion:book.version,valueCents:v.navCents,cashCents:book.cashCents,unsettledCashCents:v.unsettledCashCents,positions:structuredClone(v.positions),quotes:Object.fromEntries([...new Set(book.lots.map(l=>l.symbol))].map(s=>[s,structuredClone(quotes[s])]))};
  book.highWaterCents=Math.max(ledgerPeak,oldPeak,v.navCents??0);
  const monitoring={checkedAt:at,highWaterCents:book.highWaterCents,navPeak,prices};
  db.prepare('INSERT INTO market_observation_peaks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(accountId,JSON.stringify(monitoring));
  return {...snapshot,book,risk:strategyRisk(book,quotes,at),monitoring};
 };
 return {
  // Caller owns the same transaction as observation_todos; failures roll back episode consumption.
  evaluate(topics,at){
   const snapshots=getSnapshots(at),accounts=new Set([...snapshots.map(s=>s.accountId),'cross-theme']),prior=new Map(rows().map(r=>[r.id,JSON.parse(r.payload)])),seen=new Set(),hits=[];
   const candidates=snapshots.flatMap(snapshot=>marketReviewCandidates(observePeaks(snapshot),topics));
   candidates.push(...crossThemeCandidates(snapshots,topics,clustersForTopic));
   for(const c of candidates){
    seen.add(c.key);const old=prior.get(c.key),state={...old,accountId:c.accountId,status:c.state,reason:c.reason,checkedAt:at,episode:old?.episode||0};
    if(c.state==='hit'&&(!old?.active||old.fingerprint!==c.fingerprint)){
     state.episode++;state.active=true;state.fingerprint=c.fingerprint;
     hits.push({...c.hit,id:digest([c.key,state.episode,c.fingerprint]),input:{...c.hit.input,episode:state.episode}});
    }else if(c.state==='clear')state.active=false;
    save(c.key,state);
   }
   // Closing a lot removes its condition. Unknown quotes retain the active episode instead.
   const overlapUnknown=candidates.some(c=>c.accountId==='cross-theme'&&!c.hit&&c.state==='unknown');
   for(const [id,old] of prior)if(accounts.has(old.accountId)&&!seen.has(id)&&old.status!=='retired')save(id,old.accountId==='cross-theme'&&overlapUnknown?{...old,status:'unknown',reason:'跨主题输入不完整，保留此前触发轮次',checkedAt:at}:{...old,active:false,status:'retired',checkedAt:at});
   return hits;
  },
  checks(){return rows().map(r=>({id:r.id,...JSON.parse(r.payload)})).filter(r=>r.status!=='retired');}
 };
}
