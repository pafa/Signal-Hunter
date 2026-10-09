// Read-only freshness projection. Old observations remain inspectable, but are
// never presented as checks of a newer holding, research or rule definition.
export const actualCheckNames={'research-status':'研究关联','research-version':'研究变化',counterevidence:'反向线索','review-due':'复核期限','price-coverage':'价格条件覆盖'};
export function projectActualMonitoring(record,topic,{checks=[],rules=[],operations={},watching=[],at}={}){
 const task=operations.observations,rows=checks.filter(c=>c.recordId===record.id),applicable=rules.filter(r=>r.topicId===record.topicId),watch=watching.find(w=>w.recordId===record.id);
 const checkedAt=rows.map(r=>r.checkedAt).sort()[0]||null;
 const changed=rows.some(c=>c.recordVersion!==record.version||c.topicVersion!==(topic?.version??null)||c.ruleId&&applicable.find(r=>r.id===c.ruleId)?.version!==c.ruleVersion)||applicable.some(r=>!rows.some(c=>c.ruleId===r.id)&&(!r.definition.conditions.some(c=>c.symbol)||r.definition.conditions.some(c=>c.symbol===record.symbol)));
 const late=checkedAt&&(!Number.isFinite(Date.parse(checkedAt))||Date.parse(checkedAt)>Date.parse(at)||Date.parse(at)-Date.parse(checkedAt)>120000);
 const state=task?.paused?'paused':task?.blocked||task?.outcome==='error'?'failed':!rows.length?'pending':changed?'changed':late?'stale':!task?'unavailable':'checked';
 const labels={paused:'巡检已暂停',failed:'巡检失败，保留上次结果',pending:'等待首次巡检',changed:'输入已变化，等待复核',stale:'巡检已延迟，保留上次结果',unavailable:'巡检任务状态未知',checked:'后台已检查'};
 const current=state==='checked',hit=rows.filter(c=>c.status==='hit'),unknown=rows.filter(c=>c.status==='unknown');
 const gaps=[watch?.state==='removed'?'已手动移出行情关注，价格条件无法持续更新':watch?.state==='deferred'?'行情关注尚未接入：'+watch.reason:null,
  operations.daily?.paused?'日线任务已暂停':null,operations.minutes?.paused?'分钟行情任务已暂停':null].filter(Boolean);
 const risks=[...(current?hit.map(c=>c.reason):[labels[state]]),...rows.filter(c=>c.active&&(c.status==='unknown'||!current)).map(c=>'上次触发尚未确认解除：'+(actualCheckNames[c.reviewKind]||c.details?.definition?.definition.label||'观察条件')),
  ...unknown.map(c=>c.reason),...gaps];
 return {state,label:labels[state],checkedAt,current,hitCount:current?hit.length:null,unknownCount:current?unknown.length:null,checks:rows,risks:[...new Set(risks)],gaps,watch:watch||null,policy:'每10–60秒后台检查；超过2分钟显示延迟。检查结果与回执分开，未知输入不解除旧触发。'};
}
