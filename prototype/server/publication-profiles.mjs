// Profiles are restricted to verified publisher article routes, not arbitrary class names.
export function publicationProfile(url){
 try{const u=new URL(url);if(u.protocol!=='https:'||u.port||u.username||u.password)return 'generic';
  if(u.hostname==='www.csrc.gov.cn'&&/^\/csrc\/c\d+\/c\d+\/content\.shtml$/.test(u.pathname))return 'csrc-article-1';
  if(u.hostname==='www.hkma.gov.hk'&&/^\/(?:chi|gb_chi)\/news-and-media\/press-releases\/\d{4}\/\d{2}\/\d{8}(?:-\d+)?\/$/.test(u.pathname))return 'hkma-release-1';
 }catch{}return 'generic';
}
// Date profiles evolve independently of the immutable article-extraction profile.
// v1/v2 evidence must continue resolving with the rules that created it.
export function datePublicationProfile(url,format='publication-date-5'){
 if(['publication-date-3','publication-date-4','publication-date-5'].includes(format))try{const u=new URL(url);if(u.protocol==='https:'&&!u.port&&!u.username&&!u.password){
  if(format==='publication-date-5'&&u.hostname==='www.hkma.gov.hk'&&/^\/eng\/news-and-media\/press-releases\/\d{4}\/\d{2}\/\d{8}(?:-\d+)?\/$/.test(u.pathname))return 'hkma-english-date-1';
  if(['publication-date-4','publication-date-5'].includes(format)){
   if(u.hostname==='news.microsoft.com'&&/^\/source\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/.test(u.pathname))return 'microsoft-source-1';
   if(u.hostname==='blogs.microsoft.com'&&/^\/blog\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/.test(u.pathname))return 'microsoft-blog-1';
  }
  if(u.hostname==='news.adobe.com'&&/^\/news\/news-details\/\d{4}\/[a-z0-9-]+(?:\.html)?\/?$/.test(u.pathname))return 'adobe-news-1';
  if(u.hostname==='www.amgen.com'&&/^\/newsroom\/press-releases\/\d{4}\/\d{2}\/[a-z0-9-]+\/?$/.test(u.pathname))return 'amgen-release-1';
 }}catch{}
 return publicationProfile(url);
}
export function profileDateText(candidate,profile){
 const {source,raw}=candidate;
 if(source==='adobe:heading-date'&&profile==='adobe-news-1'){
  const m=/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+ \d{1,2}, \d{4}) (?:0?[1-9]|1[0-2]):[0-5]\d [AP]M$/.exec(raw.trim().replace(/\s+/g,' '));
  return m?m[1]:''; // No timezone is stated: retain only the explicit calendar day.
 }
 if(source==='amgen:wire-date'&&profile==='amgen-release-1'||source==='microsoft:visible-date'&&['microsoft-source-1','microsoft-blog-1'].includes(profile)){
  const m=/^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(raw.trim().replace(/\s+/g,' '));
  const months={Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Sept:'September',Oct:'October',Nov:'November',Dec:'December'};
  return m?`${months[m[1]]||m[1]} ${m[2]}, ${m[3]}`:'';
 }
 return raw;
}
export function matchesPageGeneration(raw,context){
 const m=/^页面生成时间\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/.exec(context);
 return !!m&&raw.trim()===m[1];
}
export function profileCandidates(document,profile,add){
 if(['microsoft-source-1','microsoft-blog-1'].includes(profile)){
  const headingSelector=profile==='microsoft-source-1'?'.post-header__content > h1':'article > header.entry-header > h1.entry-title';
  const headings=[...document.querySelectorAll(headingSelector)].filter(n=>!n.closest('nav,footer,aside,.related,.related-articles,.recommendations'));
  if(headings.length===1){
   const selector=profile==='microsoft-source-1'?':scope > a.kicker > time':':scope > div > p.c-meta-text > time';
   for(const node of headings[0].parentElement.querySelectorAll(selector)){
    add('microsoft:visible-date',node.textContent.trim());
    if(profile==='microsoft-blog-1'&&node.hasAttribute('datetime'))add('microsoft:date-attribute',node.getAttribute('datetime'));
   }
  }
 }
 if(profile==='adobe-news-1'){
  const headings=[...document.querySelectorAll('main > div > .text h1')].filter(n=>!n.closest('nav,footer,aside,.related,.related-articles,.recommendations'));
  if(headings.length===1){const h=headings[0],date=h.nextElementSibling;
   if(date?.tagName==='P')add('adobe:heading-date',date.textContent.trim());
   for(const block of document.querySelectorAll('main > div > .card-metadata')){
    const rows=[...block.children].filter(n=>n.tagName==='DIV'&&n.children.length===2),values=key=>rows.filter(n=>n.children[0].textContent.trim()===key).map(n=>n.children[1].textContent.trim());
    const titles=values('CardTitle');if(titles.length===1&&titles[0]===h.textContent.trim())for(const raw of values('CardDate'))add('adobe:card-date',raw);
   }
  }
 }
 if(profile==='amgen-release-1')for(const article of document.querySelectorAll('.news-articles-container > section.m-article')){
  if(article.closest('nav,footer,aside,.related,.related-articles,.recommendations')||!article.querySelector(':scope > h1'))continue;
  for(const p of article.querySelectorAll(':scope > .xn-content > p')){
   const [place,date]=p.children,node=date?.querySelector(':scope > chron');
   if(!place?.matches('span.legendSpanClass')||!place.querySelector(':scope > location')||!date?.matches('span.legendSpanClass')||!node||date.children.length!==1||date.textContent.trim()!==node.textContent.trim()||date.nextSibling?.nodeType!==3||!/^\s*\/PRNewswire\/\s*--/.test(date.nextSibling.textContent))continue;
   add('amgen:wire-date',node.textContent.trim());
  }
 }
 if(profile==='csrc-article-1')for(const node of document.querySelectorAll('.content > .info > p.fl')){
  const raw=node.textContent.trim();if(!/^日期[：:]/.test(raw))continue;
  const match=/^日期[：:]\s*(\d{4}-\d{2}-\d{2})\s+来源[：:]\s*\S[\s\S]*$/.exec(raw);
  add('csrc:article-date',match?match[1]:raw);
 }
 if(['hkma-release-1','hkma-english-date-1'].includes(profile))for(const node of document.querySelectorAll('.content-area > .date')){
  if(node.parentElement.querySelector(':scope > .press-release-title'))add('hkma:release-date',node.textContent.trim());
 }
}
