export const MATERIALITY_VERSION='company-materiality/1.0.0';
export const MATERIALITY_VALUES={baseline:'比较基准',affected:'涉及规模',expected:'原预期',observed:'新结果 / 情景值'};
export const materialityErrors=['量级记录最多8项，编号不得重复','量级口径、期间、单位与依据必须填写','量级数值必须是有限数字，绝对值不超过一万亿','数值来源必须选择材料或假设，材料引用不得缺失或重复','量级比较需明确确认同一主体、期间、单位与口径','量级时间需为带时区的有效时刻','量级记录字段无效'];
const fail=i=>{throw new Error(materialityErrors[i]);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail(6);};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(1);return v.trim();};
const instant=v=>{if(v==null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==v.slice(0,10))fail(5);return new Date(v).toISOString();};
const difference=(a,b)=>a==null||b==null?null:a-b;
const relative=(a,b)=>{if(a==null||b==null||b===0)return null;const value=(a-b)/Math.abs(b)*100;return Number.isFinite(value)?value:null;};

// Ratios are comparisons of the entered metric, never probabilities or return forecasts.
export function calculateMateriality(row){
 const get=k=>typeof row[k]?.value==='number'&&Number.isFinite(row[k].value)?row[k].value:null;
 const baseline=get('baseline'),affected=get('affected'),expected=get('expected'),observed=get('observed');
 if(row.comparable!==true)return {delta:null,relativeChange:null,expectationDelta:null,expectationGap:null,exposure:null,expectationBasis:'not-comparable'};
 const expectationAt=Date.parse(row.expectationAt),eventAt=Date.parse(row.eventAt),refs=row.expected?.references||[];
 const preEvent=expected!=null&&row.expected?.kind==='source'&&refs.length>0&&Number.isFinite(expectationAt)&&Number.isFinite(eventAt)&&expectationAt<eventAt&&refs.every(r=>Number.isFinite(Date.parse(r.availableAt))&&Date.parse(r.availableAt)<=expectationAt);
 return {delta:difference(observed,baseline),relativeChange:relative(observed,baseline),expectationDelta:difference(observed,expected),expectationGap:relative(observed,expected),exposure:baseline>0&&affected!=null&&affected>=0&&affected<=baseline?affected/baseline*100:null,expectationBasis:expected==null?'missing':preEvent?'pre-event-source-available':'retrospective-or-unverified',prospectiveValidated:false};
}

export function normalizeMateriality(input,topic,at){
 if(!Array.isArray(input)||input.length>8||new Set(input.map(r=>r?.id)).size!==input.length)fail(0);
 return {version:MATERIALITY_VERSION,savedAt:at,rows:input.map(row=>{
  keys(row,['id','label','scope','period','unit','basis','comparable','eventAt','expectationAt',...Object.keys(MATERIALITY_VALUES)]);
  if(typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.id))fail(0);
  if(row.comparable!==true)fail(4);
  const clean={id:row.id,label:text(row.label,120),scope:text(row.scope,200),period:text(row.period,160),unit:text(row.unit,80),basis:text(row.basis,1200),comparable:true,eventAt:instant(row.eventAt),expectationAt:instant(row.expectationAt)};
  for(const key of Object.keys(MATERIALITY_VALUES)){
   const value=row[key];if(value==null){clean[key]=null;continue;}
   keys(value,['value','kind','evidenceIds']);
   if(typeof value.value!=='number'||!Number.isFinite(value.value)||Math.abs(value.value)>1e12)fail(2);
   const ids=value.evidenceIds;
   if(!['source','assumption'].includes(value.kind)||!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length||value.kind==='source'&&!ids.length||ids.some(id=>typeof id!=='string'||!topic.evidence.some(e=>e.id===id)))fail(3);
   const references=ids.map(id=>{const e=topic.evidence.find(e=>e.id===id);return {id,claim:e.claim,url:e.url||null,availableAt:e.availableAt||(!e.newsId?e.firstSeen:null)||null,datePrecision:e.datePrecision||null,verification:e.verification||'unverified',newsId:e.newsId||null,newsRevision:e.newsRevision||null,materialId:e.materialId||null,materialRevision:e.materialRevision||null};});
   clean[key]={value:value.value,kind:value.kind,evidenceIds:[...ids],references};
  }
  return {...clean,result:calculateMateriality(clean)};
 })};
}

// Remove server-frozen references/results before editing; the server rebuilds them on save.
export function materialityInputs(value){return (value?.rows||[]).map(({result,...row})=>({...row,...Object.fromEntries(Object.keys(MATERIALITY_VALUES).map(k=>[k,row[k]?{value:row[k].value,kind:row[k].kind,evidenceIds:[...row[k].evidenceIds]}:null]))}));}
