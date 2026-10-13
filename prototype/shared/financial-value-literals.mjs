import {sourceQuantities,quantityInUnit,MAX_LITERAL_SOURCE_TEXT} from './source-quantities.mjs';
import {financialLiteralMatches} from './research-financials.mjs';

// A frozen packet opts into the new dimensional checks. Historic packets keep
// their original validator; none of their output or saved calculations is edited.
export const FINANCIAL_VALUE_RULES='financial-value-literals/2';
const canonical=/^(USD|CNY|HKD)\/shares$/;
export function financialQuantities(text){
 if(typeof text!=='string'||text.length>MAX_LITERAL_SOURCE_TEXT)throw Error('财务数值来源无效');
 const units=[],suffixes=[];
 // Project explicit unit tokens to a same-length money-parser view. This reuses
 // its exact decimal, range, ambiguous-currency and sign checks without FX or
 // guessing that an ordinary amount is a per-share measure.
 const projected=text.replace(/\b(USD|CNY|HKD)\/(shares?)\b|\bshares\b|\bper[\t\p{Zs}]+share\b/giu,(raw,currency,shares,at)=>{
  if(/^per/i.test(raw)){suffixes.push({start:at,end:at+raw.length});return ' '.repeat(raw.length);}
  units.push({start:at,end:at+raw.length,unit:currency?currency.toUpperCase()+'/shares':'shares'});
  return (currency?.toUpperCase()||'USD').padEnd(raw.length,' ');
 });
 return sourceQuantities(projected).map(q=>{
  const dimensions=units.filter(u=>u.start<q.end&&u.end>q.start);
  const suffix=suffixes.find(s=>s.start>=q.end&&/^[\t\p{Zs}]*$/u.test(text.slice(q.end,s.start)));
  let end=Math.max(q.end,...dimensions.map(u=>u.end),suffix?.end||0),unit=dimensions[0]?.unit||q.unit,normalization=q.normalization;
  if(dimensions.length>1||suffix&&dimensions.length||suffix&&!['USD','CNY','HKD'].includes(unit))normalization='conflicting-dimensions';
  else if(suffix)unit+='/shares';
  if(suffixes.some(s=>s.start>=q.start&&s.end<=q.end))normalization='conflicting-dimensions';
  if(dimensions.length){
   let rest=text.slice(q.start,end);
   for(const u of [...dimensions].reverse())rest=rest.slice(0,u.start-q.start)+' '.repeat(u.end-u.start)+rest.slice(u.end-q.start);
   if(/\b(?:USD|CNY|HKD|RMB|shares?)\b|US\$|HK\$|\$|人民币|美元|港元|港币/iu.test(rest))normalization='conflicting-dimensions';
  }
  // Full unit text is part of the citation. Signs outside the parser projection
  // and unsupported compound denominators cannot disappear through quoting.
  const before=text.slice(Math.max(0,q.start-4),q.start),after=text.slice(end);
  if((dimensions.length||suffix)&&(/^[\t\p{Zs}]*(?:USD|CNY|HKD|RMB|shares?)\b/iu.test(after)||/\b(?:USD|CNY|HKD|RMB|shares?)[\t\p{Zs}]*$/iu.test(text.slice(0,q.start))))normalization='conflicting-dimensions';
  if(/[（(][\t\p{Zs}]*$/u.test(before)&&/^[\t\p{Zs}]*[）)]/u.test(after))normalization='parenthesized-sign-unresolved';
  if(/^[\t\p{Zs}]*\//u.test(after))normalization='unsupported-dimension';
  return {...q,end,raw:text.slice(q.start,end),unit,normalization,normalizedValue:normalization==='literal-only'?q.normalizedValue:null,context:text.slice(Math.max(0,q.start-60),Math.min(text.length,end+60))};
 });
}
export function researchFinancialLiteralMatches(datum,unit,sourceText,{version,perShare=false}={}){
 if(version===undefined)return financialLiteralMatches(datum,unit,sourceText);
 if(version!==FINANCIAL_VALUE_RULES)return false;
 const dimension=perShare&&['USD','CNY','HKD'].includes(unit)?unit+'/shares':unit;
 const currency=canonical.exec(dimension||'')?.[1];
 const dimensional=!!currency||dimension==='shares';
 const expected=dimensional?quantityInUnit(datum.value,currency||'USD'):quantityInUnit(datum.value,dimension);
 if(!expected||!Array.isArray(datum.citations)||!datum.citations.length)return false;
 const wanted=dimensional?dimension:expected.unit;
 return datum.citations.every(c=>{
  const text=sourceText(c);if(typeof text!=='string'||typeof c.quote!=='string'||!c.quote.length)return false;
  const values=financialQuantities(text).filter(q=>q.normalization==='literal-only'&&q.unit===wanted&&q.normalizedValue===expected.normalizedValue);
  for(let at=text.indexOf(c.quote);at!==-1;at=text.indexOf(c.quote,at+1))if(values.some(q=>q.start>=at&&q.end<=at+c.quote.length))return true;
  return false;
 });
}
export function financialValueInstructions(packet){
 if(packet?.input?.financialValueRules!==FINANCIAL_VALUE_RULES)return '';
 return '本包财务字面校验采用financial-value-literals/2。metrics.unit可用原明确金额/百分比单位、USD/shares、CNY/shares、HKD/shares或shares；每股单位不能写成普通金额，股数不能写成币种。支持原文明确的USD/shares、USD/share、USD 2.50 per share、2.50 USD/share及shares 100或100 shares等写法（CNY/HKD同理）；$不推断币种。source估值perShare必须有该证券原币的明确每股单位，普通同额现金、股价或股数不能作为每股盈利/净资产的依据。仍须检查指标、主体、实际期间、摊薄/ADR与申报编号；每股收益和每股净资产不互换，历史每股数据不能直接年化或冒充未来预测。所有引用包含完整单位、符号和范围。未支持的写法保留缺口，不改成assumption绕过；存在明确模型假设时单独说明推导。新单位支持不证明会计语义、估值或交易可行性。\n';
}
