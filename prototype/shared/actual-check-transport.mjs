// The wire carries one summary per check. Restore the existing view shape at
// the API boundary, never mix summaries from separate polling responses.
export function hydrateActualChecks(payload){
 if(!Object.hasOwn(payload||{},'actualCheckTransport'))return payload;
 const fail=()=>{throw Error('巡检摘要校验失败，请刷新页面后重试');};
 if(payload.actualCheckTransport!=='summary-v1'||!Array.isArray(payload.observationInbox?.actualChecks)||!Array.isArray(payload.overview?.accounts))fail();
 const checks=new Map(),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 for(const check of payload.observationInbox.actualChecks){
  if(!hex(check.id)||checks.has(check.id)||check.detailRef?.checkId!==check.id||!hex(check.detailRef?.recordId)||!hex(check.detailRef?.hash)||Object.hasOwn(check,'details'))fail();
  checks.set(check.id,check);
 }
 const accounts=payload.overview.accounts.map(account=>({...account,positions:account.positions.map(position=>{
  if(!position.monitoring)return position;
  const {checkIds,...monitoring}=position.monitoring;
  if(!Array.isArray(checkIds)||Object.hasOwn(monitoring,'checks')||new Set(checkIds).size!==checkIds.length)fail();
  return {...position,monitoring:{...monitoring,checks:checkIds.map(id=>{const check=checks.get(id);if(!check||check.detailRef.recordId!==position.recordId)fail();return check;})}};
 })}));
 const {actualCheckTransport,...rest}=payload;
 return {...rest,overview:{...rest.overview,accounts}};
}
