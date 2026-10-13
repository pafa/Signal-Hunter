import {calculateMateriality} from './company-materiality.mjs';
import {quantityInUnit,sourceQuantities} from './source-quantities.mjs';

export const RESEARCH_FINANCIALS_VERSION='research-financials/1';
export const VALUATION_METHODS={'eps-pe':'每股收益 × 市盈率假设','book-pb':'每股净资产 × 市净率假设'};
export const VALUATION_SCENARIOS={low:'保守情景',base:'基准情景',high:'积极情景'};
export const FINANCIAL_VALUES={baseline:'比较基准',affected:'涉及规模',expected:'原预期',observed:'新结果 / 情景'};

// Literal equality is only a unit/number check, never financial interpretation.
export function financialLiteralMatches(datum,unit,sourceText=c=>c.quote){
 const input=quantityInUnit(datum.value,unit);
 return !!input&&datum.citations.length>0&&datum.citations.every(c=>{
  const text=sourceText(c);if(typeof text!=='string'||typeof c.quote!=='string'||!c.quote.length)return false;
  // Inspect the full frozen field: a quote must not drop a sign, range or unit.
  const matches=sourceQuantities(text).filter(q=>q.normalization==='literal-only'&&q.unit===input.unit&&q.normalizedValue===input.normalizedValue);
  for(let at=text.indexOf(c.quote);at!==-1;at=text.indexOf(c.quote,at+1))if(matches.some(q=>q.start>=at&&q.end<=at+c.quote.length))return true;
  return false;
 });
}
export function financialMetricResult(row,evidence=[]){
 return calculateMateriality({...row,...Object.fromEntries(Object.keys(FINANCIAL_VALUES).map(k=>[k,row[k]?{...row[k],references:row[k].citations.map(c=>{const e=evidence.find(e=>e.id===c.evidenceId);return {availableAt:e?.material?.availableAt||e?.availableAt||null};})}:null]))});
}
// Versioned research arithmetic; values are NOT executable prices or probabilities.
export function valuationResult(financials){
 const v=financials?.valuation;
 if(financials?.version!==RESEARCH_FINANCIALS_VERSION||v?.status!=='defined')return null;
 const scenarios=v.scenarios.map(s=>({id:s.id,perShare:s.perShare.value,multiple:s.multiple.value,price:Number((s.perShare.value*s.multiple.value).toFixed(6))}));
 return {version:RESEARCH_FINANCIALS_VERSION,method:v.method,currency:v.currency,basisAt:v.basisAt,horizonAt:v.horizonAt,scenarios,low:scenarios[0].price,base:scenarios[1].price,high:scenarios[2].price,semanticVerified:false,executable:false};
}
