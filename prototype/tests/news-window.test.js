import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCollectionWindow,summarizeCollectionCoverage} from '../server/news-window.mjs';
const item=(id,publisher='Reuters',date='Thu, 01 Oct 2026 05:00:00 GMT')=>`<item><guid>${id}</guid><title>Company report</title><link>https://news.google.com/rss/articles/${id}</link><pubDate>${date}</pubDate><source url="https://www.reuters.com">${publisher}</source></item>`;
const feed=items=>`<rss><channel>${items}</channel></rss>`;
const start='2026-10-01T00:00:00Z',end='2026-10-01T12:00:00Z';
test('100 raw entries remain capped even when one is filtered out',()=>{const result=parseCollectionWindow(feed(Array.from({length:100},(_,i)=>item(i,i===0?'Other':'Reuters')).join('')),start,end);assert.equal(result.rawCount,100);assert.equal(result.acceptedCount,99);assert.equal(result.rejectedCount,1);assert.equal(result.inWindowCount,99);assert.equal(result.possiblyCapped,true);});
test('accepted and in-window counts remain separate and raw cap is unaffected by timestamp filtering',()=>{const r=parseCollectionWindow(feed(item('a')+item('b','Reuters','Wed, 30 Sep 2026 05:00:00 GMT')+item('c','Other')),start,end);assert.equal(r.rawCount,3);assert.equal(r.acceptedCount,2);assert.equal(r.rejectedCount,1);assert.equal(r.inWindowCount,1);assert.equal(r.items.length,2);assert.equal(r.possiblyCapped,false);assert.throws(()=>parseCollectionWindow(feed(''),end,start));});

test('slice boundaries are half-open and returned range includes out-of-window entries',()=>{
 const r=parseCollectionWindow(feed(item('a','Reuters','Wed, 30 Sep 2026 23:59:59 GMT')+item('b','Reuters','Thu, 01 Oct 2026 00:00:00 GMT')+item('c','Reuters','Fri, 02 Oct 2026 00:00:00 GMT')),start,end,{sliceStartAt:start,sliceEndAt:'2026-10-02T00:00:00Z'});
 assert.equal(r.inWindowCount,1);assert.equal(r.outsideWindowCount,2);assert.equal(r.outsideSliceCount,2);assert.equal(r.actualPublishedStartAt,'2026-09-30T23:59:59.000Z');assert.equal(r.actualPublishedEndAt,'2026-10-02T00:00:00.000Z');
});
test('duplicates within and across queries remain distinct from unique samples and failures',()=>{
 const a=parseCollectionWindow(feed(item('a')+item('a')+item('b')),start,end),b=parseCollectionWindow(feed(item('a')+item('c')),start,end);
 const coverage=summarizeCollectionCoverage([{query:a,items:a.items},{query:b,items:b.items},{query:{error:'network failure'},items:[]},{query:parseCollectionWindow(feed(''),start,end),items:[]}]);
 assert.equal(a.duplicateWithinQueryCount,1);assert.equal(coverage.queryCount,4);assert.equal(coverage.successfulQueryCount,3);assert.equal(coverage.failedQueryCount,1);assert.equal(coverage.emptyQueryCount,1);assert.equal(coverage.returnedOccurrences,5);assert.equal(coverage.uniqueReturnedCount,3);assert.equal(coverage.duplicateWithinQueriesCount,1);assert.equal(coverage.duplicateAcrossQueriesCount,1);assert.equal(coverage.coverageStatus,'unverified');assert.equal(coverage.historicalBackfillComplete,false);
});
test('empty accepted feed has unknown range and never proves historical completeness',()=>{
 const r=parseCollectionWindow(feed(item('other','Other')),start,end);assert.equal(r.rawCount,1);assert.equal(r.rejectedCount,1);assert.equal(r.actualPublishedStartAt,null);assert.equal(r.actualPublishedEndAt,null);assert.equal(r.outsideSliceCount,null);assert.equal(summarizeCollectionCoverage([{query:r,items:r.items}]).historicalBackfillComplete,false);
 assert.throws(()=>parseCollectionWindow(feed(''),start,end,{sliceStartAt:start}));assert.throws(()=>parseCollectionWindow(feed(''),start,end,{sliceStartAt:start,sliceEndAt:start}));
});
test('collection CLI persists coverage diagnostics without external acquisition',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=await mkdtemp(join(tmpdir(),'rss-coverage-'));try{
  const preload=join(dir,'fetch.mjs');const xml=feed(item('a')+item('a')+item('outside','Reuters','Fri, 02 Oct 2026 05:00:00 GMT'));
  await writeFile(preload,`globalThis.fetch=async(url)=>{if(new URL(url).searchParams.get('q').includes('after:2026-09-30'))throw new Error('synthetic failure');return new Response(${JSON.stringify(xml)});};`);
  const output=join(dir,'output');await promisify(execFile)(process.execPath,['--import',preload,'scripts/collect-recent-news.mjs','2026-10-01','2026-10-01',output],{cwd:new URL('../',import.meta.url),timeout:15000});
  const saved=JSON.parse(await readFile(join(output,'news.json'),'utf8'));assert.equal(saved.coverage.failedQueryCount,1);assert.equal(saved.coverage.duplicateWithinQueriesCount,1);assert.equal(saved.coverage.outsideWindowCount,1);assert.equal(saved.coverage.outsideSliceCount,1);assert.equal(saved.items.length,1);assert.equal(saved.items[0].queryDays.length,1);assert.equal(saved.queries[1].actualPublishedEndAt,'2026-10-02T05:00:00.000Z');assert.equal(saved.coverage.historicalBackfillComplete,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
