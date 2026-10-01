import {dailyHealth} from '../shared/market-clock.mjs';
export function dataCapabilities(store,at=new Date().toISOString(),{offline=false}={}){
 const checks=store.checks();
 return store.watchlist().map(w=>{
  const daily=store.daily(w.symbol),minute=store.quote(w.symbol),d=checks['daily:'+w.symbol],m=checks[w.symbol];
  const dh=offline?{status:'synthetic',label:'合成演示'}:dailyHealth(w.symbol,daily,at);
  return {symbol:w.symbol,daily:{available:!!daily,source:daily?.provider||null,receivedAt:daily?.receivedAt||null,
   providerDate:daily?.lastDate||null,status:d?.state==='error'?'error':dh.status,label:d?.state==='error'?'获取失败，保留已有日线':dh.label,error:d?.error||null},
   minutes:{available:!!minute,source:minute?.provider||null,providerTime:minute?.providerTime||null,timezone:minute?.providerTimezone||null,
    receivedAt:minute?.receivedAt||null,attemptedAt:m?.attemptedAt||null,status:offline?'synthetic':m?.state==='error'?'error':minute?'unverified':'missing',
    label:offline?'合成演示':m?.state==='error'?'获取失败，旧缓存仅供参考':minute?'延迟与成交能力待核验':'尚无分钟数据',error:m?.error||null},
   execution:{enabled:false,reason:'现有行情仅供研究；市场模拟执行尚未接通'}};
 });
}
