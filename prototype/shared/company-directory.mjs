import {normalizeMateriality} from './company-materiality.mjs';
import {securityIdentity} from './securities.mjs';

// A bounded research directory. It is not a live listing master or a supply-chain graph.
export const DIRECTORY_VERSION='company-directory/0.1.0';
const entries=[
 ['META.US','Meta',['Meta','Facebook','脸书']],['SPOT.US','Spotify',['Spotify']],
 ['AMZN.US','Amazon',['Amazon','AWS','亚马逊']],['INTC.US','Intel',['Intel','Xeon','英特尔']],
 ['AMD.US','AMD',['AMD','EPYC','超威半导体']],['ARM.US','Arm',['Arm Holdings','Neoverse','Arm AGI']],
 ['NVDA.US','NVIDIA',['Nvidia','英伟达']],['MU.US','Micron',['Micron','美光']],
 ['603986.SH','兆易创新 A',['GigaDevice','兆易创新']],['03986.HK','兆易创新 H',['GigaDevice','兆易创新']],
 ['688008.SH','澜起科技',['Montage Technology','澜起科技']],['600825.SH','新华传媒',['新华传媒']],
 ['NVO.US','Novo Nordisk ADR',['Novo Nordisk','诺和诺德']],['NVS.US','Novartis ADR',['Novartis','诺华']],
 ['002594.SZ','比亚迪 A',['BYD','比亚迪']],['01211.HK','比亚迪 H',['BYD','比亚迪']],
 ['03690.HK','美团',['Meituan','美团']],['09988.HK','阿里巴巴 H',['Alibaba','阿里巴巴']],['BABA.US','Alibaba ADR',['Alibaba','阿里巴巴']],
 ['ORCL.US','Oracle',['Oracle','甲骨文']],['ONON.US','On Holding',['On Holding']],['RCL.US','Royal Caribbean',['Royal Caribbean']],
 ['VLO.US','Valero',['Valero']],['BHP.US','BHP ADR',['BHP','必和必拓']],['FCX.US','Freeport-McMoRan',['Freeport-McMoRan']],
 ['00293.HK','国泰航空',['Cathay Pacific','国泰航空']],['002493.SZ','荣盛石化',['Rongsheng Petrochemical','荣盛石化']],
 ['DAL.US','Delta Air Lines',['Delta Air Lines','Delta Airlines','达美航空']],['XOM.US','Exxon Mobil',['Exxon Mobil','ExxonMobil','埃克森美孚']],
 ['TSLA.US','Tesla',['Tesla','特斯拉']],['MSFT.US','Microsoft',['Microsoft','微软']],
 ['688981.SH','中芯国际 A',['SMIC','中芯国际']],['00981.HK','中芯国际 H',['SMIC','中芯国际']],
 ['AAPL.US','Apple',['Apple Inc','苹果公司'],'https://investor.apple.com/faq/'],
 ['BA.US','Boeing',['Boeing','波音'],'https://investors.boeing.com/investors/overview/default.aspx'],
 ['LLY.US','Eli Lilly',['Eli Lilly','礼来'],'https://investor.lilly.com/news-releases/news-release-details/lilly-confirms-date-and-conference-call-second-quarter-2026'],
 ['00700.HK','腾讯',['Tencent','腾讯'],'https://www.tencent.com/investors/'],
];
export const COMPANY_DIRECTORY=entries.map(([symbol,name,aliases,url])=>({symbol,name,aliases,...securityIdentity(symbol),
 directoryVersion:DIRECTORY_VERSION,identityStatus:url?'source-checked':'curated-candidate',identitySource:url||'',
 identityBasis:url?'2026-09-25 核对公司官方投资者页面的股票代码；不代表持续核验上市状态':'沿用项目既有公司与证券候选；上市状态和关系须复核',
}));
const bySymbol=new Map(COMPANY_DIRECTORY.map(c=>[c.symbol,c]));
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const matchers=COMPANY_DIRECTORY.map(c=>({...c,patterns:c.aliases.map(alias=>({alias,re:new RegExp(/^[\x00-\x7F]+$/.test(alias)?`(?<![a-z0-9])${escape(alias)}(?![a-z0-9])`:escape(alias),'iu')}))}));
export function companyIdentity(value){const spec=securityIdentity(value);return bySymbol.get(spec.symbol)||{...spec,name:spec.symbol,directoryVersion:DIRECTORY_VERSION,identityStatus:'unresolved',identitySource:'',identityBasis:'只校验代码格式，尚未核对上市主体'};}
export function searchCompanies(query){const q=String(query||'').trim().toLowerCase();return q?COMPANY_DIRECTORY.filter(c=>[c.symbol,c.code,c.name,...c.aliases].some(s=>s.toLowerCase().includes(q))).slice(0,15):[];}
export function headlineCompanies(text){
 return matchers.flatMap(c=>{
  let matched=c.patterns.find(p=>p.re.test(text))?.alias;
  if(c.symbol==='ARM.US'&&!matched&&/\b(?:Arm|ARM)\b(?=[^.!?]{0,55}\b(?:licensing|chips?|processors?|earnings|revenue)\b)/.test(text))matched='Arm + 半导体上下文';
  if(c.symbol==='AAPL.US'&&!matched&&/\bApple\b(?=[^.!?]{0,65}\b(?:iPhone|Mac|iPad|App Store|shares|earnings|revenue|buyback)\b)/.test(text))matched='Apple + 公司上下文';
  if(c.symbol==='LLY.US'&&!matched&&/\bLilly\b(?=[^.!?]{0,65}\b(?:drug|FDA|therapy|earnings|revenue)\b)/.test(text))matched='Lilly + 医药上下文';
  if(c.symbol==='META.US'&&matched==='Meta'&&(!/\b(?:Meta|META)\b/.test(text)||/\bmeta[- ]analys/i.test(text)))matched=null;
  if(c.symbol==='AMZN.US'&&matched==='Amazon'&&/\b(?:rainforest|river|deforestation|tribe)\b/i.test(text)&&!/\b(?:AWS|shares|company)\b/i.test(text))matched=null;
  if(c.symbol==='ORCL.US'&&matched==='Oracle'&&!/\b(?:Oracle|ORACLE)\b/.test(text))matched=null;
  if(!matched)return [];
  const {patterns,...identity}=c;
  return [{...identity,matchedAlias:matched,kind:'mentioned',relationStatus:'pending',direction:'unclear',role:'标题提及，影响待研判',note:`名称匹配：${matched}；未确认业务角色或影响方向`,method:'headline-alias',identityReviewed:false}];
 });
}
export const COMPANY_RELATIONS={mentioned:'仅被提及',direct:'事件当事方',supplier:'供应商',customer:'客户',competitor:'竞争者',industry:'行业 / 跨市场传导',listing:'同一发行人证券'};
export const RELATION_STATUS={pending:'关系待核验',reviewed:'人工核对关系',disputed:'关系有争议'};
export const DIRECTIONS={unclear:'方向待评估',positive:'条件利好',negative:'条件利空',mixed:'影响分化'};
export const COMPANY_ANALYSIS_FIELDS={businessExposure:'业务敞口',impactMechanism:'传导机制',magnitudeBasis:'影响量级与依据',pricedIn:'市场已反映多少',duration:'持续时间与兑现节点',countercase:'反向情景与替代解释',nextCheck:'下一步核查'};
export function normalizeCompanyAnalysis(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(COMPANY_ANALYSIS_FIELDS,k)))throw new Error('公司影响分析字段无效');
 const out={};for(const key of Object.keys(COMPANY_ANALYSIS_FIELDS)){const v=value[key]??'';if(typeof v!=='string'||v.length>1000)throw new Error('每项公司影响分析最多 1000 字符');out[key]=v.trim();}return out;
}
export function normalizeCompanyRelation(data,topic,at){
 const identity=companyIdentity(data.symbol),kind=data.kind||'mentioned',relationStatus=data.relationStatus||'pending',direction=data.direction||'unclear';
 if(!Object.hasOwn(COMPANY_RELATIONS,kind)||!Object.hasOwn(RELATION_STATUS,relationStatus)||!Object.hasOwn(DIRECTIONS,direction))throw new Error('公司关系类型、状态或方向无效');
 const note=typeof data.note==='string'?data.note.trim():'';if(!note||note.length>1200)throw new Error('公司关联依据不能为空且最多 1200 字符');
 const evidenceIds=data.evidenceIds??[];if(!Array.isArray(evidenceIds)||evidenceIds.length>20||new Set(evidenceIds).size!==evidenceIds.length||evidenceIds.some(id=>!topic.evidence.some(e=>e.id===id)))throw new Error('公司关系引用的证据不存在或重复');
 let url='';if(data.url){try{const parsed=new URL(data.url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||data.url.length>2000)throw Error();url=parsed.href;}catch{throw new Error('关系来源需为无凭据的 HTTPS 链接');}}
 if(relationStatus==='reviewed'&&!url&&!evidenceIds.length)throw new Error('人工核对关系需要来源链接或本事件证据');
 if(kind==='listing'&&!topic.companies.some(c=>c.symbol!==identity.symbol&&companyIdentity(c.symbol).issuerKey===identity.issuerKey))throw new Error('同一发行人关系需有已映射的另一证券；跨行业联动请选择行业传导');
 if(data.identityReviewed!==undefined&&typeof data.identityReviewed!=='boolean')throw new Error('主体核对状态无效');
 if(identity.identityStatus==='unresolved'&&data.identityReviewed&&(!url||typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>120))throw new Error('陌生上市主体需填写公司名和核对来源');
 return {...identity,name:identity.identityStatus==='unresolved'&&data.identityReviewed?data.name.trim():identity.name,kind,relationStatus,direction,note,url,evidenceIds,identityReviewed:!!data.identityReviewed,role:COMPANY_RELATIONS[kind],method:'human-relation',reviewedAt:at,analysis:normalizeCompanyAnalysis(data.analysis),materiality:data.materiality===undefined?(topic.companies.find(c=>c.symbol===identity.symbol)?.materiality||null):normalizeMateriality(data.materiality,topic,at)};
}
export function canAutoWatch(company){return company.identityStatus!=='unresolved'||company.identityReviewed===true;}
