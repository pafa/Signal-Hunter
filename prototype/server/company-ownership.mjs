// A cited model classification, not independently verified ownership or impact.
export const OWNERSHIP_CONNECTION_VERSION='event-company-connection/2';
export const ATTACHMENT_ENTITIES_VERSION='company-attachment-entities-2';
export const CONTEXT_ENTITIES_VERSION='company-event-context-2';
export const ATTACHMENT_ENTITY_SCHEMAS=[ATTACHMENT_ENTITIES_VERSION,'company-attachment-entities-1'];
export const CONTEXT_ENTITY_SCHEMAS=[CONTEXT_ENTITIES_VERSION,'company-event-context-1'];
export const SCOPED_ENTITY_SCHEMAS=[...ATTACHMENT_ENTITY_SCHEMAS,...CONTEXT_ENTITY_SCHEMAS];
export const ownershipContract=packet=>[ATTACHMENT_ENTITIES_VERSION,CONTEXT_ENTITIES_VERSION].includes(packet?.schema);
const string=maxLength=>({type:'string',minLength:1,maxLength});
const fields=['subjectName','subjectReference','subjectQuote','actionQuote','ownershipQuote'];
export const PARENT_CONNECTION_SCHEMA={type:'object',additionalProperties:false,required:['relation','anchorQuote','reason','ownership'],properties:{relation:{type:'string',enum:['parent']},anchorQuote:string(1500),reason:string(1200),ownership:{type:'object',additionalProperties:false,required:fields,properties:Object.fromEntries(fields.map(k=>[k,string(['subjectName','subjectReference'].includes(k)?120:1500)]))}}};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const normalized=v=>v.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function validParentConnection(mention,packet){
 const c=mention?.eventConnection,o=c?.ownership;
 if(!ownershipContract(packet)||packet.input?.identityConnectionVersion!==OWNERSHIP_CONNECTION_VERSION||!exact(c,['relation','anchorQuote','reason','ownership'])||c.relation!=='parent'||!text(c.reason,1200)||!text(c.anchorQuote,1500)||!packet.input.eventFocus?.quote.includes(c.anchorQuote)||!exact(o,fields))return false;
 if(fields.some(k=>!text(o[k],['subjectName','subjectReference'].includes(k)?120:1500))||!text(mention.name,120)||normalized(mention.name)===normalized(o.subjectName))return false;
 const source=packet.input.identityEventContext?.quote||packet.input.material?.body;
 return typeof source==='string'&&['subjectQuote','actionQuote','ownershipQuote'].every(k=>source.includes(o[k]))&&o.subjectQuote.includes(o.subjectName)&&o.subjectQuote.includes(o.subjectReference)&&o.actionQuote.includes(o.subjectReference)&&o.ownershipQuote.includes(mention.name)&&o.ownershipQuote.includes(o.subjectName);
}
export const OWNERSHIP_IDENTITY_INSTRUCTIONS=`本版本补充直接关联规则：还可输出relation=parent，但仅用于原文明示该公司拥有并控制原事项直接对象的情形；少数持股、品牌、合作、供应链、同文背景和模型记忆都不足以成立。它只新增间接影响待研判的母公司，不将母公司写成直接承担原事项动作或受处罚的主体，也不推出利好、利空、归属利润或交易。
parent的eventConnection恰含relation、anchorQuote、reason、ownership。anchorQuote逐字取自原eventFocus.quote且非空，reason说明同一事项的动作与直接对象、控股证据及不确定性。ownership恰含subjectName、subjectReference、subjectQuote、actionQuote、ownershipQuote：subjectName为直接涉事实体的逐字全称；subjectQuote须包含该全称，若动作句用简称或代词，还须在此段原文明确建立subjectReference与全称对应；actionQuote须包含subjectReference且明确其参与原事项同一动作；ownershipQuote须同时包含当前mention.name和subjectName并明示拥有及控制关系。三个quote各最多1500字符，全部逐字取自本次材料正文；同段上下文模式只能取identityEventContext.quote，不能借邻段或另一份材料补关系。缺任一环节保留context/unclear，不编造、不改写原文，不把仅列公司名称当控股证明。
direct/context/unrelated/unclear保持原三字段结构，不填ownership。parent的主quote仍需包含母公司name并符合本次材料范围；证券身份、多市场歧义、来源日期限制继续独立核对。所有关系均是待核实模型候选。`;
