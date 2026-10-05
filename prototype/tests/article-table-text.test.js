import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {articleTableText} from '../server/article-table-text.mjs';
import {extractArticle} from '../server/source-reader.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {materialComparisonSnapshot} from '../server/semantic-materials.mjs';
const render=html=>{const dom=new JSDOM('');try{return articleTableText(dom.window.document,html);}finally{dom.window.close();}};
const table='<table><caption>Fictional cash flow</caption><tr><th rowspan="2">Metric</th><th colspan="2">Quarter</th><th colspan="2">Year</th></tr><tr><th>2024 CNY million</th><th>2025 CNY million</th><th>2024 CNY million</th><th>2025 CNY million</th></tr><tr><td>Operating cash</td><td>20</td><td>25</td><td></td><td>110</td></tr><tr><td>Investing cash</td><td>(3)</td><td>—</td><td>0</td><td>(40)</td></tr></table>';
const prose='This fictional public statement is a test of preserved financial table structure. No listed company or actual investment is represented. '.repeat(3);
const page=`<html><head><title>Fictional statement</title></head><body><article><h1>Fictional statement</h1><p>${prose}</p>${table}<p>End of source.</p></article></body></html>`;
test('table text preserves merged headings, blank columns, captions and source signs without inferring financial values',()=>{
 const text=render(table);assert.match(text,/rows=4; columns=5/);assert.match(text,/caption "Fictional cash flow"/);assert.match(text,/r1:2 c1 th "Metric"/);assert.match(text,/r1 c2:3 th "Quarter"/);assert.match(text,/r1 c4:5 th "Year"/);assert.match(text,/r2 c5 th "2025 CNY million"/);assert.match(text,/r3 c5 td "110"/);assert.doesNotMatch(text,/r3 c4 /);assert.match(text,/r4 c2 td "\(3\)"/);assert.match(text,/r4 c3 td "—"/);assert.match(text,/r4 c4 td "0"/);assert.match(text,/r4 c5 td "\(40\)"/);
});
test('rowspan zero stays within its row group and empty spans preserve their coordinates',()=>{
 const text=render('<table><tbody><tr><td rowspan="0">A</td><td>X</td></tr><tr><td colspan="2"></td></tr></tbody><tbody><tr><td>B</td><td>Y</td></tr></tbody></table>');assert.match(text,/r1:2 c1 td "A"/);assert.match(text,/r2 c2:3 td ""/);assert.match(text,/r3 c1 td "B"/);assert.match(text,/r3 c2 td "Y"/);
});
test('nested tables remain separately numbered inside their containing cell without duplicated values',()=>{
 const text=render('<table><tr><td>Outer<table><tr><td>Inner 731</td><td>8</td></tr></table>Tail</td><td>Outside</td></tr></table>');assert.match(text,/HTML table 1;/);assert.match(text,/HTML table 2;/);assert.match(text,/r1 c2 td "Outside"/);assert.equal(text.match(/Inner 731/g).length,1);
});
test('malformed, overlapping and unbounded table spans fail instead of publishing guessed coordinates',()=>{
 for(const html of ['<div><tr><td>Lost table context</td></tr></div>','<table><tr><td colspan="0">X</td></tr></table>','<table><tr><td colspan="257">X</td></tr></table>','<table><tr><td rowspan="2">X</td></tr></table>','<table><tr><td colspan="x">X</td></tr></table>','<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">Overlap</td></tr></table>',Array(51).fill('<table><tr><td>A</td></tr></table>').join(''),'<table>'+Array(1001).fill('<tr><td>X</td></tr>').join('')+'</table>'])assert.throws(()=>render(html),/表格结构/);
});
test('extraction preserves table text in place while ordinary article text remains plain and bounded',()=>{
 const article=extractArticle(page,'https://ir.acme.com/report');assert.equal(article.method,'public-article-7');assert.match(article.body,/r3 c5 td "110"/);assert(article.body.indexOf(prose.trim())<article.body.indexOf('[HTML table'));assert(article.body.indexOf('[/HTML table')<article.body.indexOf('End of source.'));assert.doesNotMatch(article.body,/<table|<td/);assert.equal(render('<p>Before &amp; after</p>'),'Before & after');
 const huge='<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>'+Array(900).fill('<tr><td>'+('x'.repeat(80))+'</td><td>1</td></tr>').join('')+'</tbody></table>';assert.throws(()=>extractArticle(page.replace(table,huge),'https://ir.acme.com/report'),/表格结构/);assert.throws(()=>extractArticle(page.replace(prose,prose.repeat(220)),'https://ir.acme.com/report'),/8 万/);
});
test('table extraction appends a new material revision, freezes old bodies and reaches research and comparison packets',async()=>{
 const store=openStore(':memory:'),url='https://ir.acme.com/report',current=extractArticle(page,url);let source={...current,body:'Legacy flattened table: QuarterYear2024202520242025Operating cash2025110. '+prose};
 const research=openResearch(store,{seed:false,clock:()=> '2026-10-04T00:00:00Z',sourceReader:async()=>({...source,url})});
 try{let t=research.create({title:'Fictional table',summary:'Only a parser test'});const request={url,stance:'unverified',family:'earnings',step:'fact',interpretation:'Fictional test'};t=await research.readMaterial(t.id,{version:t.version,...request});const old=research.materialList(t.id).materials[0],before=JSON.stringify(immutableMaterialSnapshot(store.db,{id:old.id,revision:1}));source=current;t=await research.readMaterial(t.id,{version:t.version,...request});const next=research.materialList(t.id).materials.find(m=>m.revision===2);assert(next);assert.equal(JSON.stringify(immutableMaterialSnapshot(store.db,{id:old.id,revision:1})),before);assert.equal(materialComparisonSnapshot(store.db,{id:next.id,revision:2}).body,current.body);assert(research.packet(t.id).input.evidence.some(e=>e.material?.body===current.body));assert.equal((await research.readMaterial(t.id,{version:t.version,...request})).version,t.version);
  source={...current,body:'unused'};const badResearch=openResearch(store,{seed:false,sourceReader:async()=>extractArticle(page.replace(table,'<table><tr><th>Metric</th><th>Value</th></tr><tr><td colspan="257">bad</td></tr></table>'),url)});await assert.rejects(badResearch.readMaterial(t.id,{version:t.version,...request}),/表格结构/);assert.equal(badResearch.get(t.id).version,t.version);assert.equal(badResearch.materialList(t.id).materials.length,2);assert.equal(badResearch.materialList(t.id).attempts[0].state,'failed');
 }finally{store.close();}
});
