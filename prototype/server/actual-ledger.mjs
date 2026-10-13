import {createHash,randomUUID} from 'node:crypto';
import {actualHoldingErrors,failActual,parseActualCsv} from '../shared/actual-holdings.mjs';
import {ACTUAL_LEDGER_VERSION,LEDGER_COLUMNS,ledgerAccountKinds,ledgerAccountParts,ledgerPositionParts,ledgerEntryKey,ledgerGroupKey,normalizeLedgerRow,reconstructActualLedger} from '../shared/actual-ledger.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const identity=r=>hash([...ledgerAccountParts(r),r.externalId]);
const content=r=>({...Object.fromEntries(LEDGER_COLUMNS.filter(k=>k!=='reason').map(k=>[k,r[k]])),...(r.accountKind?{accountKind:r.accountKind}:{})});
const fields=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...ks].sort().join(',');
export function openActualLedger(store,{guard,clock,getTopic,snapshotVersion,snapshotRecords=()=>[]}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS actual_ledger_batches(id TEXT PRIMARY KEY,payload TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,applied_version INTEGER,applied_at TEXT);
 CREATE TABLE IF NOT EXISTS actual_ledger_entries(entry_id TEXT NOT NULL,revision INTEGER NOT NULL,batch_id TEXT NOT NULL REFERENCES actual_ledger_batches(id),payload TEXT NOT NULL,hash TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(entry_id,revision));
 CREATE INDEX IF NOT EXISTS actual_ledger_batch_entries ON actual_ledger_entries(batch_id);`);
 const transact=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const version=()=>db.prepare('SELECT COALESCE(MAX(applied_version),0) n FROM actual_ledger_batches').get().n;
 const read=r=>{const value=JSON.parse(r.payload);if(hash(value)!==r.hash||identity(value)!==r.entry_id||value.revision!==r.revision||!Number.isSafeInteger(r.applied_version)||r.applied_version<1)failActual(15);return {...value,id:r.entry_id,recordedAt:r.recorded_at,appliedVersion:r.applied_version,batchId:r.batch_id};};
 const latest=()=>db.prepare('SELECT e.*,b.applied_version FROM actual_ledger_entries e JOIN actual_ledger_batches b ON b.id=e.batch_id WHERE e.revision=(SELECT MAX(r.revision) FROM actual_ledger_entries r WHERE r.entry_id=e.entry_id) ORDER BY e.entry_id').all().map(read);
 const topicCheck=(row,previous)=>{if(!row.topicId||previous&&row.topicId===previous.topicId&&row.topicVersion===previous.topicVersion&&row.at>=previous.at)return;const t=getTopic(row.topicId);if(!t||t.status!=='active'||t.version!==row.topicVersion||!t.companies?.some(c=>c.symbol===row.symbol)||Date.parse(t.updatedAt)>Date.parse(row.at))failActual(5);};
 const batch=id=>{if(typeof id!=='string')failActual(13);const r=db.prepare('SELECT * FROM actual_ledger_batches WHERE id=?').get(id);if(!r)failActual(13);const p=JSON.parse(r.payload);if(hash(p)!==r.hash)failActual(15);return {...p,id:r.id,hash:r.hash,createdAt:r.created_at,expiresAt:new Date(Date.parse(r.created_at)+1800000).toISOString(),appliedVersion:r.applied_version};};
 const snapshot=()=>{const entries=latest(),accounts=reconstructActualLedger(entries);return {schema:ACTUAL_LEDGER_VERSION,version:version(),accounts,entries,note:'本人所录逐笔账本；不连接券商或下单，现金为交易日账面余额，不代表已结算可用资金'};};
 return {snapshot,
  history(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))failActual(13);const rows=db.prepare('SELECT e.*,b.applied_version FROM actual_ledger_entries e JOIN actual_ledger_batches b ON b.id=e.batch_id WHERE e.entry_id=? ORDER BY revision DESC').all(id).map(read);if(!rows.length)failActual(13);return rows;},
  preview(input){
   guard();const kindFields=Object.hasOwn(input||{},'accountKind')?['accountKind']:[];if(!fields(input,['rows','confirmOpening',...kindFields])&&!fields(input,['csv','confirmOpening',...kindFields])||typeof input.confirmOpening!=='boolean'||kindFields.length&&(typeof input.accountKind!=='string'||!Object.hasOwn(ledgerAccountKinds,input.accountKind)))failActual(16);
   const raw='csv' in input?parseActualCsv(input.csv,LEDGER_COLUMNS):input.rows;const inputs=Array.isArray(raw)&&kindFields.length?raw.map(r=>({...r,accountKind:input.accountKind})):raw;if(!Array.isArray(inputs)||!inputs.length||inputs.length>100||JSON.stringify(inputs).length>100000)failActual(16);
   return transact(()=>{
    const at=clock(),old=latest(),prior=new Map(old.map(r=>[ledgerEntryKey(r),r])),seen=new Map(),combined=new Map(prior);
    const items=inputs.map((input,index)=>{let row;try{
     row=normalizeLedgerRow(input,at);const key=ledgerEntryKey(row),previous=prior.get(key),first=seen.get(key),same=hash(content(row));
     if(first&&first!==same)failActual(19);seen.set(key,same);
     const duplicate=first===same||previous&&hash(content(previous))===same;
     if(!duplicate){if(row.revision!==(previous?.revision||0)+1||previous&&!row.reason||row.type==='void'&&(!previous||previous.type==='opening'))failActual(19);if(previous&&(previous.type==='opening')!==(row.type==='opening'))failActual(19);topicCheck(row,previous);combined.set(key,row);}
     return {index:index+1,id:identity(row),row,previous:previous||null,action:duplicate?'duplicate':previous?'correction':'add',issue:null};
    }catch(e){return {index:index+1,row:row||null,action:'invalid',issue:actualHoldingErrors.includes(e.message)?e.message:actualHoldingErrors[16]};}});
    let accounts=[],issue=null;try{accounts=reconstructActualLedger([...combined.values()]);if(items.some(i=>['opening','opening_position'].includes(i.row?.type)&&!['duplicate','invalid'].includes(i.action))&&!input.confirmOpening)failActual(18);}catch(e){issue=actualHoldingErrors.includes(e.message)?e.message:actualHoldingErrors[16];}
    const openingGroups=new Set(items.filter(i=>i.row?.type==='opening'&&i.action!=='duplicate').map(i=>ledgerGroupKey(i.row))),replacedSnapshots=snapshotRecords().filter(r=>openingGroups.has(ledgerGroupKey(r))).map(r=>({account:r.account,currency:r.currency,symbol:r.symbol,quantity:r.quantity,asOf:r.asOf}));
    const payload={replacedSnapshots,baseVersion:version(),baseSnapshotVersion:snapshotVersion(),items,accounts,issue,canApply:!issue&&!items.some(i=>i.action==='invalid')&&items.some(i=>!['invalid','duplicate'].includes(i.action))};
    const id=randomUUID();db.prepare('INSERT INTO actual_ledger_batches(id,payload,hash,created_at) VALUES(?,?,?,?)').run(id,JSON.stringify(payload),hash(payload),at);return batch(id);
   });
  },
  apply(input){
   guard();if(!fields(input,['id','hash']))failActual(16);
   return transact(()=>{const p=batch(input.id);if(input.hash!==p.hash)failActual(9);if(p.appliedVersion!==null)return {id:p.id,version:p.appliedVersion,replayed:true};if(!p.canApply)failActual(10);const at=clock();if(p.baseVersion!==version()||p.baseSnapshotVersion!==snapshotVersion()||at>p.expiresAt||at<p.createdAt)failActual(9);
    for(const item of p.items.filter(i=>i.action!=='duplicate')){topicCheck(item.row,item.previous);const r=item.row;db.prepare('INSERT INTO actual_ledger_entries VALUES(?,?,?,?,?,?)').run(item.id,r.revision,p.id,JSON.stringify(r),hash(r),at);}
    const v=p.baseVersion+1;db.prepare('UPDATE actual_ledger_batches SET applied_version=?,applied_at=? WHERE id=?').run(v,at,p.id);snapshot();return {id:p.id,version:v,replayed:false};
   });
  },
 };
}
export function ledgerHoldingRecords(ledger){
 return ledger.accounts.flatMap(a=>a.positions.map(p=>({... (a.accountKind?{accountKind:a.accountKind}:{}),account:a.account,symbol:p.symbol,currency:a.currency,quantity:p.quantity,unitCost:null,costCents:p.costCents,price:null,asOf:p.asOf,source:p.source,feeBasis:p.costCents===null?'unknown':'included',reason:'逐笔账本重算，原始记录与修订保留',topicId:p.topicId,topicVersion:p.topicVersion,id:hash(ledgerPositionParts({...a,symbol:p.symbol})),version:'ledger-'+a.version,recordedAt:a.recordedAt,accountingOrigin:'actual-ledger',ledgerAccount:a.key,openedAt:p.openedAt,bindings:p.bindings,realizedCents:p.realizedCents})));
}
