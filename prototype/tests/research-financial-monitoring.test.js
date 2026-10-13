import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionFixture} from './helpers/research-conditions-fixture.mjs';
import {financialMaterial,SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {financialFilingMaterial,financialExhibitMaterial} from '../server/financial-filing-material.mjs';
import {filingDocuments,filingMap,syntheticFilingHtml,quarterlyUrl} from './helpers/financial-filing-fixture.mjs';
import {researchObservationSubjects} from '../server/research-observation-subjects.mjs';

function bundle({at='2026-10-08T00:00:00.000Z',value=200,extra=false,html=syntheticFilingHtml}={}){
 const facts={cik:1045810,entityName:'NVIDIA CORP',facts:{'us-gaap':{Revenues:{units:{USD:[{val:value,end:'2026-07-26',start:'2026-04-27',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}},...(extra?{unselectedNewDisclosure:'A raw change must not be dismissed as a new receipt'}:{})};
 const documents=[{url:SEC_TICKERS_URL,receivedAt:at,body:Buffer.from(JSON.stringify(filingMap))},{url:secFactsUrl('0001045810'),receivedAt:at,body:Buffer.from(JSON.stringify(facts))}];
 const primary=filingDocuments(html.replace('</body>','<a href="ex99.htm">Synthetic attachment</a></body>')).map(d=>({...d,receivedAt:at}));
 const attachment=[...primary,{url:quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),receivedAt:at,body:Buffer.from(html)}];
 const filingMaterials=[{...financialFilingMaterial('NVDA.US',primary,'0001045810-26-000075'),filingDocuments:primary},{...financialExhibitMaterial('NVDA.US',attachment,'0001045810-26-000075'),filingDocuments:attachment}];
 return {...financialMaterial('NVDA.US',documents),financialDocuments:documents,filingMaterials};
}
function attach(f,id,options){const m=bundle(options),t=f.service.research.get(id);return f.service.research.recordFinancialSource(id,{version:t.version},{symbol:'NVDA.US',status:'saved',filings:m.filingMaterials.map(m=>({url:m.url,status:'saved',...(m.filingSource.exhibit?{kind:'exhibit',parentUrl:quarterlyUrl}:{})}))},m);}
async function make(options){
 const f=conditionFixture();let t=attach(f,f.topic.id,options),run=f.service.modelResearch.start(t.id,{version:t.version});await f.service.modelResearch.wait(run.id);t=f.service.modelResearch.adopt(t.id,run.id,{version:t.version});
 let other=f.service.research.create({title:'Independent synthetic research',summary:'Shared official financial materials, without shared decisions'});other=f.service.research.addCompany(other.id,{version:other.version,symbol:'NVDA.US',note:'Synthetic monitoring test'});
 const subject=()=>researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[f.service.research.get(t.id)])[0];
 return {...f,saved:t,otherId:other.id,subject,observe:()=>f.service.runOperation('observations'),checks:()=>f.service.observations.summary().researchChecks.filter(c=>c.subject.id===t.id),hits:()=>f.service.observations.snapshot().items.filter(c=>c.kind==='research-condition'&&c.topicId===t.id)};
}

test('identical facts, primary filing and exhibit fetched again keep saved conditions current and history immutable',async()=>{
 const f=await make();try{const paper=f.service.paper.snapshot(),old=f.store.db.prepare('SELECT * FROM research_materials').all();await f.observe();attach(f,f.otherId,{at:'2026-10-08T01:00:00.000Z'});
 assert.equal(f.subject().fresh,true);assert.equal(f.subject().changed,false);await f.observe();assert.equal(f.hits().length,0);assert.equal(f.checks().find(c=>c.group==='nextCheck').status,'false');assert.equal(f.checks().find(c=>c.group==='entryCondition').status,'unknown');
 assert.deepEqual(f.service.research.get(f.saved.id),f.saved);assert.deepEqual(f.service.paper.snapshot(),paper);for(const m of old)assert.deepEqual(f.store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(m.id),m);
 }finally{await f.close();}
});
for(const [name,options] of [['financial amendment',{value:250}],['unselected raw disclosure',{extra:true}],['filing text',{html:syntheticFilingHtml.replace('USD 200','USD 300')}]])test(`a changed ${name} remains a real source change`,async()=>{
 const f=await make();try{attach(f,f.otherId,{at:'2026-10-08T01:00:00.000Z',...options});assert.equal(f.subject().ready,true);assert.equal(f.subject().changed,true);assert.equal(f.subject().fresh,false);await f.observe();assert.equal(f.checks().find(c=>c.group==='nextCheck').status,'true');assert.equal(f.hits().length,1);}finally{await f.close();}
});
test('changed selection window is not ignored even with unchanged original bytes',async()=>{
 const f=await make({at:'2026-10-07T00:00:00.000Z'});try{attach(f,f.otherId,{});assert.equal(f.subject().changed,true);}finally{await f.close();}
});
for(const damage of ['raw','material'])test(`unverifiable latest financial ${damage} is unknown and preserves an existing alert`,async()=>{
 const f=await make();try{const t=f.service.research.get(f.saved.id);f.service.research.update(t.id,{version:t.version,nextEvidence:'Synthetic personal change'});await f.observe();const previous=f.hits();assert.equal(previous.length,1);
 const newer=attach(f,f.otherId,{at:'2026-10-08T01:00:00.000Z',extra:true}),id=newer.financialSources[0].materialId,m=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(id).payload);
 if(damage==='raw')f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),m.financialSource.sources[1].sha256);else f.store.db.prepare("UPDATE research_materials SET payload=json_set(payload,'$.body','corrupt') WHERE id=?").run(id);
 assert.equal(f.subject().ready,false);await f.observe();assert(f.checks().every(c=>c.status==='unknown'));assert.equal(f.checks().find(c=>c.group==='nextCheck').active,true);assert.deepEqual(f.hits(),previous);
 }finally{await f.close();}
});
