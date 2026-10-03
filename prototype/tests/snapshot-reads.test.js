import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {createService} from '../server/service.mjs';

const at='2026-10-03T09:00:00Z';
const item=(id,title='Synthetic regulatory approval')=>({id,title,publisher:'Synthetic fixture',url:'https://example.test/'+encodeURIComponent(id),publishedAt:'2026-09-20T08:00:00Z'});
function previousNewsProjection(store){
 return store.db.prepare('SELECT * FROM news ORDER BY last_seen DESC LIMIT 500').all().map(row=>({...JSON.parse(row.payload),firstSeen:row.first_seen,articleFirstSeen:row.first_seen,revisionFirstSeen:store.db.prepare('SELECT received_at FROM revisions WHERE news_id=? AND version=?').get(row.id,row.revision)?.received_at||null,lastSeen:row.last_seen,revision:row.revision,selected:!!row.selected,read:!!row.read,note:row.note})).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
}

test('batched news receipts preserve list order, bounds, individual records and missing-revision uncertainty',()=>{
 const store=openStore(':memory:');
 try{
  store.ingest(Array.from({length:503},(_,i)=>item(i===0?'quote\'中文':`n-${i}`)),at);
  store.ingest([item('n-502','Synthetic revised report')],'2026-10-03T10:00:00Z');
  store.editNews('n-1',{read:true,selected:true,note:'Retain note'});
  store.db.prepare('DELETE FROM revisions WHERE news_id=?').run('n-2');
  const expected=previousNewsProjection(store),actual=store.news();
  assert.equal(actual.length,500);assert.deepEqual(actual,expected);
  for(const news of actual)assert.deepEqual(store.newsById(news.id),news);
  assert.equal(store.newsById('n-2').revisionFirstSeen,null);
  assert.equal(store.newsById('n-502').revisionFirstSeen,'2026-10-03T10:00:00Z');
  assert.equal(store.newsById('n-502').articleFirstSeen,at);assert.equal(store.newsById('absent'),null);
  assert.equal(store.revisions('n-502').length,2);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM news').get().n,503);
 }finally{store.close();}
});

test('snapshot reads only matching current triage; superseded rules and revisions remain stored',()=>{
 const store=openStore(':memory:'),research=openResearch(store,{seed:false,clock:()=>at});
 try{
  store.ingest([item('a'),item('b'),item('c')],at);research.process();
  const activeKey=store.db.prepare('SELECT rules_version FROM triage LIMIT 1').get().rules_version;
  const insert=store.db.prepare('INSERT INTO triage VALUES(?,?,?,?,?)');
  for(let i=0;i<600;i++)insert.run('history-'+i,1,activeKey,'{"bucket":"quiet"}',at);
  insert.run('a',2,'obsolete-rules','{"bucket":"quiet"}',at);
  store.ingest([item('a','Synthetic changed report')],'2026-10-03T10:00:00Z');
  const before=store.db.prepare('SELECT * FROM triage ORDER BY news_id,news_revision,rules_version').all();
  const prepare=store.db.prepare.bind(store.db);let rowsRead=0;
  store.db.prepare=sql=>{
   const statement=prepare(sql);
   if(/\btriage\b/i.test(sql)){const all=statement.all.bind(statement);statement.all=(...args)=>{const rows=all(...args);rowsRead+=rows.filter(row=>'news_id' in row&&'news_revision' in row&&'rules_version' in row).length;return rows;};}
   return statement;
  };
  const snapshot=research.snapshot();
  assert.equal(rowsRead,2);assert.equal(snapshot.inbox.find(n=>n.id==='a').triage.bucket,'pending');assert.equal(snapshot.inbox.find(n=>n.id==='a').processedAt,null);
  for(const id of ['b','c'])assert.deepEqual(snapshot.inbox.find(n=>n.id===id).triage,JSON.parse(prepare('SELECT payload FROM triage WHERE news_id=? AND news_revision=1 AND rules_version=?').get(id,activeKey).payload));
  assert.deepEqual(prepare('SELECT * FROM triage ORDER BY news_id,news_revision,rules_version').all(),before);
  research.process();const refreshed=research.snapshot();assert.notEqual(refreshed.inbox.find(n=>n.id==='a').triage.bucket,'pending');
  assert.ok(prepare('SELECT 1 FROM triage WHERE news_id=? AND news_revision=1 AND rules_version=?').get('a',activeKey));
  assert.equal(store.revisions('a').length,2);
 }finally{store.close();}
});

test('service reuses reads only within one response and observes changes on the next request',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:()=>{throw new Error('No network in test');}});
 try{
  store.ingest([item('a')],at);service.research.process();
  const topic=service.research.create({title:'Synthetic research',summary:'Original hypothesis'});
  const originalNews=store.news,originalList=service.research.list;let newsReads=0,topicReads=0;
  store.news=()=>{newsReads++;return originalNews();};service.research.list=()=>{topicReads++;return originalList();};
  const first=service.snapshot();assert.equal(newsReads,1);assert.equal(topicReads,1);
  first.news[0].note='Caller-only mutation';first.research.topics[0].title='Caller-only title';
  store.editNews('a',{note:'Saved note'});store.ingest([item('a','Revised current headline')],'2026-10-03T10:00:00Z');
  const next=service.snapshot();assert.equal(newsReads,2);assert.equal(topicReads,2);
  assert.equal(next.news[0].note,'Saved note');assert.equal(next.news[0].title,'Revised current headline');assert.equal(next.research.inbox[0].triage.bucket,'pending');
  assert.equal(next.research.topics.find(t=>t.id===topic.id).title,'Synthetic research');assert.equal(next.research.inbox[0].revisionFirstSeen,'2026-10-03T10:00:00Z');
  assert.equal(store.revisions('a').length,2);assert.equal(service.research.history(topic.id).length,1);
  assert.deepEqual(next.paper,first.paper);
 }finally{await service.close();store.close();}
});

test('empty research snapshot keeps pending/count projections empty',()=>{
 const store=openStore(':memory:'),research=openResearch(store,{seed:false,clock:()=>at});
 try{const value=research.snapshot();assert.deepEqual(value.topics,[]);assert.deepEqual(value.inbox,[]);assert.deepEqual(value.counts,{pending:0,review:0,clue:0,quiet:0});}finally{store.close();}
});
