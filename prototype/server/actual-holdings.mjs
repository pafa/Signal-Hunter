import {createHash,randomUUID} from 'node:crypto';
import {ACTUAL_COLUMNS,actualAmount,actualHoldingErrors,failActual,normalizeActualRow,parseActualCsv} from '../shared/actual-holdings.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const identity=r=>hash([r.account,r.symbol]);
const content=r=>{const {reason,...value}=r;return value;};
const inputRow=r=>Object.fromEntries(ACTUAL_COLUMNS.map(k=>[k,r[k]]));
export function openActualHoldings(store,{enabled=false,clock=()=>new Date().toISOString(),getTopic=()=>null}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS actual_holding_batches(id TEXT PRIMARY KEY,base_version INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,applied_version INTEGER,applied_at TEXT);
 CREATE TABLE IF NOT EXISTS actual_holding_records(record_id TEXT NOT NULL,version INTEGER NOT NULL,batch_id TEXT NOT NULL REFERENCES actual_holding_batches(id),payload TEXT NOT NULL,hash TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(record_id,version));
 CREATE INDEX IF NOT EXISTS actual_holding_batch_records ON actual_holding_records(batch_id);`);
 const guard=()=>{if(!enabled)failActual(11);if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')failActual(12);};
 const version=()=>db.prepare('SELECT COALESCE(MAX(applied_version),0) n FROM actual_holding_batches').get().n;
 const read=r=>{const p=JSON.parse(r.payload);if(hash(p)!==r.hash||identity(p)!==r.record_id)failActual(15);return {...p,id:r.record_id,version:r.version,batchId:r.batch_id,recordedAt:r.recorded_at};};
 const latest=()=>db.prepare('SELECT r.* FROM actual_holding_records r WHERE version=(SELECT MAX(s.version) FROM actual_holding_records s WHERE s.record_id=r.record_id) ORDER BY recorded_at DESC,record_id').all().map(read);
 const topicCheck=(r,previous)=>{if(!r.topicId||previous&&previous.topicId===r.topicId&&previous.topicVersion===r.topicVersion)return;const t=getTopic(r.topicId);if(!t||t.status==='archived'||t.version!==r.topicVersion||!t.companies?.some(c=>c.symbol===r.symbol))failActual(5);};
 const plan=(inputs,at)=>{
  const old=new Map(latest().map(r=>[r.id,r])),seen=new Map();
  return inputs.map((input,index)=>{
   let row;
   try{
    row=normalizeActualRow(input,at);const id=identity(row),previous=old.get(id),fingerprint=hash(content(row)),first=seen.get(id);topicCheck(row,previous);
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
  snapshot(){return {enabled,version:version(),records:latest(),note:'本人记录的账户持仓快照；不是券商接入、成交账本或实时净值'};},
  history(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))failActual(13);const rows=db.prepare('SELECT * FROM actual_holding_records WHERE record_id=? ORDER BY version DESC').all(id).map(read);if(!rows.length)failActual(13);return rows;},
  preview(input){
   guard();if(!fields(input,['rows'])&&!fields(input,['csv']))failActual(0);
   const inputs='csv' in input?parseActualCsv(input.csv):input.rows;if(!Array.isArray(inputs)||!inputs.length||inputs.length>100||JSON.stringify(inputs).length>100000)failActual(0);
   return transact(()=>{
    const at=clock(),items=plan(inputs,at),baseVersion=version(),id=randomUUID(),payload={baseVersion,items,canApply:!items.some(r=>r.action==='invalid')&&items.some(r=>!['duplicate','invalid'].includes(r.action))};
    db.prepare('INSERT INTO actual_holding_batches(id,base_version,payload,hash,created_at) VALUES(?,?,?,?,?)').run(id,baseVersion,JSON.stringify(payload),hash(payload),at);return batch(id);
   });
  },
  apply(input){
   guard();if(!fields(input,['id','hash'])||typeof input.hash!=='string')failActual(0);
   return transact(()=>{
    const p=batch(input.id);if(p.hash!==input.hash)failActual(9);
    if(p.appliedVersion!==null)return {id:p.id,version:p.appliedVersion,replayed:true};
    if(!p.canApply)failActual(10);const at=clock();if(p.baseVersion!==version()||at>p.expiresAt||at<p.createdAt)failActual(9);
    for(const item of p.items)topicCheck(item.row,item.previous);
    for(const item of p.items.filter(r=>r.action!=='duplicate')){
     const payload=JSON.stringify(item.row);db.prepare('INSERT INTO actual_holding_records VALUES(?,?,?,?,?,?)').run(item.id,(item.previous?.version||0)+1,p.id,payload,hash(item.row),at);
    }
    const v=p.baseVersion+1;db.prepare('UPDATE actual_holding_batches SET applied_version=?,applied_at=? WHERE id=?').run(v,at,p.id);return {id:p.id,version:v,replayed:false};
   });
  },
 };
}

export function projectActualAccounts(snapshot,topics,at){
 const groups=new Map(),byTopic=new Map(topics.map(t=>[t.id,t]));
 for(const r of snapshot.records.filter(r=>r.quantity!=='0')){
  const account='actual:'+hash([r.account,r.currency]),topic=byTopic.get(r.topicId),h=topic?.hypothesis||{},costCents=actualAmount(r.quantity,r.unitCost),valueCents=actualAmount(r.quantity,r.price);
  const pnl=costCents===null||valueCents===null?null:valueCents-costCents;
  const risks=['记录时点估值；当前行情与持续退出监控尚未接入'];
  if(costCents===null)risks.push('成本未知，无法计算记录时点浮盈亏');
  if(valueCents===null)risks.push('记录价格未知，不能计算估值');
  if(r.feeBasis!=='included')risks.push(r.feeBasis==='excluded'?'记录成本未含费用，浮盈亏未扣全部费用':'成本是否含费用未知');
  if(!r.topicId)risks.push('未绑定原研究；不自动猜测建仓依据');
  else if(!topic||topic.version!==r.topicVersion||topic.status==='archived')risks.push('原研究与当前版本不同或不可用，需复核');
  const p={id:'actual:'+r.id,recordId:r.id,recordVersion:r.version,account,symbol:r.symbol,name:topic?.companies?.find(c=>c.symbol===r.symbol)?.name||r.symbol,topicId:r.topicId,topicTitle:topic?.title||'未绑定研究',openingVersion:r.topicVersion,currentVersion:topic?.version??null,
   qty:r.quantity,currency:r.currency,costCents,valueCents,unrealizedCents:pnl,returnPct:pnl===null||!costCents?null:pnl/costCents*100,
   price:r.price,priceAt:r.price?r.asOf:null,priceSource:r.source,priceBasis:'记录时点价',recordedAsOf:r.asOf,openedAt:null,
   judgement:({observe:'继续观察',buy:'评估买入',add:'评估增仓',reduce:'评估减仓',exit:'评估退出'})[h.action]||'判断待补',trigger:h.trigger||null,invalidation:h.invalidation||null,holdingHorizon:h.holdingHorizon||null,reviewAt:h.reviewAt||null,risks};
  if(!groups.has(account))groups.set(account,{id:account,label:`实际 · ${r.account} · ${r.currency}`,kind:'actual',configured:true,currency:r.currency,version:snapshot.version,updatedAt:r.recordedAt,positions:[],navCents:null,realizedCents:null,feesCents:null,currentDrawdownPct:null,drawdownBasis:'快照不能推导净值回撤',sourceNote:'持仓快照 · 记录时点参考盈亏；非实时、非已实现收益；不同币种分开查看'});
  groups.get(account).positions.push(p);
 }
 return [...groups.values()].map(a=>{const ps=a.positions,known=ps.every(p=>p.unrealizedCents!==null),sameTime=new Set(ps.map(p=>p.recordedAsOf)).size===1,complete=known&&sameTime;
  const sum=f=>{const n=ps.filter(f).reduce((v,p)=>v+BigInt(p.unrealizedCents),0n);return n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER)?null:Number(n);};
  return {...a,valuationAt:sameTime?ps[0].recordedAsOf:null,valuedPositions:ps.filter(p=>p.unrealizedCents!==null).length,unrealizedCents:complete?sum(()=>true):null,floatingProfitCents:complete?sum(p=>p.unrealizedCents>0):null,floatingLossCents:complete?sum(p=>p.unrealizedCents<0):null,dailyPnlCents:null,maxDrawdownPct:null,unavailable:{dailyPnl:'缺少完整成交、现金流及净值基准',maxDrawdown:'持仓快照不是完整净值序列',aggregate:!sameTime?'记录时间不一致，账户盈亏不合计':!known?'存在未知成本或记录价格，账户盈亏不合计':null}};
 });
}
