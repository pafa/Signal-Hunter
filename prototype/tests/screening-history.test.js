import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {openScreeningSamples} from '../server/screening-samples.mjs';
import {screeningSamplePage} from '../server/screening-history.mjs';
import {createHandler} from '../server/index.mjs';
import {createService} from '../server/service.mjs';
const id=createHash('sha256').update('synthetic history').digest('hex'),otherId=createHash('sha256').update('other history').digest('hex'),at='2026-10-04T00:00:00Z';
function fixture(){const store=openStore(':memory:'),samples=openScreeningSamples(store.db,{clock:()=>at});const capture=(revision,newsId=id,time=at)=>samples.capture({id:newsId,revision,title:'Synthetic title '+revision,url:'https://example.test/history',publisher:'Synthetic',publishedAt:at,articleFirstSeen:at,revisionFirstSeen:at},{bucket:'quiet'},time);return {store,samples,capture,page:p=>screeningSamplePage(store.db,id,samples.rulesHash,p)};}
test('all history pages preserve timestamp ordering and ties, without losing rows when new samples arrive',()=>{
 const f=fixture();try{
  for(let v=1;v<=31;v++)f.capture(v);const original=f.store.db.prepare('SELECT * FROM screening_samples ORDER BY rowid').all();
  const first=f.page();assert.equal(first.total,31);assert.deepEqual(first.samples,f.samples.packet(id).samples);assert.equal(first.samples.length,12);
  f.capture(32);f.capture(33,id,'2026-09-01T00:00:00Z');
  const all=[...first.samples];let cursor=first.nextCursor;
  while(cursor){const p=f.page({before:cursor,ceiling:first.ceiling});assert.equal(p.total,31);all.push(...p.samples);cursor=p.nextCursor;}
  assert.deepEqual(all.map(s=>s.input.revision),Array.from({length:31},(_,i)=>31-i));assert.equal(new Set(all.map(s=>s.id)).size,31);
  const fresh=f.page();assert.equal(fresh.total,33);assert.equal(fresh.samples[0].input.revision,32);
  const refreshed=f.page({ceiling:first.ceiling});assert.deepEqual(refreshed,first);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM screening_samples ORDER BY rowid LIMIT 31').all(),original);
 }finally{f.store.close();}
});
test('old-page reviews refresh independently of the fixed sample range; invalid and foreign cursors cannot cross news',()=>{
 const f=fixture();try{
  for(let v=1;v<=14;v++)f.capture(v);f.capture(1,otherId);const first=f.page(),query={before:first.nextCursor,ceiling:first.ceiling},old=f.page(query).samples[0];
  f.samples.review({sampleId:old.id,version:0,verdict:'unclear',scope:'headline-only',note:'Review original title'});
  const second=f.page(query);assert.equal(second.total,14);assert.equal(second.nextCursor,null);assert.equal(second.samples[0].reviews[0].note,'Review original title');assert.equal(second.samples[0].input.title,'Synthetic title 2');
  const foreign=f.store.db.prepare('SELECT id FROM screening_samples WHERE news_id=?').get(otherId).id;
  for(const p of [{offset:12},{before:first.nextCursor},{before:foreign,ceiling:99},{before:'f'.repeat(64),ceiling:first.ceiling},{before:'',ceiling:0},{ceiling:''},{ceiling:'1e1'},{ceiling:'-1'},{ceiling:Number.MAX_SAFE_INTEGER+1}])assert.throws(()=>f.page(p),/分页参数/);
  assert.equal(f.page({ceiling:0}).samples.length,0);
 }finally{f.store.close();}
});
test('HTTP exposes complete paginated samples while retaining the default response and read-only behavior',async()=>{
 const f=fixture(),service=createService(f.store,{mode:'research'}),handler=createHandler(f.store,service);
 const call=async query=>{let status,body;await handler({method:'GET',url:`/api/news/${id}/screening${query}`,headers:{host:'127.0.0.1:4179'}},{writeHead:s=>{status=s;},end:b=>{body=JSON.parse(b);}});return {status,body};};
 try{
  for(let v=1;v<=13;v++)f.capture(v);const before=f.samples.stats(),first=await call('');assert.equal(first.status,200);assert.equal(first.body.samples.length,12);assert.equal(first.body.currentRulesHash,f.samples.rulesHash);
  const last=await call('?'+new URLSearchParams({before:first.body.nextCursor,ceiling:first.body.ceiling}));assert.equal(last.status,200);assert.equal(last.body.samples[0].input.revision,1);assert.equal(last.body.nextCursor,null);
  assert.equal((await call('?ceiling=bad')).status,400);assert.deepEqual(f.samples.stats(),before);
 }finally{await service.close();f.store.close();}
});
