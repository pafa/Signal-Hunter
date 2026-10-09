import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,at,quote,dossier,comparison,allClusters} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {LINKED_EVIDENCE_POLICY} from '../server/pipeline-linked-evidence.mjs';
const target='https://ir.acme.com/statement',child='https://ir.acme.com/detail';
const sourceReader=async url=>({url,title:'合成公开声明',sourceName:'合成',body:quote.repeat(30),scope:'extracted-text',sourceLinks:{schema:'article-source-links/1',scope:'extracted-html-links',links:[{url:url===target?child:target,label:'原始声明',context:'公告链接尚未读取'}],inspected:1,omitted:0,truncated:false}});
function researchRunner(p){const d=dossier(p),e=p.input.evidence.find(e=>e.material?.sourceLinks?.links.length),sourceRequests=e?[{evidenceId:e.id,url:e.material.sourceLinks.links[0].url,reason:'核对原始声明的批准条件'}]:[],v={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};}
const rows=f=>f.queue.snapshot().evidence.items.filter(s=>s.policy===LINKED_EVIDENCE_POLICY);
const lead=f=>f.store.db.prepare("SELECT id FROM news WHERE json_extract(payload,'$.url')=?").get(target);
const pipe=(f,id=lead(f)?.id)=>id&&f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE news_id=? ORDER BY rowid DESC LIMIT 1').get(id);
const make=opts=>fixture({sourceReader,researchRunner,...opts});
async function pending(f){f.add(1);await f.until(()=>rows(f).length);return rows(f)[0];}

test('literal external link enters automatic reading, independent research, comparison and synthesis, at depth one only',async()=>{
 const reads=[],f=make({sourceReader:async u=>{reads.push(u);return sourceReader(u);}});try{const paper=f.service.paper.snapshot();await pending(f);await f.drive(50);const s=rows(f)[0],n=f.store.newsById(lead(f).id);
 assert.equal(s.status,'completed');assert.equal(s.candidates[0].status,'matched');assert.equal(n.provider,'linked-public-source');assert.equal(n.publishedAt,null);assert.equal(n.datePrecision,'unknown');assert.equal(n.linkedReference.evidenceId,s.candidates[0].evidenceId);assert.equal(pipe(f).status,'completed');assert.equal(f.calls.dossier,2);assert.equal(f.calls.semantic,1);assert.equal(f.synthesisCalls,1);assert.equal(allClusters(f).length,1);assert.deepEqual(reads,[f.news(1).url,target]);assert.ok(!f.store.news().some(n=>n.url===child));assert.deepEqual(f.service.paper.snapshot(),paper);
 const original=f.service.research.get(s.anchor.topicId);assert.equal(original.version,s.anchor.topicVersion);assert.equal(original.dossier.sourceRequests.length,1);assert.ok(f.queue.snapshot().evidence.items.some(s=>s.policy!=='linked-public-source/1'&&s.current));
 }finally{await f.close();}
});
for(const kind of ['unrelated','analogy','uncertain'])test(`external ${kind} result stays separate and does not claim the original gap is filled`,async()=>{const f=make({semanticRunner:p=>comparison(p,kind)});try{await pending(f);await f.drive(50);assert.equal(rows(f)[0].candidates[0].status,kind==='unrelated'?'unrelated':kind==='analogy'?'related':'observing');assert.equal(allClusters(f).length,0);assert.equal(f.synthesisCalls,0);}finally{await f.close();}});
test('shared quota, pause and restart preserve one durable link request without duplicate reads or research',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-link-')),path=join(dir,'db.sqlite');let f=make({path});try{
 f.add(1);await f.until(()=>f.calls.dossier===1);f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:3});await f.drive(4);assert.equal(rows(f).length,1);assert.equal(pipe(f).status,'queued');const id=rows(f)[0].id;f.service.controlOperation('discovery','pause');assert.throws(()=>f.service.runOperation('discovery'),/暂停/);await f.close();f=make({path});assert.equal(rows(f)[0].id,id);f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:100});await f.drive(50);assert.equal(rows(f).length,1);assert.equal(pipe(f).status,'completed');assert.equal(f.calls.dossier,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('editing the requesting research before reading invalidates its request without fetching the target',async()=>{
 const reads=[],f=make({sourceReader:async u=>{reads.push(u);return sourceReader(u);}});try{f.add(1);await f.until(()=>f.calls.dossier===1);f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:3});await f.drive(4);const s=rows(f)[0],t=f.service.research.get(s.anchor.topicId);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人修改后的核验目标'});f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:100});await f.drive(10);assert.equal(rows(f)[0].status,'invalidated');assert.equal(pipe(f).status,'invalidated');assert.deepEqual(reads,[f.news(1).url]);assert.equal(f.service.research.get(t.id).nextEvidence,'本人修改后的核验目标');}finally{await f.close();}
});
test('known manual-era news is observed without reactivation or duplicated lead',async()=>{
 const f=make();try{f.queue.configure({version:2,automatic:false,extractEvents:true,includeClues:false,dailyCalls:100});f.store.ingest([{...f.news(2),url:target,title:'常规资料'}],at);f.service.research.process();f.queue.scan({assertActive(){}});const old=pipe(f,f.news(2).id);f.queue.configure({version:3,automatic:true,extractEvents:true,includeClues:false,dailyCalls:100});await pending(f);await f.drive(30);assert.deepEqual(pipe(f,f.news(2).id),old);assert.equal(rows(f)[0].coverage.reusedNews,1);assert.equal(rows(f)[0].candidates[0].status,'observing');assert.equal(f.calls.dossier,1);assert.equal(f.store.news().length,2);}finally{await f.close();}
});
test('failed external reading stops after three attempts, retains the original gap, and other news continues',async()=>{
 let reads=0;const f=make({sourceReader:async u=>{if(u===target){reads++;throw Error('unavailable');}return sourceReader(u);}});try{await pending(f);await f.drive(8);f.advance(60001);await f.drive(8);f.advance(120001);await f.drive(8);f.advance(240001);await f.drive(8);assert.equal(reads,3);assert.equal(pipe(f).status,'observing');assert.equal(rows(f)[0].status,'observing');f.add(3);await f.drive(30);assert.equal(pipe(f,f.news(3).id).status,'completed');assert.equal(reads,3);}finally{await f.close();}
});
test('lead, queue, screening and follow-up plan roll back together on audit failure',async()=>{
 const f=make();try{f.add(1);await f.until(()=>f.calls.dossier===1);f.store.db.exec("CREATE TRIGGER reject_link BEFORE INSERT ON research_pipeline_audit WHEN NEW.action='linked-evidence-planned' BEGIN SELECT RAISE(ABORT,'test rollback'); END");await f.step();await f.step();assert.equal(lead(f),undefined);assert.equal(rows(f).length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM news').get().n,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM screening_samples').get().n,1);f.store.db.exec('DROP TRIGGER reject_link');await f.drive(50);assert.equal(rows(f).length,1);assert.equal(pipe(f).status,'completed');}finally{await f.close();}
});
test('a revision of the requesting article invalidates the exact pending request before target fetch',async()=>{
 const reads=[],f=make({sourceReader:async u=>{reads.push(u);return sourceReader(u);}});try{f.add(1);await f.until(()=>f.calls.dossier===1);f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:3});await f.drive(4);const id=rows(f)[0].id;f.revise(1);await f.step();assert.equal(rows(f).find(s=>s.id===id).status,'invalidated');assert.deepEqual(reads,[f.news(1).url]);}finally{await f.close();}
});
test('saved request tampering cannot authorize a new target, and read-only snapshots never create plans',async()=>{
 const f=make();try{f.add(1);await f.until(()=>f.calls.dossier===1);await f.step();const topic=f.service.research.list().find(t=>t.dossier);const stored=f.store.db.prepare('SELECT payload FROM research_topics WHERE id=?').get(topic.id),bad=JSON.parse(stored.payload);bad.dossier.sourceRequests[0].url='https://ir.acme.com/guessed';f.store.db.prepare('UPDATE research_topics SET payload=? WHERE id=?').run(JSON.stringify(bad),topic.id);const before=f.store.db.prepare('SELECT count(*) n FROM news').get().n;for(let i=0;i<3;i++)f.queue.snapshot();assert.equal(f.store.db.prepare('SELECT count(*) n FROM news').get().n,before);await f.drive(15);assert.ok(!f.store.news().some(n=>n.url.endsWith('/guessed')));assert.ok(rows(f).every(s=>!s.current));}finally{await f.close();}
});
