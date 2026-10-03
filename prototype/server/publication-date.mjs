const schema='publication-date-1',limit=20;
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const day=(year,month,date)=>{const value=`${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`;try{return new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;}catch{return null;}};
// Never ask Date.parse to guess the machine's timezone, date order or missing year.
export function parsePublicationDate(raw){
 if(typeof raw!=='string'||raw.length>200)return null;
 const s=raw.trim().replace(/\s+/g,' ');let m;
 if((m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s)))return day(m[1],m[2],m[3]);
 if((m=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(s)))return day(m[1],m[2],m[3])&&Number.isFinite(Date.parse(s))?s:null;
 if((m=/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(s)))return day(m[1],m[2],m[3]);
 if((m=/^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(s))){const month=months.indexOf(m[1].toLowerCase())+1;return month?day(m[3],month,m[2]):null;}
 return null;
}
export function resolvePublicationDate(candidates,truncated=false){
 if(truncated)return {status:'overflow',publishedAt:null};
 if(!candidates.length)return {status:'missing',publishedAt:null};
 const values=candidates.map(c=>parsePublicationDate(c.raw));
 if(values.some(v=>v===null))return {status:'invalid',publishedAt:null};
 const days=values.filter(v=>v.length===10),instants=values.filter(v=>v.length>10);
 if(new Set(days).size>1||new Set(instants.map(v=>Date.parse(v))).size>1||days.length&&instants.some(v=>v.slice(0,10)!==days[0]))return {status:'conflict',publishedAt:null};
 return {status:'known',publishedAt:instants[0]||days[0]};
}
const samePage=(value,url)=>{try{const a=new URL(value,url),b=new URL(url);a.hash='';b.hash='';return a.href===b.href;}catch{return false;}};
export function collectPublicationDates(document,url){
 const candidates=[];let truncated=false;
 const add=(source,raw)=>{if(typeof raw!=='string')return;if(candidates.length>=limit){truncated=true;return;}if(raw.length>200){truncated=true;return;}candidates.push({source,raw:raw.trim()});};
 const metaNames=new Set(['article:published_time','datepublished','pubdate','publishdate','publication_date','dc.date.issued','dcterms.issued','parsely-pub-date']);
 for(const node of document.querySelectorAll('meta')){const name=(node.getAttribute('property')||node.getAttribute('name')||node.getAttribute('itemprop')||'').toLowerCase();if(metaNames.has(name))add('meta:'+name,node.getAttribute('content')||'');}
 const articleTypes=new Set(['Article','AdvertiserContentArticle','NewsArticle','AnalysisNewsArticle','AskPublicNewsArticle','BackgroundNewsArticle','OpinionNewsArticle','ReportageNewsArticle','ReviewNewsArticle','Report','SatiricalArticle','ScholarlyArticle','MedicalScholarlyArticle','SocialMediaPosting','BlogPosting','LiveBlogPosting','DiscussionForumPosting','TechArticle','APIReference']);
 for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
  let root;try{root=JSON.parse(script.textContent);}catch{continue;}
  const queue=Array.isArray(root)?[...root]:[root];let visited=0;
  while(queue.length){if(++visited>200){truncated=true;break;}const item=queue.shift();if(!item||typeof item!=='object')continue;if(Array.isArray(item)){queue.push(...item);continue;}
   if(Array.isArray(item['@graph']))queue.push(...item['@graph']);
   const types=Array.isArray(item['@type'])?item['@type']:[item['@type']];if(!types.some(t=>articleTypes.has(t)))continue;
   const identity=typeof item.url==='string'?item.url:typeof item.mainEntityOfPage==='string'?item.mainEntityOfPage:item.mainEntityOfPage?.['@id']||item['@id'];
   if(identity&&!samePage(identity,url))continue;
   if(Object.hasOwn(item,'datePublished'))add('jsonld:datePublished',typeof item.datePublished==='string'?item.datePublished:JSON.stringify(item.datePublished));
  }
 }
 for(const node of document.querySelectorAll('[itemprop~="datePublished"], time[pubdate], .article-date, .published-date, .publication-date, .date-published, .entry-date.published')){
  if(node.tagName==='META'||node.closest('nav,footer,aside,.related,.related-articles,.recommendations'))continue;
  const source=node.matches('[itemprop~="datePublished"]')?'element:datePublished':node.matches('time[pubdate]')?'element:pubdate':'element:publication-label';
  add(source,node.getAttribute('datetime')||node.getAttribute('content')||node.textContent.trim());
 }
 return {candidates,truncated};
}
export function publicationDateResult(collected){
 const candidates=[...collected.candidates];
 const resolved=resolvePublicationDate(candidates,collected.truncated);
 return {publishedAt:resolved.publishedAt,publicationDateEvidence:{schema,status:resolved.status,candidates,truncated:collected.truncated}};
}
export function validatePublicationEvidence(value,publishedAt){
 const fail=()=>{throw new Error('来源日期读取依据无效');};
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='candidates,schema,status,truncated'||value.schema!==schema||typeof value.truncated!=='boolean'||!Array.isArray(value.candidates)||value.candidates.length>limit)fail();
 const candidates=value.candidates.map(c=>{if(!c||Array.isArray(c)||Object.keys(c).sort().join(',')!=='raw,source'||typeof c.source!=='string'||!c.source.trim()||c.source.length>160||typeof c.raw!=='string'||c.raw.length>200)fail();return {source:c.source,raw:c.raw};});
 const resolved=resolvePublicationDate(candidates,value.truncated);if(resolved.status!==value.status||resolved.publishedAt!==publishedAt)fail();
 return {schema,status:value.status,candidates,truncated:value.truncated};
}
