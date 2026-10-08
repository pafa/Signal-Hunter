import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,at,quote,comparison,allClusters,extraction,output,dossier} from './automatic-research-fixture.mjs';
import {recallEvidenceNews} from '../server/evidence-recall.mjs';

const items=f=>f.queue.snapshot().evidence.items;
const row=(f,n)=>f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE news_id=? ORDER BY rowid DESC LIMIT 1').get(f.news(n).id);
const raw=f=>f.store.db.prepare('SELECT * FROM research_evidence_searches ORDER BY rowid').all();
const payload=r=>JSON.parse(r.payload);
const quiet='虚构甲公司与虚构乙公司事项进展';
function addQuiet(f,i=2,extra={}){f.store.ingest([{...f.news(i),title:quiet,...extra}],at);f.service.research.process();}
async function anchor(f){f.add(1);await f.drive();return f.service.research.get(f.service.research.list().find(t=>t.dossier).id);}
async function completed(f){await anchor(f);addQuiet(f);await f.drive(45);return items(f).find(r=>r.candidates.some(c=>c.newsId===f.news(2).id));}

test('a skipped current headline is autonomously read, researched, compared and included in event synthesis',async()=>{
 const f=fixture();try{const original=await anchor(f);const before=f.service.paper.snapshot();addQuiet(f);f.queue.scan({assertActive(){}});const initial=payload(row(f,2));assert.equal(row(f,2).status,'skipped');await f.drive(45);
  const source=row(f,2),search=items(f).find(r=>r.candidates.some(c=>c.newsId===f.news(2).id));assert.equal(source.status,'completed');assert.equal(payload(source).selectionReason,'evidence-followup');assert.deepEqual(payload(source).screening,initial.screening);assert.equal(search.status,'completed');assert.equal(search.candidates[0].status,'matched');assert.equal(search.candidates[0].pairs[0].scopes[0],'extracted-text');assert.equal(f.calls.dossier,2);assert.equal(f.calls.semantic,1);assert.equal(f.synthesisCalls,1);assert.equal(allClusters(f).length,1);assert.deepEqual(f.service.research.get(original.id),original);assert.deepEqual(f.service.paper.snapshot(),before);
 }finally{await f.close();}
});

test('no match is recorded once; newly received related material starts a new search without erasing the old range',async()=>{
 const f=fixture();try{await anchor(f);const saved=raw(f);await f.drive(3);assert.deepEqual(raw(f),saved);addQuiet(f);await f.drive(45);assert.equal(items(f).find(r=>r.id===saved[0].id).status,'historical');assert.deepEqual(raw(f).find(r=>r.id===saved[0].id),saved[0]);assert.equal(items(f).find(r=>r.candidates.length).coverage.newsIndexed,2);
 }finally{await f.close();}
});

test('manual-era skipped items are not activated by later automatic research',async()=>{
 const f=fixture();try{f.queue.configure({version:2,automatic:false,extractEvents:true,includeClues:false,dailyCalls:100});addQuiet(f);f.queue.scan({assertActive(){}});const old=row(f,2);f.queue.configure({version:3,automatic:true,extractEvents:true,includeClues:false,dailyCalls:100});await anchor(f);assert.deepEqual(row(f,2),old);assert.ok(items(f).every(s=>s.coverage.automaticRevisions===1));assert.equal(f.calls.dossier,1);
 }finally{await f.close();}
});

test('follow-up respects the shared call budget and pause without requiring a new user step',async()=>{
 const f=fixture();try{await anchor(f);const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});addQuiet(f);await f.drive(3);assert.equal(row(f,2).status,'queued');assert.equal(f.calls.dossier,1);const before=raw(f);f.service.controlOperation('discovery','pause');assert.throws(()=>f.service.runOperation('discovery'),/暂停/);assert.deepEqual(raw(f),before);f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false});await f.drive(45);assert.equal(row(f,2).status,'completed');
 }finally{await f.close();}
});

for(const kind of ['unrelated','analogy','uncertain'])test(`${kind} is preserved without turning the lead into corroborating event evidence`,async()=>{
 const f=fixture({semanticRunner:p=>comparison(p,kind)});try{const s=await completed(f);assert.equal(s.candidates[0].status,kind==='unrelated'?'unrelated':kind==='analogy'?'related':'observing');assert.equal(allClusters(f).length,0);assert.equal(f.synthesisCalls,0);const calls={...f.calls};await f.drive(3);assert.deepEqual(f.calls,calls);
 }finally{await f.close();}
});

test('a user-edited anchor invalidates pending lookup, keeps input history and does not overwrite the edit',async()=>{
 const f=fixture();try{const t=await anchor(f);const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});addQuiet(f);await f.drive(2);const search=items(f).find(s=>s.candidates.length);f.service.research.update(t.id,{nextEvidence:'本人修订观察依据',version:t.version});const edited=f.service.research.get(t.id);assert.equal(items(f).find(s=>s.id===search.id).status,'invalidated');await f.step();assert.equal(raw(f).find(r=>r.id===search.id).status,'invalidated');assert.deepEqual(f.service.research.get(t.id),edited);
 }finally{await f.close();}
});

test('source revisions and withdrawal immediately mark saved follow-up results as non-current on read',async()=>{
 const f=fixture();try{const s=await completed(f),before=raw(f),run=f.service.semanticEvents.get(s.candidates[0].pairs[0].runId);f.service.semanticEvents.decide(run.id,{version:run.decisionVersion,action:'withdraw',note:'合成撤回'});assert.equal(items(f).find(r=>r.id===s.id).current,false);assert.deepEqual(raw(f),before);addQuiet(f,2,{title:quiet+'更新'});assert.equal(items(f).find(r=>r.id===s.id).status,'invalidated');assert.deepEqual(raw(f),before);
 }finally{await f.close();}
});

test('cancelled supplementary extraction remains cancelled and is never resurrected by follow-up',async()=>{
 let release,packet,calls=0;const f=fixture({extractionRunner:p=>{if(++calls===2){packet=p;return new Promise(resolve=>{release=resolve;});}return extraction(p);}});try{await anchor(f);addQuiet(f);await f.until(()=>row(f,2)?.status==='processing');await f.service.runOperation('discovery');const j=f.queue.snapshot().events.items.find(j=>j.kind==='extract'&&j.title===quiet);f.service.materialEvents.cancel(j.topicId,j.runId);release(extraction(packet));await f.finish();await f.drive(15);const source=row(f,2);assert.equal(source.status,'cancelled');const count=f.calls.extract;f.advance(600000);await f.drive(5);assert.equal(f.calls.extract,count);assert.equal(items(f).find(s=>s.candidates.length).candidates[0].status,'cancelled');
 }finally{if(release)release(extraction(packet));await f.close();}
});

test('failed supplementary reading uses three attempts and then observes while other news continues',async()=>{
 let reads=0;const f=fixture({sourceReader:async url=>{if(url.endsWith('-2')){reads++;throw Error('synthetic source inaccessible');}return {url,title:'合成',sourceName:'合成',body:quote.repeat(30),scope:'extracted-text'};}});try{await anchor(f);addQuiet(f);await f.drive(6);assert.equal(reads,1);f.advance(60001);await f.drive(6);assert.equal(reads,2);f.advance(120001);await f.drive(6);f.advance(240001);await f.drive(6);assert.equal(reads,3);assert.equal(row(f,2).status,'observing');assert.equal(items(f).find(s=>s.anchor.kind==='event'&&s.candidates.length).candidates[0].status,'observing');f.add(3);await f.drive(30);assert.equal(row(f,3).status,'completed');assert.equal(reads,3);
 }finally{await f.close();}
});

test('unreadable selected news can trigger alternate received-source research without claiming original verification',async()=>{
 const f=fixture({sourceReader:async url=>{if(url.endsWith('-1'))throw Error('synthetic unreadable primary');return {url,title:'合成',sourceName:'合成',body:quote.repeat(30),scope:'extracted-text'};}});try{f.store.ingest([{...f.news(1),title:'虚构甲公司与虚构乙公司事项进展，收购批准'}, {...f.news(2),title:quiet}],at);f.service.research.process();await f.drive(35);const s=items(f).find(s=>s.anchor.kind==='source'&&s.candidates.length);assert.equal(row(f,2).status,'completed');assert.equal(s.candidates[0].status,'researched');assert.match(s.candidates[0].reason,/不能确认/);assert.equal(f.calls.dossier,1);assert.equal(row(f,1).status,'failed');
 }finally{await f.close();}
});

test('search and queue activation are one transaction; retry does not duplicate research',async()=>{
 const f=fixture();try{await anchor(f);addQuiet(f);f.queue.scan({assertActive(){}});const original=row(f,2),count=raw(f).length;f.store.db.exec("CREATE TRIGGER fail_evidence BEFORE INSERT ON research_evidence_searches BEGIN SELECT RAISE(ABORT,'synthetic search save failure'); END");await f.step();assert.deepEqual(row(f,2),original);assert.equal(raw(f).length,count);f.store.db.exec('DROP TRIGGER fail_evidence');await f.drive(45);assert.equal(f.calls.dossier,2);assert.equal(f.calls.semantic,1);
 }finally{await f.close();}
});

test('restart retains finished follow-up and reuses all prior calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'evidence-followup-')),path=join(dir,'test.sqlite');let f=fixture({path});try{await completed(f);const before=raw(f),snap=items(f);await f.close();f=fixture({path});await f.drive(5);assert.deepEqual(raw(f),before);assert.deepEqual(items(f),snap);assert.deepEqual(f.calls,{extract:0,identity:0,dossier:0,semantic:0});assert.equal(f.synthesisCalls,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('bounded lookup discloses eligible matches and excludes the same source and old publication windows',async()=>{
 const f=fixture();try{await anchor(f);for(let i=2;i<=6;i++)addQuiet(f,i);const n=f.store.newsById(f.news(1).id),event=f.service.research.list().find(t=>t.dossier).eventExtraction.event;assert.deepEqual(recallEvidenceNews({news:n,event},[{news:{...f.news(9),title:quiet,publishedAt:'2025-01-01T00:00:00Z'},item:{id:'old'}},{news:{...f.news(8),title:quiet,url:n.url},item:{id:'same'}}]),[]);const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});await f.step();const search=items(f).find(s=>s.candidates.length);assert.equal(search.coverage.matches,5);assert.equal(search.coverage.selected,3);assert.equal(search.candidates.length,3);assert.equal([2,3,4,5,6].filter(i=>row(f,i).status==='queued').length,3);
 }finally{await f.close();}
});

test('supplementary research is explicitly compared to its anchor even when ordinary occurrence recall misses it',async()=>{
 let calls=0;const f=fixture({extractionRunner:p=>{const r=extraction(p);if(++calls===1)return r;return output(p,'decomposition',{...r.decomposition,events:[{...r.decomposition.events[0],title:'项目取消',actor:'虚构甲',action:'取消',object:'项目',quote:'虚构甲取消项目。'}]});}});try{const s=await completed(f);assert.equal(s.candidates[0].status,'matched');const pair=s.candidates[0].pairs[0];const saved=f.store.db.prepare('SELECT payload FROM research_pipeline_relations WHERE id=?').get(pair.id);assert.equal(payload(saved).recallRulesHash,'evidence-followup/1');assert.equal(pair.target.id,s.anchor.topicId);assert.equal(f.calls.semantic,1);assert.equal(allClusters(f).length,1);
 }finally{await f.close();}
});

test('a manually created source research is preserved and never replaced by supplementary research',async()=>{
 const f=fixture();try{await anchor(f);addQuiet(f);const existing=f.service.research.createFromNews({newsId:f.news(2).id,newsRevision:1});const before=f.service.research.get(existing.id);await f.drive(10);assert.equal(row(f,2).status,'observing');assert.deepEqual(f.service.research.get(existing.id),before);assert.equal(f.calls.dossier,1);assert.equal(items(f).find(s=>s.candidates.length).candidates[0].status,'observing');
 }finally{await f.close();}
});

test('snapshot never mutates plans; a restore lock prevents background search and activation',async()=>{
 const f=fixture();try{await anchor(f);addQuiet(f);f.queue.scan({assertActive(){}});const before=raw(f),source=row(f,2);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();f.queue.snapshot();f.service.snapshot();assert.deepEqual(raw(f),before);assert.deepEqual(row(f,2),source);await assert.rejects(f.queue.step({assertActive(){}}),/恢复/);assert.deepEqual(raw(f),before);assert.deepEqual(row(f,2),source);
 }finally{await f.close();}
});

test('one failed occurrence does not prevent available supplementary occurrences from being compared',async()=>{
 let extractions=0;const f=fixture({extractionRunner:p=>{const r=extraction(p);if(++extractions===1)return r;return output(p,'decomposition',{...r.decomposition,events:[...r.decomposition.events,{...r.decomposition.events[0],title:'项目取消',actor:'虚构甲',action:'取消',object:'项目',quote:'虚构甲取消项目。'}]});},researchRunner:p=>{if(p.input.title==='项目取消')throw Error('synthetic dossier unavailable');return dossier(p);}});try{await anchor(f);addQuiet(f);await f.drive(30);f.advance(60001);await f.drive(10);f.advance(120001);await f.drive(25);assert.equal(row(f,2).status,'observing');const s=items(f).find(r=>r.anchor.newsId===f.news(1).id&&r.candidates.length);assert.equal(s.candidates[0].status,'matched');assert.equal(s.candidates[0].partial,true);assert.match(s.candidates[0].scopeNote,/部分事项/);assert.equal(s.candidates[0].pairs.length,1);assert.equal(f.calls.dossier,5);
 }finally{await f.close();}
});

test('alternate-source results become historical evidence on user edits without rewriting their saved outcome',async()=>{
 const f=fixture({sourceReader:async url=>{if(url.endsWith('-1'))throw Error('synthetic unreadable primary');return {url,title:'合成',sourceName:'合成',body:quote.repeat(30),scope:'extracted-text'};}});try{f.store.ingest([{...f.news(1),title:'虚构甲公司与虚构乙公司事项进展，收购批准'}, {...f.news(2),title:quiet}],at);f.service.research.process();await f.drive(35);const s=items(f).find(s=>s.anchor.kind==='source'&&s.candidates.length),ref=s.candidates[0].researchRefs[0],before=raw(f);assert.equal(s.current,true);f.service.research.update(ref.id,{version:ref.version,nextEvidence:'本人补充新的观察点'});assert.equal(items(f).find(r=>r.id===s.id).current,false);assert.deepEqual(raw(f),before);
 }finally{await f.close();}
});
