import {CodexResearchError} from './codex-research.mjs';

export const TIME_EVIDENCE_SCHEMA={type:'object',additionalProperties:false,required:['basis','quote','quoteField'],properties:{basis:{type:'string',enum:['explicit','relative','unknown']},quote:{type:'string'},quoteField:{type:'string',enum:['title','body','none']}}};
export const TIME_PROMPT_VERSION='event-time-evidence-2';
export const TIME_INSTRUCTIONS=`事件时间须单独提供timeEvidence对象：basis、quote、quoteField。eventTime只填写对应侧原文中的时间片段，禁止补充、翻译、换算或从另一侧搬入日期。
basis=explicit：eventTime为含四位年份的原文绝对日期或期间片段；timeEvidence.quote为同侧title或body内连续引文，须包含eventTime及与本事件有关的上下文；quoteField指明title或body。不能用URL、发布日期元数据或模型知识代替事件时间证据。
basis=relative：原文以today/yesterday/tomorrow/今天/今日/昨天/昨日/明天/明日/本日/当日指明本事件时间时，eventTime只填该原文词，timeEvidence.quote引用相应上下文。即使提供publishedAt，也不能把相对词换算成确定日期；界面另列来源发布日期供核对。发布日期缺失时仍可保留相对词，但具体日历日期未知。
basis=unknown：本侧缺少支持本事件时间的上述证据，eventTime必须为“未知”，timeEvidence.quote为空字符串，quoteField为none。不要从相关背景、另一项事件或另一侧材料借用日期。与主体/动作引用分开选择时间引文；两种引文都只证明原文表述，不证明事实或法律生效时点。相同材料在不同配对中沿用相同的时间依据标准。\n`;

export function validateTimeEvidence(event,record){
 const bad=()=>{throw new CodexResearchError('output');},e=event.timeEvidence;
 if(!e||Array.isArray(e)||Object.keys(e).sort().join(',')!=='basis,quote,quoteField'||!['explicit','relative','unknown'].includes(e.basis)||typeof e.quote!=='string'||e.quote.length>1000)bad();
 if(e.basis==='unknown'){
  if(event.eventTime!=='未知'||e.quote!==''||e.quoteField!=='none')bad();
  return;
 }
 if(!['title','body'].includes(e.quoteField)||!e.quote.trim()||typeof record[e.quoteField]!=='string'||!record[e.quoteField].includes(e.quote)||typeof event.eventTime!=='string'||!event.eventTime.trim()||event.eventTime.length>160||!e.quote.includes(event.eventTime))bad();
 if(e.basis==='explicit'&&!/(?<!\d)[12]\d{3}(?!\d)/u.test(event.eventTime))bad();
 if(e.basis==='relative'&&!/^(?:today|yesterday|tomorrow|今天|今日|昨天|昨日|明天|明日|本日|当日)$/i.test(event.eventTime))bad();
}
