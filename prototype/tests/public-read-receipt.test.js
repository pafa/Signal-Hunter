import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {publicReadReceipt,hasPublicReadReceipt} from '../server/public-read-receipt.mjs';
import {fixture,quote,output} from './automatic-research-fixture.mjs';
const requested='https://example.com/original',final='https://files.acme.com/final';
const article={url:final,requestedUrl:requested,title:'Synthetic material',sourceName:'Synthetic source',body:quote.repeat(25),scope:'extracted-text'};
const data={version:1,url:requested,stance:'unverified',family:'other',step:'fact',interpretation:'Synthetic explicit source link'};

test('only the reader request records redirect provenance; legacy missing proof does not invent a redirect',()=>{
 assert.equal(publicReadReceipt({url:final},requested),null);assert.equal(publicReadReceipt({url:requested},requested).finalUrl,requested);assert.throws(()=>publicReadReceipt({...article,requestedUrl:'https://else.acme.com/source'},requested),/不符/);assert.throws(()=>publicReadReceipt({...article,url:'https://127.0.0.1/a'},requested));
});

test('read receipt and source archive roll back together; manually supplied provenance never becomes a successful public read',async()=>{
 const store=openStore(':memory:'),r=openResearch(store,{seed:false,sourceReader:async()=>article,clock:()=> '2026-10-11T00:00:00Z'});try{
  const t=r.create({title:'Synthetic event',summary:'Source binding test'});store.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON research_source_attempts WHEN json_extract(NEW.payload,'$.state')='saved' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");await assert.rejects(r.readMaterial(t.id,data),/synthetic failure/);assert.equal(r.get(t.id).version,1);assert.equal(r.materialList(t.id).materials.length,0);assert(r.materialList(t.id).attempts.every(a=>a.state==='failed'&&!a.readReceipt));store.db.exec('DROP TRIGGER reject_receipt');
  const manual=r.saveMaterial(t.id,{...data,...article,scope:'user-supplied-text',readReceipt:{schema:'public-source-read/1',requestedUrl:requested,finalUrl:final}});assert.equal(manual.version,2);assert(r.materialList(t.id).attempts.every(a=>!a.readReceipt));
 }finally{store.close();}
});

test('an inconsistent reader response cannot save either evidence or a receipt',async()=>{
 const store=openStore(':memory:'),r=openResearch(store,{seed:false,sourceReader:async()=>({...article,requestedUrl:final}),clock:()=> '2026-10-11T00:00:00Z'});try{const t=r.create({title:'Synthetic event',summary:'Source binding test'});await assert.rejects(r.readMaterial(t.id,data),/不符/);assert.equal(r.get(t.id).version,1);assert.equal(r.materialList(t.id).materials.length,0);assert(r.materialList(t.id).attempts.every(a=>a.state==='failed'&&!a.readReceipt));}finally{store.close();}
});

test('intake archive retains its own exact request receipt for reuse without another fetch',async()=>{
 let reads=0;const f=fixture({sourceReader:async url=>{reads++;return {...article,requestedUrl:url};},intakeRunner:p=>output(p,'screening',{items:p.input.items.map(i=>({id:i.id,decision:'research',quote:i.material.body.slice(0,150),quoteField:'body',reason:'Synthetic decision',missingEvidence:['Independent evidence']}))})});try{
  f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false,screenUnselected:true});f.store.ingest([{...f.news(0),title:'Synthetic routine survey release'}],'2026-10-08T00:00:00Z');f.service.research.process();await f.until(()=>f.queue.snapshot().counts.completed===1);
  assert.equal(reads,1);const row=f.store.db.prepare('SELECT * FROM research_pipeline_items').get(),p=JSON.parse(row.payload),ref={topicId:row.topic_id,intakeId:row.id,requestedUrl:f.news(0).url,materialId:p.intakeSource.materialId,materialRevision:p.intakeSource.materialRevision,finalUrl:final};assert.equal(hasPublicReadReceipt(f.store.db,ref),true);assert.equal(hasPublicReadReceipt(f.store.db,{...ref,intakeId:'unrelated'}),false);assert.equal(f.service.research.get(row.topic_id).evidence.find(e=>e.materialId).url,final);
 }finally{await f.close();}
});
