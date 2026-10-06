import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';import {openMaterials} from '../server/research-materials.mjs';
import {openHistoricalRecall,historicalRows} from '../server/historical-recall.mjs';
import {historicalBodyProfile,historicalMaterials,historicalBodyMatch} from '../server/historical-body.mjs';
import {hash} from '../server/providers.mjs';import {createService} from '../server/service.mjs';import {createHandler} from '../server/index.mjs';
const at='2026-10-04T00:00:00Z';
function fixture(){const store=openStore(':memory:'),materials=openMaterials(store.db,{clock:()=>at}),save=(key,body,publishedAt,title='公告更新')=>{const p=materials.prepare('fixture',{title,body,publishedAt,sourceName:'合成来源',scope:'excerpt',url:'https://example.invalid/'+key},'manual');p.persist();return p.material;};return {store,save,history:openHistoricalRecall(store,{now:()=>Date.parse(at)}),close:()=>store.close()};}
const request=revision=>({revision,requestId:randomUUID()});
test('body recall finds older cross-language mechanisms absent from both titles with exact versioned quotations',()=>{
 const f=fixture();try{
  const old=f.save('past','企业简报。诺和诺德治疗肥胖的药物获批。其他事项待补。','2020-01-01'),anchor=f.save('anchor','Quarterly update. FDA approves Eli Lilly obesity drug. Further details unknown.','2026-10-01');
  const report=f.history.freeze('material:'+anchor.id,request(1));assert.equal(report.version,'historical-recall-body/1');assert.equal(report.summary.candidate,1);assert.equal(report.coverage.materials,2);
  const row=report.rows.find(r=>r.status==='candidate');assert.equal(row.newsId,'material:'+old.id);assert.equal(row.sameIssuer,false);assert.equal(row.quotes.anchor.field,'body');assert.equal(row.quotes.candidate.field,'body');
  for(const q of Object.values(row.quotes)){const input=report.inputs.find(i=>i.id===q.inputId);assert.equal(input[q.field].slice(q.start,q.end),q.text);assert.equal(q.revision,input.revision);assert.equal(q.contentScope,'excerpt');}
  assert.equal(report.forwardEligible,false);assert.equal(report.anchor.contentHash,anchor.contentHash);
 }finally{f.close();}
});
test('separate sentences cannot combine an unrelated approval with a medical noun; later and missing dates remain excluded',()=>{
 const f=fixture();try{
  f.save('disjoint','A vaccine study continues. The factory expansion was approved.','2020-01-01');f.save('missing','FDA approves obesity drug.',null);f.save('later','FDA approves obesity drug.','2026-10-02');
  const anchor=f.save('anchor','FDA approves obesity drug.','2026-10-01');const r=f.history.freeze('material:'+anchor.id,request(1));assert.equal(r.summary.candidate,0);assert.equal(r.summary.no_mechanism,1);assert.equal(r.summary.invalid_time,1);assert.equal(r.summary.not_earlier,1);
 }finally{f.close();}
});
test('long body scanning preserves UTF-16 offsets, scans the tail, and never imports metadata as evidence',()=>{
 const body='🧪'+ '无关材料'.repeat(900)+'。FDA approves obesity drug\nA final routine line';
 const profile=historicalBodyProfile({kind:'material',title:'普通公告',body});assert(profile.spans.some(s=>s.text.includes('FDA approves')));for(const s of profile.spans)assert.equal((s.field==='body'?body:'普通公告').slice(s.start,s.end),s.text);
 const atTime={title:'普通公告',publishedAt:'2026-01-01',availableAt:at,firstSeen:at,revision:1};const rows=historicalRows({...atTime,id:'a',kind:'material',body:'FDA approves obesity drug.'},[{...atTime,id:'b',publishedAt:'2020-01-01',publisher:'FDA approves obesity drug.',title:'普通公告'}],at,{body:true});assert.equal(rows[0].status,'no_mechanism');
});
test('latest material revisions replace only future searches and old reports and idempotent retries remain readable',()=>{
 const f=fixture();try{
  const old=f.save('past','FDA approves obesity drug.','2020-01-01'),anchor=f.save('anchor','FDA approves obesity treatment.','2026-10-01'),req=request(1),before=f.history.freeze('material:'+anchor.id,req);
  f.save('past','A routine weather update.','2020-01-01');assert.equal(f.history.freeze('material:'+anchor.id,request(1)).summary.candidate,0);assert.deepEqual(f.history.get('material:'+anchor.id,before.id),before);assert.deepEqual(f.history.freeze('material:'+anchor.id,req),before);
  f.save('anchor','Updated FDA approval for obesity treatment.','2026-10-01');assert.throws(()=>f.history.freeze('material:'+anchor.id,request(1)),/已修订/);assert.throws(()=>f.history.freeze(anchor.id,req),/已用于/);assert.equal(before.inputs.find(i=>i.materialId===old.id).body,old.body);
 }finally{f.close();}
});
test('corrupt material or oversized corpus aborts without creating a partial report',()=>{
 const f=fixture();try{
  const anchor=f.save('anchor','FDA approves obesity drug.','2026-10-01');f.store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run('{}',anchor.id);assert.throws(()=>f.history.freeze('material:'+anchor.id,request(1)));assert.equal(f.history.list('material:'+anchor.id).reports.length,0);
  f.store.db.exec("DELETE FROM research_materials; WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2001) INSERT INTO research_materials SELECT 'id'||x,'doc'||x,1,'{}' FROM n");assert.throws(()=>historicalMaterials(f.store.db),/完整扫描上限/);
 }finally{f.close();}
});
test('material HTTP route keeps the title-only API and saved reports separate and admits news candidates',async()=>{
 const f=fixture(),service=createService(f.store,{mode:'demo',now:()=>Date.parse(at)}),handler=createHandler(f.store,service);
 const call=async(method,url,data)=>{let status,body;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>status=v,end:s=>body=JSON.parse(s)});return {status,body};};
 try{
  const anchor=f.save('anchor','FDA approves obesity drug.','2026-10-01'),old={id:hash('old-news'),title:'FDA approves obesity therapy',url:'https://example.invalid/old-news',publishedAt:'2020-01-01'};f.store.ingest([old],at);
  const r=await call('POST',`/api/materials/${anchor.id}/history-recall`,request(1));assert.equal(r.status,200);assert.equal(r.body.summary.candidate,1);assert.equal(r.body.rows.find(r=>r.status==='candidate').quotes.candidate.field,'title');
  assert.equal((await call('GET',`/api/materials/${anchor.id}/history-recall/${r.body.id}`)).body.hash,r.body.hash);assert.equal((await call('GET',`/api/news/${anchor.id}/history-recall/${r.body.id}`)).status,400);assert.equal((await call('GET',`/api/materials/${anchor.id}/history-recall`)).body.reports.length,1);
 }finally{await service.close();f.close();}
});

 test('fragment and pair budgets reject the whole request rather than silently truncating body recall',()=>{
  assert.throws(()=>historicalBodyProfile({kind:'material',title:'普通公告',body:'短段\n'.repeat(2001)}),/完整扫描上限/);
  const input={title:'FDA approves obesity drug.'},p=historicalBodyProfile(input);
  assert.throws(()=>historicalBodyMatch(input,input,p,p,{remaining:0}),/完整扫描上限/);
 });

test('FDA agency name does not count as a food industry mechanism context',()=>{
 const profile=historicalBodyProfile({title:'公告',kind:'material',body:'Food and Drug Administration approved an obesity drug.'});assert.equal(profile.spans.length,1);assert(!profile.spans[0].profile.facets.some(f=>f.id==='food'));assert(profile.spans[0].profile.facets.some(f=>f.id==='pharma'));
 const food=historicalBodyProfile({title:'Food and Drug Administration recalls food products'});assert(food.spans[0].profile.facets.some(f=>f.id==='food'));
});
