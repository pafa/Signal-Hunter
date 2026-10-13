import {CITATION_WIRE_VERSION,CITATION_ID_PATTERN} from './research-citation-wire.mjs';
import {COMPANY_ASSESSMENT_FIELDS} from '../shared/company-assessment.mjs';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validId=v=>typeof v==='string'&&new RegExp(CITATION_ID_PATTERN).test(v);
// Diagnose transport positions only. Never echo arbitrary identifiers, quotes,
// object keys or instructions from rejected output into the repair prompt.
export function citationWireFeedback(output,packet){
 if(!output||typeof output!=='object'||Array.isArray(output))return null;
 if(!Object.hasOwn(output,'wireFormat')&&!Object.hasOwn(output,'citationPool'))return [];
 if(!exact(output,['wireFormat','citationPool','sections','missingEvidence','materialityReviews','sourceRequests','companyAssessments'])||output.wireFormat!==CITATION_WIRE_VERSION||!Array.isArray(output.citationPool))return null;
 const known=new Map(packet.input.evidence.map(e=>[e.id,e])),pool=new Map(),used=new Set(),issues=[];
 for(const [i,c] of output.citationPool.entries()){
  if(!exact(c,['id','evidenceId','field','quote']))return null;
  const e=known.get(c.evidenceId),m=e?.material;
  // Only describe references to intact, real excerpts of this frozen packet.
  // Damaged material or invented quotations remain ordinary rejected output.
  if(!m||m.id!==e.materialId||m.revision!==e.materialRevision||!['title','body'].includes(c.field)||typeof c.quote!=='string'||c.quote.trim().length<4||c.quote.length>1200||typeof m[c.field]!=='string'||!m[c.field].includes(c.quote))return null;
  const path=`citationPool[${i}].id`;
  if(!validId(c.id))issues.push({code:'citation-id-format',path,pattern:CITATION_ID_PATTERN});
  else if(pool.has(c.id))issues.push({code:'citation-id-duplicate',path,conflictsWith:`citationPool[${pool.get(c.id)}].id`});
  if(typeof c.id==='string'&&!pool.has(c.id))pool.set(c.id,i);
 }
 const check=(citations,path)=>{
  if(citations===undefined)return;
  if(!Array.isArray(citations)){issues.push({code:'citation-reference-format',path});return;}
  const seen=new Map();
  citations.forEach((id,i)=>{
   const here=`${path}[${i}]`;
   if(!validId(id))issues.push({code:'citation-reference-format',path:here,pattern:CITATION_ID_PATTERN});
   else if(!pool.has(id))issues.push({code:'citation-reference-missing',path:here});
   if(typeof id==='string'&&pool.has(id))used.add(id);
   if(typeof id==='string'&&seen.has(id))issues.push({code:'citation-use-duplicate',path:here,conflictsWith:`${path}[${seen.get(id)}]`});
   if(typeof id==='string')seen.set(id,i);
  });
 };
 if(!Array.isArray(output.materialityReviews)||!Array.isArray(output.companyAssessments)||output.companyAssessments.length>(packet.input.companyAssessment?.targets.length||0))return null;
 output.materialityReviews.forEach((r,i)=>check(r?.citations,`materialityReviews[${i}].citations`));
 for(const [i,a] of output.companyAssessments.entries()){
  if(!packet.input.companyAssessment.targets.some(t=>t.symbol===a?.symbol))return null;
  const path=`companyAssessments[${i}]`;
  for(const key of Object.keys(COMPANY_ASSESSMENT_FIELDS))check(a.analysis?.[key]?.citations,`${path}.analysis.${key}.citations`);
  if(a.financials?.metrics!==undefined){if(!Array.isArray(a.financials.metrics)||a.financials.metrics.length>8)return null;a.financials.metrics.forEach((m,j)=>{for(const k of ['baseline','affected','expected','observed'])check(m?.[k]?.citations,`${path}.financials.metrics[${j}].${k}.citations`);});}
  if(a.financials?.valuation?.scenarios!==undefined){if(!Array.isArray(a.financials.valuation.scenarios)||a.financials.valuation.scenarios.length>3)return null;a.financials.valuation.scenarios.forEach((s,j)=>{for(const k of ['perShare','multiple'])check(s?.[k]?.citations,`${path}.financials.valuation.scenarios[${j}].${k}.citations`);});}
  check(a.recommendation?.citations,`${path}.recommendation.citations`);
  check(a.recommendation?.holdingHorizon?.citations,`${path}.recommendation.holdingHorizon.citations`);
 }
 for(const [id,i] of pool)if(validId(id)&&!used.has(id))issues.push({code:'citation-unused',path:`citationPool[${i}].id`,id});
 return issues;
}
