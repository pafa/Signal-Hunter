import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfFixture,encryptedPdfFixture} from './helpers/pdf-fixture.mjs';
import https from 'node:https';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {extractPdf,pdfDigest,validatePdfScope} from '../server/pdf-source.mjs';
import {readPublicArticle,extractArticle} from '../server/source-reader.mjs';
import {materialInput,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {validateSourceLinks,validateSourceRequests} from '../server/source-links.mjs';
import {fixture,output,dossier,allClusters} from './automatic-research-fixture.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {digest} from '../server/codex-research.mjs';

const url='https://ir.acme.com/report.pdf',q='Acme proposes to acquire Beta subject to approval.',at='2026-10-09T00:00:00Z';
const resolver=async()=>[{address:'93.184.216.34'}];
const read=(bytes,extra={})=>readPublicArticle(url,{resolver,request:async()=>({status:200,headers:{'content-type':'application/pdf'},body:bytes}),...extra});

test('PDF reads every text page, labels blank/scan uncertainty, preserves bytes and does not execute actions or infer publication date',async()=>{
 const bytes=pdfFixture([q,'','Final approval is still pending.'],{action:true}),m=await read(bytes);
 assert.equal(m.extractionEvidence.pages.length,3);assert.deepEqual(m.extractionEvidence.emptyPages,[2]);assert.equal(m.extractionEvidence.sha256,pdfDigest(bytes));assert.equal(m.sourceDocument,bytes);assert.equal(m.publishedAt,null);assert.equal(m.method,'public-pdf-1');assert.match(m.body,/\[PDF page 3\]\nFinal approval/);assert.equal(globalThis.pdfExecuted,undefined);assert.equal(m.title,'Synthetic announcement');
 assert.deepEqual(materialInput(m,at).extractionEvidence,m.extractionEvidence);
 const trailing=await read(pdfFixture([q,'']));assert.deepEqual(materialInput(trailing,at).extractionEvidence.emptyPages,[2]);
 for(const change of [e=>e.pages[1].page=1,e=>e.pages[0].characters++,e=>e.pages[0].sha256='0'.repeat(64),e=>e.emptyPages=[],e=>e.sha256='invalid']){const bad=structuredClone(m.extractionEvidence);change(bad);assert.throws(()=>validatePdfScope(bad,m.body));}
 assert.throws(()=>validatePdfScope(m.extractionEvidence,m.body.replace('Acme','Fake')));
});
test('invalid, scanned, oversized and excessive-page PDFs fail without silently keeping partial text',async()=>{
 for(const bytes of [Buffer.from('<html>Not PDF</html>'),Buffer.from('%PDF-1.7\ninvalid'),pdfFixture(['','']),pdfFixture(Array(121).fill(q)),pdfFixture(Array(60).fill(Array(35).fill(q).join('\n'))),Buffer.concat([Buffer.from('%PDF-1.7'),Buffer.alloc(8_000_000)])])await assert.rejects(read(bytes));
 await assert.rejects(extractPdf(pdfFixture([q]),url,{timeoutMs:1}),/超时/);
 const controller=new AbortController();controller.abort();await assert.rejects(extractPdf(pdfFixture([q]),url,{signal:controller.signal}),/超时/);
 await assert.rejects(read(encryptedPdfFixture()),/加密/);
});
test('actual transport accepts only bounded declared PDF bytes and applies both advertised and streamed limits',async t=>{
 let headers={'content-type':'application/pdf'},chunks=[pdfFixture([q])];
 t.mock.method(https,'get',(_url,options,callback)=>{assert.match(options.headers.Accept,/application\/pdf/);const req=new EventEmitter();queueMicrotask(()=>{const res=Readable.from(chunks);res.statusCode=200;res.headers=headers;callback(res);});return req;});
 assert.equal((await readPublicArticle(url,{resolver})).extractionEvidence.pages.length,1);
 headers={'content-type':'application/pdf','content-length':'8000001'};await assert.rejects(readPublicArticle(url,{resolver}),/8 MB/);
 headers={'content-type':'application/pdf'};chunks=[Buffer.from('%PDF-1.7'),Buffer.alloc(8_000_000)];await assert.rejects(readPublicArticle(url,{resolver}),/8 MB/);
 for(const patch of [{'content-type':'application/zip'},{'content-type':'application/pdf','content-encoding':'gzip'}]){headers=patch;await assert.rejects(readPublicArticle(url,{resolver}));}
});
test('PDF redirects retain public address pinning and never follow private targets',async()=>{
 const sent=[];await assert.rejects(readPublicArticle(url,{resolver:async host=>[{address:host==='private.acme.com'?'10.0.0.1':'93.184.216.34'}],request:async(u,ip)=>{sent.push([u.href,ip]);return {status:302,headers:{location:'https://private.acme.com/file.pdf'}};}}),/非公网/);assert.deepEqual(sent,[[url,'93.184.216.34']]);
});
test('new HTML links admit literal PDF attachments, while old link contracts remain valid and unchanged',()=>{
 const m=extractArticle(`<html><body><article><h1>Report</h1><p>${q.repeat(12)}<a download href="${url}">Full announcement PDF</a><a href="/table.xlsx">Spreadsheet</a></p></article></body></html>`,'https://ir.acme.com/news');
 assert.equal(m.sourceLinks.schema,'article-source-links/2');assert.deepEqual(m.sourceLinks.links.map(l=>l.url),[url]);assert.equal(m.extractionEvidence.attachments[0].status,'unread');assert.deepEqual(validateSourceLinks(m.sourceLinks),m.sourceLinks);
 const old={...m.sourceLinks,schema:'article-source-links/1',links:[]};assert.deepEqual(validateSourceLinks(old),old);assert.throws(()=>validateSourceLinks({...m.sourceLinks,schema:'article-source-links/1'}));const encoded={...old,inspected:1,links:[{url:'https://ir.acme.com/file%2epdf',label:'Legacy link',context:''}]};assert.deepEqual(validateSourceLinks(encoded),encoded);
 const p={input:{evidence:[{id:'e',material:m}]}};assert.equal(validateSourceRequests([{evidenceId:'e',url,reason:'Read the published conditions'}],p).length,1);assert.throws(()=>validateSourceRequests([{evidenceId:'e',url:url+'?guessed',reason:'Read'}],p));
});
test('PDF bytes and extraction commit together, deduplicate, survive revisions and detect raw-file corruption',async()=>{
 let bytes=pdfFixture([q]);const store=openStore(':memory:'),r=openResearch(store,{seed:false,clock:()=>at,sourceReader:()=>read(bytes)});try{
 const t=r.create({title:'Acme acquisition',summary:'Synthetic only'}),command=version=>({version,url,stance:'unverified',family:'corporate',step:'fact',interpretation:'Check conditions'});
 store.db.exec("CREATE TRIGGER fail_pdf BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");await assert.rejects(r.readMaterial(t.id,command(1)),/synthetic write failure/);assert.equal(store.db.prepare('SELECT count(*) n FROM research_source_documents').get().n,0);assert.equal(r.materialList(t.id).materials.length,0);store.db.exec('DROP TRIGGER fail_pdf');
 await r.readMaterial(t.id,command(1));const a=r.materialList(t.id).materials[0];assert.equal(a.readerVersion,'public-pdf-1');assert.deepEqual(Buffer.from(store.db.prepare('SELECT body FROM research_source_documents').get().body),bytes);assert.equal(immutableMaterialSnapshot(store.db,a).body,a.body);assert.equal(JSON.stringify(r.packet(t.id)).includes('sourceDocument'),false);
 await r.readMaterial(t.id,command(2));assert.equal(store.db.prepare('SELECT count(*) n FROM research_source_documents').get().n,1);
 bytes=pdfFixture(['Acme has withdrawn the proposed transaction.']);await r.readMaterial(t.id,command(2));assert.equal(r.materialList(t.id).materials.length,2);assert.equal(r.materialList(t.id).materials[1].revision,2);assert.equal(immutableMaterialSnapshot(store.db,a).body,a.body);
 store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('bad'),a.extractionEvidence.sha256);assert.throws(()=>immutableMaterialSnapshot(store.db,a),/原始文件/);assert.throws(()=>r.packet(t.id),/原始文件/);bytes=pdfFixture([q]);await assert.rejects(r.readMaterial(t.id,command(r.get(t.id).version)),/原始文件/);
 }finally{store.close();}
});
function extraction(p){return output(p,'decomposition',{events:[{title:'Acme proposed acquisition',actor:'Acme',action:'proposes to acquire',object:'Beta',stage:'pending approval',eventTime:'未知',quote:q,quoteField:'body',boundaryReason:'single matter',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'Synthetic text-layer test',missingEvidence:['Check original approval']});}
function researchRunner(p){const d=dossier(p),e=p.input.evidence.find(e=>e.material?.sourceLinks?.links.length),v={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests:e?[{evidenceId:e.id,url,reason:'Read the attached conditions'}]:[]},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};}
test('automatic HTML to PDF supplement completes research and synthesis with no intermediate approval or transaction',async()=>{
 const reads=[],bytes=pdfFixture([q+'\nFinal approval is still pending.']),f=fixture({extractionRunner:extraction,researchRunner,sourceReader:u=>{reads.push(u);return readPublicArticle(u,{resolver,request:async()=>u===url?{status:200,headers:{'content-type':'application/pdf'},body:bytes}:{status:200,headers:{},body:`<article><h1>Acme acquisition</h1><p>${q.repeat(10)} <a href="${url}">Full announcement PDF</a></p></article>`}});}});
 try{const paper=f.service.paper.snapshot();f.add(1);await f.drive(65);const search=f.queue.snapshot().evidence.items.find(s=>s.policy==='linked-public-source/1');assert.ok(search,JSON.stringify(f.queue.snapshot()));assert.equal(search.status,'completed');assert.equal(search.candidates[0].status,'matched');assert.deepEqual(reads,[f.news(1).url,url]);assert.equal(f.calls.dossier,2);assert.equal(f.synthesisCalls,1);assert.equal(allClusters(f).length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_documents').get().n,1);assert.deepEqual(f.service.paper.snapshot(),paper);const child=f.store.news().find(n=>n.url===url);assert.equal(child.publishedAt,null);
 }finally{await f.close();}
});
test('an unreadable PDF stops after bounded retries while unrelated automatic research continues',async()=>{
 let failed=0;const f=fixture({sourceReader:async u=>{if(u.endsWith('-1')){failed++;return read(pdfFixture(['']));}return {url:u,title:'Synthetic',sourceName:'Synthetic publisher',body:q,scope:'extracted-text'};},extractionRunner:extraction});
 try{f.add(1);await f.drive(5);f.advance(60001);await f.drive(5);f.advance(120001);await f.drive(5);f.advance(240001);await f.drive(5);assert.equal(failed,3);assert.equal(f.queue.snapshot().items[0].status,'observing');f.add(2);await f.drive(25);assert.equal(f.calls.dossier,1);assert.equal(failed,3);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_documents').get().n,0);assert.equal(f.service.research.list().filter(t=>t.dossier).length,1);}finally{await f.close();}
});

test('PDF raw bytes and page scope survive the existing verified backup and locked restore',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdf-backup-')),path=join(dir,'source.sqlite'),target=join(dir,'restored.sqlite');let store=openStore(path),restored;
 try{const r=openResearch(store,{seed:false,clock:()=>at,sourceReader:()=>read(pdfFixture([q,'']))}),t=r.create({title:'PDF backup',summary:'Synthetic only'});await r.readMaterial(t.id,{version:1,url,stance:'unverified',family:'corporate',step:'fact',interpretation:'Preserve source'});const m=r.materialList(t.id).materials[0],b=await createBackup(path,join(dir,'backups'));assert.equal(b.counts.research_source_documents,1);const result=restoreBackup(b.directory,target);assert.equal(result.verified,true);assert.equal(result.reviewRequired,true);restored=openStore(target);assert.deepEqual(immutableMaterialSnapshot(restored.db,m),immutableMaterialSnapshot(store.db,m));assert.equal(pdfDigest(restored.db.prepare('SELECT body FROM research_source_documents').get().body),m.extractionEvidence.sha256);}finally{restored?.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
