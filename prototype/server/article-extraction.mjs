import {articleLinkUrl,validateLinkUpgrade,mergeLinkLabels} from './article-link-url.mjs';
import {publicSourceUrl} from './public-source-url.mjs';
import {publicationProfile} from './publication-profiles.mjs';
import {PDF_SCOPE_SCHEMA,PDF_SCOPE_INSTRUCTIONS} from '../shared/pdf-source.mjs';
import {validatePdfScope} from './pdf-source.mjs';
export const ARTICLE_SCOPE_VERSION='article-reading-scope-5';
export const ARTICLE_SCOPE_INSTRUCTIONS=PDF_SCOPE_INSTRUCTIONS+'网页材料的extractionEvidence记录提取范围，publisher-article-links包含已识别发布方的正文与其明确附件区域，extracted-html-links仅扫描提取后的正文。originalUrl存在时保留同主机HTTP原链接，url仅升级为HTTPS且未改变路径或查询，失败不降级HTTP。attachments仅为网页中识别的附件入口，全部尚未读取；文件名、链接和格式提示不证明附件内容，不得补写未提供的附件、表格或法律条文。缺少关键附件时列入missingEvidence。没有附件记录、列表为空或旧材料缺少此字段，都不证明没有附件或已读完整来源。移除界面控件不等于全文完整性已验证。public-article-5材料可能含HTML table块（html-table-text/1），r/c为提取器添加的1起始行列坐标，冒号表示合并单元格覆盖范围；单元格原文本用JSON字符串转义，空单元格虽省略文本但保留占位。按同列及覆盖范围核对表头、年份、币种和单位，不能把坐标、合并格、空格或嵌套表当作财务数值、零或新证据；不得把季度与年度相邻列混用。该结构来自保留的HTML，不证明CSS布局、会计口径或全文完整，旧材料扁平表格不补造列对应。\n';
const schema='article-extraction-3',limit=30;
function extractionProfile(url,format=schema){
 // Keep immutable v1 materials valid: their Fed pages used the generic profile.
 if(format!=='article-extraction-1')try{const u=new URL(url);if(u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&u.hostname==='www.federalreserve.gov'&&/^\/newsevents\/pressreleases\/[a-z]+\d{8}[a-z]?\.htm$/.test(u.pathname))return 'fed-release-1';}catch{}
 return publicationProfile(url);
}
const formats=new Set(['pdf','doc','docx','xls','xlsx','csv','ppt','pptx','txt','zip','unknown']);
const formatHint=(href,label)=>{let path;try{path=decodeURIComponent(new URL(href).pathname);}catch{path=href;}return /\.(pdf|docx?|xlsx?|csv|pptx?|txt|zip)$/i.exec(path)?.[1].toLowerCase()||/\.(pdf|docx?|xlsx?|csv|pptx?|txt|zip)\s*$/i.exec(label)?.[1].toLowerCase()||'unknown';};
function scanAttachments(root,url){
 const attachments=[],seen=new Map();let omittedAttachmentLinks=0,truncated=false;
 for(const a of root.querySelectorAll('a[href]')){
  const label=a.textContent.trim().replace(/\s+/g,' '),raw=a.getAttribute('href');if(!raw.trim()||raw.trim().startsWith('#'))continue;let resolved;try{resolved=new URL(raw,url).href;}catch{resolved=raw;}
  const hint=formatHint(resolved,label);if(hint==='unknown'&&!a.hasAttribute('download')&&!/^(?:附件|附錄|附录|attachment|annex)(?:\s|[:：\d一二三四五六七八九十]|$)/i.test(label))continue;
  let target,originalUrl;try{({url:target,originalUrl}=articleLinkUrl(resolved,url));if(target.length>2000||originalUrl?.length>2000)throw 0;}catch{omittedAttachmentLinks++;continue;}
  const existing=seen.get(target);if(existing){const merged=mergeLinkLabels(existing.label,label);existing.label=merged.label;truncated||=merged.truncated;continue;}
  if(attachments.length>=limit){truncated=true;continue;}
  if(label.length>200)truncated=true;
  const attachment={url:target,...(originalUrl?{originalUrl}:{}),label:label.slice(0,200)||'未命名附件入口',formatHint:hint,status:'unread'};attachments.push(attachment);seen.set(target,attachment);
 }
 return {attachments,omittedAttachmentLinks,truncated};
}
export function prepareArticleExtraction(document,url){
 const profile=extractionProfile(url),removedControls={fontSize:0,share:0};
 if(profile==='csrc-article-1')for(const [key,selector] of [['fontSize','.content > .info > #changeSize.changeSize'],['share','.content > .info > #share.share']]){
  const nodes=[...document.querySelectorAll(selector)];removedControls[key]=nodes.length;nodes.forEach(n=>n.remove());
 }
 const selector=profile==='csrc-article-1'?'.content > .detail-news':profile==='hkma-release-1'?'.content-area > .template-content-area':profile==='fed-release-1'?'#content #article > div.col-xs-12.col-sm-8.col-md-8:not(.heading)':null;
 const roots=selector?[...document.querySelectorAll(selector)]:[];
 // A changed or ambiguous publisher layout falls back to Readability's extracted HTML.
 return {profile,removedControls,links:roots.length===1?scanAttachments(roots[0],url):null};
}
export function finishArticleExtraction(document,url,preparation,html){
 let links=preparation.links;if(!links){const root=document.createElement('div');root.innerHTML=html;links=scanAttachments(root,url);}
 return {schema,profile:preparation.profile,scanScope:preparation.links?'publisher-article-links':'extracted-html-links',removedControls:preparation.removedControls,...links};
}
export function validateExtractionEvidence(value,url,body){
 if(value?.schema===PDF_SCOPE_SCHEMA)return validatePdfScope(value,body);
 const fail=()=>{throw new Error('正文提取范围记录无效');},keys=(v,k)=>!!v&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===k;
 if(!keys(value,'attachments,omittedAttachmentLinks,profile,removedControls,scanScope,schema,truncated')||![schema,'article-extraction-2','article-extraction-1'].includes(value.schema)||value.profile!==extractionProfile(url,value.schema)||!['publisher-article-links','extracted-html-links'].includes(value.scanScope)||value.profile==='generic'&&value.scanScope!=='extracted-html-links'||!keys(value.removedControls,'fontSize,share')||typeof value.truncated!=='boolean'||!Number.isSafeInteger(value.omittedAttachmentLinks)||value.omittedAttachmentLinks<0||value.omittedAttachmentLinks>18000||!Array.isArray(value.attachments)||value.attachments.length>limit)fail();
 for(const n of Object.values(value.removedControls))if(!Number.isSafeInteger(n)||n<0||n>18000||value.profile!=='csrc-article-1'&&n!==0)fail();
 const seen=new Set(),attachments=value.attachments.map(a=>{if(!(keys(a,'formatHint,label,status,url')||value.schema===schema&&keys(a,'formatHint,label,originalUrl,status,url'))||typeof a.url!=='string'||a.url.length>2000||typeof a.label!=='string'||!a.label.trim()||a.label.length>200||!formats.has(a.formatHint)||a.status!=='unread')fail();try{validateLinkUpgrade(a,url);if(publicSourceUrl(a.url).href!==a.url||seen.has(a.url))fail();}catch{fail();}seen.add(a.url);return {url:a.url,...(a.originalUrl?{originalUrl:a.originalUrl}:{}),label:a.label,formatHint:a.formatHint,status:'unread'};});
 return {schema:value.schema,profile:value.profile,scanScope:value.scanScope,removedControls:{fontSize:value.removedControls.fontSize,share:value.removedControls.share},attachments,omittedAttachmentLinks:value.omittedAttachmentLinks,truncated:value.truncated};
}
