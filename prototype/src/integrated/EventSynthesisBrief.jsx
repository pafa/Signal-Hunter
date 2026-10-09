import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {synthesisStates} from '../../shared/event-synthesis-view.mjs';
export default function EventSynthesisBrief({group,onDetail}){
 const r=group.cluster.research,ready=r?.current;
 return <div className="dashboard-brief v8-brief" aria-label="事件综合研判">
  <div className="i-topic-heading"><div><div className="i-kicker">事件综合 · {group.topics.length} 份当前研究 · {ready?`综合 v${r.version}`:synthesisStates[r?.status]||'等待综合'} · 系统生成，事实待核</div><h1>{group.title}</h1></div><Button onClick={()=>onDetail('summary')}>深入研究 →</Button></div>
  <div className="v8-verdict"><b>{ready?'当前事件结论 · 尚非可执行方案':synthesisStates[r?.status]||'等待综合'}</b><Button onClick={()=>onDetail('conditions')}>查看条件与缺口</Button></div>
  <p className="dashboard-logic" title={ready?r.judgment:r?.reason}><b>{ready?'综合判断':'当前状态'}</b> {ready?r.judgment:r?.reason||'后台将综合本事件材料；各篇研究可从左侧展开查看。'}</p>
  <p className="dashboard-logic dashboard-risk" title={ready?r.risk:undefined}><b>主要风险</b> {ready?r.risk:'综合尚未完成，不能把某一篇研究当作整个事件的当前结论。'}</p>
  <p className="dashboard-horizon">{ready?`结论更新 ${time(r.updatedAt)} · ${r.companyCount} 家关联证券`:'原研究与历史综合保留，其他事件继续处理。'}</p>
  <details className="v8-context"><summary>展开事件状态与核心依据</summary><p>{ready?r.summary:'尚无当前有效的综合结论。'}</p><p>{ready?r.missingEvidence?.join('；'):r?.reason}</p><Button onClick={()=>onDetail('evidence')}>查看跨材料证据</Button></details>
 </div>;
}
