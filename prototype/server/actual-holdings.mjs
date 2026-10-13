import {createHash,randomUUID} from 'node:crypto';
import {ACTUAL_COLUMNS,actualAmount,actualHoldingErrors,failActual,normalizeActualRow,parseActualCsv} from '../shared/actual-holdings.mjs';
import {openActualLedger,ledgerHoldingRecords} from './actual-ledger.mjs';
import {ledgerAccountParts,ledgerGroupKey,ledgerSum} from '../shared/actual-ledger.mjs';
import {compareMarketTime} from './market-time.mjs';
import {actualReferenceValuation} from './actual-valuation.mjs';
import {projectActualMonitoring} from '../shared/actual-monitoring.mjs';
import {projectActualResearch,actualResearchOrigins} from './actual-research.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const identity=r=>hash([r.account,r.symbol]);
const content=r=>{const {reason,...value}=r;return value;};
const inputRow=r=>Object.fromEntries(ACTUAL_COLUMNS.map(k=>[k,r[k]]));
export function openActualHoldings(store,{enabled=false,clock=()=>new Date().toISOString(),getTopic=()=>null,getPriceWatchStates=()=>new Map()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS actual_holding_batches(id TEXT PRIMARY KEY,base_version INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,applied_version INTEGER,applied_at TEXT);
 CREATE TABLE IF NOT EXISTS actual_holding_records(record_id TEXT NOT NULL,version INTEGER NOT NULL,batch_id TEXT NOT NULL REFERENCES actual_holding_batches(id),payload TEXT NOT NULL,hash TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(record_id,version));
 CREATE INDEX IF NOT EXISTS actual_holding_batch_records ON actual_holding_records(batch_id);
 CREATE TABLE IF NOT EXISTS actual_holding_watch_links(record_id TEXT PRIMARY KEY,symbol TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const guard=()=>{if(!enabled)failActual(11);if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')failActual(12);};
 const version=()=>db.prepare('SELECT COALESCE(MAX(applied_version),0) n FROM actual_holding_batches').get().n;
 const ledger=openActualLedger(store,{guard,clock,getTopic,snapshotVersion:version,snapshotRecords:()=>latest()});
 const effective=()=>{const book=ledger.snapshot(),groups=new Set(book.accounts.map(a=>a.key)),legacyRecords=latest();return {ledger:book,legacyRecords,records:[...legacyRecords.filter(r=>!groups.has(ledgerGroupKey(r))),...ledgerHoldingRecords(book)]};};
 const read=r=>{const p=JSON.parse(r.payload);if(hash(p)!==r.hash||identity(p)!==r.record_id)failActual(15);return {...p,id:r.record_id,version:r.version,batchId:r.batch_id,recordedAt:r.recorded_at};};
 const latest=()=>db.prepare('SELECT r.* FROM actual_holding_records r WHERE version=(SELECT MAX(s.version) FROM actual_holding_records s WHERE s.record_id=r.record_id) ORDER BY recorded_at DESC,record_id').all().map(read);
 const topicCheck=(r,previous)=>{if(!r.topicId||previous&&previous.topicId===r.topicId&&previous.topicVersion===r.topicVersion)return;const t=getTopic(r.topicId);if(!t||t.status==='archived'||t.version!==r.topicVersion||!t.companies?.some(c=>c.symbol===r.symbol))failActual(5);};
 const plan=(inputs,at)=>{
  const old=new Map(latest().map(r=>[r.id,r])),seen=new Map(),ledgerGroups=new Set(ledger.snapshot().accounts.map(a=>a.key));
  return inputs.map((input,index)=>{
   let row;
   try{
    row=normalizeActualRow(input,at);if(ledgerGroups.has(ledgerGroupKey(row)))failActual(21);const id=identity(row),previous=old.get(id),fingerprint=hash(content(row)),first=seen.get(id);topicCheck(row,previous);
    if(first&&first!==fingerprint)failActual(6);
    seen.set(id,fingerprint);
    let action=first===fingerprint||previous&&hash(content(normalizeActualRow(inputRow(previous),at)))===fingerprint?'duplicate':previous?'update':'add';
    if(action!=='duplicate'&&previous){if(row.asOf<previous.asOf)failActual(7);if(!row.reason)failActual(8);if(row.asOf===previous.asOf)action='correction';}
    return {index:index+1,id,row,previous:previous||null,action,issue:null};
   }catch(e){return {index:index+1,row:row||null,action:'invalid',issue:actualHoldingErrors.includes(e.message)?e.message:actualHoldingErrors[0]};}
  });
 };
 const batch=id=>{
  if(typeof id!=='string')failActual(13);const r=db.prepare('SELECT * FROM actual_holding_batches WHERE id=?').get(id);if(!r)failActual(13);
  const p=JSON.parse(r.payload);if(hash(p)!==r.hash)failActual(15);
  return {...p,id:r.id,hash:r.hash,createdAt:r.created_at,expiresAt:new Date(Date.parse(r.created_at)+1800000).toISOString(),appliedVersion:r.applied_version,appliedAt:r.applied_at};
 };
 const transact=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 return {
  ledger,
  holdingSymbols(){return enabled?[...new Set(effective().records.filter(r=>r.quantity!=='0').map(r=>r.symbol))]:[];},
  holdingReferences(){return enabled?effective().records.filter(r=>r.quantity!=='0').flatMap(r=>actualResearchOrigins(r).map(o=>({symbol:r.symbol,topicId:o.topicId}))):[];},
  snapshot(){const combined=effective(),records=combined.records,watches=new Set(store.watchlist().map(w=>w.symbol)),priceStates=getPriceWatchStates();return {enabled,version:version(),...combined,watching:records.filter(r=>r.quantity!=='0').map(r=>({recordId:r.id,symbol:r.symbol,state:watches.has(r.symbol)?'watching':db.prepare('SELECT 1 FROM actual_holding_watch_links WHERE record_id=?').get(r.id)||store.watchRemoved(r.symbol)?'removed':'deferred',reason:watches.size>=40?'已达40个行情关注上限':'等待后台登记',...priceStates.get(r.symbol)})),note:'本人记录的持仓快照与逐笔账本；按账户币种选择其一，历史快照保留，不是券商实时同步'};},
  syncWatches(){
   if(!enabled)return;guard();
   return transact(()=>{for(const r of effective().records.filter(r=>r.quantity!=='0')){
    if(store.watchRemoved(r.symbol))continue;
    if(db.prepare('SELECT 1 FROM actual_holding_watch_links WHERE record_id=?').get(r.id))continue;
    if(!store.watchlist().some(w=>w.symbol===r.symbol)&&store.watchlist().length>=40)continue;
    store.addWatch(r.symbol,{automatic:true});db.prepare('INSERT INTO actual_holding_watch_links VALUES(?,?,?)').run(r.id,r.symbol,clock());
   }});
  },
  history(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))failActual(13);const rows=db.prepare('SELECT * FROM actual_holding_records WHERE record_id=? ORDER BY version DESC').all(id).map(read);if(!rows.length)failActual(13);return rows;},
  preview(input){
   guard();if(!fields(input,['rows'])&&!fields(input,['csv']))failActual(0);
   const inputs='csv' in input?parseActualCsv(input.csv):input.rows;if(!Array.isArray(inputs)||!inputs.length||inputs.length>100||JSON.stringify(inputs).length>100000)failActual(0);
   return transact(()=>{
    const at=clock(),items=plan(inputs,at),baseVersion=version(),id=randomUUID(),payload={baseVersion,ledgerVersion:ledger.snapshot().version,items,canApply:!items.some(r=>r.action==='invalid')&&items.some(r=>!['duplicate','invalid'].includes(r.action))};
    db.prepare('INSERT INTO actual_holding_batches(id,base_version,payload,hash,created_at) VALUES(?,?,?,?,?)').run(id,baseVersion,JSON.stringify(payload),hash(payload),at);return batch(id);
   });
  },
  apply(input){
   guard();if(!fields(input,['id','hash'])||typeof input.hash!=='string')failActual(0);
   return transact(()=>{
    const p=batch(input.id);if(p.hash!==input.hash)failActual(9);
    if(p.appliedVersion!==null)return {id:p.id,version:p.appliedVersion,replayed:true};
    if(!p.canApply)failActual(10);const at=clock();if(p.baseVersion!==version()||(p.ledgerVersion||0)!==ledger.snapshot().version||at>p.expiresAt||at<p.createdAt)failActual(9);
    for(const item of p.items)topicCheck(item.row,item.previous);
    for(const item of p.items.filter(r=>r.action!=='duplicate')){
     const payload=JSON.stringify(item.row);db.prepare('INSERT INTO actual_holding_records VALUES(?,?,?,?,?,?)').run(item.id,(item.previous?.version||0)+1,p.id,payload,hash(item.row),at);
    }
    const v=p.baseVersion+1;db.prepare('UPDATE actual_holding_batches SET applied_version=?,applied_at=? WHERE id=?').run(v,at,p.id);return {id:p.id,version:v,replayed:false};
   });
  },
 };
}

export function projectActualAccounts(snapshot,topics,at,monitoring={},valuation={}){
 const groups=new Map(),byTopic=new Map(topics.map(t=>[t.id,t]));
 // These indexes belong only to this projection. Keep every row and its order;
 // freshness, rule versions and old active hits still use the original checks.
 const {checks=[],rules=[]}=monitoring,{watching=[]}=snapshot;
 const checksByRecord=Map.groupBy(checks,c=>c.recordId),rulesByTopic=Map.groupBy(rules,r=>r.topicId),watchingByRecord=Map.groupBy(watching,w=>w.recordId);
 for(const r of snapshot.records.filter(r=>r.quantity!=='0')){
  const account='actual:'+hash(ledgerAccountParts(r)),topic=byTopic.get(r.topicId),h=topic?.hypothesis||{},costCents=r.accountingOrigin==='actual-ledger'?r.costCents:actualAmount(r.quantity,r.unitCost),valueCents=actualAmount(r.quantity,r.price);
  const pnl=costCents===null||valueCents===null?null:valueCents-costCents;
  const reference=actualReferenceValuation(r,{...valuation,at,costCents});
  const projectedResearch=monitoring.researchContext?projectActualResearch(r,topics,monitoring.researchContext,at):null;
  const monitor=projectActualMonitoring(r,topic,{...monitoring,checks:checksByRecord.get(r.id)||[],rules:rulesByTopic.get(r.topicId)||[],watching:watchingByRecord.get(r.id)||[],at,researchContextHash:projectedResearch?.contextHash});
  const researchView=projectedResearch&&{...projectedResearch,exitAdvice:projectedResearch.exitAdvice.state==='review'&&!monitor.current?{...projectedResearch.exitAdvice,state:'waiting',reason:'这版持仓尚无当前有效巡检；后台更新后再结合研究决定'}:projectedResearch.exitAdvice};
  const risks=[...(researchView?.risks||[]),...monitor.risks,...reference.issues];
  if(costCents===null)risks.push('成本未知，无法计算浮盈亏');
  if(r.feeBasis!=='included')risks.push(r.feeBasis==='excluded'?'记录成本未含费用，浮盈亏未扣全部费用':'成本是否含费用未知');
  if(!r.topicId&&!researchView)risks.push('未绑定原研究；不自动猜测建仓依据');
  else if(!monitor.current&&(!topic||topic.version!==r.topicVersion||topic.status==='archived'))risks.push('原研究与当前版本不同或不可用，需复核');
  const p={accountKind:r.accountKind||'actual',id:'actual:'+r.id,recordId:r.id,recordVersion:r.version,account,symbol:r.symbol,name:topic?.companies?.find(c=>c.symbol===r.symbol)?.name||r.symbol,topicId:r.topicId,topicTitle:topic?.title||'未绑定研究',openingVersion:r.topicVersion,currentVersion:topic?.version??null,
   qty:r.quantity,currency:r.currency,costCents,valueCents:reference.valueCents,unrealizedCents:reference.unrealizedCents,returnPct:reference.returnPct,
   price:reference.price,priceAt:reference.priceAt,priceSource:reference.source,priceBasis:reference.state==='available'?'参考标记价':'当前价不可用',recordedAsOf:r.asOf,openedAt:r.openedAt||null,accountingOrigin:r.accountingOrigin||'snapshot',monitoring:monitor,referenceValuation:reference,
   recordValuation:{price:r.price,priceAt:r.price?r.asOf:null,priceSource:r.source,valueCents,unrealizedCents:pnl,returnPct:pnl===null||!costCents?null:pnl/costCents*100,feeBasis:r.feeBasis},
   judgement:({observe:'继续观察',buy:'评估买入',add:'评估增仓',reduce:'评估减仓',exit:'评估退出'})[h.action]||'判断待补',trigger:h.trigger||null,invalidation:h.invalidation||null,holdingHorizon:h.holdingHorizon||null,reviewAt:h.reviewAt||null,
   ...(researchView?{actualResearch:researchView,monitoringTopicId:researchView.link.topicId,currentBinding:researchView.currentBinding,currentVersion:researchView.currentBinding?.version??null,topicTitle:researchView.title,openingTitle:topic?.title||null,judgement:researchView.judgement,trigger:researchView.trigger,invalidation:researchView.invalidation,holdingHorizon:researchView.holdingHorizon,reviewAt:researchView.reviewAt}:{}),risks:[...new Set(risks)]};
  if(!groups.has(account))groups.set(account,{id:account,label:`${r.accountKind==='manual-simulation'?'手动模拟':'实际'} · ${r.account} · ${r.currency}`,kind:r.accountKind||'actual',configured:true,currency:r.currency,version:snapshot.version,updatedAt:r.recordedAt,positions:[],navCents:null,realizedCents:null,feesCents:null,currentDrawdownPct:null,drawdownBasis:'快照不能推导净值回撤',sourceNote:'按已录数量估算当前参考盈亏；非券商实时账户收益，未扣未来卖出费用；原币分别查看'});
  groups.get(account).positions.push(p);
 }
 for(const a of snapshot.ledger?.accounts||[]){const id='actual:'+hash(ledgerAccountParts(a));if(!groups.has(id))groups.set(id,{id,label:`${a.accountKind==='manual-simulation'?'手动模拟':'实际'} · ${a.account} · ${a.currency}`,kind:a.accountKind||'actual',configured:true,currency:a.currency,positions:[],version:snapshot.version});const {positions:_,...summary}=a;groups.get(id).ledger=summary;}
 return [...groups.values()].map(a=>{const ps=a.positions,known=ps.every(p=>p.unrealizedCents!==null),times=ps.map(p=>p.priceAt).filter(Boolean).sort(compareMarketTime);
  const sum=(rows,f)=>{const n=rows.filter(f).reduce((v,p)=>v+BigInt(p.unrealizedCents),0n);return n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER)?null:Number(n);};
  const records=ps.map(p=>p.recordValuation),sameRecordTime=new Set(ps.map(p=>p.recordedAsOf)).size===1,recordsComplete=sameRecordTime&&records.every(p=>p.unrealizedCents!==null);
  const ledger=a.ledger;let nav=null,periodPnl=null;try{if(ledger){nav=ledgerSum([ledger.cashCents,...ps.map(p=>p.valueCents)]);if(ledger.performanceKnown&&nav!==null&&ledger.openingValueCents!==null)periodPnl=ledgerSum([nav,-ledger.openingValueCents,-ledger.netFlowsCents]);}}catch{nav=null;periodPnl=null;}
  return {...a,...(ledger?{version:'ledger-'+ledger.version,updatedAt:ledger.recordedAt,navCents:nav,cashCents:ledger.cashCents,realizedCents:ledger.realizedCents,feesCents:ledger.feesCents,incomeCents:ledger.incomeCents,netFlowsCents:ledger.netFlowsCents,periodPnlCents:periodPnl,risks:ledger.issues,currentDrawdownPct:null,drawdownBasis:'尚无完整同口径净值路径',sourceNote:'本人逐笔记录 + 合格当前标记价；原币账面现金不是已结算可用资金；未与券商实时同步'}:{}),valuationAt:known?at:null,priceTimeRange:times.length?[times[0],times.at(-1)]:null,valuedPositions:ps.filter(p=>p.valueCents!==null).length,unrealizedCents:known?sum(ps,()=>true):null,floatingProfitCents:known?sum(ps,p=>p.unrealizedCents>0):null,floatingLossCents:known?sum(ps,p=>p.unrealizedCents<0):null,dailyPnlCents:null,maxDrawdownPct:null,
   recordValuation:{at:sameRecordTime&&ps.length?ps[0].recordedAsOf:null,unrealizedCents:recordsComplete?sum(records,()=>true):null,floatingProfitCents:recordsComplete?sum(records,p=>p.unrealizedCents>0):null,floatingLossCents:recordsComplete?sum(records,p=>p.unrealizedCents<0):null,issue:!sameRecordTime?'记录时间不一致，原记录盈亏不合计':!recordsComplete?'存在未知成本或记录价格，原记录盈亏不合计':null},
   unavailable:{dailyPnl:'缺少完整成交、现金流及净值基准',maxDrawdown:ledger?'尚无完整同口径净值路径':'持仓快照不是完整净值序列',aggregate:!known?'存在未知成本或当前行情，当前参考盈亏不合计':null}};
 });
}
