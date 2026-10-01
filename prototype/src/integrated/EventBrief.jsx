import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {claimsOf} from '../../shared/claims.mjs';
import {CLAIM_STATES} from '../../shared/uncertainty.mjs';
const actions={observe:'继续观察 · 尚未形成买点',buy:'研究买入 · 等待条件评估',add:'研究增仓 · 先核对新增风险',reduce:'评估减仓 · 等待本人审批',exit:'评估退出 · 等待本人审批'};
export default function EventBrief({topic,workflow,onDetail,onEvidence,onCompany}){
 const claims=claimsOf(topic),a=claims[0],origin=topic.origin==='news-candidate'?'新闻候选 · 未经深度研判':topic.origin==='recent-data-test'?'真实新闻 · 回溯研究':topic.origin==='attachment-research'?'附件研究 · 助手研判':topic.origin==='retrospective-case'?'既有回溯案例':'人工研究';
 return <div className="v8-brief">
 <div className="i-topic-heading"><div><div className="i-kicker">{topic.label} · {origin} · v{topic.version}</div><h1>{topic.title}</h1></div><Button onClick={()=>onDetail(topic.dossier?'brief':'evidence')}>{topic.dossier?'详细研判':'研究详情'}</Button></div>
 <div className="v8-verdict"><b>{actions[topic.hypothesis.action]||'补充行动判断'}</b><span>{workflow?.priorityReason||'待研判'}</span><Button primary onClick={()=>onDetail('hypothesis')}>评估行动条件</Button></div>
 {topic.origin==='news-candidate'&&<div className="i-muted">来源状态：{{rumor:'传闻',proposed:'拟议 / 待落实','denial-reported':'否认报道',unverified:'未证实'}[topic.messageStatus]||'未证实'} · {topic.headlineStage||'事件阶段待核验'}；主张和概率需独立评估。</div>}
 <div className="v8-statuses"><span title={a?.claim||'尚未定义主张'}>核心主张 <b>{CLAIM_STATES[a?.status]||'待定义'} · {a?.probability==null?'概率待估计':`${a.probability}% 主观估计`}</b></span><Button onClick={()=>onDetail('uncertainty')}>主张与概率 {claims.length}</Button><span>关联 <b>{workflow?.positionSymbols?.length||0} 持仓 / {workflow?.pendingCount||0} 待批</b></span></div>
 <button className="v8-delta" onClick={()=>onDetail('history')} title={topic.changeSummary?.items?.join('；')}><b>{topic.changeSummary?.fromVersion?`v${topic.changeSummary.fromVersion} → v${topic.version}`:'本次新增'}</b><span>{topic.changeSummary?.items?.join('；')||'查看事件版本与来源'}</span><em>版本 ↗</em></button>
 {workflow?.readiness&&<details className="v8-context research-readiness"><summary>{workflow.readiness.label} · {workflow.readiness.gaps.length} 项待补</summary><p>填写完整度不代表结论成立或获准交易；未知事项可写明缺口与核验方法。</p>{workflow.readiness.gaps.map(g=><p key={g.id}>{g.label} <Button onClick={()=>g.target==='companies'?onCompany():onDetail(g.target)}>去补充</Button></p>)}</details>}
 <div className="v8-next"><b>下一步</b><p title={topic.nextEvidence}>{topic.nextEvidence}</p><Button onClick={()=>onDetail('materials')}>材料与研究</Button><Button onClick={onEvidence}>补线索</Button><Button onClick={onCompany}>公司关系</Button></div>
 <div className="v8-risk"><b>失效风险</b><p title={topic.hypothesis.invalidation}>{topic.hypothesis.invalidation||'尚未定义，拟申请前应补充'}</p></div>
 <details className="v8-context"><summary>当前判断、证据与时间口径</summary><p>{topic.hypothesis.logic}</p><p>支持 {topic.coverage.support} / 反证 {topic.coverage.against} / 待核 {topic.coverage.pending} · 证据状态不等于投资逻辑已成立。</p><p>持有窗口：{topic.hypothesis.holdingHorizon||'待评估'} · 复核：{topic.hypothesis.reviewAt||'待定'}</p><p>首次记录 {time(topic.firstSeen||topic.createdAt)} · 更新 {time(topic.updatedAt)}；回溯资料不视为当时已发现。</p></details>
 </div>;
}
