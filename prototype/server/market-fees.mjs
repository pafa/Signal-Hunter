import {createHash} from 'node:crypto';
import {decimal,amount,fee,sum} from './market-money.mjs';
import {compareMarketTime,isMarketInstant} from './market-time.mjs';

const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=()=>{throw Error('执行费用方案无效或未完成核验');};
// Keep the fractional micro-unit until statutory rounding (a tiny positive
// charge still rounds up to a cent when the source requires ceil).
const quantize=(numerator,denominator,unit,mode)=>{
 const divisor=denominator*unit;
 return ((numerator+(mode==='ceil'?divisor-1n:divisor/2n))/divisor)*unit;
};
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
function validProfile(p,q,at){
 if(!p||p.schema!=='execution-fees/1'||p.verified!==true||p.complete!==true||p.currency!==q.currency||![p.id,p.version,p.source].every(label)||!isMarketInstant(at)||!isMarketInstant(p.validFrom)||!isMarketInstant(p.validUntil)||compareMarketTime(p.validFrom,p.validUntil)>=0||compareMarketTime(p.validFrom,at)>0||compareMarketTime(at,p.validUntil)>0||!Array.isArray(p.components)||p.components.length<1||p.components.length>20)fail();
 const ids=new Set();
 for(const c of p.components){
  if(!c||!label(c.id)||['__proto__','constructor','prototype'].includes(c.id)||ids.has(c.id)||!label(c.source)||!['both','buy','sell'].includes(c.side)||!['notional-bps','per-share','fixed'].includes(c.basis)||!['per-fill','per-order'].includes(c.aggregation)||!['nearest','ceil'].includes(c.rounding))fail();
  ids.add(c.id);decimal(c.rate);if(decimal(c.quantum)<=0n)fail();
  if(c.minimum!==undefined)decimal(c.minimum);if(c.maximum!==undefined&&(decimal(c.maximum)<decimal(c.minimum??0)))fail();
 }
}

// The source declares each fee's scope and aggregation; no broker pricing is inferred.
// Accrual makes per-order minima/caps apply once across partial fills.
export function executionFees(q,{qty,price,side,at,feeBps,accrual=null}={}){
 if(!Number.isSafeInteger(qty)||qty<=0||!['buy','sell'].includes(side))fail();
 if(!q.fees){if(q.executionFeed===true)fail();const totalCents=fee(amount(qty,price,q.fx.usdPerUnit),feeBps);return {totalCents,profileId:'legacy-config-bps',components:[{id:'legacy-config-bps',usdCents:totalCents}],accrual:null};}
 validProfile(q.fees,q,at);const profileHash=digest(q.fees);
 if(accrual&&(accrual.profileHash!==profileHash||accrual.side!==side||accrual.currency!==q.currency))fail();
 const next=structuredClone(accrual||{profileHash,side,currency:q.currency,qty:0,notionalMicros:'0',paid:{}});
 if(!Number.isSafeInteger(next.qty)||next.qty<0||!/^\d+$/.test(next.notionalMicros)||!next.paid||typeof next.paid!=='object')fail();
 next.qty+=qty;if(!Number.isSafeInteger(next.qty))fail();next.notionalMicros=String(BigInt(next.notionalMicros)+BigInt(qty)*decimal(price));
 const components=[];
 for(const c of q.fees.components){
  if(c.side!=='both'&&c.side!==side)continue;
  const all=c.aggregation==='per-order',n=all?next.qty:qty,notional=all?BigInt(next.notionalMicros):BigInt(qty)*decimal(price),rate=decimal(c.rate);
  const denominator=c.basis==='notional-bps'?10000000000n:1n;
  let numerator=c.basis==='notional-bps'?notional*rate:c.basis==='per-share'?BigInt(n)*rate:rate;
  if(c.minimum!==undefined&&numerator<decimal(c.minimum)*denominator)numerator=decimal(c.minimum)*denominator;
  if(c.maximum!==undefined&&numerator>decimal(c.maximum)*denominator)numerator=decimal(c.maximum)*denominator;
  const unit=decimal(c.quantum);let total=quantize(numerator,denominator,unit,c.rounding);
  if(c.minimum!==undefined&&total<decimal(c.minimum))total=decimal(c.minimum);
  if(c.maximum!==undefined&&total>decimal(c.maximum))total=decimal(c.maximum);
  const prior=all?BigInt(next.paid[c.id]||'0'):0n;
  if(total<prior)fail();const charge=total-prior;if(all)next.paid[c.id]=String(total);
  const nativeAmount=`${charge/1000000n}.${String(charge%1000000n).padStart(6,'0')}`;
  components.push({id:c.id,source:c.source,aggregation:c.aggregation,nativeAmount,currency:q.currency,usdCents:amount(1,nativeAmount,q.fx.usdPerUnit)});
 }
 return {totalCents:sum(components.map(c=>c.usdCents)),profileId:q.fees.id,profileVersion:q.fees.version,profileHash,components,accrual:next};
}
