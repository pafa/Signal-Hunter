import {securityIdentity} from '../shared/securities.mjs';

export const DIRECTORY_RECALL='cross-market-name-or-explicit-symbol-recall-2';
const venues={NASDAQ:'XNAS',NYSE:'XNYS',NYSEAMERICAN:'XASE',NYSEARCA:'ARCX',HKEX:'XHKG',SSE:'XSHG',SZSE:'XSHE'};
const suffix={XNAS:'US',XNYS:'US',XASE:'US',ARCX:'US',XHKG:'HK',XSHG:'SH',XSHE:'SZ'};
// Read entire qualified tokens, including unsupported extensions. Removing
// them from name recall prevents a wrong venue or malformed NVDA.USX token
// from sneaking back into the candidate list through the NVDA alias.
export function directoryCodeRecall(text){
 const input=String(text).normalize('NFKC'),tokens=[];
 const pattern=/(?<![A-Z0-9_.-])(?:(NASDAQ|NYSEAMERICAN|NYSEARCA|NYSE|HKEX|SSE|SZSE|BSE)\s*:\s*([A-Z0-9_.-]+)|([A-Z0-9_.-]+\.(?:US|SH|SZ|HK|BJ)[A-Z0-9_.-]*))(?![A-Z0-9_.-])/gi;
 const names=input.replace(pattern,(_all,exchange,code,qualified)=>{
  const venue=exchange?venues[exchange.toUpperCase()]:null;
  try{
   if(exchange&&!venue)return ' ';
   const value=(code||qualified).toUpperCase().replace(/\.$/,''),canonical=/\.(US|SH|SZ|HK|BJ)$/.test(value)?value:`${value}.${suffix[venue]}`;
   const symbol=securityIdentity(canonical).symbol;
   if(!venue||symbol.endsWith('.'+suffix[venue]))tokens.push({symbol,venue});
  }catch{/* Unsupported tokens remain unresolved; never infer another market. */}
  return ' ';
 });
 return {names,tokens:tokens.map(t=>({...t})),matches:entry=>tokens.some(t=>t.symbol===entry.symbol&&(!t.venue||t.venue===entry.venue))};
}
