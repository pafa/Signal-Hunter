import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {openStore} from '../server/store.mjs';import {createService} from '../server/service.mjs';import {createHandler} from '../server/index.mjs';import {digest} from '../server/codex-research.mjs';import {materialEventsPacket,validateMaterialEvents,materialEventsPrompt} from '../server/material-events.mjs';import {openMaterialEventRuns} from '../server/material-event-runs.mjs';import {claimModelLease,releaseModelLease} from '../server/model-lease.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000},at='2026-10-03T00:00:00Z';
const body='虚构甲公司计划收购乙公司，尚需股东大会批准。虚构丙公司宣布终止丁项目，具体原因仍需公告核验。两项事项来自同一材料，不能计为独立佐证。';
const unknown={basis:'unknown',quote:'',quoteField:'none'};
function output(){return {events:[{title:'虚构甲公司拟收购乙公司',actor:'虚构甲公司',action:'拟收购',object:'乙公司',stage:'尚需批准',eventTime:'未知',timeEvidence:unknown,timeRole:'unknown',quote:'虚构甲公司计划收购乙公司，尚需股东大会批准。',quoteField:'body',boundaryReason:'与另一项目的终止是不同事项。'},{title:'虚构丙公司终止丁项目',actor:'虚构丙公司',action:'终止',object:'丁项目',stage:'宣布终止',eventTime:'未知',timeEvidence:unknown,timeRole:'unknown',quote:'虚构丙公司宣布终止丁项目，具体原因仍需公告核验。',quoteField:'body',boundaryReason:'另一主体的不同具体项目。'}],scopeNote:'仅分析提供的合成摘录，不保证完整。',missingEvidence:['原公告及具体事件时间']};}
function candidate(p,o=output()){const rawOutput=JSON.stringify(o);return {status:'candidate',reviewStatus:'unreviewed',decomposition:o,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};}
function fixture({runner=async p=>candidate(p),path=':memory:',mode='research'}={}){
 const store=openStore(path),service=createService(store,{mode,modelConfig:config,materialEventRunner:runner,now:()=>Date.parse(at)}),r=service.research;let topic=r.create({title:'合成汇总公告',summary:'分开核对两个事项'});
 topic=r.saveMaterial(topic.id,{version:topic.version,title:'合成材料',sourceName:'合成测试',url:'https://news.acme.com/announcement',body,scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'合成事项核验'});const material=r.materialList(topic.id).materials[0];
 return {store,service,r,topic,material,runs:service.materialEvents,input:{version:topic.version,materialId:material.id,revision:material.revision,requestId:'test-request-00000001'},async close(){await service.close();store.close();}};
}
const decide=(index,version,action,note='人工合成测试核对')=>({eventIndex:index,version,action,note});
test('stored decomposition mismatches cannot create research and remain available for diagnosis',async()=>{
 for(const mutate of [r=>r.candidate.decomposition.events[0].title='Changed stored candidate',r=>r.candidate.rawOutput='broken JSON',r=>r.candidate.trace.outputHash='wrong',r=>r.candidate.trace.model='other-model',r=>r.candidate.reviewStatus='complete',r=>r.packet.input.material.title='Changed frozen input']){
  const f=fixture();try{
   const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);
   const saved=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(a.id).payload);mutate(saved);
   const frozen=JSON.stringify(saved);f.store.db.prepare('UPDATE material_event_runs SET payload=? WHERE id=?').run(frozen,a.id);
   const topics=f.r.list(),history=f.r.history(f.topic.id),materials=f.store.db.prepare('SELECT * FROM research_materials').all(),book=f.service.paper.snapshot();
   assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,0,'create')));
   assert.equal(f.runs.get(f.topic.id,a.id).stale,true);assert.deepEqual(f.r.list(),topics);assert.deepEqual(f.r.history(f.topic.id),history);
   assert.deepEqual(f.store.db.prepare('SELECT * FROM research_materials').all(),materials);assert.deepEqual(f.service.paper.snapshot(),book);
   assert.equal(f.store.db.prepare('SELECT count(*) n FROM material_event_decisions').get().n,0);
   assert.equal(f.store.db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(a.id).payload,frozen);
  }finally{await f.close();}
 }
});
test('decomposition confirmation checks the same stored run inside the research transaction',async()=>{
 const f=fixture();try{
  const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);const before=f.r.list(),create=f.r.createFromMaterialEvent.bind(f.r);
  f.r.createFromMaterialEvent=(...args)=>{const r=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(a.id).payload);r.candidate.decomposition.scopeNote='Changed after preview';f.store.db.prepare('UPDATE material_event_runs SET payload=? WHERE id=?').run(JSON.stringify(r),a.id);return create(...args);};
  assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,0,'create')));assert.deepEqual(f.r.list(),before);assert.equal(f.runs.get(f.topic.id,a.id).reviews[0].length,0);
 }finally{await f.close();}
});
test('intact legacy decomposition without time roles survives changed model configuration without rewriting output',async()=>{
 const f=fixture();let reopened;try{
  const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);const r=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(a.id).payload);
  const currentPacket=structuredClone(r.packet);r.packet.schema='material-events-1';for(const event of r.candidate.decomposition.events)delete event.timeRole;
  assert.throws(()=>validateMaterialEvents(r.candidate.decomposition,currentPacket,{allowLegacy:true}),e=>e.code==='output');
  const invalid=structuredClone(r.candidate.decomposition);invalid.events[0].quote='Invented legacy quote';
  assert.throws(()=>validateMaterialEvents(invalid,r.packet,{allowLegacy:true}),e=>e.code==='output');
  r.candidate.rawOutput=JSON.stringify(r.candidate.decomposition);r.candidate.trace.outputHash=digest(r.candidate.rawOutput);const frozen=JSON.stringify(r);
  f.store.db.prepare('UPDATE material_event_runs SET payload=? WHERE id=?').run(frozen,a.id);
  reopened=openMaterialEventRuns(f.store,f.r,{enabled:true,config:{...config,model:'new-model'}});
  assert.equal(reopened.get(f.topic.id,a.id).stale,false);const result=reopened.decide(f.topic.id,a.id,decide(0,0,'create'));
  const topic=f.r.get(result.reviews[0][0].topicId);assert.equal(topic.eventExtraction.event.timeRole,undefined);assert.equal(topic.eventExtraction.modelTrace.model,config.model);
  assert.equal(f.store.db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(a.id).payload,frozen);
 }finally{if(reopened)await reopened.close();await f.close();}
});
test('material event inputs freeze the full current linked version and reject unrelated, archived or malformed requests',async()=>{
 const f=fixture();try{const {requestId,...ref}=f.input,p=materialEventsPacket(f.store,f.r,f.topic.id,ref);assert.equal(p.input.material.body,body);assert.equal(p.inputHash,digest(p.input));assert.match(materialEventsPrompt(p),/不能按句子、段落或编号机械拆分/);assert.match(materialEventsPrompt(p),/附件/);
 for(const data of [{...ref,revision:2},{...ref,version:1},{...ref,materialId:'absent'},{...ref,extra:true}])assert.throws(()=>materialEventsPacket(f.store,f.r,f.topic.id,data));
 const other=f.r.create({title:'其他主题',summary:'未关联材料'});assert.throws(()=>f.runs.start(other.id,{...f.input,version:other.version}),/不属于/);
 f.r.update(f.topic.id,{version:f.topic.version,status:'archived'});assert.throws(()=>f.runs.start(f.topic.id,f.input),/更新或归档/);
 }finally{await f.close();}
});
test('event output permits no events, preserves uncertainty and rejects invented quotes, invalid time, duplicate entries and overflow',async()=>{
 const f=fixture();try{const {requestId,...ref}=f.input,p=materialEventsPacket(f.store,f.r,f.topic.id,ref);assert.deepEqual(validateMaterialEvents(output(),p),output());assert.equal(validateMaterialEvents({...output(),events:[]},p).events.length,0);
 for(const mutate of [o=>o.events[0].quote='编造引文',o=>o.events[0].quoteField='url',o=>o.events[0].title='x'.repeat(141),o=>o.events[0].eventTime='2026-10-03',o=>o.events[0].symbol='FAKE',o=>o.events.push(o.events[0]),o=>o.events=Array(13).fill(o.events[0]),o=>o.scopeNote='',o=>o.missingEvidence=['']]){const o=output();mutate(o);assert.throws(()=>validateMaterialEvents(o,p),e=>e.code==='output');}
 }finally{await f.close();}
});
test('one request starts one call and no research is created until human selection; creation atomically links existing material and keeps originals',async()=>{
 let calls=0;const f=fixture({runner:async p=>{calls++;return candidate(p);}});try{const before=f.r.get(f.topic.id),row=f.store.db.prepare('SELECT * FROM research_materials').all(),book=f.service.paper.snapshot();const a=f.runs.start(f.topic.id,f.input);assert.equal(f.runs.start(f.topic.id,f.input).id,a.id);assert.equal(f.runs.start(f.topic.id,Object.fromEntries(Object.entries(f.input).reverse())).id,a.id);const run=await f.runs.wait(a.id);assert.equal(calls,1);assert.equal(f.r.list().length,1);assert.equal(run.candidate.decomposition.events.length,2);
 const d=decide(0,0,'create'),created=f.runs.decide(f.topic.id,a.id,d),id=created.reviews[0][0].topicId;assert.equal(f.runs.decide(f.topic.id,a.id,d).reviews[0].length,1);assert.equal(f.runs.decide(f.topic.id,a.id,Object.fromEntries(Object.entries(d).reverse())).reviews[0].length,1);const t=f.r.get(id);assert.equal(t.version,1);assert.equal(t.evidence[0].materialId,f.material.id);assert.equal(t.evidence[0].availableAt,f.material.availableAt);assert.equal(t.hypothesis.action,'observe');assert.equal(t.eventExtraction.eventIndex,0);assert.equal(f.r.packet(id).input.eventExtraction.runId,a.id);assert.deepEqual(f.r.get(f.topic.id),before);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_materials').all(),row);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.r.list().length,2);
 assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,1,'reopen')),/已变化/);assert.throws(()=>f.runs.start(f.topic.id,{...f.input,revision:2}),/标识/);
 }finally{await f.close();}
});
test('reject and reopen append decisions; old versions cannot override them',async()=>{
 const f=fixture();try{const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);f.runs.decide(f.topic.id,a.id,decide(1,0,'reject'));assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(1,0,'create')),/已变化/);assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(1,1,'create')),/已排除/);f.runs.decide(f.topic.id,a.id,decide(1,1,'reopen'));const r=f.runs.decide(f.topic.id,a.id,decide(1,2,'create'));assert.deepEqual(r.reviews[1].map(d=>d.action),['create','reopen','reject']);assert.equal(f.r.list().length,2);
 }finally{await f.close();}
});
test('decision storage failure rolls back new research and its first historical version',async()=>{
 const f=fixture();try{const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);const n=f.store.db.prepare('SELECT COUNT(*) n FROM research_versions').get().n;f.store.db.exec("CREATE TRIGGER reject_event_decision BEFORE INSERT ON material_event_decisions BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,0,'create')),/synthetic/);assert.equal(f.r.list().length,1);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM research_versions').get().n,n);assert.equal(f.runs.get(f.topic.id,a.id).reviews[0].length,0);
 }finally{await f.close();}
});
test('new material revisions elsewhere stale candidates without overwriting old input or results',async()=>{
 const f=fixture();try{const a=f.runs.start(f.topic.id,f.input),run=await f.runs.wait(a.id),other=f.r.create({title:'修订材料',summary:'其他研究读取同一来源'});f.r.saveMaterial(other.id,{version:other.version,title:f.material.title,sourceName:f.material.sourceName,url:f.material.url,body:body+'新增修订。',scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'修订'});const old=f.runs.get(f.topic.id,a.id);assert.equal(old.stale,true);assert.deepEqual(old.candidate,run.candidate);assert.deepEqual(old.packet,run.packet);assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,0,'create')),/已变化/);assert.throws(()=>f.runs.start(f.topic.id,{...f.input,requestId:'test-request-00000002'}));
 }finally{await f.close();}
});
test('model lease is shared, cancellation persists, and unknown provider failures are redacted',async()=>{
 const f=fixture({runner:async(p,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private diagnostic')),{once:true}))});try{claimModelLease(f.store.db,'another',Date.parse(at),99999);assert.throws(()=>f.runs.start(f.topic.id,f.input),/模型/);releaseModelLease(f.store.db,'another');const a=f.runs.start(f.topic.id,f.input);await Promise.resolve();assert.throws(()=>claimModelLease(f.store.db,'another',Date.parse(at),99999),/模型/);f.runs.cancel(f.topic.id,a.id);assert.equal((await f.runs.wait(a.id)).status,'cancelled');}finally{await f.close();}
 const failed=fixture({runner:async()=>{throw new Error('private diagnostic');}});try{const a=failed.runs.start(failed.topic.id,failed.input),r=await failed.runs.wait(a.id);assert.equal(r.status,'failed');assert.doesNotMatch(JSON.stringify(r),/private diagnostic/);}finally{await failed.close();}
});
test('provider output is validated independently and raw-output tampering cannot persist as a candidate',async()=>{
 for(const change of [c=>c.decomposition.events[0].quote='invented',c=>c.trace.inputHash='bad',c=>c.trace.model='other',c=>c.rawOutput='{}']){const f=fixture({runner:async p=>{const c=candidate(p);change(c);return c;}});try{const a=f.runs.start(f.topic.id,f.input);assert.equal((await f.runs.wait(a.id)).status,'failed');assert.equal(f.r.list().length,1);}finally{await f.close();}}
});
test('offline and restore-review states prevent model starts and decisions',async()=>{
 const offline=fixture({mode:'demo'});try{assert.throws(()=>offline.runs.start(offline.topic.id,offline.input),/未启用/);}finally{await offline.close();}
 const f=fixture();try{const a=f.runs.start(f.topic.id,f.input);await f.runs.wait(a.id);f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.runs.start(f.topic.id,f.input),/恢复/);assert.throws(()=>f.runs.decide(f.topic.id,a.id,decide(0,0,'create')),/恢复/);}finally{await f.close();}
});
test('completed candidates, decisions and source research survive restart; expired unfinished work is not retried',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'material-event-test-')),path=join(dir,'data.sqlite');const f=fixture({path});let id,topicId;
 try{id=f.runs.start(f.topic.id,f.input).id;await f.runs.wait(id);f.runs.decide(f.topic.id,id,decide(0,0,'create'));topicId=f.topic.id;await f.close();const s=openStore(path),svc=createService(s,{mode:'research'});try{const run=svc.materialEvents.get(topicId,id);assert.equal(run.status,'candidate');assert.equal(svc.research.list().length,2);assert.equal(run.reviews[0][0].action,'create');const fake={...run,id:'interrupted-record',status:'running'};s.db.prepare('INSERT INTO material_event_runs VALUES(?,?,?,?,?,?)').run(fake.id,topicId,'interrupted-request','running',1,JSON.stringify(fake));const recovered=openMaterialEventRuns(s,svc.research);assert.equal(recovered.get(topicId,fake.id).status,'interrupted');await recovered.close();}finally{await svc.close();s.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('HTTP routes expose scoped runs and creation updates the workspace; host and restore protections apply',async()=>{
 const f=fixture(),server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;server.on('request',createHandler(f.store,f.service,{apiPort:port,frontendPort:port}));const base=`http://127.0.0.1:${port}/api/research/${f.topic.id}/material-events`,post=(url,data)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{const started=await post(base,f.input);assert.equal(started.status,202);const a=await started.json();await f.runs.wait(a.id);assert.equal((await(await fetch(base)).json()).runs.length,1);const create=await post(`${base}/${a.id}/decision`,decide(0,0,'create'));assert.equal(create.status,200);assert.equal((await create.json()).research.topics.length,2);assert.equal((await post(base,{...f.input,model:'override'})).status,400);assert.equal((await fetch(base,{headers:{Origin:'https://evil.invalid'}})).status,403);f.store.db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();assert.equal((await post(base,f.input)).status,409);
 }finally{await new Promise(r=>server.close(r));await f.close();}
});

test('HTTP failure preserves the owned actionable message and hides appended diagnostic text',async()=>{
 const {safeErrorText}=await import('../shared/safe-errors.mjs');assert.equal(safeErrorText(new Error('材料或研究已变化，或此候选已排除；请刷新核对')),'材料或研究已变化，或此候选已排除；请刷新核对');assert.equal(safeErrorText(new Error('材料或研究已变化，或此候选已排除；请刷新核对 private details')),'任务失败，请检查来源或运行配置');
});

test('a quoted deadline has an explicit role and cannot pass as unknown time',async()=>{
 const f=fixture();try{const {requestId,...ref}=f.input,p=materialEventsPacket(f.store,f.r,f.topic.id,ref);p.input.material.body+='政策延期至2028年12月31日。';const o=output();Object.assign(o.events[0],{eventTime:'2028年12月31日',timeEvidence:{basis:'explicit',quote:'政策延期至2028年12月31日。',quoteField:'body'},timeRole:'deadline'});assert.equal(validateMaterialEvents(o,p).events[0].timeRole,'deadline');o.events[0].timeRole='unknown';assert.throws(()=>validateMaterialEvents(o,p),e=>e.code==='output');o.events[0].timeRole='deadline';o.events[1].timeRole='event';assert.throws(()=>validateMaterialEvents(o,p),e=>e.code==='output');assert.match(materialEventsPrompt(p),/截止日不能当作决定发生/);}finally{await f.close();}
});

test('event cards label deadline and legacy unknown purpose explicitly and keep creation separate from source truth',async()=>{
 const {createServer}=await import('vite'),{fileURLToPath}=await import('node:url'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {EventReview}=await vite.ssrLoadModule('/src/major/MaterialEvents.jsx'),event={...output().events[0],eventTime:'2028年12月31日',timeRole:'deadline',quote:'<script>合成引用</script>'},render=(e,h=[])=>renderToStaticMarkup(React.createElement(EventReview,{event:e,index:0,history:h,disabled:true,onDecision:()=>{}}));const html=render(event);assert.match(html,/到期或截止时间/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/disabled/);assert.match(render({...event,timeRole:undefined}),/旧版未记录用途/);const created=render(event,[{version:1,action:'create',topicId:'new-topic',at,note:'人工核对'}]);assert.match(created,/打开新研究/);assert.doesNotMatch(created,/为此事项建立研究/);assert.match(render(event,[{version:1,action:'reject',at,note:'排除'}]),/重新核对/);}finally{await vite.close();}
});
