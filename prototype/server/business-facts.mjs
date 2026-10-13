import {BUSINESS_FACT_CONTRACT,BUSINESS_FACT_VERDICTS,businessFactTargets} from '../shared/business-facts.mjs';
const string={type:'string'},object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const BUSINESS_FACT_SCHEMA=object({type:{type:'string',enum:['business-fact']},claim:string,verdict:{type:'string',enum:Object.keys(BUSINESS_FACT_VERDICTS)},reason:string,citations:{type:'array',maxItems:3,items:object({evidenceId:string,field:{type:'string',enum:['body']},quote:string})}});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('业务事实条件、原文或复核范围无效');};
export function validateBusinessFact(c,{packet,validateCitations}={}){
 if(!exact(c,['type','claim','verdict','reason','citations'])||c.type!=='business-fact'||!Object.hasOwn(BUSINESS_FACT_VERDICTS,c.verdict)||typeof c.claim!=='string'||!c.claim.trim()||c.claim.length>400||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>600||!Array.isArray(c.citations)||c.citations.length>3||c.verdict!=='unknown'&&!c.citations.length)fail();
 const refs=validateCitations?validateCitations(c.citations):c.citations;
 for(const q of refs){
  if(!exact(q,['evidenceId','field','quote'])||typeof q.evidenceId!=='string'||q.field!=='body'||typeof q.quote!=='string'||q.quote.trim().length<4||q.quote.length>1200)fail();
  if(packet){if(!Number.isFinite(Date.parse(packet.generatedAt)))fail();const e=packet.input.evidence.find(e=>e.id===q.evidenceId),m=e?.material,available=Date.parse(m?.availableAt);if(!m||m.method==='public-market'||!Number.isFinite(available)||available>Date.parse(packet.generatedAt))fail();}
 }
 for(const id of (c.claim+' '+c.reason).match(/\b(?:news|material):[A-Za-z0-9_:-]+/g)||[])if(!refs.some(q=>q.evidenceId===id))fail();
 return {...c,claim:c.claim.trim(),reason:c.reason.trim(),citations:refs};
}
export function validateBusinessTargets(assessment,packet){
 if(packet.businessFactContract!==BUSINESS_FACT_CONTRACT)return;
 const prior=packet.input.monitoringReview?.businessFacts||[],current=businessFactTargets([assessment]);
 // A refresh cannot silently drop or rename a frozen prerequisite to get a pass.
 for(const p of prior.filter(p=>p.symbol===assessment.symbol))if(!current.some(c=>c.group===p.group&&c.join===p.join&&c.claim===p.claim))fail();
}
export const BUSINESS_FACT_INSTRUCTIONS=`本包businessFactContract=research-business-facts/1时，monitoring的conditions另支持business-fact，仅含type、claim、verdict、reason、citations。claim用1至400字符写一项可被后续资料证实或否定的业务命题，明确主体、动作、对象、阶段，必要时保留金额/单位/期间及先决条件；不要把多个互相独立命题塞成一项。verdict仅supported、contradicted、unknown，表示本版材料对该命题的支持/反驳/仍未知，不是独立核实真相或交易许可。reason用1至600字符比较命题与原文，说明缺口、冲突和资料截至时间。
supported或contradicted至少1段、最多3段本包正文逐字citations，格式仍evidenceId、field=body、quote；不可用标题、价格、旧模型文字或请求中的历史verdict作事实依据。没有报道不等于未发生；授权回购不等于实际回购、签约不等于收入确认、拟收购/待审批不等于完成、预测不等于实绩。原文未直接覆盖命题全范围、只有推断、缺关键附件或资料相冲突时unknown，保留原因和已有相关引文，不改成价格/时间条件替代必要业务前提。条件定义为defined时可含verdict=unknown，后台检查结果仍未知；无法明确命题本身时整组unknown。
input.monitoringReview.businessFacts是已冻结需继续核对的命题清单；每项symbol/group/join/claim必须原样保留在对应组并重新核对verdict/reason/citations，不静默删去必要前提，旧结论不是独立证据。其他新材料和反证继续覆盖。每组仍最多4个条件，join按全部/任一的实际含义；不能仅凭公司关系或价格上涨判业务成立。缺失材料同时写missingEvidence；原文明示的可用链接按已有sourceRequests提出，后台沿原补证/研究队列处理，不输出新API地址或用户任务。后台每日复核是调度政策，不是事实已兑现；无新材料时明确仍未知。\n`;
