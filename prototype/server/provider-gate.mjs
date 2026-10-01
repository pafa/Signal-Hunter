// Persist provider cooling periods independently of symbol caches and task history.
export function createProviderGate(store,{fetcher=fetch,now=Date.now}={}){
 return async (url,options={},context)=>{
  context?.assertActive?.();
  const host=new URL(url).hostname,key='source:'+host,previous=store.checks()[key]||{};
  if(Date.parse(previous.retryAt)>now())throw new Error(host+' 暂停请求至 '+previous.retryAt+'；'+(previous.error||'来源冷却'));
  const at=new Date(now()).toISOString();
  const fail=(message,delay)=>{
   context?.assertActive?.();
   store.status(key,{state:'error',attemptedAt:at,error:message,consecutiveFailures:(previous.consecutiveFailures||0)+1,retryAt:new Date(now()+delay).toISOString()});
  };
  try{
   const response=await fetcher(url,options);context?.assertActive?.();
   if(response.status===403||response.status===429)fail('上游 HTTP '+response.status,30*60000);
   else if(response.status>=500)fail('上游 HTTP '+response.status,Math.min(60000*2**Math.min(previous.consecutiveFailures||0,4),15*60000));
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
