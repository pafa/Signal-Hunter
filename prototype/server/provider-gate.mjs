// Persist provider cooling periods independently of symbol caches and task history.
const day='(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)',month='(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const imf=new RegExp(`^(${day}), (\\d{2}) (${month}) (\\d{4}) (\\d{2}:\\d{2}:\\d{2}) GMT$`);
const rfc850=new RegExp(`^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-(${month})-(\\d{2}) (\\d{2}:\\d{2}:\\d{2}) GMT$`);
const asctime=new RegExp(`^(${day}) (${month}) ( \\d|\\d{2}) (\\d{2}:\\d{2}:\\d{2}) (\\d{4})$`);
function retryAfterAt(response,at){
 const value=response.headers?.get?.('retry-after')?.trim();if(!value||value.length>128)return 0;
 let until;
 if(/^\d+$/.test(value)){
  const seconds=Number(value);if(!Number.isSafeInteger(seconds))return 0;until=at+seconds*1000;
 }else{
  // Normalize the three HTTP-date forms and round-trip calendar fields in UTC.
  let canonical=value,parts;
  if((parts=rfc850.exec(value))){
   let year=Math.floor(new Date(at).getUTCFullYear()/100)*100+Number(parts[4]);
   if(year>new Date(at).getUTCFullYear()+50)year-=100;
   canonical=`${parts[1].slice(0,3)}, ${parts[2]} ${parts[3]} ${year} ${parts[5]} GMT`;
  }else if((parts=asctime.exec(value)))canonical=`${parts[1]}, ${parts[3].trim().padStart(2,'0')} ${parts[2]} ${parts[5]} ${parts[4]} GMT`;
  else if(!imf.test(value))return 0;
  until=Date.parse(canonical);if(!Number.isFinite(until)||new Date(until).toUTCString()!==canonical)return 0;
 }
 return Number.isSafeInteger(until)&&until>at&&until<=8640000000000000?until:0;
}
export function createProviderGate(store,{fetcher=fetch,now=Date.now}={}){
 return async (url,options={},context)=>{
  context?.assertActive?.();
  const host=new URL(url).hostname,key='source:'+host,previous=store.checks()[key]||{};
  if(Date.parse(previous.retryAt)>now())throw new Error(host+' 暂停请求至 '+previous.retryAt+'；'+(previous.error||'来源冷却'));
  const at=new Date(now()).toISOString();
  const fail=(message,delay,retryAt=0)=>{
   context?.assertActive?.();
   const current=store.checks()[key]||{},until=Math.max(now()+delay,retryAt,Date.parse(current.retryAt)||0);
   store.status(key,{state:'error',attemptedAt:at,error:message,consecutiveFailures:(current.consecutiveFailures||0)+1,retryAt:new Date(until).toISOString()});
  };
  try{
   const response=await fetcher(url,options);context?.assertActive?.();
   if([403,405,429].includes(response.status))fail('上游 HTTP '+response.status,30*60000,retryAfterAt(response,now()));
   else if(response.status>=500)fail('上游 HTTP '+response.status,Math.min(60000*2**Math.min(previous.consecutiveFailures||0,4),15*60000),retryAfterAt(response,now()));
   else if(response.ok&&!(Date.parse(store.checks()[key]?.retryAt)>now()))store.status(key,{state:'ok',attemptedAt:at,receivedAt:at,consecutiveFailures:0,retryAt:null});
   return response;
  }catch(error){
   context?.assertActive?.();
   if(context?.signal?.aborted)throw error;
   fail(String(error.message).slice(0,120),Math.min(60000*2**Math.min(previous.consecutiveFailures||0,4),15*60000));
   throw error;
  }
 };
}
