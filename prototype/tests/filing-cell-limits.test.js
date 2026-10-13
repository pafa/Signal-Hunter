import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {articleTableText} from '../server/article-table-text.mjs';
import {financialFilingMaterial,financialExhibitMaterial,verifyFilingDocuments} from '../server/financial-filing-material.mjs';
import {financialDigest} from '../server/financial-source-material.mjs';
import {openStore} from '../server/store.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {filingDocuments,filingIndex,filingAt,syntheticFilingHtml,quarterlyUrl} from './helpers/financial-filing-fixture.mjs';

const accession='0001045810-26-000075';
const table=rows=>'<table>'+Array.from({length:rows},(_,i)=>'<tr>'+Array.from({length:20},(_,j)=>`<td>${i===rows-1&&j===19?'Cash flow USD 987':''}</td>`).join('')+'</tr>').join('')+'</table>';
const large=syntheticFilingHtml.replace('</body>',table(750)+'</body>');
const read=docs=>sha=>docs.find(d=>financialDigest(d.body)===sha)?.body;

test('SEC filings accept 15000 cells with the original coordinates while legacy readers keep their bound',()=>{
 const docs=filingDocuments(large),m=financialFilingMaterial('NVDA.US',docs,accession);
 assert.equal(m.filingSource.schema,'sec-filing-excerpts/3');assert.match(m.body,/r750 c20 td "Cash flow USD 987"/);
 assert.equal(m.filingSource.selection.omittedBlocks,0);assert.deepEqual(verifyFilingDocuments(m,read(docs)),docs);
 assert.throws(()=>financialFilingMaterial('NVDA.US',docs,accession,{generation:1}),/表格结构/);
 const downgrade=structuredClone(m);downgrade.filingSource.schema='sec-filing-excerpts/1';assert.throws(()=>verifyFilingDocuments(downgrade,read(docs)),/表格结构/);
 const dom=new JSDOM('');try{assert.throws(()=>articleTableText(dom.window.document,table(750)),/表格结构/);}finally{dom.window.close();}
});

test('the SEC budget remains capped at 20000 cells and does not relax geometry or malformed spans',()=>{
 const dom=new JSDOM('');try{
  assert.match(articleTableText(dom.window.document,table(1000),{maximumCells:20000}),/r1000 c20 td "Cash flow USD 987"/);
  assert.throws(()=>articleTableText(dom.window.document,table(1000)+'<table><tr><td>Extra</td></tr></table>',{maximumCells:20000}),/表格结构/);
  for(const maximumCells of [0,20001,Infinity,1.5,'20000'])assert.throws(()=>articleTableText(dom.window.document,'<p>Invalid budget</p>',{maximumCells}),/表格结构/);
 }finally{dom.window.close();}
 for(const bad of ['<table><tr><td colspan="257">Bad</td></tr></table>','<table><tr><td rowspan="2">Bad</td></tr></table>'])assert.throws(()=>financialFilingMaterial('NVDA.US',filingDocuments(large.replace('</body>',bad+'</body>')),accession),/表格结构/);
 for(const generation of [0,3,'2',null])assert.throws(()=>financialFilingMaterial('NVDA.US',filingDocuments(),accession,{generation}),/代次/);
});

test('explicit same-filing exhibits share the bounded reader without widening their authorized URLs',()=>{
 const docs=filingDocuments(syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Earnings attachment</a></body>'));
 const attachment={url:quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),receivedAt:filingAt,body:Buffer.from(large)},all=[...docs,attachment];
 const m=financialExhibitMaterial('NVDA.US',all,accession);assert.equal(m.filingSource.schema,'sec-filing-exhibits/3');assert.match(m.body,/r750 c20 td "Cash flow USD 987"/);assert.deepEqual(verifyFilingDocuments(m,read(all)),all);
 assert.throws(()=>financialExhibitMaterial('NVDA.US',all,accession,{generation:1}),/表格结构/);
 assert.throws(()=>financialExhibitMaterial('NVDA.US',[...docs,{...attachment,url:attachment.url.replace('ex99','other')}],accession),/不属于/);
});

test('all old filing and exhibit schemas replay exactly and coexist with new versions in the material archive',()=>{
 const store=openStore(':memory:');try{
  const materials=openMaterials(store.db,{clock:()=>filingAt});
  for(const compatible of [false,true]){
   const index=filingIndex();if(compatible)index.name='NVIDIA CORPORATION';
   const docs=filingDocuments(syntheticFilingHtml.replace('</body>','<a href="ex99.htm">Earnings attachment</a></body>'),index),all=[...docs,{url:quarterlyUrl.replace('nvda-20260726.htm','ex99.htm'),receivedAt:filingAt,body:Buffer.from(syntheticFilingHtml)}];
   for(const [reader,inputs,prefix]of [[financialFilingMaterial,docs,'sec-filing-excerpts'],[financialExhibitMaterial,all,'sec-filing-exhibits']]){
    const old=reader('NVDA.US',inputs,accession,{generation:1}),current=reader('NVDA.US',inputs,accession);
    assert.equal(old.filingSource.schema,`${prefix}/${compatible?2:1}`);assert.equal(current.filingSource.schema,`${prefix}/${compatible?4:3}`);
    assert.deepEqual({...old,filingSource:{...old.filingSource,schema:current.filingSource.schema}},current);
    const history=materials.prepare(`history-${prefix}-${compatible}`,{...old,filingDocuments:inputs},'public-filing');history.persist();const frozen=immutableMaterialSnapshot(store.db,history.material);
    const next=materials.prepare(`history-${prefix}-${compatible}`,{...current,filingDocuments:inputs},'public-filing');next.persist();
    assert.deepEqual(immutableMaterialSnapshot(store.db,history.material),frozen);
    assert.equal(immutableMaterialSnapshot(store.db,next.material).filingSource.schema,current.filingSource.schema);
   }
  }
 }finally{store.close();}
});
