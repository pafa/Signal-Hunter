import {WATCH_REVIEW_CONTRACT,WATCH_ACTION_VERSION,isWatchResearch} from '../shared/research-watch.mjs';
import {RESEARCH_ACTIONS,RESEARCH_ACTION_VERSION} from '../shared/research-action.mjs';
import {observationInstant} from './observation-rules.mjs';

const string={type:'string'},object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const citation=object({evidenceId:string,field:{type:'string',enum:['title','body']},quote:string}),citations={type:'array',maxItems:3,items:citation};
const unknown=object({status:{type:'string',enum:['unknown']},reason:string});
export const RESEARCH_ACTION_SCHEMA=object({version:{type:'string',enum:[RESEARCH_ACTION_VERSION]},action:{type:'string',enum:Object.keys(RESEARCH_ACTIONS)},reason:string,citations,validUntil:{anyOf:[string,{type:'null'}]},holdingHorizon:{anyOf:[unknown,object({status:{type:'string',enum:['defined']},until:string,reason:string,citations})]}});
export function researchActionSchema(packet){
 if(packet.watchReviewContract!==WATCH_REVIEW_CONTRACT)return RESEARCH_ACTION_SCHEMA;
 const watch=structuredClone(RESEARCH_ACTION_SCHEMA);watch.properties.version.enum=[WATCH_ACTION_VERSION];watch.properties.action.enum=['watch'];watch.properties.validUntil={type:'null'};watch.properties.holdingHorizon=unknown;
 return {anyOf:[RESEARCH_ACTION_SCHEMA,watch]};
}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('公司行动倾向、期限或原文依据无效');};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>1200)fail();return v.trim();};

export function validateResearchAction(input,{packet,validateCitations}){
 const watch=packet.watchReviewContract===WATCH_REVIEW_CONTRACT&&isWatchResearch(input);
 if(!exact(input,['version','action','reason','citations','validUntil','holdingHorizon'])||(!watch&&input.version!==RESEARCH_ACTION_VERSION)||!Object.hasOwn(RESEARCH_ACTIONS,input.action))fail();
 const reason=text(input.reason),refs=validateCitations(input.citations),generated=Date.parse(packet.generatedAt);
 const reference=(s,c)=>{if((s.match(/\b(?:news|material):[A-Za-z0-9_:-]+/g)||[]).some(id=>!c.some(r=>r.evidenceId===id)))fail();};
 reference(reason,refs);
 if(input.action==='unknown'){if(input.validUntil!==null||input.holdingHorizon?.status!=='unknown')fail();}
 else if(watch){if(!refs.length||!Number.isFinite(generated))fail();}
 else if(!refs.length||observationInstant(input.validUntil)===null||!Number.isFinite(generated)||Date.parse(input.validUntil)<=generated)fail();
 const h=input.holdingHorizon;let holdingHorizon;
 if(h?.status==='unknown'){
  if(!exact(h,['status','reason']))fail();holdingHorizon={status:'unknown',reason:text(h.reason)};reference(holdingHorizon.reason,refs);
 }else{
  if(!exact(h,['status','until','reason','citations'])||h.status!=='defined'||observationInstant(h.until)===null||!Number.isFinite(generated)||Date.parse(h.until)<=generated)fail();
  const citations=validateCitations(h.citations);if(!citations.length)fail();
  holdingHorizon={status:'defined',until:h.until,reason:text(h.reason),citations};reference(holdingHorizon.reason,citations);
  // Entry intent cannot outlive its own holding window.
  if(['buy','hold'].includes(input.action)&&Date.parse(input.validUntil)>Date.parse(h.until))fail();
 }
 const evidence=new Map(packet.input.evidence.map(e=>[e.id,e]));
 for(const c of [...refs,...(holdingHorizon.citations||[])]){
  const available=Date.parse(evidence.get(c.evidenceId)?.material?.availableAt);
  if(!Number.isFinite(generated)||!Number.isFinite(available)||available>generated)fail();
 }
 return {version:input.version,action:input.action,reason,citations:refs,validUntil:input.validUntil,holdingHorizon};
}

export const RESEARCH_ACTION_INSTRUCTIONS=[
 '仅company-assessment/4增加recommendation，恰含version(research-action/1)、action、reason、citations、validUntil、holdingHorizon；旧/1至/3不补写。action只能unknown、watch、buy、hold、reduce、exit，分别表示无法判断、继续观察、有条件考虑买入、已有持仓继续持有、已有持仓考虑减仓、已有持仓考虑退出。它们都是研究倾向，不是账户方案、本人决定或已成交事实。业务影响direction与行动倾向独立：利好不必买，利空不等于退出，更不等于做空。未提供账户和持仓，不能声称已持有、计算数量、仓位或选择账户；hold/reduce/exit仅对存在相应持仓时适用。',
 'reason用1至1200字交代为什么采取该倾向、关键前提、主要反证和到期复核依据；除unknown以外至少一段本版逐字citations，最多三段，格式与analysis一致。不从公司被提及、新闻热度、单个价格触发或情景估值直接跳到买入。建议的前提必须保留于analysis与monitoring，无法表达的业务条件保持unknown；整个方案可因缺资料而等待，不强凑看似齐全的信号。',
 'unknown的validUntil必须null且holdingHorizon必须unknown；其余validUntil必须是晚于packet.generatedAt、明确时区的有效ISO复核期限，说明选择依据，不能照搬报道日期。到期后倾向只保留历史，需形成新版判断。holdingHorizon未知时仅status:unknown与reason；定义时仅status:defined、until、reason、citations，until必须是未来带时区时点，说明事件兑现和持有复核窗口的假设并引用原文，不声称已知确定卖出日。buy/hold的validUntil不得晚于该持有复核窗口。无法给出有依据的精确窗口就unknown，不伪造时间；未知窗口的买入倾向不能进入完整方案。模型禁止输出账户、数量、预算、订单、执行接口、批准或权限字段；研究倾向和引用通过不证明财务语义正确。'
].join('\n')+'\n';

export function researchActionInstructions(packet){
 if(packet.watchReviewContract!==WATCH_REVIEW_CONTRACT)return RESEARCH_ACTION_INSTRUCTIONS;
 return RESEARCH_ACTION_INSTRUCTIONS.replace('其余validUntil必须','research-action/1其余validUntil必须').replace('无法给出有依据的精确窗口就unknown，不伪造时间；','research-action/1无法给出有依据的精确窗口就unknown，不伪造时间；独立观察协议见下文。')+`本包watchReviewContract=research-observation-review/1时，有原文依据、需要等待后续事实的watch使用独立version=research-watch/1，action=watch，validUntil=null，holdingHorizon仅status:unknown与reason；reason与citations要求保持。后台以保存完成时点为起点，每24小时按原额度和队列复核一次；这是系统调度节奏，不是事实兑现、交易截止或确定卖出日，模型不生成或猜测复核日期。数据不足以支持继续观察本身时仍用research-action/1的unknown。buy/hold/reduce/exit沿用research-action/1及原未来有效期、持有窗口与条件要求；旧research-action/1的watch如返回仍按其原精确期限校验，不能借新版放宽。观察不会生成账户方案。\n`;
}
