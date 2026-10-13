import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,output,quote} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {intakeBodyPacket,validateIntakeScreening,intakeScreeningPrompt} from '../server/intake-screening.mjs';
import {immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {pdfFixture} from './helpers/pdf-fixture.mjs';
import {extractPdf} from '../server/pdf-source.mjs';
const context={assertActive(){}};
const article=url=>({url,title:'Synthetic statistics release',sourceName:'Synthetic publisher',body:quote+'This fictional survey reports a change from 6.5 percent to 8.6 percent. '+'Frozen synthetic source; not evidence of financial quality. '.repeat(8),scope:'extracted-text'});
const decision=(p,action='observe')=>({items:p.input.items.map(i=>({id:i.id,decision:action,quote:i.material.body.slice(0,150),quoteField:'body',reason:'Synthetic body-level decision; not an independent quality label',missingEvidence:['Independent event evidence and prior expectations']}))});
const answer=(p,action)=>output(p,'screening',decision(p,action));
function setup(f,n=1){f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false,screenUnselected:true});for(let i=0;i<n;i++)f.store.ingest([{...f.news(i),title:'Synthetic routine survey release '+i}],new Date().toISOString());f.service.research.process();f.queue.scan(context);}
const step=f=>f.queue.intake.step(context);
const count=(f,t)=>f.store.db.prepare(`SELECT count(*) n FROM ${t}`).get().n;

test('new intake uses full archived body evidence, keeps exact quote fields and discloses unread links',async()=>{
 let captured,reads=0;const f=fixture({sourceReader:url=>{reads++;return article(url);},intakeRunner:p=>{captured=p;return answer(p);}});try{
  setup(f,2);const newsBefore=f.store.db.prepare('SELECT * FROM news ORDER BY id').all();await step(f);assert.equal(count(f,'intake_screening_runs'),0);await step(f);await step(f);
  assert.equal(reads,2);assert.equal(captured.schema,'intake-screening/2');assert.equal(captured.input.items.length,2);assert(captured.input.items.every(i=>i.material.body===article(i.material.url).body.trim()));assert.equal(f.service.research.list().length,0,'observation does not create research topics');assert.equal(f.queue.snapshot().counts.skipped,2);assert.deepEqual(f.store.db.prepare('SELECT * FROM news ORDER BY id').all(),newsBefore);
  assert.deepEqual(f.queue.snapshot().intake.sources,{total:2,ready:2,unresolved:0,pending:0});assert.match(intakeScreeningPrompt(captured),/缺少数字的标题不等于没有新增量/);assert.match(intakeScreeningPrompt(captured),/附件或链接目标/);
  const ok=decision(captured);assert.deepEqual(validateIntakeScreening(ok,captured),ok);for(const mutate of [o=>o.items[0].quoteField='title',o=>o.items[0].quote='invented',o=>delete o.items[0].quoteField,o=>o.items.pop()]){const bad=structuredClone(ok);mutate(bad);assert.throws(()=>validateIntakeScreening(bad,captured));}
 }finally{await f.close();}
});
test('selected body reuses the same immutable material in the original automatic research chain without a second fetch',async()=>{
 let reads=0;const f=fixture({sourceReader:url=>{reads++;return article(url);},intakeRunner:p=>answer(p,'research')});try{
  setup(f);const paper=f.service.paper.snapshot();await f.until(()=>f.queue.snapshot().counts.completed===1);assert.equal(reads,1);assert.equal(f.calls.extract,1);assert.equal(f.calls.identity,1);assert.equal(f.calls.dossier,1);assert.equal(count(f,'research_materials'),1);assert.equal(f.queue.snapshot().callsInLast24Hours,4);assert.deepEqual(f.service.paper.snapshot(),paper);
  const batch=JSON.parse(f.store.db.prepare('SELECT payload FROM intake_screening_batches').get().payload),material=batch.packet.input.items[0].material;assert.deepEqual(immutableMaterialSnapshot(f.store.db,material),material);assert(f.service.research.list().some(t=>t.evidence.some(e=>e.materialId===material.id)));assert.equal(f.queue.snapshot().items[0].intakeScreening.scope,'extracted-source-text');
 }finally{await f.close();}
});
test('failed source keeps the full denominator with 60/120 second retries while other bodies continue',async()=>{
 const readCalls=[],f=fixture({sourceReader:url=>{readCalls.push(url);if(url.endsWith('-0'))throw Error('secret error');return article(url);},intakeRunner:p=>answer(p)});try{
  setup(f,2);await step(f);await step(f);await step(f);assert.equal(count(f,'intake_screening_runs'),1);assert.equal(f.queue.snapshot().intake.items[0].total,1);assert.equal(f.queue.snapshot().intake.waitingItems,1);f.advance(60000);await step(f);f.advance(119999);await step(f);assert.equal(readCalls.length,3);f.advance(1);await step(f);assert.equal(readCalls.length,4);assert.equal(f.queue.snapshot().intake.sources.unresolved,1);assert.equal(f.queue.snapshot().intake.totals.unresolvedItems,1);assert.equal(f.queue.snapshot().counts.observing,1);assert.doesNotMatch(JSON.stringify(f.queue.snapshot()),/secret error/);assert.equal(f.queue.snapshot().callsInLast24Hours,1);
 }finally{await f.close();}
});
test('pause discards late source writes and resumes only the unresolved read, with no model invocation before archive',async()=>{
 let release,reads=0;const f=fixture({sourceReader:url=>{reads++;return reads===1?new Promise(r=>{release=()=>r(article(url));}):article(url);},intakeRunner:p=>answer(p)});try{
  setup(f);const work=f.step();for(let i=0;!release&&i<30;i++)await new Promise(r=>setImmediate(r));assert(release);f.service.controlOperation('discovery','pause');release();await work;assert.equal(count(f,'research_materials'),0);assert.equal(count(f,'intake_screening_runs'),0);f.advance(30001);await f.until(()=>f.queue.snapshot().intake.counts.completed===1);assert.equal(reads,2);assert.equal(count(f,'research_materials'),1);
 }finally{release?.();await f.close();}
});
test('source revision or disabling intake cannot publish a late body; unchanged sources can resume',async()=>{
 for(const change of ['revision','disabled']){let release;const f=fixture({sourceReader:url=>new Promise(r=>{release=()=>r(article(url));}),intakeRunner:p=>answer(p)});try{
  setup(f);const work=step(f);for(let i=0;!release&&i<30;i++)await new Promise(r=>setImmediate(r));if(change==='revision'){f.store.ingest([{...f.news(0),title:'Revised synthetic routine survey'}],new Date().toISOString());f.service.research.process();}else f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false,screenUnselected:false});release();await work;assert.equal(count(f,'research_materials'),0);assert.equal(count(f,'intake_screening_runs'),0);
 }finally{release?.();await f.close();}}
});
test('body archive and queue pointer commit together; failure retains a retry instead of a false ready count',async()=>{
 const f=fixture({sourceReader:article,intakeRunner:p=>answer(p)});try{
  setup(f);f.store.db.exec("CREATE TRIGGER reject_body BEFORE INSERT ON research_materials BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END");await step(f);assert.equal(count(f,'research_materials'),0);assert.equal(f.queue.snapshot().intake.sources.ready,0);f.store.db.exec('DROP TRIGGER reject_body');f.advance(60000);await step(f);await step(f);assert.equal(count(f,'research_materials'),1);assert.equal(f.queue.snapshot().intake.counts.completed,1);
 }finally{await f.close();}
});
test('expired source read cannot overwrite a newer archive',async()=>{
 let release,reads=0;const f=fixture({sourceReader:url=>{reads++;return reads===1?new Promise(r=>{release=()=>r({...article(url),body:article(url).body+' OLD'});}):{...article(url),body:article(url).body+' NEW'};},intakeRunner:p=>answer(p)});try{
  setup(f);const old=step(f);for(let i=0;!release&&i<30;i++)await new Promise(r=>setImmediate(r));f.advance(30001);await step(f);release();await old;await step(f);assert.equal(count(f,'research_materials'),1);const m=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials').get().payload);assert(m.body.endsWith(' NEW'));assert.equal(f.queue.snapshot().intake.counts.completed,1);
 }finally{release?.();await f.close();}
});
test('body batches split by byte limit with complete material text retained',async()=>{
 const sizes=[],f=fixture({sourceReader:url=>({...article(url),body:'合成完整正文'.repeat(12000)}),intakeRunner:p=>{sizes.push(p.input.items.map(i=>i.material.body.length));return answer(p);}});try{
  setup(f,4);for(let i=0;i<12&&f.queue.snapshot().intake.waitingItems;i++)await step(f);assert(sizes.length>1);assert.equal(sizes.flat().length,4);assert(sizes.flat().every(n=>n===72000));assert.equal(f.queue.snapshot().intake.totals.completedItems,4);assert.equal(count(f,'research_materials'),4);assert.throws(()=>intakeBodyPacket(Array.from({length:4},(_,i)=>({id:String(i),title:'Synthetic',material:{id:'m'+i,contentHash:'x',body:'合成'.repeat(50000)}}))));
 }finally{await f.close();}
});
test('stored body integrity is checked before inference or adoption',async()=>{
 let calls=0;const f=fixture({sourceReader:article,intakeRunner:p=>{calls++;return answer(p,'research');}});try{
  setup(f);await step(f);const row=f.store.db.prepare('SELECT id,payload FROM research_materials').get(),m=JSON.parse(row.payload);m.body+='tampered';f.store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify(m),row.id);await step(f);assert.equal(f.queue.snapshot().intake.totals.unresolvedItems,1);assert.equal(calls,0);assert.equal(f.queue.snapshot().counts.queued||0,0);
 }finally{await f.close();}
});
test('the first twenty sources in backoff do not hold later readable sources behind them',async()=>{
 let calls=0;const f=fixture({sourceReader:url=>{if(!url.endsWith('-20'))throw Error('unavailable');return article(url);},intakeRunner:p=>{calls++;return answer(p);}});try{
  setup(f,21);for(let i=0;i<22;i++)await step(f);assert.equal(calls,1);assert.equal(f.queue.snapshot().intake.sources.ready,1);assert.equal(f.queue.snapshot().intake.waitingItems,20);assert.equal(f.queue.snapshot().intake.totals.completedItems,1);
 }finally{await f.close();}
});
test('archived PDF bytes survive entry screening and reuse without another source read',async()=>{
 const bytes=pdfFixture(['Synthetic complete text source with evidence and remaining uncertainty.']);let reads=0;const f=fixture({sourceReader:async url=>{reads++;return {...await extractPdf(bytes,url),url};},intakeRunner:p=>answer(p,'research')});try{
  setup(f);await step(f);await step(f);const item=f.queue.snapshot().items[0],saved=JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials').get().payload),topic=f.service.research.createFromNews({newsId:item.newsId,newsRevision:1});const result=f.service.research.useStoredMaterial(topic.id,{version:topic.version,url:f.news(0).url,stance:'unverified',family:'other',step:'fact',interpretation:'Synthetic archived source reuse'},saved);assert.equal(reads,1);assert.deepEqual(Buffer.from(f.store.db.prepare('SELECT body FROM research_source_documents').get().body),bytes);assert(result.evidence.some(e=>e.materialId===saved.id));assert.deepEqual(immutableMaterialSnapshot(f.store.db,saved),saved);
 }finally{await f.close();}
});
