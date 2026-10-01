import {claimsOf} from './claims.mjs';
import {COMPANY_ANALYSIS_FIELDS} from './company-directory.mjs';
const filled=v=>typeof v==='string'&&v.trim().length>0;
export function researchReadiness(topic){
 const gaps=[],h=topic.hypothesis||{},evidence=topic.evidence||[];
 const add=(id,label,target)=>gaps.push({id,label,target});
 if(!evidence.length)add('materials','尚无来源材料','materials');
 for(const [key,label] of Object.entries({logic:'研究逻辑',invalidation:'反证与失效条件',reviewAt:'下次复核日期',holdingHorizon:'观察期限'}))if(!filled(h[key]))add(key,`${label}未填写`,'hypothesis');
 if(!filled(topic.nextEvidence))add('next','下一步核查未填写','hypothesis');
 if(h.action!=='observe'&&!filled(h.trigger))add('trigger','行动条件未填写','hypothesis');
 for(const c of claimsOf(topic)){
  if(!filled(c.claim))add(`claim:${c.id}`,'主张内容未填写','uncertainty');
  if(!(c.evidenceIds||[]).length||c.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))add(`citation:${c.id}`,'主张来源引用未填写或已缺失','uncertainty');
  if(c.probability!=null&&['basis','resolveBy','impactIfTrue','impactIfFalse'].some(k=>!filled(c[k])))add(`probability:${c.id}`,'概率依据、期限或正反情景不完整','uncertainty');
 }
 const companies=topic.companies||[];
 if(!companies.length)add('companies','尚无有效公司关系','companies');
 for(const c of companies)for(const [field,label] of Object.entries(COMPANY_ANALYSIS_FIELDS))if(!filled(c.analysis?.[field]))add(`company:${c.symbol}:${field}`,`${c.name||c.symbol}：${label}未填写`,'companies');
 return {version:'research-readiness/1.0.0',topicVersion:topic.version,status:gaps.length?'incomplete':'documented',label:gaps.length?'研究记录待补齐':'研究记录已填写，待人工核验',gaps,automaticApproval:false};
}
