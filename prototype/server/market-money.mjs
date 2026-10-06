import {marketErrors} from '../shared/market-simulation.mjs';
const moneyFail=()=>{throw new Error(marketErrors[12]);};
const max=BigInt(Number.MAX_SAFE_INTEGER);
function safe(n){if(n>max||n< -max)moneyFail();return Number(n);}
export function decimal(value){
 const s=String(value);if(!/^(0|[1-9]\d{0,10})(\.\d{1,6})?$/.test(s))moneyFail();
 const [whole,fraction='']=s.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
}
const rounded=(a,b)=>(a+b/2n)/b;
// All account amounts are integer USD cents. Price and FX multiplication uses decimal integers.
export function amount(qty,price,fx='1'){if(!Number.isSafeInteger(qty)||qty<0)moneyFail();return safe(rounded(BigInt(qty)*decimal(price)*decimal(fx),10000000000n));}
export const cents=value=>amount(1,value);
export const fee=(gross,bps)=>safe(rounded(BigInt(gross)*decimal(bps),10000000000n));
export const sum=values=>safe(values.reduce((n,v)=>n+BigInt(v),0n));
