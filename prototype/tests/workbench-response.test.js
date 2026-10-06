import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {workbenchResponse} from '../server/workbench-response.mjs';
const hash='a'.repeat(64),hash2='b'.repeat(64);
const snapshot=(topics=[{id:'one',version:1,evidence:[]}],id='dataset-a')=>({runtime:{instance:{id}},research:{topics,inbox:[]},serverTime:'2026-10-04T00:00:00Z'});
const response=(body,validator=hash)=>Response.json(body,{headers:validator?{'X-Signal-Topics-Hash':validator}:{}});
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
async function client(t,fetcher){const original=globalThis.fetch;globalThis.fetch=fetcher;t.after(()=>{globalThis.fetch=original;});return (await import(`../src/major/api.js?transport-${Math.random()}`)).request;}

test('conditional workbench projection preserves all non-topic state and the complete original representation',()=>{
 const original=snapshot([{id:'one',version:1,evidence:[{claim:'Preserve me',availableAt:null}],error:'private detail'}]);
 const first=workbenchResponse(original),full=JSON.parse(first.body),validator=first.headers['X-Signal-Topics-Hash'];
 assert.equal(full.research.topics[0].error,'任务失败，请检查来源或运行配置');
 assert.equal(original.research.topics[0].error,'private detail');
 const next={...original,serverTime:'2026-10-04T01:00:00Z',operations:{paused:true},research:{...original.research,inbox:[{id:'new-news'}]}};
 const conditional=workbenchResponse(next,validator),result=JSON.parse(conditional.body);
 assert.equal(conditional.headers['X-Signal-Topics-Hash'],validator);assert.equal(result.research.topicsUnchanged,true);assert.equal(Object.hasOwn(result.research,'topics'),false);
 assert.deepEqual({...result,research:{...result.research,topics:full.research.topics,topicsUnchanged:undefined}}, {...JSON.parse(workbenchResponse(next).body),research:{...JSON.parse(workbenchResponse(next).body).research,topicsUnchanged:undefined}});
 for(const different of [snapshot([]),snapshot(original.research.topics,'dataset-b'),snapshot([{...original.research.topics[0],evidence:[{claim:'Preserve me',availableAt:'2026-10-04T01:00:00Z'}]}]),snapshot([{...original.research.topics[0],version:2}])]){
  const changed=workbenchResponse(different,validator);assert.notEqual(changed.headers['X-Signal-Topics-Hash'],validator);assert(Array.isArray(JSON.parse(changed.body).research.topics));
 }
 assert(Array.isArray(JSON.parse(workbenchResponse(original,'invalid').body).research.topics));
 const legacy=workbenchResponse({...original,runtime:{}},validator);assert.deepEqual(legacy.headers,{});assert(Array.isArray(JSON.parse(legacy.body).research.topics));
});

test('actual handler revalidates recovered evidence, appended versions and instance identity without rewriting history',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'fixture-transport'}}),handler=createHandler(store,service);
 const call=async(validator,identity='fixture-transport')=>{let status,headers,body;await handler({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179','x-signal-instance':identity,...(validator?{'x-signal-topics-hash':validator}:{})}}, {writeHead:(s,h)=>{status=s;headers=h;},end:b=>{body=JSON.parse(b);}});return {status,headers,body};};
 try{
  const topic=service.research.create({title:'Synthetic transport',summary:'Historical references remain intact'});
  // Simulate an imported historical reference whose source revision is missing.
  const payload={...topic,evidence:[{id:'e1',newsId:'later',newsRevision:1,claim:'Imported',stance:'context',verification:'unverified'}]};
  store.db.prepare('UPDATE research_topics SET payload=? WHERE id=?').run(JSON.stringify(payload),topic.id);
  const history=service.research.history(topic.id),first=await call(),validator=first.headers['X-Signal-Topics-Hash'];
  assert.equal(first.body.research.topics[0].evidence[0].availableAt,null);
  assert.equal((await call(validator)).body.research.topicsUnchanged,true);
  store.ingest([{id:'later',title:'Synthetic source',publisher:'Synthetic',url:'https://example.test/source',publishedAt:'2026-10-04T00:00:00Z'}],'2026-10-04T01:00:00Z');
  const recovered=await call(validator);assert.notEqual(recovered.headers['X-Signal-Topics-Hash'],validator);assert.equal(recovered.body.research.topics[0].evidence[0].availableAt,'2026-10-04T01:00:00Z');
  assert.deepEqual(service.research.history(topic.id),history);
  service.research.update(topic.id,{version:1,nextEvidence:'Appended v2'});
  const changed=await call(recovered.headers['X-Signal-Topics-Hash']);assert.equal(changed.body.research.topics[0].version,2);assert.equal(service.research.history(topic.id).length,2);
  assert.equal((await call(validator,'wrong-instance')).status,409);
 }finally{await service.close();store.close();}
});

test('browser rehydrates only the requested content and keeps caller edits out of the transport cache',async t=>{
 const seen=[];let count=0;
 const request=await client(t,async(path,options)=>{seen.push(options);count++;return count===1?response(snapshot()):response({runtime:{instance:{id:'dataset-a'}},research:{topicsUnchanged:true,inbox:[{id:'fresh'}]},serverTime:'new-time'});});
 const first=await request('/api/data');first.research.topics[0].evidence.push({id:'local-only'});
 const next=await request('/api/data');assert.equal(seen[1].headers['X-Signal-Topics-Hash'],hash);assert.deepEqual(next.research.topics,snapshot().research.topics);assert.equal(next.serverTime,'new-time');assert.deepEqual(next.research.inbox,[{id:'fresh'}]);assert.equal(Object.hasOwn(next.research,'topicsUnchanged'),false);
 next.research.topics[0].version=999;assert.equal((await request('/api/data')).research.topics[0].version,1);
});

test('browser refuses partial responses with missing baseline, wrong hash, wrong dataset or ambiguous payload',async t=>{
 let body=snapshot(),validator=hash;const request=await client(t,async()=>response(body,validator));
 body={runtime:{instance:{id:'dataset-a'}},research:{topicsUnchanged:true}};
 await assert.rejects(request('/api/data'),/缓存校验失败/);
 body=snapshot();await request('/api/data');body={runtime:{instance:{id:'dataset-a'}},research:{topicsUnchanged:true}};validator=hash2;
 await assert.rejects(request('/api/data'),/缓存校验失败/);
 validator=hash;body.research.topics=[];await assert.rejects(request('/api/data'),/缓存校验失败/);
 delete body.research.topics;body.research.topicsUnchanged='true';await assert.rejects(request('/api/data'),/缓存校验失败/);
 body.research.topicsUnchanged=true;body.runtime.instance.id='dataset-b';await assert.rejects(request('/api/data'),/数据集已切换/);await assert.rejects(request('/api/data'),/刷新/);
});

test('real handler and browser helper preserve new versions, reject stale edits and retain history after conditional reads',async t=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'fixture-e2e'}}),handler=createHandler(store,service),seen=[];
 t.after(async()=>{await service.close();store.close();});
 const request=await client(t,async(path,options)=>{let status,headers,body;await handler({method:options.method,url:path,headers:{host:'127.0.0.1:4179',...Object.fromEntries(Object.entries(options.headers).map(([k,v])=>[k.toLowerCase(),v]))},async *[Symbol.asyncIterator](){yield options.body||'';}},{writeHead:(s,h)=>{status=s;headers=h;},end:b=>{body=b;}});seen.push({headers:options.headers,body:JSON.parse(body)});return new Response(body,{status,headers});});
 const topic=service.research.create({title:'Synthetic transport end-to-end',summary:'Preserve all versions'});
 await request('/api/data');const cached=await request('/api/data');assert.equal(seen.at(-1).body.research.topicsUnchanged,true);assert.equal(cached.research.topics[0].version,1);
 service.research.update(topic.id,{version:1,nextEvidence:'Other editor v2'});
 const changed=await request('/api/data');assert.equal(changed.research.topics[0].version,2);assert.equal(seen.at(-1).body.research.topicsUnchanged,undefined);
 await assert.rejects(request('/api/research/'+topic.id,'PATCH',{version:1,nextEvidence:'Stale editor'}));
 await request('/api/data');assert.equal(seen.at(-1).headers['X-Signal-Topics-Hash'],undefined);
 const saved=await request('/api/research/'+topic.id,'PATCH',{version:2,nextEvidence:'Current editor v3'});assert.equal(saved.research.topics[0].version,3);
 assert.deepEqual(service.research.history(topic.id).map(x=>x.version),[3,2,1]);
 await request('/api/data');await request('/api/data');assert.equal(seen.at(-1).body.research.topicsUnchanged,true);
});

test('out-of-order reads retain their own baseline without replacing the newest transport cache',async t=>{
 const pending=deferred(),seen=[];let count=0;
 const partial={runtime:{instance:{id:'dataset-a'}},research:{topicsUnchanged:true}};
 const request=await client(t,async(path,options)=>{seen.push(options);count++;if(count===1)return response(snapshot());if(count===2)return pending.promise;if(count===3)return response(snapshot([{id:'one',version:2,evidence:[]}]),hash2);return response(partial,hash2);});
 await request('/api/data');const older=request('/api/data');await request('/api/data');pending.resolve(response(partial));assert.equal((await older).research.topics[0].version,1);
 assert.equal((await request('/api/data')).research.topics[0].version,2);assert.equal(seen.at(-1).headers['X-Signal-Topics-Hash'],hash2);
});

test('mutation invalidation survives a late read, and old servers continue to return complete snapshots',async t=>{
 const pending=deferred(),seen=[];let count=0;
 const request=await client(t,async(path,options)=>{seen.push(options);count++;if(count===2)return pending.promise;return response(snapshot(),count>=3?null:hash);});
 await request('/api/data');const older=request('/api/data');await request('/api/research','POST',{});pending.resolve(response({runtime:{instance:{id:'dataset-a'}},research:{topicsUnchanged:true}}));assert.equal((await older).research.topics.length,1);
 await request('/api/data');assert.equal(seen.at(-1).headers['X-Signal-Topics-Hash'],undefined);await request('/api/data');assert.equal(seen.at(-1).headers['X-Signal-Topics-Hash'],undefined);
});
