import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractArticle} from '../server/source-reader.mjs';
import {validatePublicationEvidence} from '../server/publication-date.mjs';
import {openStore} from '../server/store.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
const adobe='https://news.adobe.com/news/news-details/2024/synthetic-announcement',amgen='https://www.amgen.com/newsroom/press-releases/2024/02/synthetic-announcement';
const text='Original synthetic fixture describing a hypothetical business announcement, subject to conditions and further verification. This is not an actual announcement or trading recommendation. '.repeat(5);
const heading=(date='Tuesday, February 6, 2024 08:01 AM')=>`<div><div class="text"><div><div><h1>Synthetic announcement</h1><p>${date}</p></div></div></div></div>`;
const card=(date='2024-02-06',title='Synthetic announcement')=>`<div><div class="card-metadata"><div><div>CardTitle</div><div>${title}</div></div><div><div>CardDate</div><div>${date}</div></div></div></div>`;
const wire=(date='Feb. 6, 2024')=>`<div class="news-articles-container"><section class="m-article"><h1>Synthetic announcement</h1><div class="xn-content"><p><span class="legendSpanClass"><location>Example City</location></span>, <span class="legendSpanClass"><chron>${date}</chron></span> /PRNewswire/ -- ${text}</p></div></section></div>`;
const read=(url,content,meta='')=>extractArticle(`<html><head><title>Synthetic announcement</title>${meta}</head><body><main>${content}<article><p>${text}</p></article></main></body></html>`,url);
test('Adobe heading and matching card date retain raw evidence and day precision',()=>{
 const a=read(adobe,heading()+card());assert.equal(a.publishedAt,'2024-02-06');assert.equal(a.publicationDateEvidence.schema,'publication-date-5');assert.equal(a.publicationDateEvidence.profile,'adobe-news-1');assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'adobe:heading-date',raw:'Tuesday, February 6, 2024 08:01 AM'},{source:'adobe:card-date',raw:'2024-02-06'}]);
 assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,adobe),a.publicationDateEvidence);
 assert.equal(a.extractionEvidence.profile,'generic');assert.equal(a.extractionEvidence.schema,'article-extraction-1');
 assert.equal(read(adobe+'.html',heading()).publishedAt,'2024-02-06');
 assert.equal(read(adobe,heading()+card('2025-01-01','A related article')).publishedAt,'2024-02-06');
});
test('Amgen dateline is scoped to the wire article, not later background dates or navigation',()=>{
 const a=read(amgen,wire()+'<nav><chron>Jan. 1, 2020</chron></nav>');assert.equal(a.publishedAt,'2024-02-06');assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'amgen:wire-date',raw:'Feb. 6, 2024'}]);assert.equal(a.publicationDateEvidence.profile,'amgen-release-1');
 assert.equal(read(amgen,wire().replace('/PRNewswire/ --','Background discussion:')).publishedAt,null);
 assert.equal(read(amgen,wire().replace('legendSpanClass','other-class')).publishedAt,null);
 assert.equal(read(amgen,wire().replace(', <span',', background <em>context</em> <span')).publishedAt,null);
 assert.equal(read(amgen,'<aside>'+wire()+'</aside>').publishedAt,null);
 assert.equal(read(amgen,wire().replace('</p>','<span class="legendSpanClass"><chron>Jan. 1, 2020</chron></span></p>')).publishedAt,'2024-02-06');
 assert.equal(read(amgen,wire('February 6, 2024')).publishedAt,'2024-02-06');
});
test('publisher dates reject conflicting, malformed, ambiguous and excessive evidence',()=>{
 for(const [content,status] of [[heading()+card('2024-02-07'),'conflict'],[heading('Tuesday, February 30, 2024 08:01 AM'),'invalid'],[heading('Tuesday, February 6, 2024 25:01 AM'),'invalid'],[heading()+card().repeat(21),'overflow'],[heading('x'.repeat(201)),'overflow']]){const a=read(adobe,content);assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,status);}
 assert.equal(read(adobe,heading()+heading()).publishedAt,null);
 assert.equal(read(adobe,heading(),'<meta property="article:published_time" content="2024-02-07">').publicationDateEvidence.status,'conflict');
 assert.equal(read(amgen,wire('Feb. 30, 2024')).publicationDateEvidence.status,'invalid');
 assert.equal(read(amgen,wire()+wire('Feb. 7, 2024')).publicationDateEvidence.status,'conflict');
});
test('new publisher selectors are limited to exact HTTPS hosts and article paths',()=>{
 for(const u of [adobe.replace('https:','http:'),adobe.replace('news.adobe.com','news.adobe.com.example.org'),'https://news.adobe.com/news/news-details/',adobe.replace('news.adobe.com','news.adobe.com:444'),amgen.replace('www.amgen.com','amgen.example.org'),'https://www.amgen.com/newsroom/press-releases'])assert.equal(read(u,heading()+card()+wire()).publishedAt,null,u);
 assert.equal(read(adobe,'<aside>'+heading()+card()+'</aside>').publishedAt,null);
});
test('current publisher profile provenance cannot be transplanted or reinterpreted as old evidence',()=>{
 const a=read(adobe,heading()+card()),e=a.publicationDateEvidence;
 for(const mutate of [v=>v.schema='publication-date-2',v=>v.profile='generic',v=>v.candidates[0].raw='Tuesday, February 7, 2024 08:01 AM',v=>v.candidates[0].source='amgen:wire-date']){const c=structuredClone(e);mutate(c);assert.throws(()=>validatePublicationEvidence(c,a.publishedAt,adobe));}
 assert.throws(()=>validatePublicationEvidence(e,a.publishedAt,amgen));
 const old={schema:'publication-date-2',profile:'generic',excluded:[],status:'missing',candidates:[],truncated:false};assert.deepEqual(validatePublicationEvidence(old,null,adobe),old);
 const invalid={...old,status:'invalid',candidates:[{source:'adobe:heading-date',raw:'Tuesday, February 6, 2024 08:01 AM'}]};assert.deepEqual(validatePublicationEvidence(invalid,null,adobe),invalid);
});
test('v2 material stays immutable and readable after a current reread and SQLite restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publisher-dates-')),path=join(dir,'test.sqlite');let store=openStore(path);
 try{
  const oldEvidence={schema:'publication-date-2',profile:'generic',excluded:[],status:'missing',candidates:[],truncated:false};
  const a=read(adobe,heading()+card()),materials=openMaterials(store.db,{clock:()=> '2026-10-04T00:00:00Z'}),old=materials.prepare('t',{...a,url:adobe,publishedAt:null,publicationDateEvidence:oldEvidence},'public-web');old.persist();
  const before=store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id);
  const next=materials.prepare('t',{...a,url:adobe},'public-web');next.persist();assert.equal(next.material.revision,2);assert.equal(next.material.documentId,old.material.documentId);
  store.close();store=openStore(path);
  assert.deepEqual(store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),before);
  assert.equal(immutableMaterialSnapshot(store.db,{id:old.material.id,revision:1}).publishedAt,null);
  assert.equal(immutableMaterialSnapshot(store.db,{id:next.material.id,revision:2}).publishedAt,'2024-02-06');
  const retry=openMaterials(store.db).prepare('t',{...a,url:adobe},'public-web');retry.persist();assert.equal(retry.material.id,next.material.id);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM research_materials').get().n,2);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
