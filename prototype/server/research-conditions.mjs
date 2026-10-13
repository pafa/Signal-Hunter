import {BUSINESS_FACT_CONTRACT,conditionSignal} from '../shared/business-facts.mjs';
import {BUSINESS_FACT_SCHEMA,validateBusinessFact,BUSINESS_FACT_INSTRUCTIONS} from './business-facts.mjs';
import {RESEARCH_CONDITION_FIELDS} from '../shared/research-conditions.mjs';
import {observationInstant,validateObservationDefinition} from './observation-rules.mjs';

const fields=Object.keys(RESEARCH_CONDITION_FIELDS),string={type:'string'};
const object=(properties)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const condition={anyOf:[
 object({type:{type:'string',enum:['price']},interval:{type:'string',enum:['1d','1m']},operator:{type:'string',enum:['gte','lte']},value:{type:'number',exclusiveMinimum:0,maximum:1e12}}),
 object({type:{type:'string',enum:['at']},at:string}),
 object({type:{type:'string',enum:['research-change','counterevidence']}})
]};
const group=object({status:{type:'string',enum:['defined','unknown']},reason:string,join:{type:'string',enum:['all','any']},conditions:{type:'array',maxItems:4,items:condition}});
export const RESEARCH_CONDITIONS_SCHEMA=object(Object.fromEntries(fields.map(k=>[k,group])));
export function researchConditionsSchema(packet){
 const schema=structuredClone(RESEARCH_CONDITIONS_SCHEMA);
 if(packet.businessFactContract===BUSINESS_FACT_CONTRACT)for(const key of Object.keys(schema.properties)){
  // The legacy template shares group objects; detach each before extending it.
  schema.properties[key]=structuredClone(schema.properties[key]);
  schema.properties[key].properties.conditions.items.anyOf.push(structuredClone(BUSINESS_FACT_SCHEMA));
 }
 return schema;
}
export function researchConditionsInstructions(packet){
 if(packet.businessFactContract!==BUSINESS_FACT_CONTRACT)return RESEARCH_CONDITIONS_INSTRUCTIONS;
 return RESEARCH_CONDITIONS_INSTRUCTIONS.replace('条件仅支持四种：','旧协议的四种条件为：')
  .replace('不能以这些辅助条件替代业务兑现检查。','业务命题另按下文business-fact协议表达，不能以这些辅助条件替代业务兑现检查。')
  .replace('也不会创建观察任务或订单。','自动登记的研究沿既有队列复核，不代表创建订单。')+BUSINESS_FACT_INSTRUCTIONS+(packet.input?.monitoringReview?.triggers?.some(t=>t.kind==='capability')?'\n本次capability触发仅说明旧协议未能表达有原文的业务前提，proof.conditions是原版定义与分析的冻结历史，不是独立事实。逐项回看当前材料并重新研判，保留关键前提与缺口；只有足够依据时才定义business-fact或观察倾向，原未知不当负例，也不强制输出买卖、价格或日期。\n':'');
}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('公司逐项研判或原文引用无效');};

// This is a research definition, not an order or a claim that monitoring has run.
// Reuse the observation engine's definition checks without creating a rule.
export function validateResearchConditions(input,{symbol,analysis,packet,validateCitations,businessFactContract=packet?.businessFactContract}){
 if(!exact(input,fields))fail();
 return Object.fromEntries(fields.map(key=>{
  const g=input[key],d=analysis[key];
  if(!exact(g,['status','reason','join','conditions'])||!['defined','unknown'].includes(g.status)||typeof g.reason!=='string'||!g.reason.trim()||g.reason.length>600||!['all','any'].includes(g.join)||!Array.isArray(g.conditions)||g.conditions.length>4)fail();
  if(g.status==='unknown'&&(g.conditions.length||g.join!=='all')||g.status==='defined'&&(!g.conditions.length||d.basis==='unknown'||!d.citations.length))fail();
  const refs=g.reason.match(/\b(?:news|material):[A-Za-z0-9_:-]+/g)||[];
  if(refs.some(id=>!d.citations.some(c=>c.evidenceId===id)))fail();
  const seen=new Set(),conditions=g.conditions.map(c=>{
   if(c?.type==='business-fact'){
    if(businessFactContract!==BUSINESS_FACT_CONTRACT)fail();const fact=validateBusinessFact(c,{packet,validateCitations}),token=JSON.stringify(conditionSignal(fact));if(seen.has(token))fail();seen.add(token);return fact;
   }else if(c?.type==='price'){
    if(!exact(c,['type','interval','operator','value']))fail();
   }else if(c?.type==='at'){
    if(!exact(c,['type','at'])||observationInstant(c.at)===null)fail();
   }else if(!['research-change','counterevidence'].includes(c?.type)||!exact(c,['type']))fail();
   const definition={label:g.reason,join:'all',conditions:[c.type==='price'?{...c,symbol}:c]};
   // Labels are presentation only; the validated group explanation can be longer.
   definition.label='系统研究条件';
   const normalized=validateObservationDefinition(definition,{companies:[{symbol}]}).conditions[0];
   const token=JSON.stringify(normalized);if(seen.has(token))fail();seen.add(token);
   return {...c};
  });
  return [key,{status:g.status,reason:g.reason.trim(),join:g.join,conditions}];
 }));
}

export const RESEARCH_CONDITIONS_INSTRUCTIONS=`仅当input.companyAssessment.version为company-assessment/2、company-assessment/3或company-assessment/4，每家公司必须增加monitoring，恰好包含entryCondition、exitCondition、invalidation、nextCheck四组，与analysis同名项相对应。每组恰有status、reason、join、conditions。status为defined或unknown；reason用1至600字符说明该组如何覆盖文字条件，或不能自动判断的具体原因。defined至少一条、最多四条conditions，且对应analysis维度必须为source或inference并带逐字引用；unknown的conditions必须为空、join必须all。旧company-assessment/1不输出monitoring。
这些只是尚待核实的研究条件定义，不是当前已满足的状态、后台检查结果、交易批准或订单。定义不能偷偷删掉文字条件中的关键前提：若任一必要的业务、证据或估值前提不能用本协议可靠表达，整组写unknown，不能仅保留一个价位就声称进入条件已完整。
条件仅支持四种：price恰含type、interval(1d/1m)、operator(gte/lte)、value(正数且不超过1e12)，比较本项证券原币的观察价；at恰含type、at，必须为有明确时区的有效ISO时点；research-change或counterevidence仅含type。join为all（全部成立）或any（任一成立），严格按文字含义选择，不重复相同条件。禁止其他证券、账户、数量、资金、权限、API地址和操作字段。价格阈值必须有对应分析中的明确依据，不从订单金额或新闻数量制造股价；缺价格/估值资料时unknown。at必须有可核对时区和时点，不把模糊月份、相对日期或报道时间改为精确截止。研究变化只表示应重新研判，不表示应该卖出；反证出现不等于原判断已被证伪。不能以这些辅助条件替代业务兑现检查。定义可接受不代表财务语义已核实，也不会创建观察任务或订单。\n`;
