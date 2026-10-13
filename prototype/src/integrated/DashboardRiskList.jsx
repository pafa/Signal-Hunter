import React from 'react';
import {Button} from '../major/Primitives';
import {riskCategoryLabels,riskCategory,compareRisks,riskCounts} from '../../shared/workbench-risk-view.mjs';

export default function DashboardRiskList({overview,category='all',page=0,onCategory,onPage,onRisk}){
 const all=overview?.risks||[],counts=riskCounts(all),rows=[...all].filter(r=>category==='all'||riskCategory(r.category)===category).sort(compareRisks);
 const current=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1)),start=current*50;
 return <section aria-label="全部持仓提醒">
  <div className="detail-section-tools"><label>提醒类型 <select aria-label="提醒类型" value={category} onChange={e=>onCategory(e.target.value)}><option value="all">全部 · {all.length} 条</option>{Object.entries(riskCategoryLabels).map(([key,label])=><option key={key} value={key}>{label} · {counts[key].items} 条</option>)}</select></label>
   <Button disabled={current===0} onClick={()=>onPage(current-1)}>上一页提醒</Button><Button disabled={start+50>=rows.length} onClick={()=>onPage(current+1)}>下一页提醒</Button>
  </div>
  <p className="m-note">{rows.length?`${start+1}–${Math.min(start+50,rows.length)} / ${rows.length} 条`:'此类暂无提醒'} · 全部账户。首页按持仓 / 账户去重计数，同一对象可出现在多类；此处逐条列出完整原因。输入缺口不代表条件命中，也不解除旧触发。</p>
  <div className="dashboard-all-items">{rows.slice(start,start+50).map(r=><button className="dashboard-list-item" key={r.id} onClick={()=>onRisk(r)}><strong>{r.symbol||overview.accounts.find(a=>a.id===r.account)?.label}</strong><span>{r.message}</span><small>{riskCategoryLabels[riskCategory(r.category)]} · {overview.accounts.find(a=>a.id===r.account)?.label||r.account} · 查看依据</small></button>)}</div>
 </section>;
}
