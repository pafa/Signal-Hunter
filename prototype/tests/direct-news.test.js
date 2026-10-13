import {unknownCompanyAssessments} from './helpers/company-assessment-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {officialQueries,sourcePageUrl,parseOfficialPage} from '../server/news-sources.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {digest} from '../server/codex-research.mjs';
const at='2026-10-06T09:00:00.000Z';
const query=()=>officialQueries({newsNvidiaEnabled:true},at).find(q=>q.id==='nvidia');
const entry=(link='https://nvidianews.nvidia.com/news/synthetic-announcement',date='Mon, 28 Sep 2026 11:00:00 GMT',title='Synthetic NVIDIA announces a $10 billion share buyback')=>`<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
const rss=items=>`<rss><channel>${items}</channel></rss>`;

test('direct company releases use a bounded declared window and fixed publisher URL',()=>{
 const q=query();assert.deepEqual(q.window,{from:'2026-09-23',to:'2026-10-06'});
 assert.deepEqual(officialQueries({},at).find(q=>q.id==='fed').window,{from:'2026-09-30',to:'2026-10-06'});
 assert.equal(sourcePageUrl({...q,url:'https://attacker.example/feed'},1),'https://nvidianews.nvidia.com/cats/press_release.xml');
 assert.throws(()=>sourcePageUrl(q,2),/页数/);
 const r=parseOfficialPage(q,rss(entry()));assert.equal(r.items[0].publishedAt,'2026-09-28T11:00:00.000Z');assert.equal(r.items[0].datePrecision,'instant');assert.equal(r.items[0].originKey,'nvidianews.nvidia.com');assert.equal(r.coverage,'observed-only');assert.equal(r.hasMore,false);
});

test('direct releases reject off-publisher links, ambiguous times and out-of-window items while preserving revisions',()=>{
 const q=query(),r=parseOfficialPage(q,rss(entry()+entry('https://nvidianews.nvidia.com.attacker.example/a')+entry('http://nvidianews.nvidia.com/a')+entry('https://nvidianews.nvidia.com:444/a')+entry(undefined,'2026-09-28 11:00:00')+entry(undefined,'Wed, 07 Oct 2026 11:00:00 GMT')+entry(undefined,'Tue, 22 Sep 2026 11:00:00 GMT')+entry()));
 assert.equal(r.acceptedCount,1);assert.equal(r.rejectedCount,4);assert.equal(r.outsideWindow,2);assert.equal(r.duplicates,1);
 const changed=parseOfficialPage(q,rss(entry(undefined,undefined,'Synthetic corrected release')));assert.equal(changed.items[0].id,r.items[0].id);
 for(const malformed of ['<html/>','<!DOCTYPE rss><rss><channel/></rss>'])assert.throws(()=>parseOfficialPage(q,malformed));
});

test('direct intake reaches immutable full material and one unadopted model candidate without orders',async()=>{
 const store=openStore(':memory:');assert.equal(store.getSettings().newsNvidiaEnabled,false);
 store.setSettings({newsDiscoveryEnabled:false,newsTrackingEnabled:false,newsNvidiaEnabled:true});
 let reads=0,calls=0;const model='synthetic-model',service=createService(store,{mode:'research',now:()=>Date.parse(at),modelConfig:{binary:'/test/codex',model,timeoutMs:1000},fetcher:async()=>new Response(rss(entry())),sourceReader:async url=>{reads++;assert.equal(url,'https://nvidianews.nvidia.com/news/synthetic-announcement');return {url,title:'Synthetic company release',sourceName:'NVIDIA',body:'Synthetic public-source body for workflow validation. '.repeat(20),scope:'extracted-text',publishedAt:'2026-09-28',datePrecision:'day',method:'synthetic-reader'};},modelRunner:async packet=>{calls++;const value={companyAssessments:unknownCompanyAssessments(packet),sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['Synthetic workflow candidate, unverified.'],sourceIds:[]})),missingEvidence:['Independent validation']},rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',...value,rawOutput,trace:{model,inputHash:packet.inputHash,topicId:packet.input.topicId,topicVersion:packet.input.topicVersion,outputHash:digest(rawOutput)}};}});
 try{
  const book=service.paper.snapshot();await service.runOperation('news');const news=store.news()[0];assert.equal(news.firstSeen,at);assert.equal(store.db.prepare('SELECT count(*) n FROM news_source_responses').get().n,1);
  service.controlOperation('discovery','resume');await service.runOperation('discovery');let item=service.researchPipeline.snapshot().items[0];await service.modelResearch.wait(item.runId);item=service.researchPipeline.snapshot().items[0];assert.equal(item.status,'candidate');assert.equal(reads,1);assert.equal(calls,1);assert.equal(service.research.get(item.topicId).dossier,undefined);assert.equal(service.research.materialList(item.topicId).materials[0].availableAt,at);assert.deepEqual(service.paper.snapshot(),book);
  await service.runOperation('news');await service.runOperation('discovery');assert.equal(calls,1);assert.equal(store.news().length,1);
 }finally{await service.close();store.close();}
});
