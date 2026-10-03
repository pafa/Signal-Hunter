import {safeErrorText} from '../shared/safe-errors.mjs';

// Accounts commit independently; one failure must not prevent the other pool's checks.
// Shared liquidity remains transactionally consumed by the existing execution engine.
export function processMarketAccounts(accounts,context){
 context.assertActive();
 const ordered=Object.entries(accounts).map(([accountId,sim])=>{try{return {sim,state:sim.executionState()};}catch(error){return {state:{accountId},error:safeErrorText(error)};}})
  .sort((a,b)=>(a.state.oldestApproval||'~').localeCompare(b.state.oldestApproval||'~')||a.state.accountId.localeCompare(b.state.accountId));
 return ordered.map(({sim,state,error})=>{
  context.assertActive();
  if(error)return {accountId:state.accountId,error};
  if(!state.configured)return {accountId:state.accountId,skipped:'not-initialized'};
  try{
   const result=sim.process({assertActive:context.assertActive,runToken:context.token});
   return {accountId:state.accountId,ok:true,version:result.version,changed:state.version!==result.version};
  }catch(error){context.assertActive();return {accountId:state.accountId,error:safeErrorText(error)};}
 });
}
