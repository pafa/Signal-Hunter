import test from 'node:test';
import assert from 'node:assert/strict';
import {financialMaterial,financialDigest,verifyFinancialDocuments,SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {financialFilingMaterial,financialExhibitMaterial,verifyFilingDocuments,secSubmissionsUrl} from '../server/financial-filing-material.mjs';
import {secIssuerNameMatch} from '../server/sec-issuer-name.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
import {researchPromptView} from '../server/research-prompt-view.mjs';
import {filingDocuments,filingIndex,filingAt,syntheticFilingHtml,quarterlyUrl} from './helpers/financial-filing-fixture.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';
const map={0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA CORP'}};
const raw=(entityName='Nvidia Corp')=>({cik:1045810,entityName,facts:{'us-gaap':{Revenues:{units:{USD:[{val:200,end:'2026-07-26',start:'2026-01-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}}});
const doc=(url,value)=>({url,receivedAt:filingAt,body:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
const docs=(value=raw())=>[doc(SEC_TICKERS_URL,map),doc(secFactsUrl('0001045810'),value)];
const reader=documents=>sha=>documents.find(x=>financialDigest(x.body)===sha)?.body;
const accession='0001045810-26-000075';

test('same official CIK and ticker accept ASCII letter case while preserving both original names',()=>{
 for(const [name,rule] of [['Nvidia Corp','ascii-case-only'],['nvidia corporation','ascii-case-and-terminal-corp-corporation']]){
  const documents=docs(raw(name)),m=financialMaterial('NVDA.US',documents),proof=m.financialSource.issuerName;
  assert.equal(m.financialSource.schema,'sec-companyfacts-selection/3');assert.equal(proof.schema,'sec-issuer-name/2');assert.equal(proof.rule,rule);assert.equal(proof.mappingName,'NVIDIA CORP');assert.equal(proof.reportedName,name);assert(m.body.includes(`本响应“${name}”`));assert.deepEqual(verifyFinancialDocuments(m,reader(documents)),documents);
 }
 const proof=secIssuerNameMatch('ISABELLA BANK CORP','Isabella Bank Corp');assert.equal(proof.rule,'ascii-case-only');assert.equal(proof.commonName,'ISABELLA BANK CORP');
});

test('case matching cannot repair different identifiers, subsidiaries, whitespace or Unicode lookalikes',()=>{
 for(const name of ['Nvidia Holdings Corp','Nvidia Bank Corp','Nvidia Inc','Nvidia  Corp','Nvidia Corp ','Nvidia Corp /DE/','Nvidıa Corp','Nvidİa Corp','ＮVIDIA CORP','NVIDIA СORP'])assert.throws(()=>financialMaterial('NVDA.US',docs(raw(name))),/名称/);
 assert.throws(()=>financialMaterial('NVDA.US',docs({...raw(),cik:9})),/身份不一致/);
 const wrong=docs();wrong[1].url=secFactsUrl('0000000009');assert.throws(()=>financialMaterial('NVDA.US',wrong),/发行人不符/);
 const duplicate=docs();duplicate[0]=doc(SEC_TICKERS_URL,{...map,1:map[0]});assert.throws(()=>financialMaterial('NVDA.US',duplicate),/不唯一/);
 assert.equal(secIssuerNameMatch('NVIDIA CORP','NVIDIA CORP'),null);assert.equal(secIssuerNameMatch('NVIDIA CORP','NVIDIA CORPORATION').schema,'sec-issuer-name/1');
});

test('case-compatible filings and exhibits use a distinct version and cannot masquerade as old readers',()=>{
 const index={...filingIndex(),name:'Nvidia Corp'},documents=filingDocuments(syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Attachment</a></body>'),index),all=[...documents,doc(quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),syntheticFilingHtml)];
 for(const [build,input,schema] of [[financialFilingMaterial,documents,'sec-filing-excerpts/5'],[financialExhibitMaterial,all,'sec-filing-exhibits/5']]){
  const m=build('NVDA.US',input,accession);assert.equal(m.filingSource.schema,schema);assert.equal(m.filingSource.issuerName.rule,'ascii-case-only');assert.deepEqual(verifyFilingDocuments(m,reader(input)),input);
  assert.throws(()=>build('NVDA.US',input,accession,{generation:1}),/旧申报代次/);
  const altered=structuredClone(m);altered.filingSource.schema=schema.replace('/5','/4');assert.throws(()=>verifyFilingDocuments(altered,reader(input)),/原始响应不符/);
 }
});

test('new name proof survives immutable archive and compact prompt while tampering is rejected',()=>{
 const store=openStore(':memory:');try{
  const documents=docs(),m=financialMaterial('NVDA.US',documents),materials=openMaterials(store.db,{clock:()=>filingAt}),saved=materials.prepare('one',{...m,financialDocuments:documents},'public-financial');saved.persist();assert.equal(immutableMaterialSnapshot(store.db,saved.material).readerVersion,'sec-companyfacts-selection/3');
  const p={inputHash:'fixed',input:{evidence:[{id:'facts',material:saved.material}]}},before=JSON.stringify(p),view=researchPromptView(p),sent=view.input.evidence[0].material;assert.deepEqual(sent.financialSource.issuerName,m.financialSource.issuerName);assert.equal(sent.financialSource.selected,undefined);assert.equal(sent.financialSource.selectedReference.count,m.financialSource.selected.length);assert.equal(sent.body,m.body);assert.equal(view.frozenInputHash,p.inputHash);assert.equal(JSON.stringify(p),before);
  for(const mutate of [x=>x.financialSource.issuerName.reportedName='Other Corp',x=>x.financialSource.issuerName.rule='ignore-case-and-name',x=>x.financialSource.schema='sec-companyfacts-selection/2']){const x=structuredClone(m);mutate(x);assert.throws(()=>verifyFinancialDocuments(x,reader(documents)),/原始响应不符/);}
 }finally{store.close();}
});

test('automatic first research receives case-compatible facts and filing without a manual intervention',async()=>{
 const quote='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。',requests=[],packets=[];
 const f=fixture({fetcher:async url=>{requests.push(url);if(url===quarterlyUrl)return new Response(syntheticFilingHtml,{headers:{'content-type':'text/html'}});return new Response(JSON.stringify(url===SEC_TICKERS_URL?map:url===secSubmissionsUrl('0001045810')?{...filingIndex(),name:'Nvidia Corp'}:raw()));},sourceReader:async url=>({url,title:'合成公告',sourceName:'合成',body:quote+'仅用于财务衔接测试。'.repeat(40),scope:'extracted-text'}),extractionRunner:p=>output(p,'decomposition',{events:[{title:'合成回购',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']}),identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成目录对应'}],scopeNote:'合成',missingEvidence:['历史身份']}),researchRunner:p=>{packets.push(p);return dossier(p);}});
 try{
  f.queue.configure({...f.queue.snapshot().settings,financialSources:true});const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!f.service.research.list().find(t=>t.eventExtraction)?.dossier);
  assert.equal(packets.length,1);assert.deepEqual(requests,[SEC_TICKERS_URL,secFactsUrl('0001045810'),secSubmissionsUrl('0001045810'),quarterlyUrl]);const p=packets[0];assert.equal(p.input.evidence.find(e=>e.material?.financialSource).material.financialSource.schema,'sec-companyfacts-selection/3');assert.equal(p.input.evidence.find(e=>e.material?.filingSource).material.filingSource.schema,'sec-filing-excerpts/5');assert.equal(f.queue.snapshot().events.items.find(j=>j.kind==='dossier').financial.attempts.filter(x=>x.state==='started').length,1);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);
 }finally{await f.close();}
});
