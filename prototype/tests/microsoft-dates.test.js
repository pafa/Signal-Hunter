import test from 'node:test';import assert from 'node:assert/strict';
import {extractArticle} from '../server/source-reader.mjs';
import {validatePublicationEvidence,parsePublicationDate} from '../server/publication-date.mjs';
import {materialInput} from '../server/research-materials.mjs';
const source='https://news.microsoft.com/source/2024/02/06/synthetic-announcement/',blog='https://blogs.microsoft.com/blog/2024/02/06/synthetic-announcement/';
const content='<article><p>'+ 'Synthetic transaction announcement for date provenance tests only. No actual company or investment result is described. '.repeat(8)+'</p></article>';
const heading=(date='February 6, 2024')=>`<div class="post-header__content"><a class="kicker"><time datetime="1707206400">${date}</time></a><h1>Synthetic announcement</h1></div>`;
const blogHeading=(date='Feb 6, 2024',attr='2024-02-06')=>`<article><header class="entry-header"><h1 class="entry-title">Synthetic announcement</h1><div><p class="c-meta-text"><time datetime="${attr}"><abbr title="February 6, 2024">${date}</abbr></time></p></div></header></article>`;
const head=(url,local='2024-02-06T00:00:00',zoned='2024-02-06T08:00:00+00:00')=>`<meta property="article:published_time" content="${zoned}"><script type="application/ld+json">${JSON.stringify([{'@type':'NewsArticle',url,datePublished:zoned},{'@type':'NewsArticle',url,datePublished:local}])}</script>`;
const read=(url=source,visible=heading(),meta=head(url))=>extractArticle(`<html><head><title>Synthetic announcement</title>${meta}</head><body>${visible}${content}</body></html>`,url);
test('verified Microsoft heading corroborates calendar day while unzoned clocks retain raw evidence without inferred instants',()=>{
 for(const [url,visible,local,zoned] of [[source,heading(),'2024-02-06T00:00:00','2024-02-06T08:00:00+00:00'],[blog,blogHeading(),'2024-02-06T05:47:32','2024-02-06T12:47:32+00:00']]){
  const a=read(url,visible,head(url,local,zoned));assert.equal(a.publishedAt,'2024-02-06');assert.equal(a.publicationDateEvidence.schema,'publication-date-5');assert.equal(a.method,'public-article-9');assert(a.publicationDateEvidence.candidates.some(c=>c.raw===local));assert(a.publicationDateEvidence.candidates.some(c=>c.raw===zoned));assert.equal(materialInput({...a,url},'2026-10-04').datePrecision,'day');assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,url),a.publicationDateEvidence);
 }
 assert.equal(parsePublicationDate('2024-02-06T05:47:32'),null);
});
test('coarser date requires a unique actual article heading and does not generalize to other hosts or page routes',()=>{
 for(const u of [source.replace('https:','http:'),source.replace('news.microsoft.com','news.microsoft.com.example.org'),'https://news.microsoft.com/source/2024/02/',blog.replace('/blog/','/other/'),source.replace('news.microsoft.com','news.microsoft.com:444')])assert.equal(read(u,heading()+blogHeading()).publishedAt,null,u);
 for(const h of ['',heading()+heading(),'<aside>'+heading()+'</aside>',heading().replace('<h1>','<h2>').replace('</h1>','</h2>'),'<nav>'+blogHeading()+'</nav>'])assert.equal(read(source,h).publishedAt,null);
 assert.equal(read(blog,blogHeading()+blogHeading()).publishedAt,null);
});
test('conflicting calendar days, zoned instants, invalid clocks and oversized evidence remain unresolved',()=>{
 const cases=[[heading('February 7, 2024'),head(source),'conflict'],[heading(),head(source,'2024-02-07T00:00:00'),'conflict'],[heading(),head(source,'2024-02-06T25:00:00'),'invalid'],[heading(),head(source,'2024-02-30T00:00:00'),'invalid'],[heading(),head(source,'2024-02-06T00:00:00')+'<meta name="pubdate" content="2024-02-06T08:00:01Z">','conflict'],[heading(),head(source).repeat(21),'overflow'],[heading('x'.repeat(201)),head(source),'overflow']];
 for(const [visible,meta,status] of cases){const a=read(source,visible,meta);assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,status);}
 assert.equal(read(blog,blogHeading('Feb 7, 2024')).publishedAt,null);
 assert.equal(read(source,heading(),'<meta name="pubdate" content="2024-02-06T00:00:00">').publishedAt,null);
});
test('profile-bound evidence cannot be transplanted, relabeled as old, or used to manufacture an exact instant',()=>{
 const a=read(),e=a.publicationDateEvidence;assert.throws(()=>validatePublicationEvidence(e,a.publishedAt,blog));assert.throws(()=>validatePublicationEvidence(e,'2024-02-06T08:00:00Z',source));
 for(const mutate of [v=>v.schema='publication-date-3',v=>v.profile='generic',v=>v.candidates.find(c=>c.source==='microsoft:visible-date').raw='February 7, 2024',v=>v.candidates.find(c=>c.source==='microsoft:visible-date').source='microsoft:unknown']){const c=structuredClone(e);mutate(c);assert.throws(()=>validatePublicationEvidence(c,a.publishedAt,source));}
 const adobeLegacy={schema:'publication-date-3',profile:'adobe-news-1',excluded:[],status:'known',truncated:false,candidates:[{source:'adobe:heading-date',raw:'Tuesday, February 6, 2024 08:01 AM'},{source:'adobe:card-date',raw:'2024-02-06'}]};assert.deepEqual(validatePublicationEvidence(adobeLegacy,'2024-02-06','https://news.adobe.com/news/news-details/2024/synthetic-announcement'),adobeLegacy);
 for(const schema of ['publication-date-2','publication-date-3']){const old={schema,profile:'generic',excluded:[],status:'invalid',truncated:false,candidates:[{source:'meta:article:published_time',raw:'2024-02-06T08:00:00+00:00'},{source:'jsonld:datePublished',raw:'2024-02-06T00:00:00'}]};assert.deepEqual(validatePublicationEvidence(old,null,source),old);}
});
