import {MATERIALITY_VALUES} from '../shared/company-materiality.mjs';
import {quantityInUnit,sourceQuantities} from '../shared/source-quantities.mjs';
export const MATERIALITY_REVIEW_VERSION='materiality-model-review/1';
const string={type:'string'};
export const MATERIALITY_REVIEW_SCHEMA={type:'array',items:{type:'object',additionalProperties:false,required:['targetId','verdict','reason','citations'],properties:{targetId:string,verdict:{type:'string',enum:['consistent','contradicted','unknown','assumption']},reason:string,citations:{type:'array',items:{type:'object',additionalProperties:false,required:['evidenceId','field','quote'],properties:{evidenceId:string,field:{type:'string',enum:['title','body']},quote:string}}}}}};
export function materialityReviewTargets(input){
 const targets=[];
 for(const company of input.companies||[])for(const row of company.materiality?.rows||[])for(const key of Object.keys(MATERIALITY_VALUES)){
  const datum=row[key];if(!datum)continue;
  targets.push({id:`${company.symbol}:${row.id}:${key}`,symbol:company.symbol,company:company.name||company.symbol,rowId:row.id,valueKey:key,valueLabel:MATERIALITY_VALUES[key],value:datum.value,kind:datum.kind,unit:row.unit,metric:row.label,scope:row.scope,period:row.period,basis:row.basis,evidenceIds:[...datum.evidenceIds]});
 }
 return {version:MATERIALITY_REVIEW_VERSION,targets};
}
const fail=()=>{throw Error('模型量级核验无效');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateMaterialityReviews(reviews,packet){
 const review=packet.input.materialityReview,targets=review?.targets||[];
 if(review&&(review.version!==MATERIALITY_REVIEW_VERSION||JSON.stringify(review)!==JSON.stringify(materialityReviewTargets(packet.input))))fail();
 if(reviews===undefined){if(targets.length)fail();return undefined;}
 if(!Array.isArray(reviews)||reviews.length!==targets.length||new Set(reviews.map(r=>r?.targetId)).size!==reviews.length)fail();
 return reviews.map(r=>{
  if(!exact(r,['targetId','verdict','reason','citations'])||!['consistent','contradicted','unknown','assumption'].includes(r.verdict)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1600||!Array.isArray(r.citations)||r.citations.length>5)fail();
  const target=targets.find(t=>t.id===r.targetId);if(!target||target.kind==='assumption'&&r.verdict!=='assumption'||target.kind==='source'&&r.verdict==='assumption')fail();
  const seen=new Set(),citations=r.citations.map(c=>{
   if(!exact(c,['evidenceId','field','quote'])||!['title','body'].includes(c.field)||typeof c.quote!=='string'||c.quote.trim().length<4||c.quote.length>1200||!target.evidenceIds.includes(c.evidenceId))fail();
   const e=packet.input.evidence.find(e=>e.id===c.evidenceId),m=e?.material;
   if(!m||m.id!==e.materialId||m.revision!==e.materialRevision||typeof m[c.field]!=='string'||!m[c.field].includes(c.quote))fail();
   const key=JSON.stringify(c);if(seen.has(key))fail();seen.add(key);return {...c};
  });
  if(['consistent','contradicted'].includes(r.verdict)&&!citations.length)fail();
  if(r.verdict==='consistent'){
   const input=quantityInUnit(target.value,target.unit);
   if(!input||!citations.some(c=>{
    const text=packet.input.evidence.find(e=>e.id===c.evidenceId).material[c.field];
    const matches=sourceQuantities(text).filter(q=>q.normalization==='literal-only'&&q.unit===input.unit&&q.normalizedValue===input.normalizedValue);
    for(let at=text.indexOf(c.quote);at!==-1;at=text.indexOf(c.quote,at+1))if(matches.some(q=>q.start>=at&&q.end<=at+c.quote.length))return true;
    return false;
   }))fail();
  }
  return {...r,reason:r.reason.trim(),citations};
 });
}
