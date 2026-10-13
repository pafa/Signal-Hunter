import {immutableMaterialSnapshot} from './research-materials.mjs';
import {digest} from './codex-research.mjs';

// Verify both the exact archived projection and its complete source bytes.
// Only receipt metadata can be ignored: amendments, raw bytes, parser/schema,
// issuer, period selection and coverage remain part of the comparison.
export function financialResearchBasis(db,ref){
 const m=immutableMaterialSnapshot(db,ref),value=structuredClone(m);
 const source=m.method==='public-financial'?value.financialSource:m.method==='public-filing'?value.filingSource:null;
 if(!source)throw Error('研究财务来源类型不匹配');
 if(m.method==='public-financial'){
  const [map,facts]=source.sources;
  value.body=value.body.replace(`原始财务响应实际获取 ${facts.receivedAt}；证券映射实际获取 ${map.receivedAt}。`,'原始财务响应及证券映射获取时间分别保留在不可变来源记录。');
 }else{
  const document=source.sources.at(-1),kind=source.exhibit?'附件':'原件';
  value.body=value.body.replace(`；${kind}实际获取 ${document.receivedAt}。`,`；${kind}获取时间保留在不可变来源记录。`);
 }
 source.sources=source.sources.map(({receivedAt,...record})=>record);
 for(const key of ['id','revision','contentHash','availableAt','receivedAt'])delete value[key];
 return digest(value);
}
