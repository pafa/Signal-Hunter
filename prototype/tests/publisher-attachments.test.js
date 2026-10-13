import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle,readPublicArticle} from '../server/source-reader.mjs';
import {validateExtractionEvidence} from '../server/article-extraction.mjs';
import {validateSourceLinks,validateSourceRequests,sourceRequestAvailable} from '../server/source-links.mjs';
import {materialInput,openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
import {fixture,output,dossier,allClusters} from './automatic-research-fixture.mjs';
import {digest,codexDraftSchema} from '../server/codex-research.mjs';
import {pdfFixture} from './helpers/pdf-fixture.mjs';

const url='https://www.federalreserve.gov/newsevents/pressreleases/enforcement20261008a.htm';
const target=new URL('files/enf20261008a1.pdf',url).href;
const q='Synthetic Acme is subject to an enforcement action.';
const link=(href,label='Attachment (PDF)')=>`<a href="${href}">${label}</a>`;
// Original prose, with the verified publisher article/attachment DOM boundary.
const page=(attachments=link(target),extra='')=>`<html><head><title>Synthetic enforcement</title></head><body><nav>${link('/navigation.pdf','Navigation')}</nav><div id="content"><div class="row"><div id="article"><div class="heading col-xs-12 col-sm-8 col-md-8"><h1>Synthetic enforcement</h1></div><div class="col-xs-12 col-sm-8 col-md-8"><p>${q.repeat(15)}</p>${extra}<div class="panel panel-attachments col-xs-12 col-sm-8 col-md-8"><div class="panel-body"><ul class="list-unstyled"><li class="list__icon">${attachments}</li></ul></div></div></div><div class="col-xs-12 col-sm-4 col-md-4">${link('/sidebar.pdf','Sidebar')}</div></div></div></div><footer>${link('/footer.pdf','Footer')}</footer></body></html>`;

test('publisher attachment survives Readability omission and becomes a frozen, unread supplement candidate',()=>{
 const a=extractArticle(page(),url);assert.equal(a.extractionEvidence.profile,'fed-release-1');assert.equal(a.extractionEvidence.scanScope,'publisher-article-links');assert.doesNotMatch(a.body,/Attachment \(PDF\)/);assert.deepEqual(a.extractionEvidence.attachments,[{url:target,label:'Attachment (PDF)',formatHint:'pdf',status:'unread'}]);assert.equal(a.sourceLinks.scope,'extracted-html-and-publisher-attachment-links');assert.deepEqual(a.sourceLinks.links,[{url:target,label:'Attachment (PDF)',context:'Attachment (PDF)'}]);assert.deepEqual(materialInput({...a,url},'2026-10-10').sourceLinks,a.sourceLinks);
 const input={topicId:'one',topicVersion:1,evidence:[{id:'m',material:a}]},p={schema:'event-research-packet-1',analysisMode:'assistant-review-required',input,inputHash:digest(input)},req={evidenceId:'m',url:target,reason:'Read the explicit attached conditions'};assert.deepEqual(validateSourceRequests([req],p),[req]);assert(codexDraftSchema(p).properties.sourceRequests.items.properties.url.enum.includes(target));assert.throws(()=>validateSourceRequests([{...req,url:target+'?guessed'}],p));
});
test('attachment discovery neither fetches targets nor admits unsafe addresses, navigation or unsupported formats',async()=>{
 const unsafe=['http://public.example/a.pdf','https://127.0.0.1/a.pdf','https://user:secret@public.example/a.pdf','javascript:alert(1)'];let calls=0;
 const a=await readPublicArticle(url,{resolver:async()=>[{address:'93.184.216.34'}],request:async()=>{calls++;return {status:200,headers:{},body:page(unsafe.map(x=>link(x)).join('')+link(target)+link(target+'#two')+link('/annex.docx','Attachment Word'))};}});
 assert.equal(calls,1);assert.equal(a.extractionEvidence.omittedAttachmentLinks,unsafe.length);assert.equal(a.extractionEvidence.attachments.length,2);assert.deepEqual(a.sourceLinks.links.map(x=>x.url),[target]);assert.equal(a.publishedAt,null);
});
test('publisher profile is route-bound and ambiguous or changed layouts fall back to extracted links',()=>{
 for(const u of ['https://other.example/newsevents/pressreleases/enforcement20261008a.htm','https://www.federalreserve.gov/other.htm'])assert.equal(extractArticle(page(),u).extractionEvidence.profile,'generic');
 for(const html of [page().replace('id="article"','id="changed"'),page().replace('</footer>','</footer><div id="content"><div id="article"><div class="col-xs-12 col-sm-8 col-md-8"><p>Uncertain article root.</p></div></div></div>')]){
  const a=extractArticle(html,url);assert.equal(a.extractionEvidence.scanScope,'extracted-html-links');assert.equal(a.sourceLinks.scope,'extracted-html-links');
 }
});
test('bounded source list prioritizes explicit attachments, preserves unread limits, and rejects forged legacy scope',()=>{
 const a=extractArticle(page(link(target),`<p>${Array.from({length:34},(_,i)=>link('/ref'+i,'Body reference '+i)).join(' ')}</p>`),url);assert.equal(a.sourceLinks.links[0].url,target);assert.equal(a.sourceLinks.links.length,30);assert.equal(a.sourceLinks.truncated,true);validateSourceLinks(a.sourceLinks);
 const b=extractArticle(page(Array.from({length:32},(_,i)=>link('/files/'+i+'.pdf')).join('')),url);assert.equal(b.extractionEvidence.attachments.length,30);assert.equal(b.extractionEvidence.truncated,true);assert.equal(b.sourceLinks.links.length,30);assert.equal(b.sourceLinks.truncated,true);
 for(const schema of ['article-source-links/1','article-source-links/2'])assert.throws(()=>validateSourceLinks({...a.sourceLinks,schema}));
});
test('legacy Fed generic evidence remains immutable while new attachment scope creates a separate revision',()=>{
 const a=extractArticle(page(),url),old={...a,method:'public-article-9',extractionEvidence:{...a.extractionEvidence,schema:'article-extraction-1',profile:'generic',scanScope:'extracted-html-links',attachments:[]},sourceLinks:{schema:'article-source-links/2',scope:'extracted-html-links',links:[],inspected:0,omitted:0,truncated:false}};
 assert.deepEqual(validateExtractionEvidence(old.extractionEvidence,url),old.extractionEvidence);assert.deepEqual(validateSourceLinks(old.sourceLinks),old.sourceLinks);assert.throws(()=>validateExtractionEvidence({...a.extractionEvidence,schema:'article-extraction-1'},url));
 const store=openStore(':memory:'),m=openMaterials(store.db,{clock:()=> '2026-10-10T00:00:00Z'});try{
  const first=m.prepare('t',{...old,url},'public-web');first.persist();const original=immutableMaterialSnapshot(store.db,first.material);
  const next=m.prepare('t',{...a,url},'public-web');next.persist();assert.equal(next.material.revision,2);assert.deepEqual(immutableMaterialSnapshot(store.db,first.material),original);assert.equal(immutableMaterialSnapshot(store.db,next.material).sourceLinks.links[0].url,target);
 }finally{store.close();}
});
test('publisher attachment enters the existing automatic PDF research, comparison and synthesis without an intermediate decision',async()=>{
 const reads=[],bytes=pdfFixture([q+'\nSynthetic order terms.']),extraction=p=>output(p,'decomposition',{events:[{title:'Synthetic enforcement',actor:'Acme',action:'is subject to',object:'enforcement action',stage:'announced',eventTime:'未知',quote:q,quoteField:'body',boundaryReason:'one synthetic matter',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'Synthetic test',missingEvidence:['Actual issuer and facts']}),researchRunner=p=>{const d=dossier(p),e=p.input.evidence.find(x=>x.material?.sourceLinks?.links.some(l=>l.url===target&&sourceRequestAvailable(p,x.id,l.url))),v={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests:e?[{evidenceId:e.id,url:target,reason:'Read explicit conditions'}]:[]},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};};
 const f=fixture({extractionRunner:extraction,researchRunner,sourceReader:u=>{reads.push(u);return readPublicArticle(u,{resolver:async()=>[{address:'93.184.216.34'}],request:async()=>u===target?{status:200,headers:{'content-type':'application/pdf'},body:bytes}:{status:200,headers:{},body:page()}});}});
 try{const paper=f.service.paper.snapshot();f.store.ingest([{...f.news(1),url}], '2026-10-08T00:00:00Z');f.service.research.process();await f.drive(65);const s=f.queue.snapshot().evidence.items.find(x=>x.policy==='linked-public-source/2');assert.equal(s.status,'completed');assert.equal(s.candidates[0].status,'matched');assert.deepEqual(reads,[url,target]);assert.equal(f.calls.dossier,3);assert.equal(f.synthesisCalls,1);assert.equal(allClusters(f).length,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_source_documents').get().n,1);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});
