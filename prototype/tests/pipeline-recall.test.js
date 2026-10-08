import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,comparison,extraction,output} from './automatic-research-fixture.mjs';
import {recallOccurrence} from '../server/event-continuity.mjs';

const options={semanticRunner:p=>comparison(p,'unrelated')};
const scans=f=>f.store.db.prepare('SELECT * FROM research_relation_scans ORDER BY rowid').all();
const latest=f=>scans(f).at(-1);
const coverage=f=>f.queue.snapshot().relations.recall.items.find(c=>c.scanId===latest(f).id);
async function prepare(f,n=6){for(let i=1;i<n;i++){f.add(i);await f.drive(40);}f.add(n);await f.until(()=>scans(f).length===n);assert.equal(latest(f).cursor,3);assert.equal(latest(f).status,'pending');return latest(f);}

test('automatic recall freezes all current targets and continues beyond the first three without orders',async()=>{
 const f=fixture(options);try{const book=f.service.paper.snapshot(),scan=await prepare(f),p=JSON.parse(scan.payload);assert.equal(p.coverage.topicsIndexed,5);assert.equal(p.candidates.length,5);assert.equal(coverage(f).remainingTopics,2);
  await f.drive(60);const c=coverage(f);assert.equal(c.selectedTopics,5);assert.equal(c.remainingTopics,0);assert.equal(c.counts.completed,5);assert.equal(f.calls.semantic,15);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_relations WHERE item_id=?').get(scan.item_id).n,5);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'relation'}).total,0);
 }finally{await f.close();}
});
test('automatic recall indexes an older matching occurrence beyond 500 while manual recall retains its bound',()=>{
 const base={status:'active',evidence:[],eventExtraction:{sourceTopicId:'source',event:{title:'合成收购项目',actor:'虚构公司',action:'收购',object:'特殊项目',quote:'虚构公司计划收购特殊项目'}}},source={...base,id:'source'};
 const old={...base,id:'old',updatedAt:'2020',eventExtraction:{...base.eventExtraction,sourceTopicId:'old'}};
 const topics=Array.from({length:501},(_,i)=>({...base,id:`new-${i}`,updatedAt:'2026',eventExtraction:{sourceTopicId:`new-${i}`,event:{title:'休闲旅行',actor:'其他',action:'游玩',object:'公园',quote:'游览公园'}}}));topics.push(old);
 assert.equal(recallOccurrence(source,topics).coverage.topicsIndexed,500);assert.equal(recallOccurrence(source,topics).items.length,0);const all=recallOccurrence(source,topics,{limit:null});assert.equal(all.coverage.topicsIndexed,502);assert.deepEqual(all.items.map(t=>t.right.id),['old']);
});
test('quota and restart preserve the frozen page cursor and existing comparison calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'recall-restart-'));let f=fixture({...options,path:join(dir,'test.sqlite')});try{const scan=await prepare(f),before=f.store.db.prepare('SELECT * FROM research_pipeline_attempts ORDER BY id').all(),s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});await f.drive();assert.equal(latest(f).cursor,scan.cursor);f.service.controlOperation('discovery','pause');await f.close();f=fixture({...options,path:join(dir,'test.sqlite')});assert(f.service.operations().tasks.discovery.paused);assert.equal(latest(f).payload,scan.payload);assert.equal(latest(f).cursor,3);f.advance(86400001);await f.drive(60);assert.equal(coverage(f).remainingTopics,0);assert.equal(coverage(f).counts.completed,5);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_attempts WHERE id<=? ORDER BY id').all(before.at(-1).id),before);assert.equal(f.calls.semantic,5);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('page scheduling and cursor roll back together on storage failure',async()=>{
 const f=fixture(options);try{const scan=await prepare(f);f.store.db.exec("CREATE TRIGGER fail_recall_page BEFORE UPDATE OF cursor ON research_relation_scans WHEN NEW.cursor>3 BEGIN SELECT RAISE(ABORT,'synthetic-cursor'); END");await f.drive(30);assert.equal(latest(f).cursor,3);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_relations WHERE item_id=?').get(scan.item_id).n,3);f.store.db.exec('DROP TRIGGER fail_recall_page');await f.drive(40);assert.equal(coverage(f).counts.completed,5);assert.equal(f.calls.semantic,15);
 }finally{await f.close();}
});
test('a target edited after recall is retained as a gap and does not block later targets',async()=>{
 const f=fixture(options);try{const scan=await prepare(f),p=JSON.parse(scan.payload),target=f.service.research.get(p.candidates[3].right.id);f.service.research.update(target.id,{version:target.version,nextEvidence:'本人修改，旧召回不可覆盖'});await f.drive(60);assert.equal(coverage(f).remainingTopics,0);assert.equal(coverage(f).counts.invalidated,1);assert.equal(coverage(f).counts.completed,4);assert.equal(f.service.research.get(target.id).nextEvidence,'本人修改，旧召回不可覆盖');
 }finally{await f.close();}
});
test('edited source stops its remaining pages and exposes the original scope',async()=>{
 const f=fixture(options);try{const scan=await prepare(f),p=JSON.parse(scan.payload),topic=f.service.research.get(p.source.id);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'本人新方向'});await f.drive(40);const c=coverage(f);assert.equal(c.status,'invalidated');assert.equal(c.current,false);assert.equal(c.selectedTopics,3);assert.equal(c.remainingTopics,2);assert.equal(c.recalledTopics,5);assert.match(c.reason,/已变化/);assert.equal(f.service.research.get(topic.id).nextEvidence,'本人新方向');
 }finally{await f.close();}
});
test('legacy automatic scope recovery preserves completed and cancelled comparisons without duplicate calls',async()=>{
 const f=fixture(options);try{const scan=await prepare(f);await f.drive(60);const rows=f.store.db.prepare('SELECT * FROM research_pipeline_relations WHERE item_id=? ORDER BY rowid').all(scan.item_id);f.store.db.prepare("UPDATE research_pipeline_relations SET status='cancelled' WHERE id=?").run(rows[0].id);const before=f.store.db.prepare('SELECT * FROM research_pipeline_relations ORDER BY rowid').all(),calls=f.calls.semantic;f.store.db.prepare('DELETE FROM research_relation_scans WHERE id=?').run(scan.id);await f.drive(40);assert.equal(coverage(f).remainingTopics,0);assert.equal(f.calls.semantic,calls);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_pipeline_relations ORDER BY rowid').all(),before);assert.equal(coverage(f).counts.cancelled,1);
 }finally{await f.close();}
});
test('continuous new sources and comparison backlog each receive durable scheduler turns',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'recall-fairness-'));let f=fixture({...options,path:join(dir,'test.sqlite')});try{await prepare(f);const calls=f.calls.semantic;for(let i=10;i<20;i++)f.add(i);const before=f.store.db.prepare("SELECT count(*) n FROM research_pipeline_items WHERE topic_id IS NOT NULL").get().n;await f.drive(10);assert(f.calls.semantic>calls,'comparison progresses while sources are queued');assert(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_items WHERE topic_id IS NOT NULL").get().n>before,'source preparation progresses before recall backlog drains');const saved=f.store.db.prepare("SELECT value FROM settings WHERE key='research_pipeline_next_lane'").get().value;assert(['events','relations','clusters','synthesis','sources'].includes(saved));f.service.controlOperation('discovery','pause');await f.close();f=fixture({...options,path:join(dir,'test.sqlite')});assert.equal(f.store.db.prepare("SELECT value FROM settings WHERE key='research_pipeline_next_lane'").get().value,saved);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('quota reached between pages reports a wait rather than an empty queue',async()=>{
 const f=fixture(options);try{await prepare(f);await f.until(()=>coverage(f).counts.completed===3);assert.equal(coverage(f).remainingTopics,2);const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});const r=await f.step();assert(r.skipReasons.some(r=>r.reason==='call-limit'));assert.equal(coverage(f).remainingTopics,2);f.advance(86400001);await f.drive(40);assert.equal(coverage(f).counts.completed,5);
 }finally{await f.close();}
});

test('an unfinished target resumes a prior asymmetric recall match after its own dossier completes',async()=>{
 const f=fixture({extractionRunner:p=>{const base=extraction(p);if(p.input.material.url.endsWith('-2'))base.decomposition.events[0].object+=' alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu';return output(p,'decomposition',base.decomposition);}});try{
  f.add(1);f.add(2);await f.until(()=>scans(f).length===1);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_relations WHERE json_extract(payload,'$.awaitingTargetDossier')=1").get().n,1);await f.drive(60);const c=coverage(f);assert.equal(c.deferredMatches,1);assert.equal(c.counts.completed,1);assert.equal(f.calls.semantic,1);assert.equal(f.service.eventClusters.get(f.service.eventClusters.list().items[0].id).members.length,2);
 }finally{await f.close();}
});

for(const reverse of [false,true])test(`queued groups finish all comparison scans without false idle or reversed duplicates (${reverse?'reverse':'forward'} inputs)`,async()=>{
 const f=fixture({extractionRunner:p=>{const n=Number(p.input.material.url.split('-').at(-1)),base=extraction(p);base.decomposition.events[0].object=`合成组${Math.floor(n/3)}`;return output(p,'decomposition',base.decomposition);},semanticRunner:p=>comparison(p,p.input.left.eventFocus.object===p.input.right.eventFocus.object?'followup':'unrelated')});try{
  const ids=Array.from({length:12},(_,i)=>i);for(const i of reverse?ids.reverse():ids)f.add(i);
  let idle=0;for(let step=0;step<650&&idle<2;step++){const r=await f.step();if(r.skipReasons?.some(r=>r.reason==='call-limit'))f.advance(86400001);idle=r.skipReasons?.some(r=>r.reason==='no-queued-items')?idle+1:0;}
  assert.equal(idle,2);const groups=f.service.eventClusters.list().items.map(c=>f.service.eventClusters.get(c.id));assert.equal(groups.length,4);assert(groups.every(c=>c.members.length===3&&c.pairs.length===3&&c.health.current));assert.equal(f.calls.semantic,66,'one model call per unordered pair');assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_pipeline_relations r JOIN semantic_runs s ON s.id=r.run_id WHERE r.status='completed' AND NOT EXISTS(SELECT 1 FROM research_pipeline_cluster_jobs j WHERE j.relation_id=r.id)").get().n,0,'no completed relation is hidden behind an idle scan');
 }finally{await f.close();}
});
