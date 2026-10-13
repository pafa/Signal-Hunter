// Only the model transport uses short references. Stored research keeps the
// existing expanded citations and is checked by the original domain validators.
export const CITATION_WIRE_VERSION='research-citations/1';
export const CITATION_ID_PATTERN='^q[1-9][0-9]{0,5}$';
const keys=['sections','missingEvidence','materialityReviews','sourceRequests','companyAssessments'];
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('研判引用表或短引用无效');};
export function citationWireSchema(expanded,materialIds,{constrained=false}={}){
 const schema=structuredClone(expanded);
 function visit(node){
  if(!node||typeof node!=='object')return;
  if(node.properties?.citations?.items?.properties?.evidenceId){
   node.properties.citations.items={type:'string',...(constrained?{pattern:CITATION_ID_PATTERN}:{})};
  }
  for(const child of Object.values(node))if(child&&typeof child==='object')visit(child);
 }
 visit(schema);
 schema.required=['wireFormat','citationPool',...schema.required];
 schema.properties={wireFormat:{type:'string',enum:[CITATION_WIRE_VERSION]},citationPool:{type:'array',...(!materialIds.length?{maxItems:0}:{}),items:{type:'object',additionalProperties:false,required:['id','evidenceId','field','quote'],properties:{id:{type:'string'},evidenceId:{type:'string',...(materialIds.length?{enum:materialIds}:{})},field:{type:'string',enum:['title','body']},quote:{type:'string'}}}},...schema.properties};
 if(constrained){const p=schema.properties.citationPool.items.properties;p.id={type:'string',pattern:CITATION_ID_PATTERN};p.quote={type:'string',minLength:4,maxLength:1200,pattern:'\\S[\\s\\S]{2,}\\S'};}
 return schema;
}
export function expandCitationWire(output){
 if(!output||typeof output!=='object'||Array.isArray(output)||!Object.hasOwn(output,'wireFormat')&&!Object.hasOwn(output,'citationPool'))return output;
 if(!exact(output,['wireFormat','citationPool',...keys])||output.wireFormat!==CITATION_WIRE_VERSION||!Array.isArray(output.citationPool))fail();
 const pool=new Map(),used=new Set();
 for(const item of output.citationPool){
  if(!exact(item,['id','evidenceId','field','quote'])||typeof item.id!=='string'||!new RegExp(CITATION_ID_PATTERN).test(item.id)||pool.has(item.id)||typeof item.evidenceId!=='string'||!['title','body'].includes(item.field)||typeof item.quote!=='string'||item.quote.trim().length<4||item.quote.length>1200)fail();
  pool.set(item.id,{evidenceId:item.evidenceId,field:item.field,quote:item.quote});
 }
 function visit(value){
  if(Array.isArray(value))return value.map(visit);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>{
   if(key!=='citations')return [key,visit(child)];
   if(!Array.isArray(child))fail();
   return [key,child.map(id=>{if(typeof id!=='string'||!pool.has(id))fail();used.add(id);return {...pool.get(id)};})];
  }));
 }
 const result=Object.fromEntries(keys.map(k=>[k,visit(output[k])]));
 // All generated quotes must be used and therefore reach a domain validator.
 // Keep the original expanded-output byte ceiling against reference fan-out.
 if(used.size!==pool.size||Buffer.byteLength(JSON.stringify(result))>262144)fail();
 return result;
}
export const CITATION_COMPLETENESS_INSTRUCTIONS=`引用完整性检查：先完成每项判断实际需要的citations，再按这些位置用到的短编号生成citationPool；引用表编号与全部citations使用编号的集合必须完全相同。编号只能为q加1至6位不以0开头的数字。每个引用表编号唯一，每个citations数组内部不重复。sections.sourceIds、sourceRequests.evidenceId及自然语言提及只标识材料，不构成对citationPool编号的使用；仅供五章列出材料时不另外生成悬空引文。不要为了用完引用表而给无关判断硬添引用，也不要省略有依据的公司、财务、反证或关键事实。重新核对每条判断所需的逐字原文与完整语境，再输出完整JSON；不输出未被使用的引文、缺失编号或混合引用对象。\n`;
export const CITATION_WIRE_INSTRUCTIONS=`本次实际输出使用research-citations/1引用传输格式。前面各协议描述的是还原后的研究字段；在实际JSON顶层增加wireFormat:"research-citations/1"和citationPool数组。将所有citations数组里的引用对象改成短编号字符串，例如["q1","q2"]；空引用仍为[]。citationPool每项仅有id、evidenceId、field、quote，id用q1、q2等唯一编号；相同证据、字段和逐字引文只写一次，可被不同判断重复引用。每个短编号必须存在，每项引用表必须被使用，不得循环或嵌套引用。quote仍须逐字完整保留关键主体、数值、单位、期间和限制，不能为了缩短裁掉必要语境。所有短引用还原后继续逐项执行原证据、证券、财务和时间校验；不能跨证券借用无关依据。五章、全部目标公司、十项分析、监控、财务、行动、缺口与补读字段保持原完整范围，不省略判断来换取较短输出。sections.sourceIds和sourceRequests.evidenceId仍使用原完整evidence.id，不改成短编号；正文和缺口仍用自然语言，不把短编号当作完整说明。没有引用时citationPool为空。\n`;
