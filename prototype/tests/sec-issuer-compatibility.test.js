import test from 'node:test';
import assert from 'node:assert/strict';
import {financialMaterial,financialDigest,verifyFinancialDocuments,SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {financialFilingMaterial,financialExhibitMaterial,verifyFilingDocuments,filingPlan,secSubmissionsUrl} from '../server/financial-filing-material.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {researchPromptView} from '../server/research-prompt-view.mjs';
import {secIssuerNameMatch} from '../server/sec-issuer-name.mjs';
import {openStore} from '../server/store.mjs';
import {filingDocuments,filingIndex,filingAt,syntheticFilingHtml,quarterlyUrl} from './helpers/financial-filing-fixture.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';

const map={0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA CORP'}};
const facts=(name='NVIDIA CORPORATION')=>({cik:1045810,entityName:name,facts:{'us-gaap':{Revenues:{units:{USD:[{val:200,end:'2026-07-26',start:'2026-01-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}}});
const doc=(url,raw)=>({url,receivedAt:filingAt,body:Buffer.from(typeof raw==='string'?raw:JSON.stringify(raw))});
const documents=(raw=facts())=>[doc(SEC_TICKERS_URL,map),doc(secFactsUrl('0001045810'),raw)];
const read=docs=>sha=>docs.find(d=>financialDigest(d.body)===sha)?.body;
const accession='0001045810-26-000075';
const compatibleFilings=()=>{const index=filingIndex();index.name='NVIDIA CORPORATION';return filingDocuments(syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Synthetic attachment</a></body>'),index);};

test('same CIK suffix compatibility saves both original names and a versioned auditable rule',()=>{
 for(const name of ['NVIDIA CORPORATION','NVIDIA CORP.']){
  const docs=documents(facts(name)),m=financialMaterial('NVDA.US',docs);
  assert.equal(m.financialSource.schema,'sec-companyfacts-selection/2');
  assert.deepEqual(m.financialSource.issuerName,{schema:'sec-issuer-name/1',rule:'terminal-corp-corporation',mappingName:'NVIDIA CORP',reportedName:name,commonStem:'NVIDIA'});
  assert.match(m.body,/证券映射“NVIDIA CORP”/);assert(m.body.includes(`本响应“${name}”`));
  assert.deepEqual(verifyFinancialDocuments(m,read(docs)),docs);
 }
 assert.equal(secIssuerNameMatch('MICROSOFT CORPORATION','MICROSOFT CORP').commonStem,'MICROSOFT');
});

test('CIK, official endpoint, ticker uniqueness and different issuer names still reject',()=>{
 for(const name of ['OTHER CORPORATION','NVIDIA HOLDINGS CORPORATION','NVIDIA','NVIDIA INC','NVIDIA CORPORATION /DE/','NVIDIA  CORPORATION','NVIDIA CORPORATION /MI/',null,'',' '.repeat(161)])
  assert.throws(()=>financialMaterial('NVDA.US',documents(facts(name))),/发行人名称/);
 const mismatch=documents({...facts(),cik:9});assert.throws(()=>financialMaterial('NVDA.US',mismatch),/身份不一致/);
 const url=documents();url[1].url=secFactsUrl('0000000009');assert.throws(()=>financialMaterial('NVDA.US',url),/发行人不符/);
 const duplicate=documents();duplicate[0]=doc(SEC_TICKERS_URL,{...map,1:map[0]});assert.throws(()=>financialMaterial('NVDA.US',duplicate),/不唯一/);
 const wrongSource=documents();wrongSource[0].url='https://example.com/tickers.json';assert.throws(()=>financialMaterial('NVDA.US',wrongSource),/来源不符/);
});

test('compatible filings and explicitly linked exhibits carry the same immutable issuer proof',()=>{
 const docs=compatibleFilings(),primary=financialFilingMaterial('NVDA.US',docs,accession),all=[...docs,doc(quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),syntheticFilingHtml)],exhibit=financialExhibitMaterial('NVDA.US',all,accession);
 assert.equal(primary.filingSource.schema,'sec-filing-excerpts/4');assert.equal(exhibit.filingSource.schema,'sec-filing-exhibits/4');assert.deepEqual(exhibit.filingSource.issuerName,primary.filingSource.issuerName);
 for(const [m,ds] of [[primary,docs],[exhibit,all]]){
  assert.match(m.body,/本响应“NVIDIA CORPORATION”/);assert.deepEqual(verifyFilingDocuments(m,read(ds)),ds);
  const store=openStore(':memory:');try{const materials=openMaterials(store.db,{clock:()=>filingAt}),saved=materials.prepare('test',{...m,filingDocuments:ds},'public-filing');saved.persist();assert.equal(immutableMaterialSnapshot(store.db,saved.material).readerVersion,m.filingSource.schema);}finally{store.close();}
  const changed=structuredClone(m);changed.filingSource.issuerName.reportedName='OTHER CORPORATION';assert.throws(()=>verifyFilingDocuments(changed,read(ds)),/选段与原始响应不符/);
  const downgraded=structuredClone(m);downgraded.filingSource.schema=downgraded.filingSource.schema.replace('/4','/3');delete downgraded.filingSource.issuerName;assert.throws(()=>verifyFilingDocuments(downgraded,read(ds)),/选段与原始响应不符/);
 }
 for(const patch of [{cik:'9'},{tickers:['MSFT']},{name:'OTHER CORPORATION'}]){
  const raw={...filingIndex(),name:'NVIDIA CORPORATION',...patch};assert.throws(()=>filingPlan(primary.filingSource.issuer,doc(secSubmissionsUrl('0001045810'),raw)));
 }
});

test('exact-name accepted materials keep issuer metadata unchanged under the current filing reader',()=>{
 const m=financialMaterial('NVDA.US',documents(facts('NVIDIA CORP'))),filing=financialFilingMaterial('NVDA.US',filingDocuments(),accession);
 assert.equal(m.financialSource.schema,'sec-companyfacts-selection/1');assert.equal(filing.filingSource.schema,'sec-filing-excerpts/3');
 for(const [body,source] of [[m.body,m.financialSource],[filing.body,filing.filingSource]]){assert(!body.includes('发行人名称核对'));assert(!Object.hasOwn(source,'issuerName'));}
 // Full historic byte-for-byte reproduction is additionally checked against the saved public batch.
});

test('new material survives archive reads, retains proof in the compact prompt and rejects altered originals',()=>{
 const store=openStore(':memory:');try{
  const docs=documents(),m=financialMaterial('NVDA.US',docs),materials=openMaterials(store.db,{clock:()=>filingAt}),p=materials.prepare('test',{...m,financialDocuments:docs},'public-financial');p.persist();
  assert.equal(immutableMaterialSnapshot(store.db,p.material).readerVersion,'sec-companyfacts-selection/2');
  const packet={inputHash:'frozen',input:{evidence:[{id:'financial',material:p.material}]}},before=JSON.stringify(packet),view=researchPromptView(packet),source=view.input.evidence[0].material.financialSource;
  assert.equal(source.selected,undefined);assert.equal(source.selectedReference.count,1);assert.deepEqual(source.issuerName,m.financialSource.issuerName);assert.equal(JSON.stringify(packet),before);
  const altered=structuredClone(m);altered.financialSource.issuerName.rule='ignore-name';assert.throws(()=>verifyFinancialDocuments(altered,read(docs)),/选摘与原始响应不符/);
  const downgrade=structuredClone(m);downgrade.financialSource.schema='sec-companyfacts-selection/1';delete downgrade.financialSource.issuerName;assert.throws(()=>verifyFinancialDocuments(downgrade,read(docs)),/选摘与原始响应不符/);
  store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),financialDigest(docs[1].body));assert.throws(()=>immutableMaterialSnapshot(store.db,p.material),/原始响应校验失败/);
 }finally{store.close();}
});

test('automatic preparation includes both compatible facts and filing in the first frozen dossier without human work',async()=>{
 const quote='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。',requests=[],packets=[];
 const f=fixture({fetcher:async url=>{requests.push(url);if(url===quarterlyUrl)return new Response(syntheticFilingHtml,{headers:{'content-type':'text/html'}});const index={...filingIndex(),name:'NVIDIA CORPORATION'};return new Response(JSON.stringify(url===SEC_TICKERS_URL?map:url===secSubmissionsUrl('0001045810')?index:facts()));},
  sourceReader:async url=>({url,title:'合成回购公告',sourceName:'合成',body:quote+'仅用于财务衔接测试。'.repeat(40),scope:'extracted-text'}),
  extractionRunner:p=>output(p,'decomposition',{events:[{title:'NVIDIA合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote,quoteField:'body',boundaryReason:'具体回购事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']}),
  identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成冻结别名'}],scopeNote:'合成',missingEvidence:['历史身份']}),
  researchRunner:p=>{packets.push(p);return dossier(p);}});
 try{
  f.queue.configure({...f.queue.snapshot().settings,financialSources:true});const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!f.service.research.list().find(t=>t.eventExtraction)?.dossier);
  const t=f.service.research.list().find(t=>t.eventExtraction),p=packets[0];assert.equal(packets.length,1);assert.equal(t.financialSources[0].status,'saved');
  assert.deepEqual(requests,[SEC_TICKERS_URL,secFactsUrl('0001045810'),secSubmissionsUrl('0001045810'),quarterlyUrl]);
  assert.equal(p.input.evidence.find(e=>e.material?.financialSource).material.financialSource.schema,'sec-companyfacts-selection/2');assert.equal(p.input.evidence.find(e=>e.material?.filingSource).material.filingSource.schema,'sec-filing-excerpts/4');
  const job=f.queue.snapshot().events.items.find(j=>j.kind==='dossier');assert.equal(job.financial.attempts.filter(a=>a.state==='started').length,1);
  await f.drive(6);assert.equal(requests.length,4);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
 }finally{await f.close();}
});
