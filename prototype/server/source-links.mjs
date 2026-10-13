import {articleLinkUrl,validateLinkUpgrade,mergeLinkLabels} from './article-link-url.mjs';
import {publicSourceUrl} from './public-source-url.mjs';

export const SOURCE_LINK_SCHEMA='article-source-links/4';
export const SOURCE_LINK_INSTRUCTIONS='material.sourceLinks只记录正文或已识别发布方明确附件区域中的网页或PDF链接、标签及邻近原文；附件区域链接的context可能只有原标签，不是已读来源或事实依据。originalUrl存在时表示将同主机原HTTP链接仅升级为HTTPS，路径与查询不变；原地址保留，不代表已读取成功，失败不降级HTTP。sourceRequests可选择其中最多3个直接有助于核对当前missingEvidence的链接，每项包含evidenceId、url、reason；没有可用链接或不需要补充时输出空数组。evidenceId和url必须逐字来自当前材料，不得编造地址、添加查询参数或把链接名称当内容。模型不要自行浏览，后台会有界读取HTML或PDF文字层、独立研究并比较，扫描图及未读附件保留缺口；同发布方不增加独立支持，链接也不证明来源可靠。';
const keys=(v,n)=>!!v&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===n;
const nonArticle=/\.(?:docx?|xlsx?|csv|pptx?|txt|zip|png|jpe?g|gif|svg|webp|mp[34])$/i;
const pathname=url=>{const path=new URL(url).pathname;try{return decodeURIComponent(path);}catch{return path;}};
const isPdf=url=>/\.pdf$/i.test(pathname(url));
const legacyNonArticle=url=>/\.(?:pdf|docx?|xlsx?|csv|pptx?|txt|zip|png|jpe?g|gif|svg|webp|mp[34])$/i.test(new URL(url).pathname)||/^\/cdn-cgi\/l\/email-protection\/?$/.test(new URL(url).pathname);
const isNonArticle=url=>nonArticle.test(pathname(url))||/^\/cdn-cgi\/l\/email-protection\/?$/.test(new URL(url).pathname);
export function sourceLinks(root,base,publisherScan=null){
 const links=[],seen=new Map();let inspected=0,omitted=0,truncated=publisherScan?.truncated??false;
 // Explicit publisher attachments are considered first so ordinary body links
 // cannot consume the bounded list before a critical attachment is exposed.
 const candidates=[...(publisherScan?.attachments||[]).map(a=>({raw:a.originalUrl||a.url,label:a.label,context:a.label,download:false})),...[...root.querySelectorAll('a[href]')].map(a=>({raw:a.getAttribute('href')?.trim(),label:a.textContent.trim().replace(/\s+/g,' '),context:(a.closest('p,li,td,blockquote')?.textContent||a.textContent).trim().replace(/\s+/g,' '),download:a.hasAttribute('download')}))];
 for(const a of candidates){
  const raw=a.raw;if(!raw||raw.startsWith('#'))continue;inspected++;
  let url,originalUrl;try{({url,originalUrl}=articleLinkUrl(raw,base));if(originalUrl?.length>2000)throw 0;}catch{omitted++;continue;}
  if(url===base||a.download&&!isPdf(url)||isNonArticle(url))continue;
  const {label,context}=a;
  if(!label||url.length>2000){omitted++;continue;}
  const existing=seen.get(url);if(existing){const merged=mergeLinkLabels(existing.label,label);existing.label=merged.label;truncated||=merged.truncated;continue;}
  if(links.length>=30){truncated=true;continue;}
  if(label.length>200||context.length>800)truncated=true;
  const link={url,...(originalUrl?{originalUrl}:{}),label:label.slice(0,200),context:context.slice(0,800)};links.push(link);seen.set(url,link);
 }
 return {schema:SOURCE_LINK_SCHEMA,scope:publisherScan===null?'extracted-html-links':'extracted-html-and-publisher-attachment-links',links,inspected,omitted,truncated};
}
export function validateSourceLinks(v,base){
 const fail=()=>{throw Error('正文来源链接记录无效');};
 if(!keys(v,'inspected,links,omitted,schema,scope,truncated')||![SOURCE_LINK_SCHEMA,'article-source-links/3','article-source-links/2','article-source-links/1'].includes(v.schema)||!(v.scope==='extracted-html-links'||[SOURCE_LINK_SCHEMA,'article-source-links/3'].includes(v.schema)&&v.scope==='extracted-html-and-publisher-attachment-links')||!Array.isArray(v.links)||v.links.length>30||typeof v.truncated!=='boolean'||![v.inspected,v.omitted].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=18000)||v.links.length>v.inspected||v.omitted>v.inspected)fail();
 const seen=new Set();for(const a of v.links){
  if(!(keys(a,'context,label,url')||v.schema===SOURCE_LINK_SCHEMA&&keys(a,'context,label,originalUrl,url'))||typeof a.url!=='string'||a.url.length>2000||typeof a.label!=='string'||!a.label.trim()||a.label.length>200||typeof a.context!=='string'||a.context.length>800)fail();
  try{validateLinkUpgrade(a,base);if(publicSourceUrl(a.url).href!==a.url||seen.has(a.url)||(v.schema==='article-source-links/1'?legacyNonArticle(a.url):isNonArticle(a.url)))fail();}catch{fail();}seen.add(a.url);
 }
 return structuredClone(v);
}
export const SOURCE_REQUEST_SCHEMA={type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['evidenceId','url','reason'],properties:{evidenceId:{type:'string'},url:{type:'string'},reason:{type:'string'}}}};
export function sourceRequestAvailable(packet,evidenceId,url){
 return !packet.input.documentContext?.entries.some(e=>e.parentEvidenceId===evidenceId&&e.url===url&&(e.status==='available'||e.requested));
}
export function validateSourceRequests(value,packet){
 if(value===undefined)return undefined; // Immutable older outputs remain readable.
 if(!Array.isArray(value)||value.length>3)throw Error('补充来源请求无效');
 const seen=new Set();for(const r of value){
  if(!keys(r,'evidenceId,reason,url')||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1200)throw Error('补充来源请求无效');
  const m=packet.input.evidence.find(e=>e.id===r.evidenceId)?.material;
  if(!m?.sourceLinks||!validateSourceLinks(m.sourceLinks).links.some(l=>l.url===r.url)||seen.has(r.url)||!sourceRequestAvailable(packet,r.evidenceId,r.url))throw Error('补充来源必须来自冻结材料中的明确链接');
  seen.add(r.url);
 }
 return structuredClone(value);
}
