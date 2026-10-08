import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,two,cluster,dossier,at} from './automatic-research-fixture.mjs';
import {synthesisPacket} from '../server/event-synthesis.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
import {digest,codexPrompt} from '../server/codex-research.mjs';
import {createHandler} from '../server/index.mjs';
import {eventChartTopic} from '../shared/event-synthesis-view.mjs';
const current=f=>f.queue.synthesis.overview(cluster(f).id);
const rows=f=>f.store.db.prepare('SELECT * FROM event_cluster_research ORDER BY version').all();
const topics=f=>f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all();

test('automatic synthesis saves one event result with immutable member input and no intermediate approval or ledger changes',async()=>{
 const f=fixture();try{const book=f.service.paper.snapshot(),c=await two(f),result=current(f);assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(result.current,true);assert.equal(f.synthesisCalls,1);
  const d=f.queue.synthesis.detail(c.id);assert.equal(d.selected.run.status,'adopted');assert.equal(d.selected.run.actor.kind,'system');assert.equal(d.selected.packet.input.eventSynthesis.members.length,2);assert.deepEqual(d.selected.packet.input.eventSynthesis.members.map(m=>m.topicId).sort(),c.members.map(m=>m.id).sort());
  assert.equal(d.selected.packet.inputHash,digest(d.selected.packet.input));assert.equal(new Set(d.selected.packet.input.evidence.map(e=>e.id)).size,d.selected.packet.input.evidence.length);assert(d.selected.packet.input.evidence.every(e=>e.memberTopicId&&e.originalEvidenceId&&e.material));
  const saved=topics(f);await f.drive(4);assert.deepEqual(topics(f),saved);assert.equal(f.synthesisCalls,1);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
  const log=f.service.activity({limit:200}).items.find(x=>x.kind==='model'&&x.entityId===result.runId);assert.equal(log.detail.automatic,true);assert(f.service.snapshot().overview.eventClusters.some(x=>x.id===c.id&&x.research.current));
 }finally{await f.close();}
});

test('new member creates a new synthesis while the previous exact result remains inspectable',async()=>{
 const f=fixture();try{const c=await two(f),first=f.queue.synthesis.detail(c.id).selected;f.add(3);await f.drive();const next=f.queue.synthesis.detail(c.id);assert.equal(next.selected.version,2);assert.equal(next.selected.memberCount,3);assert.equal(next.selected.current,true);assert.equal(f.synthesisCalls,2);assert.equal(next.history.find(x=>x.id===first.id).status,'historical');const history=f.queue.synthesis.detail(c.id,first.id).selected;assert.deepEqual(history.run,first.run);assert.deepEqual(history.packet,first.packet);assert.equal(next.selected.packet.input.eventSynthesis.priorSynthesis.version,1);
 }finally{await f.close();}
});

test('member edit immediately withdraws current synthesis on a read, then creates a new version without changing original research',async()=>{
 const f=fixture();try{const c=await two(f),first=current(f);let topic=f.service.research.get(c.members[0].id);f.service.research.update(topic.id,{version:topic.version,nextEvidence:'本人保留的新观察条件'});const edited=topics(f);assert.equal(current(f).current,false);assert.equal(current(f).status,'stale');assert.equal(rows(f).length,1);await f.drive();assert.equal(current(f).version,2);assert.equal(current(f).current,true);assert.deepEqual(topics(f),edited);assert.equal(f.queue.synthesis.detail(c.id,first.id).selected.current,false);
 }finally{await f.close();}
});

test('failed synthesis uses the shared rolling budget and three bounded attempts; the final failed run remains inspectable',async()=>{
 const f=fixture({synthesisRunner:()=>{throw Error('synthetic failure');}});try{const c=await two(f);assert.equal(f.synthesisCalls,1);assert.equal(current(f).status,'queued');const settings=f.queue.snapshot();f.queue.configure({version:settings.settings.version,dailyCalls:settings.callsInLast24Hours,includeClues:false});f.advance(60001);await f.drive(2);assert.equal(f.synthesisCalls,1);f.queue.configure({version:f.queue.snapshot().settings.version,dailyCalls:100,includeClues:false});await f.drive(2);assert.equal(f.synthesisCalls,2);f.advance(120001);await f.drive(3);assert.equal(f.synthesisCalls,3);assert.equal(current(f).status,'observing');assert.equal(current(f).attemptCount,3);assert.equal(current(f).attempts.length,3);await f.drive(3);assert.equal(f.synthesisCalls,3);assert.equal(f.queue.synthesis.detail(c.id).selected.attemptRuns.length,3);
 }finally{await f.close();}
});

test('completion is atomic with model acceptance and may recover even after quota is exhausted',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>rows(f).some(r=>r.status==='running'));const row=rows(f)[0];assert.equal(f.service.modelResearch.get('event-cluster:'+row.cluster_id,row.run_id).status,'candidate');f.store.db.exec("CREATE TRIGGER fail_synthesis_save BEFORE UPDATE ON event_cluster_research WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END");const setting=f.queue.snapshot();f.queue.configure({version:setting.settings.version,dailyCalls:setting.callsInLast24Hours,includeClues:false});await f.step();assert.equal(rows(f)[0].status,'running');assert.equal(f.service.modelResearch.get('event-cluster:'+row.cluster_id,row.run_id).status,'candidate');f.store.db.exec('DROP TRIGGER fail_synthesis_save');await f.drive(2);assert.equal(current(f).current,true);assert.equal(f.synthesisCalls,1);
 }finally{await f.close();}
});

test('restart preserves adopted event research and does not rerun unchanged input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'event-synthesis-')),path=join(dir,'test.sqlite');let f=fixture({path});try{const c=await two(f),first=f.queue.synthesis.detail(c.id);await f.close();f=fixture({path});await f.drive(4);assert.deepEqual(f.queue.synthesis.detail(c.id),first);assert.equal(f.synthesisCalls,0);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

for(const change of ['withdraw','archive','revision'])test(`${change} withdraws current synthesis without changing saved history`,async()=>{
 const f=fixture();try{const c=await two(f),saved=f.queue.synthesis.detail(c.id).selected;
  if(change==='withdraw'){const r=f.service.semanticEvents.get(c.pairs[0].basis.runId);f.service.semanticEvents.decide(r.id,{version:r.decisionVersion,action:'withdraw',note:'撤回合成归组依据'});}
  if(change==='archive')f.service.eventClusters.archive(c.id,{version:c.version,note:'归档合成事项',requestId:'synthesis-archive-test'});
  if(change==='revision')f.revise(1);
  const before=rows(f);assert.equal(f.queue.synthesis.overview(c.id).current,false);assert.equal(f.queue.synthesis.detail(c.id,saved.id).selected.current,false);assert.deepEqual(rows(f),before);assert.deepEqual(f.queue.synthesis.detail(c.id,saved.id).selected.run,saved.run);
 }finally{await f.close();}
});

test('cancelled candidate cannot be accepted or automatically resurrected',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>rows(f).some(r=>r.status==='running'));const row=rows(f)[0];f.queue.synthesis.cancel(row.id);f.advance(180001);await f.drive(4);assert.equal(current(f).status,'cancelled');assert.equal(current(f).current,false);assert.equal(f.synthesisCalls,1);assert.equal(f.service.modelResearch.get('event-cluster:'+row.cluster_id,row.run_id).status,'candidate');
 }finally{await f.close();}
});

test('start transaction rolls back synthesis, attempts, model run and lease together',async()=>{
 const f=fixture();try{f.store.db.exec("CREATE TRIGGER fail_synthesis_start BEFORE UPDATE ON event_cluster_research WHEN NEW.status='running' BEGIN SELECT RAISE(ABORT,'synthetic start failure'); END");await two(f);assert.equal(f.synthesisCalls,0);assert.equal(rows(f)[0].status,'queued');assert.equal(rows(f)[0].run_id,null);assert.equal(f.store.db.prepare("SELECT count(*) n FROM model_research_runs WHERE json_extract(payload,'$.subject')='event-cluster'").get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);f.store.db.exec('DROP TRIGGER fail_synthesis_start');await f.drive(3);assert.equal(f.synthesisCalls,1);assert.equal(current(f).current,true);assert.equal(current(f).attemptCount,1);
 }finally{await f.close();}
});

test('serialized capability, public packet injection and restore-locked cancellation are rejected',async()=>{
 const f=fixture();try{const c=await two(f),d=f.queue.synthesis.detail(c.id),packet=d.selected.packet;
  assert.throws(()=>f.service.modelResearch.startCluster(packet,()=>{},{...SYSTEM_RESEARCH_ACTOR}),/内部/);
  assert.throws(()=>f.service.modelResearch.start(packet.input.topicId,{version:packet.input.topicVersion},()=>{},packet),/不存在/);
  assert.throws(()=>f.service.modelResearch.completeCluster(d.selected.runId,packet,{...SYSTEM_RESEARCH_ACTOR},()=>{}),/内部/);
  assert.throws(()=>f.queue.synthesis.detail(c.id,'0'.repeat(64)),/不属于/);
  f.add(3);await f.until(()=>rows(f).some(r=>r.status==='running'));const row=rows(f).find(r=>r.status==='running');f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.queue.synthesis.cancel(row.id),/恢复副本/);assert.equal(rows(f).find(r=>r.id===row.id).status,'running');
 }finally{await f.close();}
});

test('company variants and same-source identities survive remapping without adding amounts or confidence',async()=>{
 const f=fixture();try{const c=await two(f),d=f.queue.synthesis.detail(c.id),members=d.selected.packet.input.eventSynthesis.members.map((m,i)=>{
  const topic=f.service.research.get(m.topicId),packet=f.service.research.packet(m.topicId),e=packet.input.evidence[0];e.material.documentId='shared-document';packet.input.companies=[{name:'Synthetic Co',symbol:'AAA',direction:i?'negative':'positive',sourceIds:[e.id],materiality:{rows:[{id:'same-row',label:'测试量级',scope:'合成',period:'2026',unit:'USD',basis:'synthetic',baseline:{value:i?'20':'10',kind:'source',evidenceIds:[e.id]}}]}}];packet.inputHash=digest(packet.input);return {topic,scope:{eventFocus:m.eventFocus},packet};
 });const p=synthesisPacket(c,members,{version:7,generatedAt:at});assert.equal(p.input.companies.length,1);const company=p.input.companies[0];assert.equal(company.direction,undefined);assert.equal(company.materiality.rows.length,2);assert.deepEqual(company.researchVariants.map(v=>v.company.direction),['positive','negative']);assert.equal(p.input.eventSynthesis.sourceGroups.length,1);assert.equal(p.input.eventSynthesis.sourceGroups[0].evidenceIds.length,2);
  for(const [i,v]of company.researchVariants.entries()){assert.equal(v.company.sourceIds[0],p.input.evidence[i].id);assert.equal(p.input.materialityReview.targets[i].evidenceIds[0],p.input.evidence[i].id);}assert.equal(new Set(p.input.materialityReview.targets.map(t=>t.id)).size,2);assert(codexPrompt(p).includes('中间结果不要求本人逐项采纳'));assert(codexPrompt(p).includes('不把各份旧研判当独立证据'));
  members[0].packet.input.evidence[0].material.body='大'.repeat(530000);assert.throws(()=>synthesisPacket(c,members,{version:8,generatedAt:at}));
 }finally{await f.close();}
});

test('invalid citations are retained as failed calls and never shown as current judgments',async()=>{
 const f=fixture({synthesisRunner:p=>{const r=dossier(p);r.sections[0].sourceIds=['material:absent'];r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence});r.trace.outputHash=digest(r.rawOutput);return r;}});try{const c=await two(f),d=f.queue.synthesis.detail(c.id);assert.equal(d.selected.current,false);assert.equal(d.selected.attemptRuns[0].status,'failed');assert.equal(d.selected.attemptRuns[0].failure.code,'output');assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);}finally{await f.close();}
});

test('detail HTTP is read-only and rejects unknown versions, extra parameters and cancellation on a locked copy',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service),call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};};try{
  const c=await two(f),before=rows(f),url=`/api/event-clusters/${c.id}/research`,r=await call('GET',url);assert.equal(r.status,200);assert.equal(r.result.selected.current,true);assert.deepEqual(rows(f),before);assert.equal((await call('GET',url+'?job=missing')).status,400);assert.equal((await call('GET',url+'?unknown=1')).status,400);assert.equal((await call('GET',url+'?job='+r.result.selected.id+'&job='+r.result.selected.id)).status,400);
  f.add(3);await f.until(()=>rows(f).some(r=>r.status==='running'));const id=rows(f).find(r=>r.status==='running').id;assert.equal((await call('POST',`/api/event-synthesis/${id}/cancel`,{actor:'system'})).status,400);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('POST',`/api/event-synthesis/${id}/cancel`,{})).status,409);assert.equal(rows(f).find(r=>r.id===id).status,'running');
 }finally{await f.close();}
});

test('paused discovery does not finalize or start synthesis until explicitly resumed',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>rows(f).some(r=>r.status==='running'));f.service.controlOperation('discovery','pause');f.advance(180001);assert.throws(()=>f.service.runOperation('discovery'),/任务已暂停/);assert.equal(rows(f)[0].status,'running');assert.equal(f.synthesisCalls,1);await f.step();assert.equal(current(f).current,true);}finally{await f.close();}
});

test('event chart uses all current securities while preserving listing boundaries and excluding old members',()=>{
 const a={symbol:'AAA',name:'甲',direction:'positive'},h={symbol:'0001.HK',name:'甲港股',direction:'negative'},old={symbol:'OLD',name:'旧证券'};
 const result=eventChartTopic({cluster:{id:'cluster'},title:'事件',topics:[{companies:[a,h]},{companies:[{...a,direction:'negative'}]}],historicalTopics:[{companies:[old]}]});assert.deepEqual(result.companies.map(c=>c.symbol),['AAA','0001.HK']);assert(result.companies.every(c=>!Object.hasOwn(c,'direction')));assert.deepEqual(result.evidence,[]);assert.equal(a.direction,'positive');
});


test('ineligible event without a synthesis reports observation instead of promising background work',async()=>{
 const f=fixture();try{f.add(1);await f.drive();f.add(2);await f.until(()=>f.service.eventClusters.list().items.length>0);const c=cluster(f);assert.equal(rows(f).length,0);assert.equal(f.queue.synthesis.overview(c.id).status,'pending');f.service.eventClusters.archive(c.id,{version:c.version,note:'合成事件归档',requestId:'synthesis-no-input-archive'});const result=f.queue.synthesis.overview(c.id);assert.equal(result.status,'observing');assert.equal(result.current,false);assert.match(result.reason,/暂不生成/);assert.equal(rows(f).length,0);}finally{await f.close();}
});
