import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle} from '../server/source-reader.mjs';
import {parsePublicationDate,resolvePublicationDate,validatePublicationEvidence} from '../server/publication-date.mjs';
import {openStore} from '../server/store.mjs';
import {openMaterials,materialInput} from '../server/research-materials.mjs';
import {openResearch} from '../server/research.mjs';
import {openSemanticEvents} from '../server/semantic-events.mjs';
import {digest} from '../server/codex-research.mjs';
import {materialComparisonSnapshot} from '../server/semantic-materials.mjs';
const url='https://news.acme.com/news/announcement';
const body='<article><h1>Acme announcement</h1>'+('<p>Acme announced a proposed transaction. Completion remains subject to approval and other closing conditions. The page describes a hypothetical fixture, not a real company or investment recommendation.</p>'.repeat(4))+'</article>';
const read=(head='',extra='')=>extractArticle(`<html><head><title>Acme announcement</title>${head}</head><body>${extra}${body}</body></html>`,url);
const c=(raw,source='fixture')=>({source,raw});

test('publication parser retains day precision and original offset without local timezone guesses',()=>{
 for(const [raw,expected] of [['2024-02-29','2024-02-29'],['February 7, 2022','2022-02-07'],['2026年 10月 2日','2026-10-02'],['2026-10-02T23:30:00-07:00','2026-10-02T23:30:00-07:00'],['2026-10-03T01:02:03.456Z','2026-10-03T01:02:03.456Z']])assert.equal(parsePublicationDate(raw),expected);
 for(const value of ['2026-02-29','2026-02-31','2026-13-01','2026-10-02T12:00:00','2026-10-02T24:00:00Z','2026-10-02T12:60:00Z','2026-10-02T12:00:00+25:00','10/02/2026','yesterday','February 30, 2022','October 2',null])assert.equal(parsePublicationDate(value),null,String(value));
});
test('v5 expands only unambiguous dates and explicit timezone timestamps',()=>{
 for(const [raw,expected] of [['2026/10/6','2026-10-06'],['2026.10.06','2026-10-06'],['Oct. 6, 2026','2026-10-06'],['6 October 2026','2026-10-06'],['6 Oct, 2026','2026-10-06'],['Tue, 06 Oct 2026 00:00:00 +0800','2026-10-06T00:00:00+08:00'],['06 Oct 2026 15:30:00 GMT','2026-10-06T15:30:00Z']])assert.equal(parsePublicationDate(raw),expected,raw);
 for(const raw of ['6/10/2026','Oct 6','2026/02/30','2026/10.06','Octember 6, 2026','06 Oct 2026 15:30:00 EST','Mon, 06 Oct 2026 00:00:00 +0800','06 Oct 2026 24:00:00 GMT','06 Oct 2026 15:30:00','2026-10-06 15:30:00'])assert.equal(parsePublicationDate(raw),null,raw);
 const a=read('','<div class="published-date">6 Oct 2026</div>');assert.equal(a.publishedAt,'2026-10-06');assert.equal(a.publicationDateEvidence.schema,'publication-date-5');assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,url),a.publicationDateEvidence);
 assert.equal(resolvePublicationDate([c('6 Oct 2026'),c('2026-10-07')]).status,'conflict');
});
test('v1-v4 evidence retains its original invalid results and v4 Microsoft calendar rules',()=>{
 for(const schema of ['publication-date-1','publication-date-2','publication-date-3','publication-date-4']){
  const evidence={schema,status:'invalid',candidates:[c('6 Oct 2026')],truncated:false,...(schema!=='publication-date-1'?{profile:'generic',excluded:[]}:{})};
  assert.deepEqual(validatePublicationEvidence(evidence,null,url),evidence);assert.throws(()=>validatePublicationEvidence({...evidence,status:'known'},'2026-10-06',url));
 }
 const old={schema:'publication-date-4',status:'known',candidates:[c('2026-10-06T00:00:00','jsonld:datePublished'),c('Oct. 6, 2026','microsoft:visible-date')],truncated:false,profile:'microsoft-source-1',excluded:[]};
 const microsoft='https://news.microsoft.com/source/2026/10/06/synthetic-test/';assert.deepEqual(validatePublicationEvidence(old,'2026-10-06',microsoft),old);
 assert.throws(()=>validatePublicationEvidence(old,'2026-10-06',url));
});
test('explicit visible publication label repairs missing metadata without manufacturing midnight',()=>{
 const a=read('','<div class="article-date">\n February 7, 2022 \n</div>');assert.equal(a.publishedAt,'2022-02-07');assert.equal(a.publicationDateEvidence.status,'known');assert.deepEqual(a.publicationDateEvidence.candidates,[c('February 7, 2022','element:publication-label')]);assert.equal(a.method,'public-article-9');
});
test('article metadata, publication microdata, pubdate time and named visible labels are captured',()=>{
 for(const a of [read('<meta property="article:published_time" content="2026-10-02T23:30:00-07:00">'),read('<meta name="parsely-pub-date" content="2026-10-02T23:30:00-07:00">'),read('','<time itemprop="datePublished" datetime="2026-10-02T23:30:00-07:00">October 2, 2026</time>')])assert.equal(a.publishedAt,'2026-10-02T23:30:00-07:00');
 assert.equal(read('','<time pubdate datetime="2026-10-02">October 2, 2026</time>').publishedAt,'2026-10-02');
 assert.equal(read('','<div class="published-date">2026年10月2日</div>').publishedAt,'2026-10-02');
});
test('modification times, unrelated time elements, body dates and related article dates are not publication evidence',()=>{
 const a=read('<meta property="article:modified_time" content="2026-10-02">','<time datetime="2026-10-02">2026-10-02</time><p>October 2, 2026</p><aside><div class="article-date">October 1, 2026</div></aside>');assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'missing');
});
test('JSON-LD examines article publication fields and page identity, not arbitrary nested dates or scripts',()=>{
 const data={'@context':'https://schema.org','@graph':[{'@type':'WebSite',datePublished:'2020-01-01'},{'@type':'NewsArticle',url, datePublished:'2026-10-02',dateModified:'2026-10-03',author:{datePublished:'2000-01-01'}},{'@type':'NewsArticle','@id':'https://news.acme.com/news/other',datePublished:'2021-01-01'}]};
 assert.equal(read(`<script type="application/ld+json">${JSON.stringify(data)}</script>`).publishedAt,'2026-10-02');
 const foreign={'@context':'https://schema.org','@type':'NewsArticle',url:'https://other.acme.com/article',datePublished:'2021-01-01'};assert.equal(read(`<script type="application/ld+json">${JSON.stringify(foreign)}</script>`).publishedAt,null);
 assert.equal(read('<script>globalThis.dateInjected=true</script>').publishedAt,null);assert.equal(globalThis.dateInjected,undefined);
});
test('conflicting dates or incompatible precisions stay unknown and retain all candidates',()=>{
 const a=read('<meta property="article:published_time" content="2026-10-02">','<div class="article-date">October 3, 2026</div>');assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'conflict');assert.equal(a.publicationDateEvidence.candidates.length,2);
 assert.equal(resolvePublicationDate([c('2026-10-02'),c('2026-10-03T00:30:00Z')]).status,'conflict');
 assert.equal(resolvePublicationDate([c('2026-10-02T12:00:00Z'),c('2026-10-02T12:00:01Z')]).status,'conflict');
});
test('consistent duplicates and equivalent offsets do not add false precision or create a conflict',()=>{
 assert.deepEqual(resolvePublicationDate([c('2026-10-02'),c('October 2, 2026')]),{status:'known',publishedAt:'2026-10-02'});
 assert.deepEqual(resolvePublicationDate([c('2026-10-02'),c('2026-10-02T23:30:00-07:00')]),{status:'known',publishedAt:'2026-10-02T23:30:00-07:00'});
 assert.equal(resolvePublicationDate([c('2026-10-02T23:30:00-07:00'),c('2026-10-03T06:30:00Z')]).status,'known');
});
test('malformed or timezone-less explicit values keep body and diagnostic evidence, not a guessed date',()=>{
 const a=read('<meta property="article:published_time" content="2026-10-02T12:00:00">');assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'invalid');assert.match(a.body,/Acme/);
 assert.equal(read('<meta property="article:published_time" content="not a date">','<div class="article-date">October 2, 2026</div>').publishedAt,null);
});
test('oversized candidate collections and fields retain bounded evidence and never silently choose the first',()=>{
 const a=read(Array.from({length:21},()=>'<meta property="article:published_time" content="2026-10-02">').join(''));assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'overflow');assert.equal(a.publicationDateEvidence.candidates.length,20);
 const long=read(`<meta property="article:published_time" content="${'x'.repeat(201)}">`);assert.equal(long.publicationDateEvidence.truncated,true);assert.equal(long.publishedAt,null);
});
test('date provenance is checked against publishedAt and rejects altered status, raw text and shape',()=>{
 const a=read('','<div class="article-date">October 2, 2026</div>'),e=a.publicationDateEvidence;assert.deepEqual(validatePublicationEvidence(e,a.publishedAt),e);
 for(const mutate of [v=>v.status='missing',v=>v.candidates[0].raw='October 3, 2026',v=>v.extra=true,v=>v.candidates[0].extra=true,v=>v.truncated='false']){const changed=structuredClone(e);mutate(changed);assert.throws(()=>validatePublicationEvidence(changed,a.publishedAt),/依据无效/);}
 assert.throws(()=>materialInput({...a,scope:'excerpt'},'2026-10-03T00:00:00Z'),/仅用于网页提取/);
});
test('new date evidence creates a new immutable material revision; old hashes remain unchanged',()=>{
 const store=openStore(':memory:'),materials=openMaterials(store.db,{clock:()=> '2026-10-03T00:00:00Z'});
 try{const old=materials.prepare('topic',{title:'Acme announcement',sourceName:'Acme',body:'Original body',url,publishedAt:null,scope:'extracted-text'},'public-web');old.persist();const row=store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),legacy=materialComparisonSnapshot(store.db,{id:old.material.id,revision:1});assert.equal(Object.hasOwn(legacy,'publicationDateEvidence'),false);
 const date=read('','<div class="article-date">October 2, 2026</div>'),next=materials.prepare('topic',{...old.material,publishedAt:date.publishedAt,publicationDateEvidence:date.publicationDateEvidence},'public-web');next.persist();assert.equal(next.material.documentId,old.material.documentId);assert.equal(next.material.revision,2);assert.deepEqual(store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),row);
 const snapshot=materialComparisonSnapshot(store.db,{id:next.material.id,revision:2});assert.deepEqual(snapshot.publicationDateEvidence,date.publicationDateEvidence);assert.equal(snapshot.datePrecision,'day');assert.equal(snapshot.availableAt,'2026-10-03T00:00:00Z');
 const retry=materials.prepare('topic',{...next.material},'public-web');retry.persist();assert.equal(retry.material.id,next.material.id);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM research_materials').get().n,2);
 const altered=structuredClone(next.material);altered.publicationDateEvidence.candidates[0].source='changed';store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify(altered),altered.id);assert.throws(()=>materialComparisonSnapshot(store.db,{id:altered.id,revision:2}),/快照校验失败/);
 }finally{store.close();}
});

test('source reread appends date provenance and preserves frozen comparisons and research history',async()=>{
 const store=openStore(':memory:');let article={title:'Acme announcement',sourceName:'Acme',body:'Acme proposed a transaction.',url,publishedAt:null,scope:'extracted-text'};
 const research=openResearch(store,{seed:false,clock:()=> '2026-10-03T00:00:00Z',sourceReader:async()=>structuredClone(article)});
 const runs=openSemanticEvents(store,{enabled:true,config:{binary:'/test/codex',model:'fixture',timeoutMs:1000},runner:async packet=>{
  const side=k=>({actor:'Acme',action:'unknown',object:'transaction',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'unknown',quote:packet.input[k].body,quoteField:'body'});
  const comparison={relation:'uncertain',left:side('left'),right:side('right'),reason:'Synthetic test, no real model call',missingEvidence:['Independent evidence']},rawOutput=JSON.stringify(comparison);
  return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:'fixture',promptVersion:packet.schema,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};
 }});
 try{
  let topic=research.create({title:'Synthetic date history test',summary:'No market or model integration'});
  const form=()=>({version:topic.version,url,stance:'unverified',family:'corporate',step:topic.chain[0].id,interpretation:'Synthetic source'});
  topic=await research.readMaterial(topic.id,form());const old=research.materialList(topic.id).materials[0];
  const second=openMaterials(store.db,{clock:()=> '2026-10-03T00:00:00Z'}).prepare('other',{...article,url:url+'-other',body:'Other source',scope:'excerpt'},'manual');second.persist();
  const run=runs.start({left:{kind:'material',id:old.id,revision:1},right:{kind:'material',id:second.material.id,revision:1}});await runs.wait(run.id);
  const beforeRun=store.db.prepare('SELECT * FROM semantic_runs WHERE id=?').get(run.id),beforeHistory=research.history(topic.id),beforePacket=research.packet(topic.id);
  const date=read('','<div class="article-date">October 2, 2026</div>');article={...article,publishedAt:date.publishedAt,publicationDateEvidence:date.publicationDateEvidence};
  topic=await research.readMaterial(topic.id,form());const items=research.materialList(topic.id).materials;assert.equal(items.length,2);assert.equal(items[1].revision,2);assert.equal(items[1].datePrecision,'day');
  assert.deepEqual(research.history(topic.id).find(h=>h.version===beforeHistory[0].version),beforeHistory[0]);assert.equal(beforePacket.input.evidence[0].material.publishedAt,null);
  assert.deepEqual(store.db.prepare('SELECT * FROM semantic_runs WHERE id=?').get(run.id),beforeRun);assert.equal(runs.get(run.id).stale,true);assert.equal(runs.get(run.id).packet.input.left.publishedAt,null);
  const version=topic.version;topic=await research.readMaterial(topic.id,form());assert.equal(topic.version,version);assert.equal(research.materialList(topic.id).materials.length,2);
  const invalid=read('<meta property="article:published_time" content="2026-10-02T12:00:00">');article={...article,publishedAt:null,publicationDateEvidence:invalid.publicationDateEvidence};
  topic=await research.readMaterial(topic.id,form());const latest=research.materialList(topic.id);assert.equal(latest.materials.length,3);assert.equal(latest.materials[2].publicationDateEvidence.status,'invalid');assert.equal(latest.materials[2].body,article.body);assert.equal(latest.attempts[0].state,'saved');assert.deepEqual(store.db.prepare('SELECT * FROM semantic_runs WHERE id=?').get(run.id),beforeRun);
 }finally{await runs.close();store.close();}
});
