import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfFixture} from './helpers/pdf-fixture.mjs';
import {extractPdf,validatePdfScope} from '../server/pdf-source.mjs';
import {readPublicArticle} from '../server/source-reader.mjs';
import {materialInput,openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
import {sourceQuantities,MAX_LITERAL_SOURCE_TEXT} from '../shared/source-quantities.mjs';
import {financialQuantities,researchFinancialLiteralMatches,FINANCIAL_VALUE_RULES} from '../shared/financial-value-literals.mjs';
import {researchPromptView} from '../server/research-prompt-view.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';

const url='https://ir.acme.com/full-report.pdf',at='2026-10-11T00:00:00Z';
const quote='Acme proposes to acquire Beta subject to approval.';
// Keep the last-page assertions inside the fixture page's visible rectangle.
const context=Array(38).fill('This is synthetic supporting context with no new event.').join('\n');
const pages=Array(40).fill(context);pages[39]+='\n'+quote+'\nThe declared amount is USD 123.00.';
const bytes=pdfFixture(pages);

test('a PDF over 80000 characters keeps every page and the final source literals without truncation',async()=>{
 const m=await extractPdf(bytes,url);assert(m.body.length>80000&&m.body.length<=160000);assert.equal(m.extractionEvidence.pages.length,40);assert.equal(m.method,'public-pdf-2');assert(m.body.indexOf(quote)>80000);assert.equal(m.extractionEvidence.pages.at(-1).end,m.body.length);
 assert.equal(materialInput({...m,url},at).body,m.body);
 assert(sourceQuantities(m.body).some(q=>q.start>80000&&q.raw==='USD 123.00'&&q.normalizedValue==='123'));
 assert(financialQuantities(m.body).some(q=>q.start>80000&&q.unit==='USD'&&q.normalizedValue==='123'));
 assert(researchFinancialLiteralMatches({value:123,citations:[{quote:'USD 123.00'}]},'USD',()=>m.body,{version:FINANCIAL_VALUE_RULES}));
 assert(!researchFinancialLiteralMatches({value:124,citations:[{quote:'USD 123.00'}]},'USD',()=>m.body,{version:FINANCIAL_VALUE_RULES}));
 await assert.rejects(extractPdf(bytes,url,{readerVersion:'public-pdf-1'}),/8万/);
 for(const readerVersion of ['public-pdf-1','public-pdf-3','constructor','__proto__'])assert.throws(()=>validatePdfScope({...m.extractionEvidence,readerVersion},m.body));
 assert.throws(()=>materialInput({title:m.title,sourceName:m.sourceName,body:m.body,url,scope:'user-supplied-text'},at),/80000/);
 for(const scan of [sourceQuantities,financialQuantities])assert.throws(()=>scan('a'.repeat(MAX_LITERAL_SOURCE_TEXT+1)));
});

test('old PDF materials retain their original reader and limits beside the new version',async()=>{
 const small=pdfFixture([quote,'Source value USD 123.00.']);
 const old=await extractPdf(small,url,{readerVersion:'public-pdf-1'}),current=await extractPdf(small,url),store=openStore(':memory:');
 try{
  assert.equal(old.body,current.body);assert.deepEqual({...old.extractionEvidence,readerVersion:'public-pdf-2'},current.extractionEvidence);
  const materials=openMaterials(store.db,{clock:()=>at}),a=materials.prepare('history',{...old,url},'public-web');a.persist();
  const frozen=immutableMaterialSnapshot(store.db,a.material);assert.equal(frozen.readerVersion,'public-pdf-1');
  const b=materials.prepare('history',{...current,url},'public-web');b.persist();assert.equal(b.material.revision,a.material.revision+1);assert.equal(b.material.readerVersion,'public-pdf-2');assert.deepEqual(immutableMaterialSnapshot(store.db,a.material),frozen);
  assert.throws(()=>validatePdfScope({...old.extractionEvidence,bytes:8_000_001},old.body));
  assert.throws(()=>validatePdfScope({...current.extractionEvidence,bytes:16_000_001},current.body));
  assert.throws(()=>materials.prepare('history',{...current,url,sourceDocument:Buffer.from('altered')},'public-web'),/原始文件/);
 }finally{store.close();}
});

test('the complete long PDF reaches automatic decomposition, identity and dossier input including tail quotes',async()=>{
 const seen={extract:false,identity:false,dossier:false};
 const f=fixture({sourceReader:u=>readPublicArticle(u,{resolver:async()=>[{address:'93.184.216.34'}],request:async()=>({status:200,headers:{'content-type':'application/pdf'},body:bytes})}),
  extractionRunner:p=>{seen.extract=p.input.material.body.indexOf(quote)>80000;return output(p,'decomposition',{events:[{title:'Acme proposed acquisition',actor:'Acme',action:'proposes to acquire',object:'Beta',stage:'pending approval',eventTime:'未知',quote,quoteField:'body',boundaryReason:'single matter',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'Synthetic complete text-layer pipeline test',missingEvidence:['Check original approval']});},
  identityRunner:p=>{seen.identity=p.input.material.body.indexOf(quote)>80000;return output(p,'resolution',{mentions:[],scopeNote:'Synthetic identity remains unknown',missingEvidence:['Confirmed security identity']});},
  researchRunner:p=>{const material=p.input.evidence.find(e=>e.material?.extractionEvidence?.readerVersion==='public-pdf-2')?.material;seen.dossier=material?.body.indexOf(quote)>80000;assert.equal(researchPromptView(p).input.evidence.find(e=>e.material?.id===material.id).material.body,material.body);assert(p.input.quantityEvidence.items.some(q=>q.raw==='USD 123.00'&&q.start>80000));return dossier(p);}
 });
 try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!f.service.research.list().find(t=>t.eventExtraction)?.dossier);assert.deepEqual(seen,{extract:true,identity:true,dossier:true});assert.equal(f.calls.dossier,1);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);}finally{await f.close();}
});
