import {MATERIALITY_VALUES} from '../shared/company-materiality.mjs';
import {QUANTITY_VERSION,quantityInUnit,sourceQuantities} from '../shared/source-quantities.mjs';

export const SOURCE_CHECK_VERSION='materiality-source-literal-check/1';
// Called only on explicit saves of materiality inputs, never on history reads.
export function checkMaterialitySources(materiality,resolveMaterial){
 const cache=new Map();
 const source=ref=>{
  const key=JSON.stringify([ref.materialId,ref.materialRevision]);
  if(!cache.has(key)){
   let result;
   try{
    const m=resolveMaterial({id:ref.materialId,revision:ref.materialRevision});
    if(m.id!==ref.materialId||m.revision!==ref.materialRevision)throw Error('Wrong material version');
    const quantities=['title','body'].flatMap(field=>sourceQuantities(m[field]).map(q=>({field,...q})));
    result={materialId:m.id,materialRevision:m.revision,contentHash:m.contentHash,quantities};
   }catch{result=null;}
   cache.set(key,result);
  }
  return cache.get(key);
 };
 return {...materiality,rows:materiality.rows.map(row=>({...row,...Object.fromEntries(Object.keys(MATERIALITY_VALUES).map(key=>{
  const datum=row[key];if(!datum)return [key,null];
  const base={version:SOURCE_CHECK_VERSION,quantityVersion:QUANTITY_VERSION,checkedAt:materiality.savedAt,semanticVerified:false};
  if(datum.kind!=='source')return [key,{...datum,sourceCheck:{...base,status:'assumption',references:[]}}];
  const input=quantityInUnit(datum.value,row.unit);
  if(!input)return [key,{...datum,sourceCheck:{...base,status:'unsupported-unit-or-number',references:[]}}];
  const references=datum.references.map(ref=>{
   const identity={evidenceId:ref.id,materialId:ref.materialId,materialRevision:ref.materialRevision};
   if(!ref.materialId)return {...identity,status:'no-material',matches:[],totalMatches:0};
   const m=source(ref);if(!m)return {...identity,status:'material-unavailable',matches:[],totalMatches:0};
   const matches=m.quantities.filter(q=>q.normalization==='literal-only'&&q.unit===input.unit&&q.normalizedValue===input.normalizedValue);
   return {...identity,contentHash:m.contentHash,status:matches.length?'literal-match':'not-found',matches:matches.slice(0,3),totalMatches:matches.length};
  });
  const hits=references.filter(r=>r.status==='literal-match').length,checked=references.filter(r=>['literal-match','not-found'].includes(r.status)).length;
  const status=hits===references.length&&hits?'literal-match':hits?'partial-match':checked?'not-found':'material-unavailable';
  return [key,{...datum,sourceCheck:{...base,status,input,references}}];
 }))}))};
}
