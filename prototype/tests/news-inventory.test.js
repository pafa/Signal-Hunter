import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {openNewsIntake} from '../server/news-intake.mjs';
import {newsInventory} from '../server/news-inventory.mjs';

const at='2026-10-12T06:00:00.000Z',url='https://www.hkma.gov.hk/eng/news-and-media/press-releases/2026/10/synthetic/';
const item=(id,link=url,extra={})=>({id,url:link,title:'Synthetic announcement',provider:'synthetic',...extra});
test('inventory keeps channel records and revisions while distinguishing repeated links without writes',()=>{
 const s=openStore(':memory:');try{
  s.ingest([item('api',url,{provider:'hkma-api'}),item('rss',url,{provider:'hkma-rss'}),item('attachment','https://example.org/attachment.pdf',{provider:'linked-public-source'})],at);
  s.ingest([item('api',url,{provider:'hkma-api',title:'Corrected synthetic title'})],at);
  const intake=openNewsIntake(s,{clock:()=>at}),before=s.db.prepare('SELECT * FROM news ORDER BY id').all(),changes=s.db.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(intake.snapshot().inventory,{schema:'news-inventory/1',sourceEntries:3,distinctLinks:2,repeatedLinkEntries:1,sharedLinks:1,unresolvedLinkEntries:0});
  assert.equal(s.newsById('api').revision,2);assert.deepEqual(s.db.prepare('SELECT * FROM news ORDER BY id').all(),before);
  assert.equal(s.db.prepare('SELECT total_changes() n').get().n,changes);
 }finally{s.close();}
});
test('inventory does not infer equivalence from similar titles, query strings, fragments or host spellings',()=>{
 const s=openStore(':memory:');try{
  const links=['https://example.org/a','https://example.org/a?v=1','https://example.org/a?v=2','https://example.org/a#section','https://EXAMPLE.org/a','http://example.org/a'];
  s.ingest(links.map((u,i)=>item(String(i),u)),at);
  assert.equal(newsInventory(s.db).distinctLinks,6);assert.equal(newsInventory(s.db).repeatedLinkEntries,0);
 }finally{s.close();}
});
test('missing and unusable links remain unknown, not a single duplicate article, and inventory covers more than a UI page',()=>{
 const s=openStore(':memory:');try{
  assert.deepEqual(newsInventory(s.db),{schema:'news-inventory/1',sourceEntries:0,distinctLinks:0,repeatedLinkEntries:0,sharedLinks:0,unresolvedLinkEntries:0});
  s.ingest([null,null,'','not a link','javascript:alert(1)','https://user:password@example.org/a',17].map((u,i)=>item('bad'+i,u)).concat(Array.from({length:220},(_,i)=>item('n'+i,'https://example.org/'+i))),at);
  const r=newsInventory(s.db);assert.equal(r.sourceEntries,227);assert.equal(r.distinctLinks,220);assert.equal(r.unresolvedLinkEntries,7);assert.equal(r.repeatedLinkEntries,0);
  assert.equal(r.sourceEntries,r.distinctLinks+r.repeatedLinkEntries+r.unresolvedLinkEntries);
 }finally{s.close();}
});
test('existing coverage drawer labels inventory scope, preserves missing old-server values and exposes unknown links',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{
  const {default:Coverage}=await vite.ssrLoadModule('/src/integrated/NewsCoverage.jsx');
  const render=inventory=>renderToStaticMarkup(React.createElement(Coverage,{data:{serverTime:at,newsIntake:{inventory}}}));
  const html=render({sourceEntries:37,distinctLinks:30,repeatedLinkEntries:7,unresolvedLinkEntries:1});
  assert.match(html,/37 条来源记录/);assert.match(html,/30 个不同链接/);assert.match(html,/7 条重复链接记录/);assert.match(html,/1 条链接不明/);assert.match(html,/不是本轮新增、有效文章数或独立证据数/);
  assert.match(html,/<details class="news-coverage"><summary>新闻入口与覆盖记录/);assert.doesNotMatch(render(undefined),/当前新闻库：/);
 }finally{await vite.close();}
});
