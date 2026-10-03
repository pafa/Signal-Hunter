import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {buildEvaluationBaseline} from '../server/evaluation-baseline.mjs';
import {digest} from '../server/codex-research.mjs';
import {forwardEligibility,EVALUATION_VERSION} from '../shared/evaluation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),at='2026-10-03T00:00:00Z';
const record=(b,patch={})=>({topicId:'new-topic',clusterId:'new-cluster',clusterReviewedAt:'2026-10-04T00:02:00Z',clusterMembers:[{kind:'news',id:'new-news',revision:1}],origin:'forward-capture',firstSeen:'2026-10-04T00:00:00Z',availableAt:'2026-10-04T00:00:00Z',decisionAt:'2026-10-04T00:03:00Z',inputHash:'frozen-input',rulesHash:b.rulesHash,...patch});
async function fixture(){
 const store=openStore(':memory:'),service=createService(store,{mode:'research',now:()=>Date.parse(at),modelConfig:{binary:'/test/codex',model:'fixture'},semanticRunner:async p=>{
  const fields=s=>({actor:'合成',action:'拟收购',object:'合成业务',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'尚需核对',quote:p.input[s].title});
  const comparison={relation:'followup',left:fields('left'),right:fields('right'),reason:'仅合成流程',missingEvidence:['真实公告']},rawOutput=JSON.stringify(comparison);
  return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:'fixture',inputHash:p.inputHash,outputHash:digest(rawOutput)}};
 }});
 const news=Array.from({length:4},(_,i)=>({id:'seen-'+i,title:'合成公告'+i,url:'https://example.com/'+i,publisher:'合成',publishedAt:at}));store.ingest(news,at);
 const make=async inputs=>{const p=service.semanticBatches.preview({inputs}),batch=service.semanticBatches.create({inputs,planHash:p.planHash,requestId:randomUUID()});service.semanticBatches.step({assertActive(){}});await service.semanticEvents.wait(service.semanticBatches.get(batch.id).items[0].runId);const g=service.eventClusters.preview(batch.id).groups[0];return service.eventClusters.save({batchId:batch.id,groupId:g.id,previewHash:g.hash,clusterId:'',version:0,title:'合成簇',note:'测试确认',requestId:randomUUID()});};
 return {store,service,news,make,async close(){await service.close();store.close();}};
}
test('baseline freezes active and archived cluster identity/history even after archived memberships are released',async()=>{
 const f=await fixture();try{
  const active=await f.make(f.news.slice(0,2).map(n=>({id:n.id,revision:1}))),archived=await f.make(f.news.slice(2).map(n=>({id:n.id,revision:1})));
  f.service.eventClusters.archive(archived.id,{version:1,note:'历史仍保留',requestId:randomUUID()});
  const before=f.store.db.prepare('SELECT * FROM event_cluster_versions ORDER BY cluster_id,version').all();
  const baseline=buildEvaluationBaseline(f.store.db,root,{frozenAt:at});
  assert.equal(baseline.protocolVersion,EVALUATION_VERSION);
  for(const id of [active.id,archived.id]){assert.ok(baseline.excludedClusterIds.includes(id));assert.equal(forwardEligibility(record(baseline,{clusterId:id}),baseline).eligible,false);}
  assert.deepEqual(baseline.eventClusterSnapshots.event_cluster_versions,before);
  assert.equal(baseline.eventClusterSnapshots.event_cluster_members.length,2);
  assert.equal(baseline.eventClusterSnapshots.event_clusters.length,2);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM event_cluster_versions ORDER BY cluster_id,version').all(),before);
  for(const n of f.news)assert.ok(baseline.excludedEvidenceKeys.includes('news:'+n.id));
  f.service.eventClusters.archive(active.id,{version:1,note:'冻结后改变不回写',requestId:randomUUID()});
  assert.deepEqual(baseline.eventClusterSnapshots.event_cluster_versions,before);
 }finally{await f.close();}
});
test('new cluster IDs cannot launder previously seen news, revised materials or event identities',async()=>{
 const f=await fixture();try{
  let t=f.service.research.create({title:'旧材料',summary:'仅合成测试'});
  const save=body=>{t=f.service.research.saveMaterial(t.id,{version:t.version,title:'旧材料',sourceName:'合成',url:'https://example.com/material',body,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'测试'});return f.service.research.materialList(t.id).materials[0];};
  const old=save('旧正文'),revised=save('修订正文');assert.equal(old.documentId,revised.documentId);
  const b=buildEvaluationBaseline(f.store.db,root,{frozenAt:at});
  assert.equal(forwardEligibility(record(b),b).eligible,true);
  for(const m of [{kind:'news',id:f.news[0].id,revision:99},{kind:'material',id:'new-revision',documentId:old.documentId,revision:99},{kind:'event',id:'new-split',documentId:old.documentId,revision:1},{kind:'event',id:t.id,documentId:'new-document',revision:1}]){
   const verdict=forwardEligibility(record(b,{clusterMembers:[m]}),b);assert.equal(verdict.eligible,false,JSON.stringify(m));assert.ok(verdict.reasons.some(r=>r.includes('已见材料')));
  }
 }finally{await f.close();}
});
test('new protocol rejects old or incomplete exclusions and absent, malformed or duplicate member identity',async()=>{
 const f=await fixture();try{
  const b=buildEvaluationBaseline(f.store.db,root,{frozenAt:at}),r=record(b);
  for(const patch of [{protocolVersion:'forward-research/0.2.0'},{excludedEvidenceKeys:undefined},{excludedEvidenceKeys:[null]}])assert.equal(forwardEligibility(r,{...b,...patch}).eligible,false);
  for(const members of [undefined,[],[{}],[{kind:'material',id:'x',revision:1}],[{kind:'event',id:'x',revision:1}],[{kind:'news',id:'x',revision:0}],[{kind:'bogus',id:'x',revision:1}],r.clusterMembers.concat(r.clusterMembers)])assert.equal(forwardEligibility({...r,clusterMembers:members},b).eligible,false,JSON.stringify(members));
 }finally{await f.close();}
});

test('retired event and document identities remain excluded from immutable older membership versions',async()=>{
 const f=await fixture();try{
  // Synthetic legacy snapshots exercise identity retention, not semantic truth.
  const one={id:'history-cluster',version:1,status:'active',members:[{kind:'event',id:'retired-event',documentId:'retired-document',revision:1}]};
  const two={...one,version:2,members:[{kind:'event',id:'replacement-event',documentId:'replacement-document',revision:1}]};
  const payload=r=>JSON.stringify({...r,snapshotHash:digest(r)});
  f.store.db.prepare('INSERT INTO event_clusters VALUES(?,?,?,?)').run(two.id,2,'active',payload(two));
  for(const r of [one,two])f.store.db.prepare('INSERT INTO event_cluster_versions VALUES(?,?,?)').run(r.id,r.version,payload(r));
  f.store.db.prepare('INSERT INTO event_cluster_members VALUES(?,?)').run('event:replacement-event',two.id);
  const b=buildEvaluationBaseline(f.store.db,root,{frozenAt:at});
  assert.ok(b.excludedEvidenceKeys.includes('event:retired-event'));assert.ok(b.excludedEvidenceKeys.includes('material:retired-document'));
  assert.equal(forwardEligibility(record(b,{clusterMembers:[{kind:'material',id:'fresh-snapshot',documentId:'retired-document',revision:3}]}),b).eligible,false);
 }finally{await f.close();}
});
test('damaged or incomplete cluster storage cannot silently freeze an incomplete exclusion list',async()=>{
 for(const mode of ['partial-schema','hash','history','assignment']){
  const f=await fixture();try{
   const saved=await f.make(f.news.slice(0,2).map(n=>({id:n.id,revision:1})));
   if(mode==='partial-schema')f.store.db.exec('DROP TABLE event_cluster_versions');
   if(mode==='hash')f.store.db.prepare('UPDATE event_clusters SET payload=? WHERE id=?').run('{}',saved.id);
   if(mode==='history')f.store.db.prepare('DELETE FROM event_cluster_versions WHERE cluster_id=?').run(saved.id);
   if(mode==='assignment')f.store.db.prepare('DELETE FROM event_cluster_members WHERE cluster_id=?').run(saved.id);
   assert.throws(()=>buildEvaluationBaseline(f.store.db,root,{frozenAt:at}),/事件簇/);
  }finally{await f.close();}
 }
});
