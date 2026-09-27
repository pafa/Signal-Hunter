import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {instrument,parseReutersFeed,parseMinutes,hash} from '../server/providers.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
const item=(source='Reuters',sourceUrl='https://www.reuters.com',link='https://news.google.com/rss/articles/example')=>`<item><title>Example &amp; news - Reuters</title><link>${link}</link><guid>x</guid><pubDate>Thu, 24 Sep 2026 05:00:00 GMT</pubDate><source url="${sourceUrl}">${source}</source></item>`;
const feed=items=>`<rss version="2.0"><channel>${items}</channel></rss>`;
const news={id:hash('x'),title:'Test headline',url:'https://www.reuters.com/example',publishedAt:'2026-09-24T05:00:00.000Z',publisher:'Reuters',provider:'test'};

test('RSS checks publisher domain, decodes text and refuses unsafe article links',()=>{
 const items=parseReutersFeed(feed(item()+item('Other')+item('Reuters','https://fake-reuters.com')+item('Reuters','https://www.reuters.com','javascript:alert(1)')));
 assert.equal(items.length,1);assert.equal(items[0].title,'Example & news');assert.equal(items[0].publishedAt,'2026-09-24T05:00:00.000Z');
});
test('RSS rejects non-feed, malformed XML and DTDs',()=>{
 for(const input of ['<html/>','<rss>','<!DOCTYPE rss><rss/>'])assert.throws(()=>parseReutersFeed(input));
});
test('symbol normalization preserves markets and rejects URLs and malformed codes',()=>{
 assert.equal(instrument('700.hk').symbol,'00700.HK');assert.equal(instrument('aapl.us').currency,'USD');assert.equal(instrument('600519.SH').ids[0],'1.600519');
 for(const v of ['http://localhost/','AAPL','600519.HK','../AAPL.US'])assert.throws(()=>instrument(v));
});
test('minute adapter validates identity, rejects unusable values and does not invent US timezone',()=>{
 const spec=instrument('AAPL.US');
 const quote=parseMinutes({data:{code:'AAPL',name:'Apple',trends:['2026-09-24 04:00,0,12,0','2026-09-24 04:01,0,NaN,0','2026-09-24 04:02,0,0,0']}},spec);
 assert.equal(quote.points.length,1);assert.equal(quote.providerTimezone,'unverified');assert.equal(quote.lastBarMayBeIncomplete,true);
 assert.throws(()=>parseMinutes({data:{code:'MSFT',trends:[]}},spec));
});
test('duplicate polling keeps first seen, notes and selection; content changes append revisions',()=>{
 const store=openStore(':memory:');try{
 assert.equal(store.ingest([news],'2026-09-24T05:01:00Z').added,1);store.editNews(news.id,{selected:true,note:'Keep this note'});
 assert.deepEqual(store.ingest([news],'2026-09-24T05:02:00Z'),{added:0,updated:0});
 store.ingest([{...news,title:'Correction'}],'2026-09-24T05:03:00Z');
 const row=store.news()[0];assert.equal(row.revision,2);assert.equal(row.firstSeen,'2026-09-24T05:01:00Z');assert.equal(row.note,'Keep this note');assert.equal(row.selected,true);assert.equal(store.revisions(news.id)[1].title,'Test headline');
 }finally{store.close();}
});
test('SQLite records survive reopen; removing a watch preserves its collected history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-store-')),path=join(dir,'test.sqlite');let store=openStore(path);
 try{
 store.ingest([news]);store.editNews(news.id,{read:true,note:'Persistent'});store.addWatch('700.HK');
 store.saveQuote({symbol:'00700.HK',points:[{time:'2026-09-24 14:20',close:400}]});store.close();store=openStore(path);
 assert.equal(store.news()[0].note,'Persistent');assert.equal(store.news()[0].read,true);assert.equal(store.watchlist().length,1);store.removeWatch('00700.HK');assert.equal(store.watchlist().length,0);assert.equal(store.quote('00700.HK').points[0].close,400);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('news edits cannot overwrite evidence or accept string booleans',()=>{
 const store=openStore(':memory:');try{store.ingest([news]);assert.throws(()=>store.editNews(news.id,{title:'tamper'}));assert.throws(()=>store.editNews(news.id,{selected:'false'}));assert.throws(()=>store.setSettings({keywords:'x'.repeat(121)}));}finally{store.close();}
});
test('concurrent RSS refresh deduplicates network requests and respects cooldown',async()=>{
 const store=openStore(':memory:');let calls=0;
 const service=createService(store,{fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return new Response(feed(item()));}});
 try{await Promise.all([service.refreshNews(),service.refreshNews()]);await service.refreshNews();assert.equal(calls,1);assert.equal(store.news().length,1);}finally{store.close();}
});
test('upstream failure preserves old data and records a failed attempt',async()=>{
 const store=openStore(':memory:');store.ingest([news]);const service=createService(store,{fetcher:async()=>{throw new Error('fetch failed');}});
 try{await service.refreshNews();assert.equal(store.news().length,1);assert.equal(store.checks().news.state,'error');assert.equal(store.checks().news.error,'上游连接失败');}finally{store.close();}
});
test('quote polling only fetches watchlist and caches per-symbol attempts',async()=>{
 const store=openStore(':memory:');let calls=0;const service=createService(store,{fetcher:async()=>{calls++;return Response.json({data:{code:'00700',trends:['2026-09-24 14:20,0,437.4,0']}});}});
 try{await service.refreshQuote('00700.HK');assert.equal(calls,0);store.addWatch('700.HK');await Promise.all([service.refreshQuote('00700.HK'),service.refreshQuote('00700.HK')]);assert.equal(calls,1);assert.equal(store.quote('00700.HK').last,437.4);}finally{store.close();}
});
test('HTTP boundary rejects foreign origins, rebinding hosts and non-JSON mutation',async()=>{
 const store=openStore(':memory:'),handler=createHandler(store,createService(store));
 try{
 for(const [headers,code] of [[{host:'evil.example'},403],[{host:'127.0.0.1:4179',origin:'https://evil.example'},403],[{host:'127.0.0.1:4179','content-type':'text/plain'},415]]){
  let actual;await handler({headers,method:'POST',url:'/api/watchlist'},{writeHead:c=>{actual=c;},end:()=>{}});assert.equal(actual,code);
 }
 }finally{store.close();}
});
