import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionFixture} from './helpers/research-conditions-fixture.mjs';
import {researchPriceMaterial,researchPriceUrls} from '../server/research-price-material.mjs';
import {researchObservationSubjects} from '../server/research-observation-subjects.mjs';

const articleUrl='https://example.com/synthetic-research-announcement';
const article=(version,body='Synthetic announcement. No business change has been established.')=>({version,url:articleUrl,title:'Synthetic primary evidence',sourceName:'Synthetic',body:body.repeat(5),scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'Synthetic evidence for condition monitoring'});
function priceMaterial(interval,close,receivedAt){
 const timestamp=Date.parse(interval==='1d'?'2026-10-07T13:30:00Z':'2026-10-07T19:59:00Z')/1000;
 const document={url:researchPriceUrls('NVDA.US',interval).at(-1),receivedAt,body:Buffer.from(JSON.stringify({chart:{result:[{meta:{symbol:'NVDA',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[timestamp],indicators:{quote:[{close:[close],volume:[1000]}]}}]}}))};
 return {...researchPriceMaterial('NVDA.US',interval,document),marketDocuments:[document]};
}
const attachPrice=(f,id,interval,close,at)=>f.service.research.recordPriceSource(id,{version:f.service.research.get(id).version},{symbol:'NVDA.US',interval,status:'saved'},priceMaterial(interval,close,at));
async function make(){
 const f=conditionFixture();let t=f.service.research.saveMaterial(f.topic.id,article(f.topic.version));
 t=attachPrice(f,t.id,'1d',60,'2026-10-08T13:50:00.000Z');t=attachPrice(f,t.id,'1m',60,'2026-10-08T13:50:00.000Z');
 const run=f.service.modelResearch.start(t.id,{version:t.version});await f.service.modelResearch.wait(run.id);t=f.service.modelResearch.adopt(t.id,run.id,{version:t.version});
 const other=f.service.research.create({title:'Another independent research task',summary:'Synthetic independent topic using the same public security.'});f.service.research.addCompany(other.id,{version:other.version,symbol:'NVDA.US',note:'Synthetic shared security'});
 const subject=()=>researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[f.service.research.get(t.id)])[0];
 const checks=()=>f.service.observations.summary().researchChecks.filter(c=>c.subject.id===t.id);
 const hits=()=>f.service.observations.snapshot().items.filter(c=>c.kind==='research-condition'&&c.topicId===t.id);
 return {...f,saved:t,otherId:other.id,subject,checks,hits,observe:()=>f.service.runOperation('observations')};
}

test('another dossier fetching day and minute snapshots cannot invalidate saved research or fabricate a research-change alert',async()=>{
 const f=await make();try{const before=f.service.research.get(f.saved.id),paper=f.service.paper.snapshot();await f.observe();assert(f.subject().fresh);
  for(const interval of ['1d','1m'])attachPrice(f,f.otherId,interval,65,'2026-10-08T13:55:00.000Z');
  const s=f.subject();assert.equal(s.ready,true);assert.equal(s.fresh,true);assert.equal(s.changed,false);
  await f.observe();assert.equal(f.checks().find(c=>c.group==='nextCheck').status,'false');assert.equal(f.checks().find(c=>c.group==='exitCondition').status,'false');
  assert.equal(f.checks().find(c=>c.group==='entryCondition').status,'unknown','archived research prices never substitute for a current monitored quote');assert.equal(f.hits().length,0);
  assert.deepEqual(f.service.research.get(f.saved.id),before);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});

test('a revised announcement still invalidates numeric conditions and triggers research review',async()=>{
 const f=await make();try{attachPrice(f,f.otherId,'1d',65,'2026-10-08T13:55:00.000Z');const other=f.service.research.get(f.otherId);f.service.research.saveMaterial(other.id,article(other.version,'Synthetic announcement revised: the proposed project was cancelled.'));
  assert.equal(f.subject().ready,true);assert.equal(f.subject().fresh,false);assert.equal(f.subject().changed,true);await f.observe();
  assert.equal(f.checks().find(c=>c.group==='nextCheck').status,'true');assert.equal(f.checks().find(c=>c.group==='exitCondition').status,'unknown');assert.equal(f.hits().length,1);
 }finally{await f.close();}
});

for(const damage of ['raw','material'])test(`damaged frozen ${damage} cannot become valid historical price evidence or clear a prior trigger`,async()=>{
 const f=await make();try{f.service.research.update(f.saved.id,{version:f.saved.version,nextEvidence:'Synthetic user research change'});await f.observe();const previous=f.hits();assert.equal(previous.length,1);
  const p=f.saved.researchPrices[0],m=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(p.materialId).payload);
  if(damage==='raw')f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),m.marketSource.source.sha256);
  else f.store.db.prepare('DELETE FROM research_materials WHERE id=?').run(m.id);
  assert.equal(f.subject().ready,false);await f.observe();assert(f.checks().every(c=>c.status==='unknown'));assert.equal(f.checks().find(c=>c.group==='nextCheck').active,true);assert.deepEqual(f.hits(),previous);
 }finally{await f.close();}
});

test('damaged unbound newer price data does not replace or poison the valid frozen basis',async()=>{
 const f=await make();try{const other=attachPrice(f,f.otherId,'1d',65,'2026-10-08T13:55:00.000Z'),m=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(other.researchPrices[0].materialId).payload);
  f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),m.marketSource.source.sha256);
  assert.equal(f.subject().ready,true);assert.equal(f.subject().fresh,true);await f.observe();assert.equal(f.checks().find(c=>c.group==='nextCheck').status,'false');assert.equal(f.hits().length,0);
 }finally{await f.close();}
});
