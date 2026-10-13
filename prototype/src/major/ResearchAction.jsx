import React from 'react';
import {isWatchResearch} from '../../shared/research-watch.mjs';
import {RESEARCH_ACTIONS,RESEARCH_ACTION_STATES,researchActionLabel} from '../../shared/research-action.mjs';

export default function ResearchAction({value,state,fold,renderCitations}){
 if(!value)return null;
 const horizon=value.holdingHorizon;
 return <section aria-label="研究行动倾向" className="assessment-dimension">
  <h4>研究倾向 · {state?researchActionLabel(state):RESEARCH_ACTIONS[value.action]}</h4><p>{value.reason}</p>
  <p className="m-note">{state?RESEARCH_ACTION_STATES[state.state]:'当前有效性尚未提供，仅展示此版保存判断'}。这里展示研究层判断；已准备的账户方案请在原首页或组合页查看。</p>
  <details {...fold('recommendation')}><summary>查看判断依据、期限与方案缺口</summary>
   {isWatchResearch(value)&&<p>{state?.judgment?.watchReview?`后台观察复核：保存后每24小时按原队列与额度检查，本版下次 ${state.judgment.watchReview.nextReviewAt}。这是系统节奏，买卖有效期与预计卖出日仍未知。`:'此记录的自动复核尚未核对；观察判断保留，买卖有效期与预计卖出日仍未知。'}</p>}
   {state?.judgment?.businessReview&&<p>业务事实复核：后台每日按原队列与额度核对资料，下次 {state.judgment.businessReview.nextReviewAt}；没有新证据时保留未知，资料判断不等于事实已独立证实。</p>}
   {value.validUntil&&<p>本版倾向复核期限：{value.validUntil}</p>}
   {renderCitations(value.citations,'recommendation:citations')}
   <h4>持有复核窗口</h4><p>{horizon.status==='defined'?horizon.until:'尚不能判断'}</p><p>{horizon.reason}</p>
   {horizon.status==='defined'&&<><p className="m-note">这是事件兑现与持有复核的假设窗口，退出条件可更早触发，实际卖出时间仍取决于行情、持仓和本人决定。</p>{renderCitations(horizon.citations,'recommendation:horizon')}</>}
   {state&&<><h4>当前研究层检查</h4><ul>{state.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul></>}
   <p className="m-note">系统继续汇总与检查，无需逐项确认这些中间结果。减仓与退出仅适用于已有持仓，不表示做空。</p>
  </details>
 </section>;
}
