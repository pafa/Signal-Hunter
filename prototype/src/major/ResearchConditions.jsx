import React from 'react';
import BusinessFact from './BusinessFact';
import {RESEARCH_CONDITION_FIELDS,describeResearchCondition} from '../../shared/research-conditions.mjs';

export default function ResearchConditions({assessment,checks,renderCitations}){
 const groups=assessment.monitoring;
 if(!groups)return <p className="m-note">此历史版本未保存结构化观察条件；不从旧文字补造规则。</p>;
 return <section aria-label={`${assessment.symbol} 结构化观察条件`}>
  <h4>结构化观察条件</h4>
  <p className="m-note">保存后的条件由后台观察任务检查。以下区分条件定义和当前检查；满足条件也不等于买卖许可。依据见上方同名研判与原文。</p>
  <dl>{Object.entries(RESEARCH_CONDITION_FIELDS).map(([key,label])=>{const g=groups[key],check=checks?.find(c=>c.group===key);return <div className="assessment-dimension" key={key}>
   <dt>{label} <small>{check?({true:'已满足',false:'未满足',unknown:'无法判断'}[check.status]):g.status==='defined'?'已有定义 · 当前检查未提供':'无法自动判断'}</small></dt>
   <dd>{check&&<p>{check.reason}{check.active&&check.status==='unknown'?'；旧触发尚未确认解除':''}</p>}<p>{g.reason}</p>{g.status==='defined'&&<><p>{g.join==='all'?'以下条件需全部满足':'以下条件任一满足'} · {assessment.symbol}</p><ul>{g.conditions.map((c,i)=><li key={i}>{describeResearchCondition(c)}<BusinessFact value={c} renderCitations={renderCitations} citationKey={key+':business:'+i}/></li>)}</ul></>}</dd>
  </div>;})}</dl>
 </section>;
}
