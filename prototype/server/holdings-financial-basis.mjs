import {digest} from './codex-research.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';

export const HOLDINGS_FINANCIAL_VERSION='holdings-financial-refresh/1';
export const HOLDINGS_FINANCIAL_INTERVAL=6*3600000;
// Call only with material verified by openMaterials.prepare or immutableMaterialSnapshot.
// Receipt time and a moving selection window alone are not new evidence. The
// selected facts, coverage, parser generation and complete source hashes are.
export function holdingsFinancialBasis(materials){
 return digest(materials.map(m=>{
  const source=structuredClone(m.financialSource||m.filingSource);
  if(!source)throw Error('持仓财务检查缺少官方来源');
  source.sources=source.sources.map(({receivedAt,...rest})=>rest);
  for(const key of ['selection','coverage'])if(source[key]&&!Array.isArray(source[key])){delete source[key].asOf;delete source[key].cutoff;}
  return {method:m.method,url:m.url,source};
 }).sort((a,b)=>a.url.localeCompare(b.url)));
}
export function storedHoldingsFinancialBasis(db,result){
 if(result?.status!=='saved')return null;
 const refs=[{id:result.materialId,revision:result.materialRevision},...(result.filings||[]).filter(x=>x.status==='saved').map(x=>({id:x.materialId,revision:x.materialRevision}))];
 return holdingsFinancialBasis(refs.map(ref=>immutableMaterialSnapshot(db,ref)));
}
export function holdingsFinancialProof(topic,symbol,nextBasis){
 const prior=topic.financialSources?.find(x=>x.symbol===symbol);
 const basis={schema:HOLDINGS_FINANCIAL_VERSION,topicId:topic.id,baseVersion:topic.version,baseHash:digest(topic),symbol,priorResultHash:digest(prior),nextBasis};
 return {...basis,scopeHash:digest(basis)};
}
