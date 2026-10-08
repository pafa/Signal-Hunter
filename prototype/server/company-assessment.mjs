import {COMPANY_ASSESSMENT_FIELDS,COMPANY_ASSESSMENT_VERSION} from '../shared/company-assessment.mjs';
import {DIRECTIONS} from '../shared/company-directory.mjs';

const string={type:'string'},fields=Object.keys(COMPANY_ASSESSMENT_FIELDS);
const citation={type:'object',additionalProperties:false,required:['evidenceId','field','quote'],properties:{evidenceId:string,field:{type:'string',enum:['title','body']},quote:string}};
const dimension={type:'object',additionalProperties:false,required:['text','basis','citations'],properties:{text:string,basis:{type:'string',enum:['source','inference','unknown']},citations:{type:'array',maxItems:3,items:citation}}};
export const COMPANY_ASSESSMENT_SCHEMA={type:'array',items:{type:'object',additionalProperties:false,required:['symbol','direction','analysis'],properties:{symbol:string,direction:{type:'string',enum:Object.keys(DIRECTIONS)},analysis:{type:'object',additionalProperties:false,required:fields,properties:Object.fromEntries(fields.map(key=>[key,dimension]))}}}};
export function companyAssessmentTargets(input){return {version:COMPANY_ASSESSMENT_VERSION,targets:(input.companies||[]).map(c=>({symbol:c.symbol,name:c.name||c.symbol}))};}
const fail=()=>{throw Error('公司逐项研判或原文引用无效');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateCompanyAssessments(assessments,packet){
 const contract=packet.input.companyAssessment,targets=contract?.targets||[];
 if(contract&&(JSON.stringify(contract)!==JSON.stringify(companyAssessmentTargets(packet.input))||new Set(targets.map(t=>t.symbol)).size!==targets.length))fail();
 // Frozen packets produced before this contract keep their original meaning.
 if(assessments===undefined){if(targets.length)fail();return undefined;}
 if(!Array.isArray(assessments)||assessments.length!==targets.length||new Set(assessments.map(a=>a?.symbol)).size!==assessments.length)fail();
 const known=new Map(packet.input.evidence.map(e=>[e.id,e]));
 return assessments.map(a=>{
  if(!exact(a,['symbol','direction','analysis'])||!targets.some(t=>t.symbol===a.symbol)||!Object.hasOwn(DIRECTIONS,a.direction)||!exact(a.analysis,fields))fail();
  const analysis=Object.fromEntries(fields.map(key=>{
   const d=a.analysis[key];
   if(!exact(d,['text','basis','citations'])||typeof d.text!=='string'||!d.text.trim()||d.text.length>1000||!['source','inference','unknown'].includes(d.basis)||!Array.isArray(d.citations)||d.citations.length>3)fail();
   const seen=new Set(),citations=d.citations.map(c=>{
    if(!exact(c,['evidenceId','field','quote'])||!['title','body'].includes(c.field)||typeof c.quote!=='string'||c.quote.trim().length<4||c.quote.length>1200)fail();
    const e=known.get(c.evidenceId),m=e?.material;
    if(!m||m.id!==e.materialId||m.revision!==e.materialRevision||typeof m[c.field]!=='string'||!m[c.field].includes(c.quote))fail();
    const token=JSON.stringify(c);if(seen.has(token))fail();seen.add(token);return {...c};
   });
   if(d.basis!=='unknown'&&!citations.length)fail();
   const refs=d.text.match(/\b(?:news|material):[A-Za-z0-9_:-]+/g)||[];
   if(refs.some(id=>!citations.some(c=>c.evidenceId===id)))fail();
   return [key,{text:d.text.trim(),basis:d.basis,citations}];
  }));
  if(a.direction!=='unclear'&&analysis.impactMechanism.basis==='unknown')fail();
  return {symbol:a.symbol,direction:a.direction,analysis};
 });
}
export const COMPANY_ASSESSMENT_INSTRUCTIONS=`companyAssessments逐一覆盖input.companyAssessment.targets的每个symbol，恰好一次；没有确定证券时为空数组，不新增代码、不把A/H/ADR或竞争者视为同一证券。每项仅有symbol、direction和analysis。direction为unclear/positive/negative/mixed，描述有条件的业务影响，不代表股价涨跌或交易许可；传导机制未知时必须unclear。analysis的十项为${fields.join('、')}，每项仅有text、basis、citations。text为1至1000字符，写具体判断或缺少什么，不能用零替代未知。basis为source（来源实际陈述的事实/预测，仍待核实）、inference（明确写出假设、传导及不成立条件的模型推断）、unknown（缺乏依据）；source与inference都至少引用一段冻结原文，不能把原文仅提及公司误当业务敞口证据。每项最多三段citations，每段仅有evidenceId、field(title/body)、quote，quote为4至1200字符的逐字原文；不能引用其他公司的无关原文支持本公司，不使用旧模型判断代替原始证据。逐项区分直接业务、间接传导、同一发行人不同上市证券；金额和比例须说明主体、单位、期间、实绩或预期，缺营收基准保留未知，不自行填入人工materiality表。pricedIn缺有时间的行情或估值资料时未知，不从报道热度断言市场已反映。entryCondition、exitCondition、invalidation写可核查的研究条件及复核节点；没有报价、账户和估值依据时买点、卖点、目标价、仓位与预计卖出日期未知，不编造精确值。nextCheck写下一项需自动补查的证据；未获证实的不强行给出买卖方向。综合包中每个证券独立分析并保留成员分歧，不相加金额、概率或受益程度。缺口同时反映到missingEvidence。这些是可追溯的模型判断，字面引用通过不证明财务含义正确，不要求用户逐项补表或批准中间结果。\n`;
