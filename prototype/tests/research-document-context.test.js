import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,quote,dossier,comparison,cluster} from './automatic-research-fixture.mjs';
import {sourceRequestAvailable} from '../server/source-links.mjs';
import {extractArticle} from '../server/source-reader.mjs';
import {eventSynthesisBasis,synthesisPacket} from '../server/event-synthesis.mjs';
import {linkedDocumentContext} from '../server/research-document-context.mjs';
import {digest,codexPrompt} from '../server/codex-research.mjs';
const root='https://example.com/synthetic-1',notice='https://example.com/notice',annex='https://example.com/annex.html',unread='https://example.com/unread.html';
const material=url=>({url,...extractArticle(`<html><head><title>合成事项</title></head><body><article><h1>合成事项</h1><p>${quote.repeat(25)}</p>${url===root?`<p><a href="${notice}">原通知</a></p>`:url===notice?`<p><a href="${annex}">附件一</a></p><p><a href="${unread}">附件二</a></p>`:''}</article></body></html>`,url)});
function runner(p){const d=dossier(p),e=p.input.evidence.find(e=>e.material?.sourceLinks?.links.some(l=>sourceRequestAvailable(p,e.id,l.url))),link=e?.material.sourceLinks.links.find(l=>sourceRequestAvailable(p,e.id,l.url)),v={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests:link&&!p.input.documentContext?[{evidenceId:e.id,url:link.url,reason:'读取明确补充材料'}]:[]},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};}
const make=options=>fixture({researchRunner:runner,sourceReader:async u=>material(u),semanticRunner:p=>comparison(p,[p.input.left.url,p.input.right.url].includes(annex)?'uncertain':'followup'),...options});
const basis=f=>eventSynthesisBasis(f.store,f.service.research,f.service.eventClusters,cluster(f).id);
const context=f=>linkedDocumentContext(f.store,f.service.research,cluster(f).members.map(m=>({topic:f.service.research.get(m.id),packet:f.service.research.packet(m.id)})));
const plans=f=>f.store.db.prepare("SELECT * FROM research_evidence_searches WHERE json_extract(payload,'$.policy')='linked-public-source/2'").all();
const child=f=>{const n=f.store.news().find(n=>n.url===annex);return n&&f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE news_id=?').get(n.id);};
async function ready(f){f.add(1);await f.drive(100);assert.equal(context(f).entries[0].status,'available',JSON.stringify(context(f).entries));}
function mutate(f,table,id,fn){const p=JSON.parse(f.store.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id).payload);fn(p);f.store.db.prepare(`UPDATE ${table} SET payload=? WHERE id=?`).run(JSON.stringify(p),id);}

test('automatic synthesis reads selected attachment context despite uncertain event identity and retains unread gaps',async()=>{
 const f=make();try{const book=f.service.paper.snapshot();await ready(f);const b=basis(f),d=f.queue.synthesis.detail(b.cluster.id),input=d.selected.packet.input;
 assert.equal(b.members.length,2);assert.equal(b.documentContext.documents.length,1);assert.deepEqual(b.documentContext.entries.map(e=>e.status),['available','unread']);assert.equal(input.evidence.length,3);assert.equal(input.eventSynthesis.members.length,2);
 const e=input.evidence.find(e=>e.url===annex),link=input.eventSynthesis.documentContext.entries[0];assert.equal(e.documentRole,'linked-attachment');assert.equal(e.verification,'unverified');assert.equal(link.evidenceId,e.id);assert(input.evidence.some(e=>e.id===link.parentEvidenceId&&e.url===notice));assert.equal(d.selected.current,true);const observed=f.queue.synthesis.observationSubjects().find(s=>s.id===b.cluster.id);assert.equal(observed.fresh,true);assert(observed.current.evidence.some(x=>x.materialId===e.materialId&&(x.id===e.id||x.memberTopicId===e.memberTopicId&&x.originalEvidenceId===e.originalEvidenceId)));
 assert(f.store.db.prepare('SELECT payload FROM semantic_runs').all().some(r=>JSON.parse(r.payload).candidate?.comparison?.relation==='uncertain'));
 const prompt=codexPrompt(d.selected.packet);assert.match(prompt,/文档关系/);assert.match(prompt,/不能引用名称补写条款/);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);assert.deepEqual(f.service.paper.snapshot(),book);
 const before=JSON.stringify(d),calls=f.synthesisCalls;await f.drive(6);assert.equal(f.synthesisCalls,calls);assert.equal(JSON.stringify(f.queue.synthesis.detail(b.cluster.id)),before);
 }finally{await f.close();}
});

test('a newly read attachment changes synthesis input while preserving old judgment, membership and source snapshot',async()=>{
 let attempts=0;const f=make({sourceReader:async u=>{if(u===annex&&attempts++===0)throw Error('暂时不可读');return material(u);}});try{f.add(1);await f.until(()=>{try{return f.queue.synthesis.overview(cluster(f).id).current&&context(f).entries[0].status==='unread';}catch{return false;}});
 const old=f.queue.synthesis.detail(cluster(f).id).selected,oldPacket=JSON.stringify(old.packet),members=cluster(f).members.map(m=>m.id);f.advance(60001);await f.drive(75);const d=f.queue.synthesis.detail(cluster(f).id);
 assert(d.selected.version>old.version);assert.equal(d.selected.documentCount,1);assert.equal(d.selected.unreadDocumentCount,1);assert.deepEqual(cluster(f).members.map(m=>m.id),members);assert.equal(JSON.stringify(f.queue.synthesis.detail(cluster(f).id,old.id).selected.packet),oldPacket);assert.equal(f.queue.synthesis.detail(cluster(f).id,old.id).selected.current,false);
 const parent=d.selected.packet.input.evidence.find(e=>e.url===notice);assert(parent.material.extractionEvidence.attachments.every(a=>a.status==='unread'));
 }finally{await f.close();}
});

for(const change of ['cancel','news-revision','raw-edit','request-tamper','parent-edit','plan-invalidated'])test(`attachment ${change} withdraws current context without rewriting historical evidence`,async()=>{
 const f=make();try{await ready(f);const b=basis(f),old=f.queue.synthesis.detail(b.cluster.id).selected,oldBytes=JSON.stringify(old.packet),row=child(f),selected=plans(f).find(r=>JSON.parse(r.payload).coverage.depth===2);
 if(change==='cancel')f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE id=?").run(row.id);
 if(change==='news-revision'){const n=f.store.newsById(row.news_id);f.store.ingest([{...n,title:n.title+' revised'}],'2026-10-08T00:01:00Z');}
 if(change==='raw-edit'){const t=f.service.research.get(row.topic_id);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人修改资料'});}
 if(change==='request-tamper')mutate(f,'research_evidence_searches',selected.id,p=>p.sourceBasis.requests[0].reason='篡改请求');
 if(change==='parent-edit'){const p=JSON.parse(plans(f).find(r=>JSON.parse(r.payload).coverage.depth===1).payload),t=f.service.research.get(p.anchor.topicId);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人修改上游研究'});}
 if(change==='plan-invalidated')f.store.db.prepare("UPDATE research_evidence_searches SET status='invalidated' WHERE id=?").run(selected.id);
 const c=context(f);assert.equal(c.documents.length,0);assert.equal(c.entries[0].status,'unread');assert.throws(()=>basis(f),/附件阅读范围已变化/);assert.equal(f.queue.synthesis.overview(b.cluster.id).current,false);assert.equal(JSON.stringify(f.queue.synthesis.detail(b.cluster.id,old.id).selected.packet),oldBytes);
 }finally{await f.close();}
});

test('document references deduplicate identical material already in members and stay outside independent corroboration claims',async()=>{
 const f=make({semanticRunner:p=>comparison(p)});try{await ready(f);const b=basis(f),p=synthesisPacket(b.cluster,b.members,{version:99,generatedAt:'2026-10-08T00:00:00Z',documentContext:b.documentContext}),doc=p.input.eventSynthesis.documentContext.entries[0];assert.equal(p.input.evidence.filter(e=>e.material?.id===doc.materialId).length,b.members.reduce((n,m)=>n+m.packet.input.evidence.filter(e=>e.material?.id===doc.materialId).length,0));assert(p.input.evidence.some(e=>e.id===doc.evidenceId));assert.equal(b.cluster.members.length,3);assert.equal(p.input.eventSynthesis.members.length,3);
 const before=JSON.stringify(b.members),unselected=linkedDocumentContext(f.store,f.service.research,b.members);assert.equal(unselected.entries.find(e=>e.url===unread).status,'unread');assert.equal(JSON.stringify(b.members),before);
 }finally{await f.close();}
});
