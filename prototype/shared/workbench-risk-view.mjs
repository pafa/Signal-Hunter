import {actualCheckNames} from './actual-monitoring.mjs';

export const riskCategoryLabels={risk:'风险提醒',review:'待复核',gap:'输入缺口'};
export const riskCategory=value=>Object.hasOwn(riskCategoryLabels,value)?value:'review';
export const riskRank=value=>({risk:0,review:1,gap:2})[riskCategory(value)];
export const compareRisks=(a,b)=>riskRank(a.category)-riskRank(b.category);
const negativeChecks=new Set(['counterevidence','research-exitCondition','research-invalidation','research-exit-advice']);
const checkCategory=check=>negativeChecks.has(check.reviewKind)?'risk':'review';

// Presentation only: keep every original message and its index, and classify
// using the existing structured outcomes rather than guessing from keywords.
export function positionRiskEntries(position){
 const p=position,m=p.monitoring,r=p.actualResearch,kinds=new Map();
 const put=(message,category)=>{if(message&&(!kinds.has(message)||riskRank(category)<riskRank(kinds.get(message))))kinds.set(message,category);};
 for(const message of p.referenceValuation?.issues||[])put(message,'gap');
 for(const message of ['成本未知，无法计算浮盈亏','记录成本未含费用，浮盈亏未扣全部费用','成本是否含费用未知','未绑定原研究；不自动猜测建仓依据'])put(message,'gap');
 if(r){
  if(r.link?.status!=='current')put(r.link?.reason,'gap');
  if(r.action?.state==='historical')for(const message of r.action.reasons||[])put(message,'gap');
  if(r.due?.length)put('当前判断或持有复核窗口已到期，等待新版研判','review');
  if(r.conditions?.some(c=>c.key==='exitCondition'&&c.current&&c.status==='true'))put('当前研究的减仓 / 退出条件已触发','risk');
 }
 if(m){
  if(!m.current)put(m.label,'gap');
  for(const message of m.gaps||[])put(message,'gap');
  for(const c of m.checks||[]){
   if(c.status==='unknown')put(c.reason,'gap');
   if(m.current&&c.status==='hit')put(c.reason,checkCategory(c));
   if(c.active&&(c.status==='unknown'||!m.current))put('上次触发尚未确认解除：'+(actualCheckNames[c.reviewKind]||c.conditionLabel||c.details?.definition?.definition.label||'观察条件'),checkCategory(c));
  }
 }
 const legacyWaiting=r?.link?.status==='waiting'&&r.origins?.length===1&&r.origins[0].baselineAvailable&&r.link.links?.[0]?.status==='legacy'&&r.link.reason===r.link.links[0].reason;
 return (p.risks||[]).map((originalMessage,index)=>{
  const category=riskCategory(p.riskCategories?.[index]||kinds.get(originalMessage));
  // A normal continuity note was reused as an unavailable-research reason.
  // Explain that missing judgment without modifying the original research.
  const message=legacyWaiting&&category==='gap'&&originalMessage===r.link.reason?'当前原研究尚无可核对的系统判断，退出建议暂不可用':originalMessage;
  return {index,category,message,...(message!==originalMessage?{originalMessage}:{})};
 }).sort(compareRisks);
}

export function riskCounts(rows=[]){
 const counts=Object.fromEntries(Object.keys(riskCategoryLabels).map(k=>[k,{items:0,targets:0}])),sets={risk:new Set(),review:new Set(),gap:new Set()},all=new Set();
 for(const row of rows){const kind=riskCategory(row.category),target=row.positionId||'account:'+row.account;counts[kind].items++;sets[kind].add(target);all.add(target);}
 for(const kind of Object.keys(counts))counts[kind].targets=sets[kind].size;
 return {...counts,items:rows.length,targets:all.size};
}
