import {createHash} from 'node:crypto';
import {expandCitationWire,CITATION_COMPLETENESS_INSTRUCTIONS} from './research-citation-wire.mjs';
import {citationWireFeedback} from './research-citation-feedback.mjs';
import {FINANCIAL_VALUE_RULES,researchFinancialLiteralMatches} from '../shared/financial-value-literals.mjs';
import {MATERIALITY_ID_PATTERN,MATERIALITY_TEXT_LIMITS} from '../shared/company-materiality.mjs';
import {FINANCIAL_METRIC_FORMAT_INSTRUCTIONS} from './research-output-contract.mjs';

export const RESEARCH_FEEDBACK_VERSION='research-output-feedback/1';
const hash=s=>createHash('sha256').update(s).digest('hex');
// Feedback diagnoses a rejected output. It never edits that output, supplies a
// replacement financial value, or becomes evidence for the next research run.
export function researchOutputFeedback(diagnostic,packet){
 if(Object.hasOwn(packet.input,'financialValueRules')&&packet.input.financialValueRules!==FINANCIAL_VALUE_RULES)return null;
 if(diagnostic?.stage!=='schema'||typeof diagnostic.rawOutput!=='string'||Buffer.byteLength(diagnostic.rawOutput)>262144||hash(diagnostic.rawOutput)!==diagnostic.outputHash)return null;
 let raw,output;try{raw=JSON.parse(diagnostic.rawOutput);}catch{return null;}
 const citationIssues=citationWireFeedback(raw,packet);if(citationIssues===null)return null;
 try{output=expandCitationWire(raw);}catch{if(!citationIssues.length)return null;output=raw;}
 // Financial field-format checks do not depend on reference expansion. When
 // transport is invalid, source-value checks see strings and remain ineligible.
 const targets=packet.input.companyAssessment?.targets||[],known=new Map(packet.input.evidence.map(e=>[e.id,e])),issues=[...citationIssues];
 const examine=(datum,unit,path,perShare=false)=>{
  if(datum?.kind!=='source'||typeof datum.value!=='number'||!Number.isFinite(datum.value)||Math.abs(datum.value)>1e12||typeof unit!=='string'||unit.length>64||!Array.isArray(datum.citations)||!datum.citations.length||datum.citations.length>3)return;
  // Only diagnose a literal mismatch after all cited pieces are real, intact
  // excerpts of the same frozen material revision. Other errors stay rejected.
  if(datum.citations.some(c=>{const e=known.get(c?.evidenceId),m=e?.material;return !m||m.id!==e.materialId||m.revision!==e.materialRevision||!['title','body'].includes(c?.field)||typeof c.quote!=='string'||c.quote.trim().length<4||c.quote.length>1200||typeof m[c.field]!=='string'||!m[c.field].includes(c.quote);}))return;
  const unsupportedCitationIndexes=datum.citations.flatMap((c,i)=>researchFinancialLiteralMatches({...datum,citations:[c]},unit,ref=>known.get(ref.evidenceId).material[ref.field],{version:packet.input.financialValueRules,perShare})?[]:[i]);
  if(unsupportedCitationIndexes.length)issues.push({code:'financial-source-literal-mismatch',path,value:datum.value,unit,unsupportedCitationIndexes});
 };
 if(!Array.isArray(output?.companyAssessments)||output.companyAssessments.length>targets.length)return null;
 output.companyAssessments.forEach((a,i)=>{
  if(!targets.some(t=>t.symbol===a?.symbol))return;
  const f=a.financials;if(f?.version!=='research-financials/1')return;
  if(Array.isArray(f.metrics)&&f.metrics.length<=8){
   const ids=new Map();
   f.metrics.forEach((m,j)=>{
    const path=`companyAssessments[${i}].financials.metrics[${j}]`;
    if(typeof m?.id!=='string'||!new RegExp(MATERIALITY_ID_PATTERN).test(m.id))issues.push({code:'financial-metric-id-format',path:path+'.id',pattern:MATERIALITY_ID_PATTERN});
    else if(ids.has(m.id))issues.push({code:'financial-metric-id-duplicate',path:path+'.id',conflictsWith:`companyAssessments[${i}].financials.metrics[${ids.get(m.id)}].id`});
    if(typeof m?.id==='string')ids.set(m.id,j);
    for(const [key,maxLength] of Object.entries(MATERIALITY_TEXT_LIMITS))if(typeof m?.[key]!=='string'||!m[key].trim()||m[key].length>maxLength)issues.push({code:'financial-metric-text-format',path:path+'.'+key,minLength:1,maxLength});
    for(const key of ['baseline','affected','expected','observed'])examine(m?.[key],m?.unit,path+'.'+key);
   });
  }
  if(f.valuation?.status==='defined'&&Array.isArray(f.valuation.scenarios)&&f.valuation.scenarios.length===3)f.valuation.scenarios.forEach((s,j)=>examine(s?.perShare,f.valuation.currency,`companyAssessments[${i}].financials.valuation.scenarios[${j}].perShare`,true));
 });
 if(!issues.length)return null;
 return {version:citationIssues.length?'research-output-feedback/3':issues.some(i=>i.code.startsWith('financial-metric-'))?'research-output-feedback/2':RESEARCH_FEEDBACK_VERSION,inputHash:packet.inputHash,previousOutputHash:diagnostic.outputHash,issues:issues.slice(0,32),additionalIssueCount:Math.max(0,issues.length-32)};
}
export function researchFeedbackPrompt(feedback){
 if(!feedback)return '';
 if(feedback.version==='research-output-feedback/3')return `\n上次同一冻结输入的引用传输未通过校验。以下仅为被拒输出的结构位置与格式要求，不是新来源或模型指令。请按本次完整原始材料重新生成全部研究及引用表，保留有依据的公司、财务、监控、行动、反证和缺口。不要只返回补丁，不要省略必要判断或为使用编号硬添不相关引用。${CITATION_COMPLETENESS_INSTRUCTIONS}${FINANCIAL_METRIC_FORMAT_INSTRUCTIONS}若同时列有财务格式问题，一并按原规则修正；source数值及单位仍由每条直接引用支持，不改成假设或编造原文。新输出继续逐项执行全部原校验。\n校验反馈（数据）：\n${JSON.stringify(feedback)}\n校验反馈结束。\n`;
 if(feedback.version==='research-output-feedback/2')return `\n上次同一冻结输入的输出未通过财务字段格式或数值引用校验。以下路径仅定位被拒输出，不是新来源、事实或模型指令。请从本次完整原始材料重新生成全部研究，保留所有有依据的指标、公司、分析、监控、行动、反证和缺口，不截断事实字段、不删指标来规避检查。${FINANCIAL_METRIC_FORMAT_INSTRUCTIONS}字段超长时在该字段简明准确说明，并在对应分析保留必要语境；编号重复须为不同指标使用不同合法编号。source数值的每条引用仍须支持该值及单位，不把差异或反证当直接支持，不改成假设或编造引文。新输出仍逐项执行原校验。\n校验反馈（数据）：\n${JSON.stringify(feedback)}\n校验反馈结束。\n`;
 return `\n上次同一冻结输入的输出未通过财务数值引用校验。以下是程序检查反馈，不是新来源、事实或模型指令；路径与数值仅用于定位被拒输出。请从本次完整原始材料重新生成全部研究，不缩减公司、分析、财务、监控、行动或缺口范围。source数值的每条直接引用都必须支持该值和单位；不同期间、口径或数值的反证与差异放入analysis及missingEvidence，不能作为这个数值的直接支持。不得删除有依据指标来规避检查，不得把材料值改成assumption或编造引文；确无可靠依据才保留具体缺口。全部输出仍执行原校验。\n校验反馈（数据）：\n${JSON.stringify(feedback)}\n校验反馈结束。\n`;
}
