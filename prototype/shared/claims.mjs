import {validateAssessment} from './uncertainty.mjs';
export const CLAIM_KINDS={fact:'事实主张',outcome:'事件兑现',earnings:'盈利影响',price:'价格假设'};
export const OUTCOMES={open:'尚未到期 / 跟踪中',unresolved:'未解决 / 资料不足',true:'已兑现',false:'未兑现',partial:'部分兑现'};
export const assessmentKeys=['status','claim','probability','basis','impactIfTrue','impactIfFalse','horizon','resolveBy'];
export const assessmentFields=a=>Object.fromEntries(assessmentKeys.map(k=>[k,a[k]]));
export function assertClaimIdentity(previous,next){
 if(previous&&['claim','kind','resolveBy'].some(k=>previous[k]!==next[k]))throw new Error('主张内容、类型与期限已冻结；更换问题请新增独立主张，保留原概率与结局');
}
export function claimsOf(topic){return topic.claims?.length?topic.claims:topic.assessment?[{...topic.assessment,id:'primary',kind:'outcome',outcome:'open',evidenceIds:[],resolutionReason:'',revisionReason:'既有主张，首次编辑后纳入多主张记录'}]:[];}
export function validateClaim(value,topic){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('主张格式无效');
 const allowed=[...assessmentKeys,'id','kind','outcome','evidenceIds','resolutionReason','revisionReason'];
 if(Object.keys(value).some(k=>!allowed.includes(k))||!Object.hasOwn(CLAIM_KINDS,value.kind)||!Object.hasOwn(OUTCOMES,value.outcome))throw new Error('主张分类或字段无效');
 const out={...validateAssessment(assessmentFields(value)),kind:value.kind,outcome:value.outcome};
 for(const k of ['resolutionReason','revisionReason']){if(typeof value[k]!=='string'||value[k].length>2000)throw new Error('主张说明最多 2000 字');out[k]=value[k].trim();}
 if(!out.revisionReason)throw new Error('请说明新增或修订原因');
 if(!Array.isArray(value.evidenceIds)||value.evidenceIds.length>40||new Set(value.evidenceIds).size!==value.evidenceIds.length||value.evidenceIds.some(id=>!topic.evidence.some(e=>e.id===id)))throw new Error('主张引用的证据不存在或重复');
 out.evidenceIds=[...value.evidenceIds];
 if(out.outcome!=='open'&&!out.resolutionReason)throw new Error('请记录结局判断依据；资料不足可选未解决');
 if(['true','false','partial'].includes(out.outcome)&&!out.evidenceIds.length)throw new Error('判定结局需关联至少一条证据');
 return out;
}
export function researchDelta(topic,previous){
 if(!previous)return {fromVersion:null,toVersion:topic.version,items:['首次研究记录；不代表发布时已发现']};
 const pct=p=>p===null||p===undefined?'未估计':`${p}%`;
 const items=[],before=new Map(claimsOf(previous).map(c=>[c.id,c]));
 for(const c of claimsOf(topic)){const old=before.get(c.id);if(!old)items.push(`新增主张：${c.claim}`);else {if(c.probability!==old.probability)items.push(`概率 ${pct(old.probability)} → ${pct(c.probability)}：${c.claim}`);if(c.status!==old.status||c.outcome!==old.outcome)items.push(`主张状态 / 结局修订：${c.claim}`);if(c.revisionReason!==old.revisionReason&&c.probability===old.probability&&c.status===old.status&&c.outcome===old.outcome)items.push(`修订依据：${c.revisionReason}`);}}
 const added=topic.evidence.filter(e=>!previous.evidence.some(p=>p.id===e.id));
 if(added.length)items.push(`新增 ${added.length} 条线索，其中 ${added.filter(e=>e.stance==='against').length} 条反向线索；不等于独立来源数`);
 if(JSON.stringify(topic.hypothesis)!==JSON.stringify(previous.hypothesis))items.push('交易假设、期限或失效条件已修订');
 if(topic.nextEvidence!==previous.nextEvidence)items.push('下一步观察点已修订');
 if(topic.companies.length!==previous.companies.length)items.push(`关联公司 ${previous.companies.length} → ${topic.companies.length}`);
 for(const company of topic.companies){const old=previous.companies.find(c=>c.symbol===company.symbol);if(old&&JSON.stringify(company)!==JSON.stringify(old))items.push(`公司关系 / 影响分析已修订：${company.name||company.symbol}`);}
 return {fromVersion:previous.version,toVersion:topic.version,items:items.length?items:['核验或研究状态已修订，查看完整版本差异']};
}
