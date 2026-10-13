import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {fixture,quote,output,extraction,comparison} from './automatic-research-fixture.mjs';
const article=url=>({url,title:'Synthetic shared source',sourceName:'Synthetic',body:quote+'Synthetic workflow check only. '.repeat(30),scope:'extracted-text'});
const add=(f,i,url=f.news(i).url)=>{f.store.ingest([{...f.news(i),url}],'2026-10-08T00:00:00Z');f.service.research.process();};
const results=f=>f.queue.snapshot().items.map(i=>i.researchResults);

test('source and duplicate link directly to the saved occurrence, not the source draft; reads make no writes',async()=>{
 const f=fixture({sourceReader:article});try{
  add(f,1);add(f,2,f.news(1).url);await f.drive(30);const before=f.store.db.prepare('SELECT total_changes() n').get().n,calls={...f.calls},rows=f.queue.snapshot().items,projected=results(f);
  assert.equal(rows.length,2);for(const [i,r] of projected.entries()){assert.equal(r.state,'available');assert.equal(r.items.length,1);assert.equal(r.items[0].hasDossier,true);assert.notEqual(r.items[0].topicId,rows[i].topicId);assert.equal(r.unavailable,0);}
  assert.deepEqual(projected[0].items,projected[1].items);assert.equal(projected.filter(r=>r.shared).length,1);assert.deepEqual(f.calls,calls);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);
 }finally{await f.close();}
});
test('multiple occurrences keep separate result links and pending work is never labelled a saved dossier',async()=>{
 const f=fixture({sourceReader:article,extractionRunner:p=>{const o=extraction(p).decomposition;return output(p,'decomposition',{...o,events:[o.events[0],{...o.events[0],title:'Synthetic second occurrence',action:'拟进一步收购',boundaryReason:'Synthetic second item only'}]});}});try{
  add(f,1);await f.until(()=>results(f)[0]?.items.length===2);let r=results(f)[0];assert(r.items.some(i=>!i.hasDossier));assert.equal(new Set(r.items.map(i=>i.topicId)).size,2);await f.drive(30);r=results(f)[0];assert(r.items.every(i=>i.hasDossier));assert.equal(f.calls.dossier,2);
 }finally{await f.close();}
});
test('no-signal remains empty and source revision invalidates result links without deleting the old research',async()=>{
 const empty=fixture({sourceReader:article,extractionRunner:p=>output(p,'decomposition',{events:[],scopeNote:'No synthetic event',missingEvidence:[]})});try{add(empty,1);await empty.drive(20);assert.deepEqual(results(empty)[0],{state:'no-signal',shared:false,items:[],unavailable:0});}finally{await empty.close();}
 const f=fixture({sourceReader:article});try{add(f,1);await f.drive();const row=f.queue.snapshot().items[0],original=row.researchResults.items[0];f.revise(1);const r=f.queue.get(row.id).researchResults;assert.equal(r.state,'changed');assert.deepEqual(r.items,[]);assert.equal(f.service.research.get(original.topicId).id,original.topicId);}finally{await f.close();}
});
test('archival and corrupt occurrence provenance remove current links while retaining an explicit unavailable count',async()=>{
 for(const change of ['archive','provenance']){const f=fixture({sourceReader:article});try{add(f,1);await f.drive();const item=results(f)[0].items[0],topic=f.service.research.get(item.topicId);
  if(change==='archive')f.service.research.update(topic.id,{version:topic.version,status:'archived'});
  else f.store.db.prepare("UPDATE research_topics SET payload=json_set(payload,'$.eventExtraction.runId','wrong') WHERE id=?").run(topic.id);
  const r=results(f)[0];assert.equal(r.items.length,0);assert.equal(r.unavailable,1);assert(f.service.research.get(topic.id));
 }finally{await f.close();}}
});
test('missing and foreign source job pointers degrade locally rather than mislinking or breaking the queue',async()=>{
 const f=fixture({sourceReader:article});try{add(f,1);add(f,2);await f.drive(40);const rows=f.store.db.prepare('SELECT * FROM research_pipeline_items ORDER BY rowid').all(),other=JSON.parse(rows[1].payload).eventJobId;
  for(const id of ['missing',other]){f.store.db.prepare("UPDATE research_pipeline_items SET payload=json_set(payload,'$.eventJobId',?) WHERE id=?").run(id,rows[0].id);const r=f.queue.get(rows[0].id).researchResults;assert.equal(r.state,'changed');assert.deepEqual(r.items,[]);assert.equal(f.queue.snapshot().items.length,2);}
 }finally{await f.close();}
});
test('result lookup does not depend on the recent thirty job summaries and it follows current research versions',async()=>{
 const f=fixture({sourceReader:article,semanticRunner:p=>comparison(p,'unrelated')});try{add(f,1);await f.drive();const old=f.queue.snapshot().items[0],ref=old.researchResults.items[0];
  for(let i=2;i<=12;i++){add(f,i);await f.drive(24);}const s=f.queue.snapshot();assert.equal(s.events.items.length,30);assert(!s.events.items.some(j=>j.itemId===old.id));assert.equal(f.queue.get(old.id).researchResults.items[0].topicId,ref.topicId);
  const topic=f.service.research.get(ref.topicId);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'Synthetic edited followup'});assert.equal(f.queue.get(old.id).researchResults.items[0].version,topic.version+1);
 }finally{await f.close();}
});
test('duplicate scope changes cannot expose another source results as current',async()=>{
 const f=fixture({sourceReader:article});try{add(f,1);add(f,2,f.news(1).url);await f.drive(30);const row=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE json_extract(payload,'$.duplicateOf') IS NOT NULL").get();f.store.db.prepare("UPDATE research_pipeline_event_jobs SET payload=json_set(payload,'$.duplicateOf.scopeHash','wrong') WHERE id=?").run(row.id);assert.equal(f.queue.get(row.item_id).researchResults.state,'changed');assert.deepEqual(f.queue.get(row.item_id).researchResults.items,[]);}finally{await f.close();}
});
test('result UI exposes plain encoded links with saved versus pending labels and no generation controls',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});try{const {default:Links}=await vite.ssrLoadModule('/src/integrated/PipelineResearchLinks.jsx'),render=results=>renderToStaticMarkup(React.createElement(Links,{results}));
  const html=render({state:'available',items:[{topicId:'a&b',title:'<script>source</script>',version:3,hasDossier:true},{topicId:'pending',title:'Pending',version:1,hasDossier:false}],unavailable:1});assert.match(html,/topic=a%26b/);assert.match(html,/查看研判/);assert.match(html,/查看事项/);assert.match(html,/研判尚未保存/);assert.match(html,/1 项已归档/);assert(!html.includes('<script>'));assert(!/<button|<form/.test(html));assert.match(render({state:'changed'}),/依据已变化/);assert.match(render({state:'no-signal'}),/未发现具体事项/);assert.equal(render(null),'');
 }finally{await vite.close();}
});
