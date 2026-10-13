import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,quote,dossier} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {LINKED_EVIDENCE_POLICY} from '../server/pipeline-linked-evidence.mjs';
const root='https://example.com/synthetic-1',notice='https://ir.acme.com/notice',annex='https://ir.acme.com/annex',beyond='https://ir.acme.com/depth-three';
const links=url=>url===root?[notice]:url===notice?[root,annex]:url===annex?[beyond]:[];
const material=url=>({url,title:'合成材料',sourceName:'合成',body:quote.repeat(30),scope:'extracted-text',sourceLinks:{schema:'article-source-links/4',scope:'extracted-html-links',links:links(url).map(url=>({url,label:'明确来源',context:'仍未读取的补证链接'})),inspected:links(url).length,omitted:0,truncated:false}});
function runner(p){const d=dossier(p),e=p.input.evidence.find(e=>e.material?.sourceLinks),sourceRequests=(e?.material.sourceLinks.links||[]).map(l=>({evidenceId:e.id,url:l.url,reason:'核对当前缺口'})),value={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests},rawOutput=JSON.stringify(value);return {...d,...value,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};}
const rows=f=>f.queue.snapshot().evidence.items.filter(s=>s.policy===LINKED_EVIDENCE_POLICY);
const news=(f,url)=>f.store.news().find(n=>n.url===url);
const pipe=(f,url)=>{const n=news(f,url);return n&&f.store.db.prepare('SELECT * FROM research_pipeline_items WHERE news_id=?').get(n.id);};
const make=opts=>fixture({sourceReader:async url=>material(url),researchRunner:runner,...opts});

test('automatic two-hop supplements retain parent chain, avoid backlinks and record depth-three exclusion',async()=>{
 const reads=[],f=make({sourceReader:async u=>{reads.push(u);return material(u);}});try{const paper=f.service.paper.snapshot();f.add(1);await f.drive(110);
 assert.deepEqual(reads,[root,notice,annex]);assert.equal(f.calls.dossier,3);assert.equal(pipe(f,annex).status,'completed');assert.equal(news(f,beyond),undefined);
 const second=rows(f).find(r=>r.coverage.depth===2),limit=rows(f).find(r=>r.coverage.depth===3);
 assert.equal(second.coverage.maximumDepth,2);assert.equal(second.candidates.length,1);assert.equal(second.excluded.length,1);assert.match(second.excluded[0].reason,/返回/);
 assert.equal(limit.status,'observing');assert.equal(limit.coverage.selected,0);assert.equal(limit.excluded[0].url,beyond);assert.match(limit.excluded[0].reason,/上限/);
 assert.deepEqual(news(f,annex).linkedReference.lineage.map(n=>n.url),[root,notice]);assert.equal(news(f,annex).linkedReference.depth,2);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});
test('editing root research invalidates a pending second-hop read through the full provenance chain',async()=>{
 const reads=[],f=make({sourceReader:async u=>{reads.push(u);return material(u);}});try{f.add(1);await f.until(()=>rows(f).some(r=>r.coverage.depth===2));const first=rows(f).find(r=>r.coverage.depth===1),t=f.service.research.get(first.anchor.topicId);f.service.research.update(t.id,{version:t.version,nextEvidence:'本人修订根研究'});await f.drive(25);
 assert.deepEqual(reads,[root,notice]);assert.equal(pipe(f,annex).status,'invalidated');assert.equal(rows(f).find(r=>r.coverage.depth===2).status,'invalidated');
 }finally{await f.close();}
});
test('forged parent depth does not create a third-level read or recursive validation loop',async()=>{
 const f=make();try{f.add(1);await f.until(()=>f.calls.dossier===2);const n=news(f,notice),row=f.store.db.prepare('SELECT payload FROM news WHERE id=?').get(n.id),bad=JSON.parse(row.payload);bad.linkedReference.depth=2;bad.linkedReference.lineage.push({newsId:n.id,revision:n.revision,url:n.url});f.store.db.prepare('UPDATE news SET payload=? WHERE id=?').run(JSON.stringify(bad),n.id);await f.drive(12);assert.equal(news(f,annex),undefined);assert.equal(rows(f).filter(r=>r.coverage.depth===2).length,0);
 }finally{await f.close();}
});
test('second-hop request resumes after shared quota and restart without duplicated reads',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-link-depth-')),path=join(dir,'db.sqlite'),reads=[];const opts={path,sourceReader:async u=>{reads.push(u);return material(u);}};let f=make(opts);try{f.add(1);await f.until(()=>f.calls.dossier===2);const used=f.queue.snapshot().callsInLast24Hours;f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:used});await f.drive(6);assert.equal(pipe(f,annex).status,'queued');await f.close();f=make(opts);f.queue.configure({version:f.queue.snapshot().settings.version,includeClues:false,dailyCalls:100});await f.drive(100);assert.deepEqual(reads,[root,notice,annex]);assert.equal(pipe(f,annex).status,'completed');assert.equal(rows(f).filter(r=>r.coverage.depth===2).length,1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('second-hop source failure stops after three reads and retains the parent gaps',async()=>{
 let failed=0;const f=make({sourceReader:async u=>{if(u===annex){failed++;throw Error('test unavailability');}return material(u);}});try{f.add(1);await f.until(()=>failed===1);await f.drive(15);f.advance(60001);await f.drive(15);f.advance(120001);await f.drive(20);f.advance(240001);await f.drive(15);assert.equal(failed,3);assert.equal(pipe(f,annex).status,'observing');assert.equal(rows(f).find(r=>r.coverage.depth===2).status,'observing');assert(news(f,notice));assert.equal(news(f,beyond),undefined);
 }finally{await f.close();}
});
