import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCollectionWindow} from '../server/news-window.mjs';
const item=(id,publisher='Reuters',date='Thu, 01 Oct 2026 05:00:00 GMT')=>`<item><guid>${id}</guid><title>Company report</title><link>https://news.google.com/rss/articles/${id}</link><pubDate>${date}</pubDate><source url="https://www.reuters.com">${publisher}</source></item>`;
const feed=items=>`<rss><channel>${items}</channel></rss>`;
const start='2026-10-01T00:00:00Z',end='2026-10-01T12:00:00Z';
test('100 raw entries remain capped even when one is filtered out',()=>{const result=parseCollectionWindow(feed(Array.from({length:100},(_,i)=>item(i,i===0?'Other':'Reuters')).join('')),start,end);assert.equal(result.rawCount,100);assert.equal(result.acceptedCount,99);assert.equal(result.rejectedCount,1);assert.equal(result.inWindowCount,99);assert.equal(result.possiblyCapped,true);});
test('accepted and in-window counts remain separate and raw cap is unaffected by timestamp filtering',()=>{const r=parseCollectionWindow(feed(item('a')+item('b','Reuters','Wed, 30 Sep 2026 05:00:00 GMT')+item('c','Other')),start,end);assert.equal(r.rawCount,3);assert.equal(r.acceptedCount,2);assert.equal(r.rejectedCount,1);assert.equal(r.inWindowCount,1);assert.equal(r.items.length,2);assert.equal(r.possiblyCapped,false);assert.throws(()=>parseCollectionWindow(feed(''),end,start));});
