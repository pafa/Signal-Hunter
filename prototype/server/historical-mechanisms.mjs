import {routeEvent} from './event-routing.mjs';
import {classifyHeadline} from './triage.mjs';
import {companyIdentity} from '../shared/company-directory.mjs';
import {directoryCodeRecall} from './directory-code-recall.mjs';
export const HISTORY_MECHANISM_VERSION='historical-mechanisms/2';
const families=[
 ['medical-access','药品商业准入',[/\b(?:FDA|EMA|NMPA|drug|therapy|treatment|vaccine)\b|药品|药物|疗法|适应症/iu,/approv|authoriz|reject|refus|获批|批准|拒绝|不予批准/iu]],
 ['clinical-result','临床结果',[/\b(?:trial|clinical)\b|临床|试验/iu,/endpoint|results?|fail|success|halt|stop|meets?|miss|终点|结果|失败|成功|终止|达到|未达/iu]],
 ['product-recall','产品召回',[/\brecalls?\b|召回/iu,/\b(?:cars?|vehicles?|products?|devices?|food|batteries|units|drug)\b|汽车|车辆|产品|电池|药品|食品/iu]],
 ['supply-interruption','供给中断',[/\b(?:mine|plant|factory|production|output|refinery|supply)\b|矿|工厂|产能|产量|供应/iu,/\b(?:halts?|shutdown|shuts?|disrupt\w*|suspend\w*)\b|停产|暂停|中断/iu]],
 ['control-transaction','控制权交易',[/\b(?:acquir\w*|acquisition|takeover|merger|buyout)\b|收购|并购|重组/iu]],
 ['capital-return','资本回报',[/buybacks?|share repurchases?|回购/iu]],
 ['trade-access','贸易准入',[/export|import|tariff|出口|进口|关税/iu,/ban|control|restrict|licen[cs]e|permit|limit|禁令|管制|限制|许可|关税/iu]],
];
const facets=[
 ['pharma','医药',/\b(?:FDA|EMA|NMPA|drug|therapy|treatment|vaccine|clinical|pharma\w*)\b|药品|药物|疗法|临床|适应症/iu],
 ['oncology','肿瘤',/cancer|oncol|tumou?r|肿瘤|癌/iu],
 ['metabolic','代谢疾病',/obesity|weight.loss|diabet|减重|肥胖|糖尿病/iu],
 ['semiconductor','半导体',/semiconductor|\bchips?\b|processor|memory|foundry|半导体|芯片|处理器|存储|晶圆/iu],
 ['automotive','汽车',/\b(?:cars?|vehicles?|automotive|automakers?)\b|汽车|车辆|整车/iu],
 ['aviation','航空',/aircraft|airplanes?|aviation|\bjets?\b|飞机|航空/iu],
 ['energy','能源',/\boil\b|\bgas\b|refinery|energy|石油|天然气|能源|炼油/iu],
 ['mining','采矿',/\b(?:mine|mining|copper|iron|ore)\b|铜|采矿|铁矿|矿山/iu],
 ['software','软件',/software|cloud|gaming|videogames?|软件|云服务|游戏/iu],
 ['food','食品',/\bfood\b|beverages?|食品|饮料/iu],
];
const same=(a,b)=>a.filter(x=>b.includes(x));
// A shared printed symbol is a retrieval clue, not a verified issuer mapping.
// Conflicting explicit venues within either side remain unresolved.
function commonIdentifiers(a=[],b=[]){
 const groups=tokens=>{const map=new Map();for(const t of tokens){if(!map.has(t.symbol))map.set(t.symbol,new Set());if(t.venue)map.get(t.symbol).add(t.venue);}return map;};
 const left=groups(a),right=groups(b),matches=[];
 for(const [symbol,venues] of left){const other=right.get(symbol);if(!other||venues.size>1||other.size>1)continue;const l=[...venues][0]||null,r=[...other][0]||null;if(l&&r&&l!==r)continue;matches.push({symbol,venue:l||r});}
 return matches;
}
export function historicalProfile(news){
 const title=String(news.title||''),codes=directoryCodeRecall(title),route=routeEvent(title),triage=classifyHeadline({...news,title:codes.names});
 return {mechanismVersion:HISTORY_MECHANISM_VERSION,families:families.filter(([, ,patterns])=>patterns.every(re=>re.test(title))).map(([id,label])=>({id,label})),facets:facets.filter(([id, ,re])=>re.test(id==='food'?title.replace(/\bFood\s+and\s+Drug\s+Administration\b/giu,''):title)).map(([id,label])=>({id,label})),issuers:[...new Set(triage.companies.map(c=>companyIdentity(c.symbol).issuerKey))],explicitIdentifiers:codes.tokens,stage:route.stage,messageStatus:route.messageStatus,normalized:title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()};
}
export function historicalMatch(anchor,candidate,a,b){
 const mechanisms=a.families.filter(x=>b.families.some(y=>y.id===x.id)),domains=a.facets.filter(x=>b.facets.some(y=>y.id===x.id)),issuers=same(a.issuers,b.issuers),explicitIdentifiers=commonIdentifiers(a.explicitIdentifiers,b.explicitIdentifiers);
 if(!mechanisms.length)return {status:'no_mechanism'};
 if(!domains.length&&!issuers.length&&!explicitIdentifiers.length)return {status:'no_context'};
 const differences=[...(!issuers.length?[a.issuers.length&&b.issuers.length?'已识别发行人不同，不能归为同一事件':'发行人身份未能匹配，须核对主体']:[]),...(a.stage!==b.stage?[`标题阶段不同：本条 ${a.stage}；历史 ${b.stage}`]:[]),...a.facets.filter(x=>!b.facets.some(y=>y.id===x.id)).map(x=>`本条出现 ${x.label}，历史标题未提供该线索`),...b.facets.filter(x=>!a.facets.some(y=>y.id===x.id)).map(x=>`历史出现 ${x.label}，本条标题未提供该线索`)];
 return {status:'candidate',kind:'analogy',rank:issuers.length*100+explicitIdentifiers.length*50+domains.length*10+mechanisms.length,mechanisms,domains,explicitIdentifiers,sameIssuer:!!issuers.length,reasons:[`共同机制线索：${mechanisms.map(x=>x.label).join('、')}`,...(domains.length?[`共同领域线索：${domains.map(x=>x.label).join('、')}`]:[]),...(issuers.length?['标题命中同一发行人目录候选']:[]),...(explicitIdentifiers.length?[`原文共同证券代码：${explicitIdentifiers.map(x=>`${x.symbol}${x.venue?' / '+x.venue:''}`).join('、')}（仅文本线索）`]:[])],differences:[...differences,...(explicitIdentifiers.length?['证券代码共现未核验主体、历史有效期或业务角色，不确认同一发行人或事件']:[]),'仅比较保存标题，业务量级、市场预期、事实真伪和历史结局尚未核对；不得机械套用历史收益']};
}
