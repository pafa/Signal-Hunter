import {createHash} from 'node:crypto';
import {ledgerAccountParts,ledgerGroupKey,ledgerSum} from '../shared/actual-ledger.mjs';
import {ledgerHoldingRecords} from './actual-ledger.mjs';
import {actualReferenceValuation} from './actual-valuation.mjs';
import {ACTUAL_PERFORMANCE_VERSION as ENGINE,actualPerformanceErrors as errors,actualPerformanceAccumulator,performanceDay} from '../shared/actual-performance.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=n=>{throw Error(errors[n]);};
const accountId=a=>'actual:'+digest(ledgerAccountParts(a));
const validAt=at=>typeof at==='string'&&Number.isFinite(Date.parse(at))&&new Date(at).toISOString()===at;
// Prefix hashes invalidate only valuations affected by a backdated addition,
// correction or void. Later legitimate entries do not erase prior observations.
function ledgerTimeline(entries,key){
 const rows=entries.filter(r=>ledgerGroupKey(r)===key&&r.type!=='void').sort((a,b)=>a.at.localeCompare(b.at)||a.sequence-b.sequence||String(a.id).localeCompare(String(b.id)));
 let hash=digest([ENGINE,key]);const prefix=rows.map(r=>({at:r.at,hash:hash=digest([hash,r])}));
 return {rows,hash,hashAt(at){let lo=0,hi=prefix.length;while(lo<hi){const mid=(lo+hi)>>1;if(prefix[mid].at<=at)lo=mid+1;else hi=mid;}return lo?prefix[lo-1].hash:digest([ENGINE,key]);}};
}
function sample(a,snapshot,{at,inputs,operation,restorePending}){
 const timeline=ledgerTimeline(snapshot.ledger.entries,a.key),records=ledgerHoldingRecords({accounts:[a]}).filter(r=>r.quantity!=='0'),marks=records.map(r=>({symbol:r.symbol,quantity:r.quantity,...actualReferenceValuation(r,{at,inputs,operation,restorePending,costCents:r.costCents})})),issues=[...new Set(marks.flatMap(m=>m.issues))];
 if(a.cashCents===null)issues.push('账面现金或费用不完整，净值未知');
 if(restorePending)issues.push('恢复副本未核对，净值采样暂停');
 let nav=null;try{if(!issues.length)nav=ledgerSum([a.cashCents,...marks.map(m=>m.valueCents)]);}catch{issues.push('参考净值金额超出可安全核算范围');}
 const factsHash=timeline.hashAt(at),quotes=marks.map(m=>({symbol:m.symbol,quantity:m.quantity,valueCents:m.valueCents,price:m.price,priceAt:m.priceAt,provenance:m.provenance}));
 const contextHash=digest([ENGINE,a.key,factsHash,nav,a.cashCents,quotes,issues]);
 return {schema:ENGINE,accountId:accountId(a),accountKey:a.key,account:a.account,currency:a.currency,at,ledgerVersion:a.version,factsHash,contextHash,navCents:nav,cashCents:a.cashCents,netFlowsCents:a.netFlowsCents,quotes,issues};
}
export function attachActualPerformance(accounts,projection){return accounts.map(a=>{
 const p=a.ledger&&projection[a.ledger.key];if(!p)return a;
 return {...a,performance:p,dailyPnlCents:p.dailyPnlCents,currentDrawdownPct:p.currentDrawdownPct,maxDrawdownPct:p.maxDrawdownPct,drawdownBasis:p.basis,unavailable:{...a.unavailable,dailyPnl:p.dailyFrom?'自账户当地今日首个有效采样起，扣除出入金；不等于完整交易日收益':'今日还没有两个可比较的有效采样',maxDrawdown:p.current?p.limit:p.reason}};
});}
export function openActualPerformance(store,{clock,enabled=false,getContext}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS actual_nav_samples(id INTEGER PRIMARY KEY AUTOINCREMENT,account_key TEXT NOT NULL,at TEXT NOT NULL,context_hash TEXT NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(account_key,at,context_hash));
 CREATE INDEX IF NOT EXISTS actual_nav_samples_account_time ON actual_nav_samples(account_key,at,id);`);
 // Epochs are transactional invalidation signals, including writes from another
 // connection. They do not replace payload verification. Cache state is disposable.
 db.exec(`CREATE INDEX IF NOT EXISTS actual_nav_samples_account_id ON actual_nav_samples(account_key,id);
 CREATE INDEX IF NOT EXISTS actual_nav_samples_time ON actual_nav_samples(at);
 CREATE TABLE IF NOT EXISTS actual_nav_epochs(account_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,rewrites INTEGER NOT NULL);
 CREATE TRIGGER IF NOT EXISTS actual_nav_epoch_insert AFTER INSERT ON actual_nav_samples BEGIN
  INSERT INTO actual_nav_epochs VALUES(NEW.account_key,1,CASE WHEN NEW.at <= (SELECT at FROM actual_nav_samples WHERE account_key=NEW.account_key AND id<>NEW.id ORDER BY at DESC,id DESC LIMIT 1) OR NEW.id < (SELECT MAX(id) FROM actual_nav_samples WHERE account_key=NEW.account_key) THEN 1 ELSE 0 END)
  ON CONFLICT(account_key) DO UPDATE SET revision=revision+1,rewrites=rewrites+excluded.rewrites;
 END;
 CREATE TRIGGER IF NOT EXISTS actual_nav_epoch_update AFTER UPDATE ON actual_nav_samples BEGIN
  INSERT INTO actual_nav_epochs VALUES(OLD.account_key,1,1) ON CONFLICT(account_key) DO UPDATE SET revision=revision+1,rewrites=rewrites+1;
  INSERT INTO actual_nav_epochs SELECT NEW.account_key,1,1 WHERE NEW.account_key<>OLD.account_key ON CONFLICT(account_key) DO UPDATE SET revision=revision+1,rewrites=rewrites+1;
 END;
 CREATE TRIGGER IF NOT EXISTS actual_nav_epoch_delete AFTER DELETE ON actual_nav_samples BEGIN
  INSERT INTO actual_nav_epochs VALUES(OLD.account_key,1,1) ON CONFLICT(account_key) DO UPDATE SET revision=revision+1,rewrites=rewrites+1;
 END;`);
 const decode=r=>{const p=JSON.parse(r.payload);if(digest(p)!==r.hash||p.accountKey!==r.account_key||p.at!==r.at||p.contextHash!==r.context_hash||p.schema!==ENGINE)fail(2);return {...p,id:r.id};};
 const caches=new Map(),block=512;
 const columns='r.*,(SELECT MAX(t.id) FROM actual_nav_samples t WHERE t.account_key=r.account_key AND t.at=r.at) latest_id';
 const all=db.prepare(`SELECT ${columns} FROM actual_nav_samples r WHERE account_key=? ORDER BY at,id`),tail=db.prepare(`SELECT ${columns} FROM actual_nav_samples r WHERE account_key=? AND id>? ORDER BY at,id`);
 const range=db.prepare(`SELECT ${columns} FROM actual_nav_samples r WHERE account_key=? AND (at>? OR (at=? AND id>?)) AND (at<? OR (at=? AND id<=?)) ORDER BY at,id`);
 const revision=db.prepare('SELECT revision,rewrites FROM actual_nav_epochs WHERE account_key=?');
 const checked=(p,row,timeline)=>{const facts=timeline.hashAt(p.at)===p.factsHash,last=row.latest_id===p.id;return {id:p.id,at:p.at,navCents:p.navCents,eligible:facts&&last,issue:!facts?'账本补录或修订影响此采样；保留原值但不用于当前收益':!last?'同一时点已有更新采样，原值保留':p.issues.join('；')};};
 const consume=(entry,row,timeline)=>{const p=decode(row);entry.acc.push(checked(p,row,timeline));entry.count++;entry.maxId=Math.max(entry.maxId,p.id);entry.latest={id:p.id,at:p.at,contextHash:p.contextHash};if(entry.count%block===0)entry.checkpoints.push({at:p.at,id:p.id,state:entry.acc.state()});};
 const rebuild=(a,timeline,stamp)=>{const entry={stamp,ledgerHash:timeline.hash,acc:actualPerformanceAccumulator(timeline.rows,{currency:a.currency}),checkpoints:[{at:'',id:0,state:null}],maxId:0,count:0,latest:null};for(const row of all.iterate(a.key))consume(entry,row,timeline);return entry;};
 const historyState=(a,timeline)=>{
  const stamp=revision.get(a.key)||{revision:0,rewrites:0};let entry=caches.get(a.key);
  try{
   if(!entry||entry.ledgerHash!==timeline.hash||entry.stamp.rewrites!==stamp.rewrites||stamp.revision<entry.stamp.revision)entry=rebuild(a,timeline,stamp);
   else if(entry.stamp.revision!==stamp.revision){
    const next={...entry,stamp,acc:actualPerformanceAccumulator(timeline.rows,{currency:a.currency,state:entry.acc.state()}),checkpoints:[...entry.checkpoints]};let appended=0,ordered=true;
    for(const row of tail.iterate(a.key,entry.maxId)){if(next.latest&&row.at<=next.latest.at){ordered=false;break;}consume(next,row,timeline);appended++;}
    // REPLACE of the last ID and any non-append operation must rebuild, even
    // when SQLite's optional recursive delete triggers are disabled.
    entry=ordered&&appended===stamp.revision-entry.stamp.revision?next:rebuild(a,timeline,stamp);
   }
   caches.delete(a.key);caches.set(a.key,entry);if(caches.size>8)caches.delete(caches.keys().next().value);return entry;
  }catch(error){caches.delete(a.key);throw error;}
 };
 const context=provided=>{const c=provided||getContext(),at=c.at||clock();if(!validAt(at))fail(0);return {...c,at};};
 const projectAccount=(a,c)=>{
  const timeline=ledgerTimeline(c.snapshot.ledger.entries,a.key),entry=historyState(a,timeline),latest=entry.latest,now=sample(a,c.snapshot,c),age=Date.parse(c.at)-Date.parse(latest?.at),op=c.monitorOperation;
  const current=enabled&&!c.restorePending&&!!op&&!op.paused&&!op.blocked&&op.outcome!=='error'&&now.navCents!==null&&latest?.contextHash===now.contextHash&&age>=0&&age<=120000;
  const reason=c.restorePending?'恢复副本未核对，当前采样暂停':op?.paused?'后台巡检已暂停，保留历史净值':op?.blocked||op?.outcome==='error'?'后台巡检异常，保留历史净值':now.navCents===null?now.issues.join('；'):current?'':'输入已变化或采样过期，等待后台更新';
  return {entry,timeline,summary:{...entry.acc.summary({at:c.at,current,reason}),ledgerVersion:a.version}};
 };
 return {
  capture(provided){
   if(!enabled)return {captured:0,skipped:'mode'};const c=context(provided);if(c.restorePending)return {captured:0,skipped:'restore'};
   db.exec('BEGIN IMMEDIATE');try{
    const max=db.prepare('SELECT MAX(at) at FROM actual_nav_samples').get().at;if(max&&max>c.at)fail(1);let captured=0;
    for(const a of c.snapshot.ledger?.accounts||[]){
     const p=sample(a,c.snapshot,c),lastRow=db.prepare('SELECT * FROM actual_nav_samples WHERE account_key=? ORDER BY at DESC,id DESC LIMIT 1').get(a.key),last=lastRow?decode(lastRow):null;
     if(last&&last.contextHash===p.contextHash&&(p.navCents===null?performanceDay(last.at,a.currency)===performanceDay(c.at,a.currency):Date.parse(c.at)-Date.parse(last.at)<60000))continue;
     // At most one normal sample per minute; account/quote changes are recorded
     // immediately. Repeated unknown polling creates no fake progress.
     captured+=Number(db.prepare('INSERT OR IGNORE INTO actual_nav_samples(account_key,at,context_hash,payload,hash) VALUES(?,?,?,?,?)').run(a.key,c.at,p.contextHash,JSON.stringify(p),digest(p)).changes);
    }
    db.exec('COMMIT');return {captured};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  project(provided){const c=context(provided);return Object.fromEntries((c.snapshot.ledger?.accounts||[]).map(a=>[a.key,projectAccount(a,c).summary]));},
  history(id,params={}){
   if(typeof id!=='string'||!/^actual:[a-f0-9]{64}$/.test(id)||Object.keys(params).some(k=>!['before','ceiling'].includes(k))||Object.values(params).some(v=>typeof v!=='string'||!/^\d{1,15}$/.test(v)||!Number.isSafeInteger(Number(v)))||params.before&&!params.ceiling)fail(3);
   const c=context(),a=c.snapshot.ledger?.accounts.find(a=>accountId(a)===id);if(!a)fail(4);
   const {entry,timeline,summary}=projectAccount(a,c),ceiling=params.ceiling?Number(params.ceiling):entry.maxId,before=params.before?Number(params.before):Number.MAX_SAFE_INTEGER;
   const selected=db.prepare('SELECT id,at FROM actual_nav_samples WHERE account_key=? AND id<=? AND id<? ORDER BY at DESC,id DESC LIMIT 61').all(a.key,ceiling,before),wanted=selected.slice(0,60),ids=new Set(wanted.map(p=>p.id)),items=[];
   if(wanted.length){
    const first=wanted.at(-1),last=wanted[0];let lo=0,hi=entry.checkpoints.length;
    while(lo<hi){const mid=(lo+hi)>>1,p=entry.checkpoints[mid];if(p.at<first.at||p.at===first.at&&p.id<first.id)lo=mid+1;else hi=mid;}
    const cp=entry.checkpoints[Math.max(0,lo-1)],acc=actualPerformanceAccumulator(timeline.rows,{currency:a.currency,state:cp.state});
    for(const row of range.iterate(a.key,cp.at,cp.at,cp.id,last.at,last.at,last.id)){const p=decode(row),computed=acc.push(checked(p,row,timeline));if(ids.has(p.id))items.push({...p,...computed});}
    items.reverse();
   }
   const total=db.prepare('SELECT COUNT(*) n FROM actual_nav_samples WHERE account_key=? AND id<=?').get(a.key,ceiling).n;
   return {accountId:id,account:a.account,currency:a.currency,summary,ceiling,total,items,nextCursor:selected.length>60?String(items.at(-1).id):null,note:'按当前账本核对历史采样，原值不可变；翻页固定新增边界，修订状态按当前事实显示'};
  },
 };
}
