import {normalizeMateriality} from '../shared/company-materiality.mjs';
import {instrument} from '../shared/securities.mjs';
import {RESEARCH_FINANCIALS_VERSION,FINANCIAL_VALUES,VALUATION_METHODS,valuationResult} from '../shared/research-financials.mjs';
import {FINANCIAL_VALUE_RULES,researchFinancialLiteralMatches} from '../shared/financial-value-literals.mjs';
import {observationInstant} from './observation-rules.mjs';

const string={type:'string'},object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const citation=object({evidenceId:string,field:{type:'string',enum:['title','body']},quote:string});
const citations={type:'array',maxItems:3,items:citation};
const datum=object({value:{type:'number',minimum:-1e12,maximum:1e12},kind:{type:'string',enum:['source','assumption']},reason:string,citations});
const nullable=s=>({anyOf:[s,{type:'null'}]});
const metric=object({id:string,label:string,scope:string,period:string,unit:string,basis:string,comparable:{type:'boolean'},eventAt:nullable(string),expectationAt:nullable(string),...Object.fromEntries(Object.keys(FINANCIAL_VALUES).map(k=>[k,nullable(datum)]))});
const unknown=object({status:{type:'string',enum:['unknown']},reason:string});
const scenario=object({id:{type:'string',enum:['low','base','high']},perShare:datum,multiple:object({value:{type:'number',exclusiveMinimum:0,maximum:1000},reason:string,citations})});
export const RESEARCH_FINANCIALS_SCHEMA=object({version:{type:'string',enum:[RESEARCH_FINANCIALS_VERSION]},reason:string,metrics:{type:'array',maxItems:8,items:metric},valuation:{anyOf:[unknown,object({status:{type:'string',enum:['defined']},reason:string,method:{type:'string',enum:Object.keys(VALUATION_METHODS)},currency:{type:'string',enum:['USD','CNY','HKD']},subject:string,shareBasis:string,metricPeriod:string,basisAt:string,horizonAt:string,scenarios:{type:'array',minItems:3,maxItems:3,items:scenario}})]}});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('公司财务输入、估值情景或原文依据无效');};
const text=(v,n=1200)=>{if(typeof v!=='string'||!v.trim()||v.length>n)fail();return v.trim();};
const number=(v,positive=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12||(positive&&v<=0))fail();return v;};

export function validateResearchFinancials(input,{symbol,packet,validateCitations}){
 if(Object.hasOwn(packet.input,'financialValueRules')&&packet.input.financialValueRules!==FINANCIAL_VALUE_RULES)fail();
 if(!exact(input,['version','reason','metrics','valuation'])||input.version!==RESEARCH_FINANCIALS_VERSION||!Array.isArray(input.metrics)||input.metrics.length>8)fail();
 const reason=text(input.reason),known=new Map(packet.input.evidence.map(e=>[e.id,e]));
 const refs=(s,c)=>{if((s.match(/\b(?:news|material):[A-Za-z0-9_:-]+/g)||[]).some(id=>!c.some(x=>x.evidenceId===id)))fail();};
 const value=(d,unit,perShare=false)=>{
  if(!exact(d,['value','kind','reason','citations'])||!['source','assumption'].includes(d.kind))fail();
  const result={value:number(d.value),kind:d.kind,reason:text(d.reason),citations:validateCitations(d.citations)};
  if(!result.citations.length)fail();refs(result.reason,result.citations);
  if(result.kind==='source'&&!researchFinancialLiteralMatches(result,unit,c=>known.get(c.evidenceId)?.material?.[c.field],{version:packet.input.financialValueRules,perShare}))fail();
  return result;
 };
 const keys=['id','label','scope','period','unit','basis','comparable','eventAt','expectationAt',...Object.keys(FINANCIAL_VALUES)];
 const metrics=input.metrics.map(row=>{
  if(!exact(row,keys))fail();
  const out={...row,...Object.fromEntries(Object.keys(FINANCIAL_VALUES).map(k=>[k,row[k]===null?null:value(row[k],row.unit)]))};
  if(Object.keys(FINANCIAL_VALUES).every(k=>out[k]===null))fail();
  refs(out.basis,Object.keys(FINANCIAL_VALUES).flatMap(k=>out[k]?.citations||[]));
  return out;
 });
 // Reuse the existing scope/unit/time/comparability contract and arithmetic.
 normalizeMateriality(metrics.map(row=>({...row,...Object.fromEntries(Object.keys(FINANCIAL_VALUES).map(k=>[k,row[k]?{value:row[k].value,kind:row[k].kind,evidenceIds:[...new Set(row[k].citations.map(c=>c.evidenceId))]}:null]))})),{evidence:packet.input.evidence},packet.generatedAt);
 const v=input.valuation;let valuation;
 if(v?.status==='unknown'){
  if(!exact(v,['status','reason']))fail();valuation={status:'unknown',reason:text(v.reason)};
 }else{
  if(!exact(v,['status','reason','method','currency','subject','shareBasis','metricPeriod','basisAt','horizonAt','scenarios'])||v.status!=='defined'||!Object.hasOwn(VALUATION_METHODS,v.method)||v.currency!==instrument(symbol).currency||!Array.isArray(v.scenarios)||v.scenarios.length!==3)fail();
  if(observationInstant(v.basisAt)===null||observationInstant(v.horizonAt)===null||!Number.isFinite(Date.parse(packet.generatedAt))||Date.parse(v.basisAt)>Date.parse(packet.generatedAt)||Date.parse(v.horizonAt)<=Date.parse(packet.generatedAt))fail();
  valuation={...v,reason:text(v.reason),subject:text(v.subject,200),shareBasis:text(v.shareBasis,300),metricPeriod:text(v.metricPeriod,160),scenarios:v.scenarios.map((s,i)=>{
   if(!exact(s,['id','perShare','multiple'])||s.id!==['low','base','high'][i]||!exact(s.multiple,['value','reason','citations']))fail();
   const perShare=value(s.perShare,v.currency,true);number(perShare.value,true);
   const multiple={value:number(s.multiple.value,true),reason:text(s.multiple.reason),citations:validateCitations(s.multiple.citations)};
   if(multiple.value>1000||!multiple.citations.length)fail();refs(multiple.reason,multiple.citations);
   for(const c of [...perShare.citations,...multiple.citations]){
    const e=known.get(c.evidenceId),availableAt=e?.material?.availableAt;
    if(!Number.isFinite(Date.parse(availableAt))||Date.parse(availableAt)>Date.parse(v.basisAt))fail();
   }
   return {id:s.id,perShare,multiple};
  })};
  const all=valuation.scenarios.flatMap(s=>[...s.perShare.citations,...s.multiple.citations]);
  for(const s of [valuation.reason,valuation.subject,valuation.shareBasis,valuation.metricPeriod])refs(s,all);
  const result=valuationResult({version:RESEARCH_FINANCIALS_VERSION,valuation});
  if(result.scenarios.some(s=>!Number.isFinite(s.price)||s.price<=0||s.price>1e12)||result.low>result.base||result.base>result.high)fail();
 }
 const allCitations=[...metrics.flatMap(r=>Object.keys(FINANCIAL_VALUES).flatMap(k=>r[k]?.citations||[])),...(valuation.scenarios||[]).flatMap(s=>[...s.perShare.citations,...s.multiple.citations])];
 refs(reason,allCitations);refs(valuation.reason,allCitations);
 return {version:RESEARCH_FINANCIALS_VERSION,reason,metrics,valuation};
}

export const RESEARCH_FINANCIALS_INSTRUCTIONS=`company-assessment/3和/4另外必须输出financials，恰含version(research-financials/1)、reason、metrics、valuation。财务语义与假设仍待核实，不输出已核验、订单或账户字段；旧/1和/2不添加financials。无资料时metrics为空，valuation仅含status:unknown及具体reason，不造零值或目标涨幅。
每个kind:source数值的citations仅放直接支持该值与单位的原文，每条都须匹配；用于对照的不同数值、口径差异或反证放在analysis及missingEvidence，不混入该数值的直接支持。例如现金支付口径和回购金额口径不同，即使同在一份申报中，也分别说明，不以其中一个数值引用另一个金额。保留反证和差异说明，不通过删指标、改为assumption或裁切原文绕过核对。
metrics由你从本版原始材料独立整理，不以人工量级表或materialityReview.targets存在为前提；沿用的是字段与计算协议，不是复制已有行。每项恰含id、label、scope、period、unit、basis、comparable:true、eventAt、expectationAt、baseline、affected、expected、observed；最多8项。四个数值可为null，否则恰含value、kind(source/assumption)、reason、citations；所有非空数值至少一段本版逐字原文引用，引用格式与analysis相同。source数值和明确币种/百分比单位必须在所引原文中逐字数值匹配，不支持的写法保留缺口；assumption明确给出从材料到情景的推导，不冒充材料实绩。subject/期间/业务口径不一致不比较；comparable不能凭数值单位一致就断言。日期未知为null；原预期不从事后资料倒填。不可比时不输出该行，reason与missingEvidence说明缺什么。人工materiality不覆盖。
先区分已披露财务背景、事件新增规模、未来假设和事前预期；最多选8项与本事件传导有关的指标，不把所有财务标签铺成表。已披露且与发行人对应的历史背景可以仅填写baseline，label以“背景：”开头，scope、period和basis明确原指标、实际期间及局限；affected、expected、observed均为null，不因此计算事件增量、占比或预期差。此时comparable:true只声明已填写的单一口径，不声称与事件可比。只有同主体、同期间、同币种、同会计与事件性质可比，才在同一行填写其他数值；回购授权不等于支付现金，现金余额不等于回购额度，季度不能与半年或年度直接相减。引用应含完整指标、单位、数值及期间，不截掉符号、区间或倍率；SEC选摘须保留所用标签、实际起止和申报编号。历史材料不能构造事前市场预期；仅有背景时说明仍缺本事件兑现及价格依据。无可用指标时才留空并说明实际缺口，不以已有人工目标为空推断财务量级必须为空。未提供financialValueRules的新单位协议时，每股/股数单位仍沿原支持范围；任何未支持单位不强改为金额或假设来绕过字面核对。
valuation定义时恰含status:defined、reason、method(eps-pe或book-pb)、currency(本证券原币)、subject(明确主体)、shareBasis(每股口径/摊薄与ADR比率等)、metricPeriod、basisAt(资料截至的带时区时点，不晚于生成时间)、horizonAt(未来估值情景窗口终点，不是预计成交日)、scenarios。scenarios按low/base/high三项顺序，每项仅id、perShare、multiple。perShare沿用上述数值结构，代表对应期间本证券口径的每股收益或每股净资产，必须为正；multiple仅value(正数≤1000)、reason、citations，是模型倍数假设，不能标已核实市场倍数。逐情景解释盈利/资产值和倍数假设，引用资料实际获取时间均不得晚于basisAt。系统自行乘算目标区间，不输出price或收益承诺。主体、币种、期间、股本/摊薄/ADR口径不能可靠对应或方法不适用时整段unknown；不把收入或订单额当每股收益、不跨币种换算、不把其他上市地目标价移用。本协议暂不计算DCF/EV等其他方法，不能为通过格式而强套倍数法。估值情景、观察阈值与执行限价分别表达；即使数值匹配和乘法通过也不证明估值合理，不自动变为买卖许可。\n`;
