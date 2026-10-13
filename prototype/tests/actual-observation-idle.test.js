import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openActualObservations} from '../server/actual-observations.mjs';

const at='2026-10-11T08:00:00.000Z',later='2026-10-11T08:01:00.000Z';
function fixture(){
 const store=openStore(':memory:');let records=[],contexts=0;
 const monitor=openActualObservations(store,{getHoldings:()=>({enabled:true,records}),getRules:()=>[],getTopicVersion:()=>null,getResearchContext:(_topics,received)=>{contexts++;assert.deepEqual(received,records);return null;}});
 return {store,monitor,setRecords:v=>records=v,get contexts(){return contexts;},close:()=>store.close()};
}
test('empty and fully closed holdings do not rebuild unrelated research context',()=>{
 const f=fixture();try{
  assert.deepEqual(f.monitor.evaluate([],at),[]);assert.equal(f.contexts,0);
  f.setRecords([{id:'closed',quantity:'0'}]);assert.deepEqual(f.monitor.evaluate([],later),[]);assert.equal(f.contexts,0);assert.deepEqual(f.monitor.checks(),[]);
 }finally{f.close();}
});
test('closing the last holding retires its checks without rebuilding context or discarding saved history',()=>{
 const f=fixture();try{
  const record={id:'holding',version:1,account:'Synthetic',symbol:'NVDA.US',quantity:'1',topicId:null,topicVersion:null,recordedAt:at};
  f.setRecords([record]);f.monitor.evaluate([],at);assert.equal(f.contexts,1);assert.equal(f.monitor.checks().length,5);
  const before=f.store.db.prepare('SELECT id,payload FROM actual_observation_states ORDER BY id').all();assert.equal(before.length,5);
  f.setRecords([{...record,quantity:'0'}]);assert.deepEqual(f.monitor.evaluate([],later),[]);assert.equal(f.contexts,1);assert.deepEqual(f.monitor.checks(),[]);
  const after=f.store.db.prepare('SELECT id,payload FROM actual_observation_states ORDER BY id').all();assert.deepEqual(after.map(r=>r.id),before.map(r=>r.id));
  for(let i=0;i<after.length;i++){const old=JSON.parse(before[i].payload),saved=JSON.parse(after[i].payload);assert.equal(saved.status,'retired');assert.equal(saved.active,false);assert.equal(saved.checkedAt,later);assert.deepEqual(saved.details,old.details);assert.equal(saved.lastTodoId,old.lastTodoId);}
 }finally{f.close();}
});
test('an empty portfolio still enforces restore and time checks',()=>{
 const f=fixture();try{
  assert.throws(()=>f.monitor.evaluate([],'invalid'),/时间无效/);
  f.store.db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1')").run();assert.throws(()=>f.monitor.evaluate([],at),/恢复副本/);assert.equal(f.contexts,0);
 }finally{f.close();}
});
