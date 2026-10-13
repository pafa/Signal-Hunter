import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {RESEARCH_ACTIONS,RESEARCH_ACTION_STATES,researchActionLabel} from '../../shared/research-action.mjs';
const same=(a,b)=>a&&b&&['kind','id','version','runId'].every(k=>a[k]===b[k]);

// The server supplies the same saved subject and readiness used by account plans.
// Selection only changes reading context; no local guess becomes a buy signal.
export default function ResearchJudgmentBrief({rows=[],selected,onSelect,onCompany,decisions=[],historical=false,member=false}){
 const source=selected?rows.find(r=>r.symbol===selected):rows[0],row=source&&(historical?{...source,state:'historical'}:source),j=row?.judgment;
 const plans=row&&row.state==='conditional'&&!member?decisions.filter(d=>d.symbol===row.symbol&&same(d.researchBinding,row.subject)):[];
 const accountState=historical||row?.state==='historical'?'旧判断不用于当前方案':member?'本篇为事件成员，当前方案以事件综合为准':plans.length?`${plans.length} 份账户方案待本人最后决定`:'本版暂无自动账户方案待决定';
 return <section aria-label="当前系统逐公司判断">
  <div className="v8-verdict"><b>{row?`${row.symbol} · ${researchActionLabel(row)}`:`${selected||'本篇'} · 系统判断当前无法核对`}</b>{rows.length>1&&<select aria-label="研判证券" value={row?.symbol||selected||''} onChange={e=>onSelect(e.target.value)}>{!row&&<option value={selected||''}>当前证券无本版判断</option>}{rows.map(r=><option key={r.symbol} value={r.symbol}>{r.symbol} · {RESEARCH_ACTIONS[r.action]||'暂不能判断'}</option>)}</select>}<Button disabled={!row} onClick={()=>onCompany(row.symbol)}>查看判断与条件</Button></div>
  <p className="dashboard-horizon"><b title={row?.reasons?.join('；')}>研究状态：</b>{RESEARCH_ACTION_STATES[row?.state]||'等待后台核对'} · {accountState}</p>
  <p className="dashboard-logic" title={j?.reason}><b>{historical||row?.state==='historical'?'原系统依据':'系统依据'}</b> {j?.reason||row?.reasons?.[0]||'后台继续核对研究与来源；原记录保留。'}</p>
  <p className="dashboard-logic dashboard-risk" title={j?.countercase||j?.invalidation}><b>主要反证 / 风险</b> {j?.countercase||j?.invalidation||'尚无可核对的风险依据，不能视为没有风险'}</p>
  <p className="dashboard-horizon">{j?.watchReview?`后台观察复核 ${time(j.watchReview.nextReviewAt)} · 每日按队列与额度接续；买卖期限未知。`:<>本版复核期限 {time(j?.validUntil)} · 持有复核 {j?.holdingHorizon?.status==='defined'?time(j.holdingHorizon.until):'未知'}；不是确定卖出日。</>}</p>
 {j?.businessReview&&<p className="dashboard-horizon">业务事实复核 {time(j.businessReview.nextReviewAt)} · 后台接续证据；判断依据可展开查看。</p>}
 </section>;
}
