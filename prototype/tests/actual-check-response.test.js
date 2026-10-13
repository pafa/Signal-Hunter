import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {compactActualChecks,actualCheckHash,actualCheckChanged,actualCheckMissing} from '../server/actual-check-response.mjs';
import {hydrateActualChecks} from '../shared/actual-check-transport.mjs';
import {safeDiagnosticPayload} from '../shared/safe-errors.mjs';
const at='2026-10-02T06:00:00.000Z';
const call=async(handler,url,headers={},method='GET',data)=>{let status,body,responseHeaders;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'fixture-details',...headers},async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:(s,h)=>{status=s;responseHeaders=h;},end:b=>body=JSON.parse(b)});return {status,body,headers:responseHeaders};};
const route=ref=>`/api/actual-holdings/${ref.recordId}/checks/${ref.checkId}/${ref.hash}`;
async function using(fn){
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'fixture-details'},now:()=>Date.parse(at)}),handler=createHandler(store,service);
 try{
  let topic=service.research.create({title:'Synthetic detail transport',summary:'Fixture only'});topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Synthetic association'});
  const rows=['Synthetic A','Synthetic B'].map(account=>({account,symbol:'AAPL.US',quantity:'1',unitCost:'100',price:'110',asOf:at,source:'Synthetic',feeBasis:'included',topicId:topic.id,topicVersion:topic.version}));
  const p=service.actualHoldings.preview({rows});assert(p.canApply);service.actualHoldings.apply({id:p.id,hash:p.hash});
  await service.runOperation('observations');
  await fn({store,service,handler,topic});
 }finally{await service.close();store.close();}
}
test('summary transport preserves every check and risk and rehydrates the exact full snapshot without GET writes',()=>using(async({store,service,handler,topic})=>{
 const before=store.db.prepare('SELECT total_changes() n').get().n,original=service.snapshot();
 const first=await call(handler,'/api/data',{'x-signal-holding-checks':'summary-v1'});assert.equal(first.status,200);
 const projected=compactActualChecks(original,'summary-v1');assert.deepEqual(first.body,safeDiagnosticPayload(projected));
 assert.equal(first.body.observationInbox.actualChecks.length,20);
 const cache=new Map();
 for(const summary of first.body.observationInbox.actualChecks){
  assert.equal(summary.details,undefined);const res=await call(handler,route(summary.detailRef));assert.equal(res.status,200);
  assert.equal(res.body.instance.id,'fixture-details');cache.set(summary.id,res.body.check);
 }
 first.body=hydrateActualChecks(first.body);
 const restore=summary=>{assert(cache.has(summary.id));return cache.get(summary.id);};
 first.body.observationInbox.actualChecks=first.body.observationInbox.actualChecks.map(restore);
 for(const a of first.body.overview.accounts)for(const p of a.positions)if(p.monitoring)p.monitoring.checks=p.monitoring.checks.map(restore);
 assert.deepEqual(first.body,safeDiagnosticPayload(original));assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
 assert.deepEqual(compactActualChecks(original,undefined),original);assert.equal(compactActualChecks(original,'summary-v2'),original);
 const conditional=await call(handler,'/api/data',{'x-signal-holding-checks':'summary-v1','x-signal-topics-hash':first.headers['X-Signal-Topics-Hash']});assert.equal(conditional.body.research.topicsUnchanged,true);assert.equal(conditional.body.observationInbox.actualChecks[0].details,undefined);
 const legacy=await call(handler,'/api/data');assert.deepEqual(legacy.body.observationInbox.actualChecks,original.observationInbox.actualChecks);
 const changed=await call(handler,'/api/research/'+topic.id,{'x-signal-holding-checks':'summary-v1'},'PATCH',{version:topic.version,nextEvidence:'Synthetic revision'});assert.equal(changed.status,200);assert.equal(changed.body.observationInbox.actualChecks[0].details,undefined);
 assert(service.observations.summary().actualChecks.every(c=>c.details.record));
}));
test('detail reads reject changed inputs, retired checks, wrong accounts, queries and dataset changes without rewriting frozen receipts',()=>using(async({store,service,handler})=>{
 const checks=service.observations.summary().actualChecks,check=checks[0],other=checks.find(c=>c.recordId!==check.recordId);
 const ref={recordId:check.recordId,checkId:check.id,hash:actualCheckHash(check)},path=route(ref),history=service.observations.snapshot().items;
 assert.equal((await call(handler,route({...ref,recordId:other.recordId}))).body.error,actualCheckMissing);
 assert.equal((await call(handler,path+'?hash=ignored')).status,400);
 assert.equal((await call(handler,path,{'x-signal-instance':'other-dataset'})).status,409);
 const {id,...payload}=check;payload.details.metrics={...payload.details.metrics,changed:'Different input, same check and research versions'};
 store.db.prepare('UPDATE actual_observation_states SET payload=? WHERE id=?').run(JSON.stringify(payload),id);
 const before=store.db.prepare('SELECT total_changes() n').get().n;
 assert.equal((await call(handler,path)).body.error,actualCheckChanged);
 const updated=service.observations.summary().actualChecks.find(c=>c.id===id),good=await call(handler,route({...ref,hash:actualCheckHash(updated)}));assert.equal(good.status,200);assert.equal(good.body.check.details.metrics.changed,payload.details.metrics.changed);
 assert.deepEqual(service.observations.snapshot().items,history);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
 payload.status='retired';store.db.prepare('UPDATE actual_observation_states SET payload=? WHERE id=?').run(JSON.stringify(payload),id);
 assert.equal((await call(handler,path)).body.error,actualCheckMissing);
}));
test('summary joins reject duplicate, missing, foreign-record and ambiguous checks instead of showing a partial risk view',()=>{
 const id='a'.repeat(64),recordId='b'.repeat(64),check={id,recordId,reviewKind:'counterevidence',status:'unknown',active:true,reason:'Synthetic unknown',checkedAt:at,details:{record:{id:recordId},metrics:{error:'private upstream failure'}}};
 const original={observationInbox:{actualChecks:[check]},overview:{accounts:[{positions:[{recordId,monitoring:{checks:[check],unknownCount:1}}]}]}};
 const wire=()=>structuredClone(compactActualChecks(original,'summary-v1')),valid=hydrateActualChecks(wire());assert.equal(valid.overview.accounts[0].positions[0].monitoring.checks[0],valid.observationInbox.actualChecks[0]);assert.equal(valid.overview.accounts[0].positions[0].monitoring.unknownCount,1);
 const changes=[p=>p.actualCheckTransport='unknown',p=>p.observationInbox.actualChecks.push(p.observationInbox.actualChecks[0]),p=>p.observationInbox.actualChecks=[],p=>p.overview.accounts[0].positions[0].recordId='c'.repeat(64),p=>p.overview.accounts[0].positions[0].monitoring.checks=[],p=>p.overview.accounts[0].positions[0].monitoring.checkIds.push(id),p=>p.observationInbox.actualChecks[0].detailRef.hash='invalid',p=>p.observationInbox.actualChecks[0].details={}];
 for(const change of changes){const p=wire();change(p);assert.throws(()=>hydrateActualChecks(p),/巡检摘要校验失败/);}
 assert.equal(hydrateActualChecks(original),original);
});
