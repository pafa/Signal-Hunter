import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle} from '../server/source-reader.mjs';
import {parsePublicationDate,validatePublicationEvidence} from '../server/publication-date.mjs';
import {openStore} from '../server/store.mjs';
import {openMaterials,immutableMaterialSnapshot,materialInput} from '../server/research-materials.mjs';

const url='https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm';
const body='<p>A synthetic release describing an official publication. The survey year and underlying comparison period are not the publication date. This fixture does not represent real market data.</p>'.repeat(4);
const heading=(date='October 09, 2026',time='For release at 10:00 a.m. EDT')=>`<div class="heading"><p class="article__time">${date}</p><h3 class="title">Synthetic publication</h3>${time===null?'':`<p class="releaseTime">${time}</p>`}</div>`;
const page=(h=heading(),head='',extra='')=>`<html><head><title>Synthetic publication</title>${head}</head><body><main><div id="article">${h}<div>${body}</div></div>${extra}</main></body></html>`;
const read=(h=heading(),head='',extra='',target=url)=>extractArticle(page(h,head,extra),target);

test('Fed release heading preserves the explicit date and zoned clock as separate raw evidence',()=>{
 const a=read(heading(),'','<div id="lastUpdate">Last Update: October 11, 2026</div>');
 assert.equal(a.publishedAt,'2026-10-09T10:00-04:00');
 assert.equal(a.method,'public-article-13');
 assert.equal(a.publicationDateEvidence.schema,'publication-date-6');
 assert.equal(a.publicationDateEvidence.profile,'fed-press-release-1');
 assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'fed:heading-date',raw:'October 09, 2026'},{source:'fed:release-time',raw:'For release at 10:00 a.m. EDT'}]);
 assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,url),a.publicationDateEvidence);
 assert.equal(materialInput({...a,url},'2026-10-11T00:00:00Z').datePrecision,'instant');
});

test('release dates without a stated clock or timezone keep calendar precision',()=>{
 for(const clock of [null,'For immediate release','For release at 10:00 a.m.']){
  const a=read(heading('October 09, 2026',clock));
  assert.equal(a.publishedAt,'2026-10-09',String(clock));
  assert.equal(materialInput({...a,url},'2026-10-11T00:00:00Z').datePrecision,'day');
  assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,url),a.publicationDateEvidence);
 }
});

test('explicit Eastern offsets must agree with calendar rules including DST boundaries',()=>{
 for(const [date,clock,expected] of [
  ['January 09, 2026','12:00 a.m. EST','2026-01-09T00:00-05:00'],
  ['July 09, 2026','12:00 p.m. EDT','2026-07-09T12:00-04:00'],
  ['November 01, 2026','1:30 a.m. EDT','2026-11-01T01:30-04:00'],
  ['November 01, 2026','1:30 a.m. EST','2026-11-01T01:30-05:00']
 ])assert.equal(read(heading(date,'For release at '+clock)).publishedAt,expected);
 for(const [date,clock] of [['January 09, 2026','10:00 a.m. EDT'],['July 09, 2026','10:00 a.m. EST'],['March 08, 2026','2:30 a.m. EST']]){
  const a=read(heading(date,'For release at '+clock));assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'invalid');
 }
});

test('generic parser still does not infer a timezone from an EST or EDT suffix',()=>{
 assert.equal(parsePublicationDate('October 09, 2026 10:00 a.m. EDT'),null);
 assert.equal(parsePublicationDate('09 Oct 2026 10:00:00 EDT'),null);
});

test('Fed selectors require the exact public host, release route and unique article heading',()=>{
 for(const target of [url.replace('https:','http:'),url.replace('www.federalreserve.gov','www.federalreserve.gov.example.com'),url.replace('.gov/','.gov:444/'),url.replace('.gov/','.gov@other.example/'),'https://www.federalreserve.gov/newsevents/pressreleases.htm'])assert.equal(read(heading(),'','',target).publishedAt,null,target);
 for(const h of [heading()+heading(),heading().replace('h3','h2').replace('</h3>','</h2>'),'<aside>'+heading()+'</aside>',heading().replace('class="heading"','class="other"')])assert.equal(read(h).publishedAt,null);
 assert.equal(read('', '', '<p class="article__time">October 09, 2026</p><p class="releaseTime">For release at 10:00 a.m. EDT</p>').publishedAt,null);
});

test('body, event, unrelated heading and last-update dates never replace a missing publication date',()=>{
 const h=heading().replace(/<p class="article__time">.*?<\/p>/,'');
 const a=read(h,'','<footer><div class="heading"><p class="article__time">October 08, 2026</p><h3 class="title">Other</h3></div></footer><p>October 07, 2026</p><div id="lastUpdate">October 11, 2026</div>');
 assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'invalid');
 assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'fed:release-time',raw:'For release at 10:00 a.m. EDT'}]);
});

test('malformed, duplicate or conflicting release fields remain unknown with bounded evidence',()=>{
 for(const time of ['For release at 24:00 a.m. EDT','For release at 10:60 a.m. EDT','For release at 10:00 a.m. ET','For release at tomorrow'])assert.equal(read(heading('October 09, 2026',time)).publicationDateEvidence.status,'invalid');
 assert.equal(read(heading('February 30, 2026')).publishedAt,null);
 const doubled=heading().replace('</div>','<p class="releaseTime">For release at 10:00 a.m. EDT</p></div>');assert.equal(read(doubled).publicationDateEvidence.status,'invalid');
 assert.equal(read(heading(),'<meta property="article:published_time" content="2026-10-08">').publicationDateEvidence.status,'conflict');
 assert.equal(read(heading(),'<meta property="article:published_time" content="2026-10-09T14:01Z">').publicationDateEvidence.status,'conflict');
 assert.equal(read(heading(),'<meta property="article:published_time" content="2026-10-09T14:00Z">').publishedAt,'2026-10-09T14:00Z');
 assert.equal(read(heading('x'.repeat(201))).publicationDateEvidence.status,'overflow');
 const many=heading().replace('</div>','<p class="article__time">October 09, 2026</p>'.repeat(21)+'</div>');assert.equal(read(many).publicationDateEvidence.status,'overflow');
});

test('new Fed evidence rejects host, raw-field and schema transplantation',()=>{
 const a=read(),e=a.publicationDateEvidence;
 for(const change of [v=>v.profile='generic',v=>v.schema='publication-date-5',v=>v.candidates[0].raw='October 08, 2026',v=>v.candidates[1].raw='For release at 11:00 a.m. EDT',v=>v.candidates[0].source='fed:last-update']){
  const changed=structuredClone(e);change(changed);assert.throws(()=>validatePublicationEvidence(changed,a.publishedAt,url));
 }
 assert.throws(()=>validatePublicationEvidence(e,a.publishedAt,'https://other.example/release'));
});

test('v5 dates retain old parser and publisher meaning, including missing Fed dates',()=>{
 const old={schema:'publication-date-5',profile:'generic',excluded:[],status:'missing',candidates:[],truncated:false};
 assert.deepEqual(validatePublicationEvidence(old,null,url),old);
 const generic={...old,status:'known',candidates:[{source:'element:publication-label',raw:'6 Oct 2026'}]};
 assert.deepEqual(validatePublicationEvidence(generic,'2026-10-06','https://example.com/release'),generic);
 assert.equal(parsePublicationDate('6 Oct 2026',{format:'publication-date-5'}),'2026-10-06');
 const microsoft={...old,profile:'microsoft-source-1',status:'known',candidates:[{source:'jsonld:datePublished',raw:'2026-10-06T00:00:00'},{source:'microsoft:visible-date',raw:'Oct. 6, 2026'}]};
 assert.deepEqual(validatePublicationEvidence(microsoft,'2026-10-06','https://news.microsoft.com/source/2026/10/06/synthetic-test/'),microsoft);
});

test('new publication evidence appends a material version without rewriting old availability or provenance',()=>{
 const store=openStore(':memory:');try{
  const a=read(),clock='2026-10-11T14:00:00Z';
  const materials=openMaterials(store.db,{clock:()=>clock});
  const prior=materials.prepare('topic',{...a,url,publishedAt:null,publicationDateEvidence:{schema:'publication-date-5',profile:'generic',excluded:[],status:'missing',candidates:[],truncated:false}},'public-web');prior.persist();
  const row=store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(prior.material.id);
  const next=materials.prepare('topic',{...a,url},'public-web');next.persist();
  assert.equal(next.material.documentId,prior.material.documentId);assert.equal(next.material.revision,2);
  assert.equal(next.material.availableAt,clock);assert.equal(next.material.receivedAt,clock);
  assert.equal(next.material.publishedAt,'2026-10-09T10:00-04:00');
  assert.deepEqual(store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(prior.material.id),row);
  assert.equal(immutableMaterialSnapshot(store.db,{id:prior.material.id,revision:1}).publishedAt,null);
  assert.equal(immutableMaterialSnapshot(store.db,{id:next.material.id,revision:2}).publishedAt,next.material.publishedAt);
 }finally{store.close();}
});
