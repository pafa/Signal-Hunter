import {marketTime,canonicalMarketTime} from './market-time.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const times=['asOf','receivedAt','validUntil','sessionOpen','sessionClose','sellableAt','settlesAt'];
function normalized(quote){
 const result=structuredClone(quote);
 for(const value of [result,result.fx])if(value)for(const field of times)if(typeof value[field]==='string'&&marketTime(value[field])!==null)value[field]=canonicalMarketTime(value[field]);
 return result;
}
export function liquidityIdentity(quote){const ns=marketTime(quote.asOf);if(ns===null)throw Error('执行时间无效');const at=ns%1000000n===0n?Number(ns/1000000n):`epoch-ns:${ns}`;return {key:hash({version:2,symbol:quote.symbol,source:quote.source,at}),fingerprint:hash(normalized(quote))};}
const validUsage=used=>used&&['buy','sell'].every(k=>Number.isSafeInteger(used[k])&&used[k]>=0)&&typeof used.fingerprint==='string';
// The shared cache is derived from fills. Legacy entries lack a canonical time;
// corroborate their counters against frozen fills without rewriting old history.
export function executionLiquidity(db,quote,{table,book}){
 const identity=liquidityIdentity(quote),changed='同一报价时点内容发生变化，等待新的稳定快照',invalid='历史流动性记录与成交依据不一致，暂停使用该报价';
 try{
  const row=db.prepare('SELECT payload FROM market_sim_liquidity WHERE key=?').get(identity.key);
  if(row){const used=JSON.parse(row.payload);if(used.version!==2||!validUsage(used))return {...identity,reason:invalid};return {...identity,used,...(used.fingerprint!==identity.fingerprint?{reason:changed}:{})};}
  const legacy=db.prepare("SELECT key,payload FROM market_sim_liquidity WHERE json_extract(payload,'$.version') IS NULL").all();
  if(!legacy.length)return {...identity,used:null};
  const groups=new Map(),tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('market_sim_book','market_sim_book_aggressive','market_sim_book_steady')").all();
  for(const {name} of tables){
   const stored=name===table?book:JSON.parse(db.prepare('SELECT payload FROM '+name+' WHERE id=1').get()?.payload||'null');
   if(!stored)continue;if(!Array.isArray(stored.fills))return {...identity,reason:invalid};
   for(const fill of stored.fills){
    if(fill.liquidityVersion===2)continue;
    const q=fill.marketSnapshot;if(!q||!['buy','sell'].includes(fill.side)||!Number.isSafeInteger(fill.qty)||fill.qty<=0||!Number.isFinite(Date.parse(q.asOf)))return {...identity,reason:invalid};
    const key=hash({symbol:q.symbol,source:q.source,asOf:q.asOf}),fingerprint=hash(q),old=groups.get(key);
    if(old&&old.fingerprint!==fingerprint)return {...identity,reason:invalid};
    const usage=old||{fingerprint,buy:0,sell:0,identity:liquidityIdentity(q)};usage[fill.side]+=fill.qty;if(!validUsage(usage))return {...identity,reason:invalid};groups.set(key,usage);
   }
  }
  const used={version:2,fingerprint:identity.fingerprint,buy:0,sell:0};let found=false;
  for(const row of legacy){
   const cached=JSON.parse(row.payload),proven=groups.get(row.key);
   if(!validUsage(cached)||!proven||cached.fingerprint!==proven.fingerprint||cached.buy!==proven.buy||cached.sell!==proven.sell)return {...identity,reason:invalid};
   if(proven.identity.key!==identity.key)continue;
   if(proven.identity.fingerprint!==identity.fingerprint)return {...identity,reason:changed};
   found=true;used.buy+=cached.buy;used.sell+=cached.sell;if(!validUsage(used))return {...identity,reason:invalid};
  }
  return {...identity,used:found?used:null};
 }catch{return {...identity,reason:invalid};}
}
