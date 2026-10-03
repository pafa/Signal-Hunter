import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {digest} from '../server/codex-research.mjs';
import {openModelResearchRuns} from '../server/model-research-runs.mjs';
const at='2026-10-03T01:00:00Z',config={binary:'/test/codex',model:'test-model',timeoutMs:1000};
function candidate(packet,relation='followup'){
 const fields=side=>({actor:'合成甲',action:'待核',object:'合成事件',eventTime:'未知',stage:'待核',quote:packet.input[side].body||packet.input[side].title,...(packet.schema==='event-pair-1'?{}:{quoteField:packet.input[side].body?'body':'title'})});
 const comparison={relation,left:fields('left'),right:fields('right'),reason:'合成核对，不代表真实事件',missingEvidence:['待核原始来源']},rawOutput=JSON.stringify(comparison);
 return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:config.model,promptVersion:packet.schema,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};
}
function fixture(path=':memory:'){
 let relation='followup';const store=openStore(path),service=createService(store,{mode:'research',modelConfig:config,semanticRunner:async p=>candidate(p,relation)}),r=service.research,s=service.semanticEvents;
 const material=(topic,name,body=name)=>r.saveMaterial(topic.id,{version:r.get(topic.id).version,title:name,body,sourceName:'合成资料',url:`https://example.invalid/${encodeURIComponent(name)}`,scope:'excerpt',publishedAt:'2026-10-01',stance:'unverified',family:'other',step:'fact',interpretation:'合成证据'});
 const a=material(r.create({title:'橙色记事',summary:'测试甲'}),'公告甲'),b=material(r.create({title:'蓝色观察',summary:'测试乙'}),'公告乙'),refs=[a,b].map(t=>{const e=t.evidence[0];return {kind:'material',id:e.materialId,revision:e.materialRevision};});
 const run=async(value='followup',input={left:refs[0],right:refs[1]})=>{relation=value;const start=s.start(input);return s.wait(start.id);};
 const accept=run=>s.decide(run.id,{version:s.get(run.id).decisionVersion,action:'accept',note:'本人核对合成关系'});
 const link=(basis,patch={})=>r.linkTopic(a.id,{version:r.get(a.id).version,topicId:b.id,targetVersion:r.get(b.id).version,kind:'related',active:true,note:'另行核对两份研究',semanticBasis:{runId:basis.runId,decisionVersion:basis.decisionVersion,sourceSide:basis.sourceSide},...patch});
 return {store,service,r,s,a,b,refs,material,run,accept,link,async close(){await service.close();store.close();}};
}
test('accepted exact evidence recalls both research directions without writing links or changing evidence and ledgers',async()=>{
 const f=fixture();try{const before=f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),paper=f.service.paper.snapshot();assert.equal(f.r.related(f.a.id).semantic.total,0);const run=await f.run();assert.equal(f.r.related(f.a.id).semantic.total,0);f.accept(run);
 const a=f.r.related(f.a.id).semantic.items[0],b=f.r.related(f.b.id).semantic.items[0];assert.equal(a.topicId,f.b.id);assert.equal(a.basis.sourceSide,'left');assert.equal(b.basis.sourceSide,'right');assert.equal(b.basis.relation,'followup');assert.equal(a.basis.source.body,undefined);assert.deepEqual(a.basis.sourceEvidenceIds,[f.a.evidence[0].id]);assert.deepEqual(f.store.db.prepare('SELECT * FROM research_topics ORDER BY id').all(),before);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});
test('unrelated, uncertain, rejected, withdrawn and superseded decisions never provide active recall',async()=>{
 const f=fixture();try{for(const relation of ['unrelated','uncertain']){f.accept(await f.run(relation));assert.equal(f.r.related(f.a.id).semantic.total,0);}const run=await f.run('analogy');f.accept(run);assert.equal(f.r.related(f.a.id).semantic.total,1);f.s.decide(run.id,{version:f.s.get(run.id).decisionVersion,action:'reject',note:'不采纳'});assert.equal(f.r.related(f.a.id).semantic.total,0);f.accept(run);f.s.decide(run.id,{version:f.s.get(run.id).decisionVersion,action:'withdraw',note:'撤销'});assert.equal(f.r.related(f.a.id).semantic.total,0);const next=await f.run('repeat',{left:f.refs[1],right:f.refs[0]});f.accept(next);assert.equal(f.r.related(f.a.id).semantic.total,1);assert.equal(f.r.related(f.a.id).semantic.items[0].basis.runId,next.id);
 }finally{await f.close();}
});
test('a saved link freezes the comparison and decision; withdrawal changes projections and model input, never stored history',async()=>{
 const f=fixture();try{const run=f.accept(await f.run()),c=f.r.related(f.a.id).semantic.items[0],linked=f.link(c.basis),packet=f.r.packet(f.a.id);assert.equal(linked.relatedEvents[0].method,'human-linked-semantic-basis');assert.equal(packet.input.relatedEvents[0].basisStatus.current,true);assert.equal(packet.input.relatedResearch[0].version,f.b.version);assert.equal(linked.evidence.length,1);const raw=f.store.db.prepare('SELECT payload FROM research_topics WHERE id=?').get(f.a.id).payload,version=f.r.get(f.a.id).version;
 f.s.decide(run.id,{version:run.decisionVersion,action:'withdraw',note:'新证据不足'});assert.equal(f.r.related(f.a.id).semantic.total,0);assert.equal(f.r.related(f.a.id).links[0].basisStatus.current,false);assert.equal(f.r.related(f.b.id).incoming[0].basisStatus.current,false);assert.notEqual(f.r.packet(f.a.id).inputHash,packet.inputHash);assert.equal(f.r.packet(f.a.id).input.relatedResearch[0].relation.basisStatus.current,false);assert.match(f.r.packet(f.a.id).instructions.join(''),/不能当作当前支持/);assert.equal(f.store.db.prepare('SELECT payload FROM research_topics WHERE id=?').get(f.a.id).payload,raw);assert.equal(f.r.get(f.a.id).version,version);assert.deepEqual(f.r.history(f.a.id)[0].topic.relatedEvents[0].semanticBasis,c.basis);
 assert.throws(()=>f.link(c.basis),/比较依据已变化/);
 }finally{await f.close();}
});
test('new source revisions or evidence mismatch cannot reuse an older semantic relationship',async()=>{
 const f=fixture();try{f.accept(await f.run());const c=f.r.related(f.a.id).semantic.items[0];f.link(c.basis);f.material(f.a,'公告甲','修订正文');assert.equal(f.r.related(f.a.id).semantic.total,0);assert.equal(f.r.related(f.a.id).links[0].basisStatus.current,false);assert.throws(()=>f.link(c.basis),/比較|比较依据/);assert.equal(f.s.get(c.basis.runId).packet.input.left.body,'公告甲');
 }finally{await f.close();}
});
test('forged decision, source side, run, target or client evidence cannot create a research version',async()=>{
 const f=fixture();try{f.accept(await f.run());const b=f.r.related(f.a.id).semantic.items[0].basis,before=f.r.get(f.a.id);const third=f.r.create({title:'没有关联的研究',summary:'缺证据'});
 for(const patch of [{runId:'missing'},{decisionVersion:0},{decisionVersion:b.decisionVersion+1},{sourceSide:'right'},{sourceSide:'other'},{inputHash:'client hash'}])assert.throws(()=>f.link(b,{semanticBasis:{runId:b.runId,decisionVersion:b.decisionVersion,sourceSide:b.sourceSide,...patch}}),/比较依据/);
 assert.throws(()=>f.link(b,{topicId:third.id,targetVersion:third.version}),/比较依据/);assert.deepEqual(f.r.get(f.a.id),before);
 assert.throws(()=>f.link(b,{version:0}),/研究已更新/);assert.throws(()=>f.link(b,{targetVersion:0}),/新版本/);
 }finally{await f.close();}
});
test('revoking a research link preserves its frozen basis and rollback cannot leave an orphaned link',async()=>{
 const f=fixture();try{f.accept(await f.run());const b=f.r.related(f.a.id).semantic.items[0].basis;f.store.db.exec("CREATE TRIGGER fail_semantic_link BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.throws(()=>f.link(b),/synthetic failure/);assert.equal(f.r.get(f.a.id).relatedEvents,undefined);f.store.db.exec('DROP TRIGGER fail_semantic_link');f.link(b);const revoked=f.r.linkTopic(f.a.id,{version:f.r.get(f.a.id).version,topicId:f.b.id,targetVersion:f.b.version,kind:'related',active:false,note:'撤销研究关系'});assert.equal(revoked.relatedEvents[0].active,false);assert.deepEqual(revoked.relatedEvents[0].semanticBasis,b);assert.equal(f.r.related(f.b.id).incoming.length,0);assert.equal(f.s.get(b.runId).active,true);
 }finally{await f.close();}
});
test('recall searches older-than-50 accepted runs and paginates every matching research without transitive claims',async()=>{
 const f=fixture();try{const original=f.accept(await f.run());for(let i=0;i<55;i++){const id=`synthetic-extra-${i}`,payload={...original,id,pairKey:id,status:'failed'};f.store.db.prepare('INSERT INTO semantic_runs VALUES(?,?,?,?,?)').run(id,id,'failed',0,JSON.stringify(payload));}assert.equal(f.s.list().runs.some(r=>r.id===original.id),false);for(let i=0;i<22;i++)f.material(f.r.create({title:`其他保存主题${i}`,summary:'同一输入可能引用于多份研究'}),'公告乙');const page=f.r.related(f.a.id).semantic,next=f.r.related(f.a.id,{semanticOffset:'20'}).semantic;assert.equal(page.total,23);assert.equal(page.items.length,20);assert.equal(next.items.length,3);assert.equal(new Set([...page.items,...next.items].map(c=>c.id)).size,23);assert.equal(page.acceptedPairs,1);assert.equal(f.r.related(f.b.id).semantic.total,1);for(const params of [{semanticOffset:-1},{semanticOffset:1.2},{unknown:1}])assert.throws(()=>f.r.related(f.a.id,params),/参数无效/);
 }finally{await f.close();}
});
test('legacy headline comparison can recall mixed research and manual relations keep their prior packet shape',async()=>{
 const f=fixture();try{f.store.ingest([{id:'n1',title:'合成甲标题',publisher:'合成',url:'https://example.invalid/n1',publishedAt:at},{id:'n2',title:'合成乙标题',publisher:'合成',url:'https://example.invalid/n2',publishedAt:at}],at);const a=f.r.createFromNews({newsId:'n1',newsRevision:1}),b=f.r.createFromNews({newsId:'n2',newsRevision:1});f.accept(await f.run('repeat',{left:{id:'n1',revision:1},right:{id:'n2',revision:1}}));assert.equal(f.r.related(a.id).semantic.items[0].topicId,b.id);assert.equal(f.r.related(a.id).semantic.items[0].basis.source.contentScope,'headline-only');f.r.linkTopic(a.id,{version:a.version,topicId:b.id,targetVersion:b.version,kind:'related',active:true,note:'单独人工关系'});const packet=f.r.packet(a.id);assert.equal(packet.input.relatedEvents[0].semanticBasis,undefined);assert.equal(packet.input.relatedEvents[0].basisStatus,undefined);f.store.ingest([{id:'n1',title:'新标题',publisher:'合成',url:'https://example.invalid/n1',publishedAt:at}],'2026-10-03T02:00:00Z');assert.equal(f.r.related(a.id).semantic.total,0);assert.equal(f.r.packet(a.id).inputHash,packet.inputHash);
 }finally{await f.close();}
});
test('updating target research retains frozen target history and current comparison basis; source bindings cannot be silently lost',async()=>{
 const f=fixture();try{f.accept(await f.run());const b=f.r.related(f.a.id).semantic.items[0].basis;f.link(b);const before=f.r.packet(f.a.id);f.r.update(f.b.id,{version:f.b.version,nextEvidence:'新研究问题'});assert.equal(f.r.packet(f.a.id).inputHash,before.inputHash);assert.equal(f.r.related(f.a.id).links[0].basisStatus.current,true);const altered=f.r.get(f.b.id);altered.evidence=[];f.store.db.prepare('UPDATE research_topics SET payload=? WHERE id=?').run(JSON.stringify(altered),f.b.id);assert.equal(f.r.related(f.a.id).semantic.total,0);assert.equal(f.r.related(f.a.id).links[0].basisStatus.current,false);
 }finally{await f.close();}
});
test('related HTTP returns paged semantic clues and rejects stale submitted basis without changing the research',async()=>{
 const f=fixture(),handler=createHandler(f.store,f.service),call=async(method,url,data)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:s=>status=s,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const accepted=f.accept(await f.run()),url=`/api/research/${f.a.id}/related`,response=await call('GET',url+'?semanticOffset=0');assert.equal(response.status,200);const basis=response.result.semantic.items[0].basis;f.s.decide(accepted.id,{version:accepted.decisionVersion,action:'withdraw',note:'撤销'});const save=await call('POST',url,{version:f.a.version,topicId:f.b.id,targetVersion:f.b.version,kind:'related',active:true,note:'旧页面',semanticBasis:{runId:basis.runId,decisionVersion:basis.decisionVersion,sourceSide:basis.sourceSide}});assert.equal(save.status,400);assert.match(save.result.error,/比较依据已变化/);assert.equal(f.r.get(f.a.id).version,f.a.version);assert.equal((await call('GET',url+'?unknown=1')).status,400);
 }finally{await f.close();}
});
test('research links, frozen basis, decisions and projected status survive reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'semantic-research-')),path=join(dir,'fixture.sqlite');const f=fixture(path);let store,service;
 try{f.accept(await f.run());f.link(f.r.related(f.a.id).semantic.items[0].basis);const expected=f.r.related(f.a.id),packet=f.r.packet(f.a.id).input;await f.close();store=openStore(path);service=createService(store,{mode:'research'});assert.deepEqual(service.research.related(f.a.id),expected);assert.deepEqual(service.research.packet(f.a.id).input,packet);}finally{if(service){await service.close();store.close();}else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('withdrawing a comparison prevents adoption of a five-section draft made from the formerly current basis',async()=>{
 const f=fixture();const models=openModelResearchRuns(f.store,f.r,{enabled:true,config,runner:async packet=>{const output={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成检查，信息待核。'],sourceIds:[]})),missingEvidence:['核验来源']},rawOutput=JSON.stringify(output);return {status:'candidate',reviewStatus:'unreviewed',...output,rawOutput,trace:{inputHash:packet.inputHash,topicId:packet.input.topicId,topicVersion:packet.input.topicVersion,model:config.model,outputHash:digest(rawOutput)}};}});
 try{const accepted=f.accept(await f.run());f.link(f.r.related(f.a.id).semantic.items[0].basis);const version=f.r.get(f.a.id).version,started=models.start(f.a.id,{version});assert.equal((await models.wait(started.id)).status,'candidate');f.s.decide(accepted.id,{version:accepted.decisionVersion,action:'withdraw',note:'否定原依据'});assert.throws(()=>models.adopt(f.a.id,started.id,{version}),/已变化/);assert.equal(f.r.get(f.a.id).version,version);assert.equal(models.get(f.a.id,started.id).status,'candidate');}finally{await models.close();await f.close();}
});
test('a decision or target edit committed by another connection before the write lock cannot race into a link or draft',async()=>{
 for(const mode of ['link-decision','link-target','draft']){
  const dir=mkdtempSync(join(tmpdir(),'semantic-race-')),path=join(dir,'fixture.sqlite'),f=fixture(path),otherStore=openStore(path),otherService=createService(otherStore,{mode:'research'});const original=f.store.db.exec.bind(f.store.db);
  try{const accepted=f.accept(await f.run()),basis=f.r.related(f.a.id).semantic.items[0].basis;if(mode==='draft')f.link(basis);const topic=f.r.get(f.a.id),packet=f.r.packet(f.a.id);let armed=true,wroteDraft=false;
   f.store.db.exec=sql=>{if(armed&&sql==='BEGIN IMMEDIATE'){armed=false;if(mode==='link-target')otherService.research.update(f.b.id,{version:f.b.version,nextEvidence:'另一个窗口修订目标'});else otherService.semanticEvents.decide(accepted.id,{version:accepted.decisionVersion,action:'withdraw',note:'另一个窗口撤销'});}return original(sql);};
   if(mode==='draft'){const draft={status:'candidate',trace:{inputHash:packet.inputHash,topicId:topic.id,topicVersion:topic.version},sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成候选'],sourceIds:[]})),missingEvidence:[]};assert.throws(()=>f.r.adoptModelDraft(topic.id,{version:topic.version,runId:'synthetic'},draft,()=>{wroteDraft=true;}),/已变化/);assert.equal(wroteDraft,false);}else assert.throws(()=>f.link(basis),mode==='link-target'?/新版本/:/比较依据/);
   assert.deepEqual(f.r.get(topic.id),topic);assert.equal(armed,false);
  }finally{f.store.db.exec=original;await otherService.close();otherStore.close();await f.close();rmSync(dir,{recursive:true,force:true});}
 }
});
