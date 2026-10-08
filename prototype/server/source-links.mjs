import {publicSourceUrl} from './public-source-url.mjs';

export const SOURCE_LINK_SCHEMA='article-source-links/1';
export const SOURCE_LINK_INSTRUCTIONS='material.sourceLinks只记录正文中出现的网页链接、标签及邻近原文，不是已读来源或事实依据。sourceRequests可选择其中最多3个直接有助于核对当前missingEvidence的链接，每项包含evidenceId、url、reason；没有可用链接或不需要补充时输出空数组。evidenceId和url必须逐字来自当前材料，不得编造地址、添加查询参数或把链接名称当内容。模型不要自行浏览，后台会独立读取、研究并比较；同发布方不增加独立支持，链接也不证明来源可靠。';
const keys=(v,n)=>!!v&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===n;
const nonArticle=/\.(?:pdf|docx?|xlsx?|csv|pptx?|txt|zip|png|jpe?g|gif|svg|webp|mp[34])$/i;
const isNonArticle=url=>nonArticle.test(new URL(url).pathname)||/^\/cdn-cgi\/l\/email-protection\/?$/.test(new URL(url).pathname);
export function sourceLinks(root,base){
 const links=[],seen=new Set();let inspected=0,omitted=0,truncated=false;
 for(const a of root.querySelectorAll('a[href]')){
  const raw=a.getAttribute('href')?.trim();if(!raw||raw.startsWith('#'))continue;inspected++;
  let url;try{url=publicSourceUrl(new URL(raw,base).href).href;}catch{omitted++;continue;}
  if(url===base||seen.has(url)||a.hasAttribute('download')||isNonArticle(url))continue;
  seen.add(url);const label=a.textContent.trim().replace(/\s+/g,' '),context=(a.closest('p,li,td,blockquote')?.textContent||label).trim().replace(/\s+/g,' ');
  if(!label||url.length>2000){omitted++;continue;}
  if(links.length>=30){truncated=true;continue;}
  if(label.length>200||context.length>800)truncated=true;
  links.push({url,label:label.slice(0,200),context:context.slice(0,800)});
 }
 return {schema:SOURCE_LINK_SCHEMA,scope:'extracted-html-links',links,inspected,omitted,truncated};
}
export function validateSourceLinks(v){
 const fail=()=>{throw Error('正文来源链接记录无效');};
 if(!keys(v,'inspected,links,omitted,schema,scope,truncated')||v.schema!==SOURCE_LINK_SCHEMA||v.scope!=='extracted-html-links'||!Array.isArray(v.links)||v.links.length>30||typeof v.truncated!=='boolean'||![v.inspected,v.omitted].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=18000)||v.links.length>v.inspected||v.omitted>v.inspected)fail();
 const seen=new Set();for(const a of v.links){
  if(!keys(a,'context,label,url')||typeof a.url!=='string'||a.url.length>2000||typeof a.label!=='string'||!a.label.trim()||a.label.length>200||typeof a.context!=='string'||a.context.length>800)fail();
  try{if(publicSourceUrl(a.url).href!==a.url||seen.has(a.url)||isNonArticle(a.url))fail();}catch{fail();}seen.add(a.url);
 }
 return structuredClone(v);
}
export const SOURCE_REQUEST_SCHEMA={type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['evidenceId','url','reason'],properties:{evidenceId:{type:'string'},url:{type:'string'},reason:{type:'string'}}}};
export function validateSourceRequests(value,packet){
 if(value===undefined)return undefined; // Immutable older outputs remain readable.
 if(!Array.isArray(value)||value.length>3)throw Error('补充来源请求无效');
 const seen=new Set();for(const r of value){
  if(!keys(r,'evidenceId,reason,url')||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1200)throw Error('补充来源请求无效');
  const m=packet.input.evidence.find(e=>e.id===r.evidenceId)?.material;
  if(!m?.sourceLinks||!validateSourceLinks(m.sourceLinks).links.some(l=>l.url===r.url)||seen.has(r.url))throw Error('补充来源必须来自冻结正文中的明确链接');
  seen.add(r.url);
 }
 return structuredClone(value);
}
