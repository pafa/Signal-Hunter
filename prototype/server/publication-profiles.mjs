// Profiles are restricted to verified publisher article routes, not arbitrary class names.
export function publicationProfile(url){
 try{const u=new URL(url);if(u.protocol!=='https:'||u.port||u.username||u.password)return 'generic';
  if(u.hostname==='www.csrc.gov.cn'&&/^\/csrc\/c\d+\/c\d+\/content\.shtml$/.test(u.pathname))return 'csrc-article-1';
  if(u.hostname==='www.hkma.gov.hk'&&/^\/(?:chi|gb_chi)\/news-and-media\/press-releases\/\d{4}\/\d{2}\/\d{8}(?:-\d+)?\/$/.test(u.pathname))return 'hkma-release-1';
 }catch{}return 'generic';
}
export function matchesPageGeneration(raw,context){
 const m=/^页面生成时间\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/.exec(context);
 return !!m&&raw.trim()===m[1];
}
export function profileCandidates(document,profile,add){
 if(profile==='csrc-article-1')for(const node of document.querySelectorAll('.content > .info > p.fl')){
  const raw=node.textContent.trim();if(!/^日期[：:]/.test(raw))continue;
  const match=/^日期[：:]\s*(\d{4}-\d{2}-\d{2})\s+来源[：:]\s*\S[\s\S]*$/.exec(raw);
  add('csrc:article-date',match?match[1]:raw);
 }
 if(profile==='hkma-release-1')for(const node of document.querySelectorAll('.content-area > .date')){
  if(node.parentElement.querySelector(':scope > .press-release-title'))add('hkma:release-date',node.textContent.trim());
 }
}
