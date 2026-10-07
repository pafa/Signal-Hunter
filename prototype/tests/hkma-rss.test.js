import test from 'node:test';
import assert from 'node:assert/strict';
import {officialQueries,sourcePageUrl,parseOfficialPage,newsWindow} from '../server/news-sources.mjs';
import {openStore} from '../server/store.mjs';
import {openNewsIntake,newsQueries} from '../server/news-intake.mjs';
const at='2026-10-07T03:00:00.000Z';
const q=()=>officialQueries({newsHkmaRssEnabled:true},at).find(x=>x.id==='hkma-rss');
const item=(date='2026-10-06',link='https://www.hkma.gov.hk/eng/news-and-media/press-releases/2026/10/synthetic/')=>`<item><title>Synthetic monetary release</title><link>${link}</link><pubDate>Tue, 06 Oct 2026 00:00:00 +0800</pubDate><sortDate>${date}</sortDate></item>`;
const feed=items=>`<rss version="2.0"><channel><title>Synthetic HKMA feed</title>${items}</channel></rss>`;
test('HKMA RSS remains opt-in, separate from API, bounded and day-precise',()=>{
 const s=openStore(':memory:');try{
  assert.equal(newsQueries(s.getSettings(),at).find(x=>x.id==='hkma-rss').enabled,false);s.setSettings({newsHkmaRssEnabled:true});assert.equal(s.getSettings().newsHkmaEnabled,false);
  const query=q();assert.equal(query.history,false);assert.throws(()=>sourcePageUrl(query,2));assert.throws(()=>newsWindow({sourceId:'hkma-rss',from:'2026-10-01',to:'2026-10-07'},at));
  const r=parseOfficialPage(query,feed(item()+item()+item('2026-09-01')+item('2026-02-30')+item('2026-10-06','https://attacker.example/a')));
  assert.equal(r.items.length,1);assert.equal(r.duplicates,1);assert.equal(r.outsideWindow,1);assert.equal(r.rejectedCount,2);assert.equal(r.coverage,'observed-only');
  assert.equal(r.items[0].publishedAt,'2026-10-06');assert.equal(r.items[0].datePrecision,'day');assert.equal(r.items[0].originKey,'www.hkma.gov.hk');assert.equal(r.items[0].provider,'hkma-rss');
  assert.equal(parseOfficialPage(query,feed(item(''))).items.length,0);assert.equal(parseOfficialPage(query,feed(item('2026-10-06T00:00:00Z'))).items.length,0);
 }finally{s.close();}
});
test('RSS success preserves the failed API receipt and exact response without claiming history coverage',async()=>{
 const s=openStore(':memory:'),intake=openNewsIntake(s,{clock:()=>at});try{
  const api=officialQueries({newsHkmaEnabled:true},at).find(x=>x.id==='hkma');const failed=await intake.run(api,async()=>new Response('synthetic unavailable',{status:503}));
  const body=feed(item()),success=await intake.run(q(),async()=>new Response(body));assert.equal(failed.state,'error');assert.equal(success.state,'ok');assert.equal(success.coverage,'observed-only');
  assert.equal(s.news()[0].firstSeen,at);assert.equal(s.news()[0].datePrecision,'day');assert.equal(intake.detail(failed.id).state,'error');
  const page=intake.detail(success.id).pages[0];assert.equal(s.db.prepare('SELECT body FROM news_source_responses WHERE hash=?').get(page.responseHash).body,body);
  const empty=await intake.run(q(),async()=>new Response(feed('')));assert.equal(empty.state,'ok');assert.equal(empty.rawCount,0);assert.equal(empty.coverage,'observed-only');assert.equal(s.news().length,1);
  assert.throws(()=>parseOfficialPage(q(),'<!DOCTYPE rss><rss><channel/></rss>'));assert.throws(()=>parseOfficialPage(q(),'<html/>'));
 }finally{s.close();}
});
