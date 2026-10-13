import test from 'node:test';
import assert from 'node:assert/strict';
import {filingPlan,financialFilingMaterial,verifyFilingDocuments,filingExhibitPlan,financialExhibitMaterial,FINANCIAL_EXHIBIT_VERSION} from '../server/financial-filing-material.mjs';
import {secIssuer,financialDigest} from '../server/financial-source-material.mjs';
import {openStore} from '../server/store.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {filingDocuments,filingIndex,filingAt,syntheticFilingHtml} from './helpers/financial-filing-fixture.mjs';
const accession='0001045810-26-000075';
test('filing plan binds issuer, recent index, exact primary path and third-party accession without guessing older filings',()=>{
 const d=filingDocuments(syntheticFilingHtml,filingIndex({both:true})),issuer=secIssuer('NVDA.US',d[0].body),p=filingPlan(issuer,d[1]);
 assert.deepEqual(p.filings.map(f=>f.form),['10-Q','8-K']);assert.match(p.filings[1].url,/data\/1045810\/000119312526000076\/current.htm$/);assert.equal(p.selection.olderIndexFilesRead,false);assert.equal(p.selection.exhibitsRead,false);
 const index=filingIndex();index.filings.recent.filingDate[0]='2026-10-09';assert.equal(filingPlan(issuer,filingDocuments(syntheticFilingHtml,index)[1]).filings.length,0);
});
test('untrusted directory paths, identity drift, duplicate accessions and misaligned columns cannot authorize a fetch',()=>{
 for(const change of [j=>j.cik='9',j=>j.name='Other',j=>j.tickers=[],j=>j.filings.recent.form=[],j=>j.filings.recent.accessionNumber.push(accession),...['../escape.htm','/absolute.htm','https://private/x.htm','doc.htm?x=1','doc.htm#x','doc%2ehtm','doc.pdf'].map(name=>j=>j.filings.recent.primaryDocument[0]=name)]){
  const j=filingIndex();change(j);const d=filingDocuments(syntheticFilingHtml,j);assert.throws(()=>filingPlan(secIssuer('NVDA.US',d[0].body),d[1]));
 }
});
test('filing excerpts preserve table coordinates, visible source units, full original hashes and selection boundaries',()=>{
 const d=filingDocuments(),m=financialFilingMaterial('NVDA.US',d,accession);
 assert.equal(m.scope,'excerpt');assert.equal(m.publishedAt,null);assert.match(m.body,/r1 c2 th "Six months"/);assert.match(m.body,/r2 c2 td "USD 200"/);assert.equal(m.filingSource.selection.omittedBlocks,0);
 assert.equal(m.filingSource.sources[2].sha256,financialDigest(d[2].body));assert.deepEqual(verifyFilingDocuments(m,sha=>d.find(x=>financialDigest(x.body)===sha)?.body),d);
 const changed=structuredClone(m);changed.filingSource.selection.ranges[0].start=1;assert.throws(()=>verifyFilingDocuments(changed,sha=>d.find(x=>financialDigest(x.body)===sha)?.body),/不符/);
});
test('large reports retain whole selected tables and explicit omitted ranges instead of pretending the full filing was analyzed',()=>{
 const html=syntheticFilingHtml.replace('</body>','<p>'+'Unselected narrative without financial cues. '.repeat(600)+'</p>'+Array.from({length:65},(_,i)=>`<p>Financial context ${i}</p><table><tr><th>Cash flow ${i}</th><th>Period</th></tr><tr><td>USD ${i+1}</td><td>2026-07-26</td></tr></table>`).join('')+'</body>');
 const m=financialFilingMaterial('NVDA.US',filingDocuments(html),accession),s=m.filingSource.selection;
 assert(s.fullTextCharacters>18000);assert(s.retainedCharacters<=18000);assert(s.omittedBlocks>0);assert(m.body.length<80000);assert.equal((m.body.match(/\[HTML table \d+;/g)||[]).length,(m.body.match(/\[\/HTML table \d+\]/g)||[]).length);
 assert(s.ranges.every((r,i)=>r.start>=0&&r.end>r.start&&r.end<=s.fullTextCharacters&&(!i||r.start>=s.ranges[i-1].end)));
});
test('hidden XBRL, scripts, access pages, oversized originals and non-HTML cannot become filing evidence',()=>{
 const html=syntheticFilingHtml.replace('<body>','<body><ix:header>USD 999 SECRET HIDDEN</ix:header><script>USD 888</script><div style="display:none">USD 777</div>');
 const m=financialFilingMaterial('NVDA.US',filingDocuments(html),accession);assert(!/999|888|777/.test(m.body));
 for(const body of ['{"not":"html"}',syntheticFilingHtml.replace('Synthetic filing for tests','Request Rate Threshold Exceeded'),'x'.repeat(8*1024*1024+1)])assert.throws(()=>financialFilingMaterial('NVDA.US',filingDocuments(body),accession));
});
test('new material uses the existing immutable archive and detects raw or derived tampering even after a cached read',()=>{
 const store=openStore(':memory:');try{const materials=openMaterials(store.db,{clock:()=>filingAt}),docs=filingDocuments(),m=financialFilingMaterial('NVDA.US',docs,accession);
  assert.throws(()=>materials.prepare('test',m,'manual'),/官方读取器/);
  const p=materials.prepare('test',{...m,filingDocuments:docs},'public-filing');p.persist();const original=immutableMaterialSnapshot(store.db,p.material);assert.equal(original.filingSource.filing.accession,accession);
  const mutation=financialFilingMaterial('NVDA.US',docs,accession);mutation.body='changed';assert.notEqual(financialFilingMaterial('NVDA.US',docs,accession).body,'changed');
  store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('corrupt'),m.filingSource.sources[2].sha256);assert.throws(()=>immutableMaterialSnapshot(store.db,p.material),/原始响应校验失败/);
 }finally{store.close();}
});

const linkedDocuments=links=>filingDocuments(syntheticFilingHtml.replace('</body>',links+'</body>'));
test('exhibit discovery follows visible same-accession HTML links only, deduplicates fragments and reports unselected coverage',()=>{
 const links='<a href="ex99.htm#x">Press release</a><a href="ex99.htm">Duplicate</a><div hidden><a href="hidden.htm">Hidden</a></div>'+Array.from({length:5},(_,i)=>`<a href="ex${i}.htm">Attachment ${i}</a>`).join('');
 const docs=linkedDocuments(links),p=filingExhibitPlan('NVDA.US',docs,accession);
 assert.equal(p.exhibits.length,4);assert(p.exhibits[0].url.endsWith('/ex99.htm'));assert.deepEqual(p.selection,{scope:'visible-same-accession-html-links-only',eligible:6,selected:4,omitted:2,excludedLinks:0,maximumDocuments:4,recursive:false});
 p.exhibits[0].label='changed';assert.equal(filingExhibitPlan('NVDA.US',docs,accession).exhibits[0].label,'Press release');
});
test('external, other-accession, encoded, credentialed, non-HTML and query links cannot expand exhibit fetch scope',()=>{
 const rejected=['https://elsewhere.example/ex99.htm','http://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/ex99.htm','https://user@www.sec.gov/Archives/edgar/data/1045810/000104581026000075/ex99.htm','../000104581026000076/ex99.htm','/Archives/edgar/data/9/000104581026000075/ex99.htm','ex99.htm?next=x','ex%39.htm','ex99.pdf','javascript:alert(1)'];
 const p=filingExhibitPlan('NVDA.US',linkedDocuments(rejected.map(h=>`<a href="${h}">External reference</a>`).join('')),accession);assert.equal(p.exhibits.length,0);assert.equal(p.selection.excludedLinks,rejected.length);
});
test('exhibit evidence binds all four originals, preserves tables and rejects fabricated links or altered provenance',()=>{
 const docs=linkedDocuments('<a href="ex99.htm">Synthetic earnings release</a>'),url=filingExhibitPlan('NVDA.US',docs,accession).exhibits[0].url,all=[...docs,{url,receivedAt:filingAt,body:Buffer.from(syntheticFilingHtml.replace('</body>','<p>The final narrative contains original trailing whitespace. </p></body>'))}];
 const m=financialExhibitMaterial('NVDA.US',all,accession);assert.equal(m.filingSource.schema,FINANCIAL_EXHIBIT_VERSION);assert.equal(m.publishedAt,null);assert.match(m.body,/r2 c2 td "USD 200"/);assert.match(m.body,/不证明附件内容与当前新闻事件一致/);assert.equal(m.filingSource.sources.length,4);
 assert.deepEqual(verifyFilingDocuments(m,sha=>all.find(d=>financialDigest(d.body)===sha)?.body),all);
 const store=openStore(':memory:');try{const materials=openMaterials(store.db,{clock:()=>filingAt}),p=materials.prepare('test',{...m,filingDocuments:all},'public-filing');p.persist();assert.equal(immutableMaterialSnapshot(store.db,p.material).readerVersion,FINANCIAL_EXHIBIT_VERSION);
  const altered=structuredClone(m);altered.filingSource.exhibit.label='Other exhibit';assert.throws(()=>verifyFilingDocuments(altered,sha=>all.find(d=>financialDigest(d.body)===sha)?.body),/不符/);
  store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('corrupt parent'),financialDigest(docs[2].body));assert.throws(()=>immutableMaterialSnapshot(store.db,p.material),/原始响应校验失败/);
 }finally{store.close();}
 assert.throws(()=>financialExhibitMaterial('NVDA.US',[...filingDocuments(),all[3]],accession),/不属于/);
 assert.throws(()=>financialExhibitMaterial('NVDA.US',[...docs,{...all[3],url:url.replace('ex99','unlinked')}],accession),/不属于/);
});


test('plain filing text without block boundaries or tables keeps its legacy reading behavior with named source elements',()=>{
 const text='Synthetic unformatted filing prose keeps its original text and does not infer any accounting fact. '.repeat(5),html='<html><body><img name="createTextNode">'+text+'</body></html>';
 for(const generation of [1,2]){const material=financialFilingMaterial('NVDA.US',filingDocuments(html),accession,{generation});assert(material.body.includes(text.trim()));assert.equal(material.filingSource.selection.fullTextCharacters,text.trim().length);}
});
