import {createHash} from 'node:crypto';

// Bind the summary to every persisted field, including the frozen inputs.
// Never use just the rule/research version: a new check may use different data.
export const actualCheckHash=check=>createHash('sha256').update(JSON.stringify(check)).digest('hex');
export const actualCheckChanged='巡检依据已更新，请等待看板刷新后重新展开';
export const actualCheckMissing='巡检依据不存在或已退出当前监控，历史触发仍可在回执中查看';

export function compactActualChecks(snapshot,mode){
 if(mode!=='summary-v1'||!Array.isArray(snapshot?.observationInbox?.actualChecks)||!Array.isArray(snapshot?.overview?.accounts))return snapshot;
 const compact=check=>{
  const {id,reviewKind,status,reason,checkedAt,active,lastTodoId}=check;
  return {id,reviewKind,status,reason,checkedAt,active,lastTodoId,conditionLabel:check.details?.definition?.definition?.label||null,detailRef:{recordId:check.recordId,checkId:id,hash:actualCheckHash(check)}};
 };
 return {...snapshot,actualCheckTransport:'summary-v1',observationInbox:{...snapshot.observationInbox,actualChecks:snapshot.observationInbox.actualChecks.map(compact)},overview:{...snapshot.overview,accounts:snapshot.overview.accounts.map(account=>({...account,positions:account.positions.map(position=>{
  if(!position.monitoring)return position;
  const {checks,...monitoring}=position.monitoring;
  return {...position,monitoring:{...monitoring,checkIds:checks.map(c=>c.id)}};
 })}))}};
}
