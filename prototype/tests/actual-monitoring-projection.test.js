import test from 'node:test';
import assert from 'node:assert/strict';
import {projectActualAccounts} from '../server/actual-holdings.mjs';
import {projectActualMonitoring} from '../shared/actual-monitoring.mjs';
const at='2026-10-12T04:03:00.000Z';
const record=(id,account,topicId)=>({id,account,topicId,topicVersion:1,version:1,symbol:'AAPL.US',currency:'USD',quantity:'1',unitCost:'100',price:'',feeBasis:'included',asOf:at,recordedAt:at});
const check=(id,recordId,extra={})=>({id,recordId,recordVersion:1,topicVersion:1,checkedAt:at,status:'clear',reviewKind:'counterevidence',active:false,reason:id,...extra});
const topic=id=>({id,version:1,title:id,status:'active',companies:[{symbol:'AAPL.US'}],hypothesis:{}});
const project=(snapshot,topics,monitoring,now=at)=>projectActualAccounts(snapshot,topics,now,monitoring).flatMap(a=>a.positions);
function fixture(){return {snapshot:{version:1,records:[record('a','Synthetic A','one'),record('b','Synthetic B','two'),record('c','Synthetic A','two')],watching:[{recordId:'b',state:'removed'},{recordId:'a',state:'deferred',reason:'Synthetic limit'},{recordId:'a',state:'watching'}]},topics:[topic('one'),topic('two')],monitoring:{checks:[check('a-hit','a',{status:'hit',active:true}),check('foreign','foreign',{status:'hit',active:true}),check('b-unknown','b',{status:'unknown',active:true}),check('a-old','a',{checkedAt:'2026-10-12T03:59:00.000Z'})],rules:[],operations:{observations:{paused:false}}}};}
test('batch monitoring retains exact record ownership, row order, first watch and old hits across same-symbol accounts',()=>{
 const f=fixture(),before=structuredClone(f),positions=project(f.snapshot,f.topics,f.monitoring);
 for(const p of positions){const r=f.snapshot.records.find(r=>r.id===p.recordId),t=f.topics.find(t=>t.id===r.topicId);assert.deepEqual(p.monitoring,projectActualMonitoring(r,t,{...f.monitoring,watching:f.snapshot.watching,at}));}
 assert.deepEqual(positions.map(p=>p.monitoring.checks.map(c=>c.id)),[['a-hit','a-old'],[],['b-unknown']]);
 assert.equal(positions.find(p=>p.recordId==='a').monitoring.state,'stale');assert.match(positions.find(p=>p.recordId==='b').monitoring.risks.join(' '),/上次触发尚未确认解除/);assert.equal(positions.find(p=>p.recordId==='c').monitoring.state,'pending');assert.deepEqual(f,before);
});
test('each projection observes changed checks, rules, watches and clock without stale cross-request reuse',()=>{
 const f=fixture();f.monitoring.checks=[check('a','a'),check('b','b')];const first=project(f.snapshot,f.topics,f.monitoring);assert.equal(first.find(p=>p.recordId==='a').monitoring.state,'checked');
 f.monitoring.rules.push({id:'new-rule',topicId:'one',version:1,definition:{conditions:[{symbol:'AAPL.US'}]}});let next=project(f.snapshot,f.topics,f.monitoring);assert.equal(next.find(p=>p.recordId==='a').monitoring.state,'changed');assert.equal(next.find(p=>p.recordId==='b').monitoring.state,'checked');
 f.monitoring.checks.push(check('rule','a',{ruleId:'new-rule',ruleVersion:1,status:'hit',active:true}));f.snapshot.watching.splice(1,2,{recordId:'a',state:'removed'});next=project(f.snapshot,f.topics,f.monitoring);assert.equal(next.find(p=>p.recordId==='a').monitoring.hitCount,1);assert.equal(next.find(p=>p.recordId==='a').monitoring.watch.state,'removed');
 f.monitoring.rules[0].version=2;assert.equal(project(f.snapshot,f.topics,f.monitoring).find(p=>p.recordId==='a').monitoring.state,'changed');f.monitoring.rules=[];f.monitoring.checks=[check('later','a',{status:'unknown',active:true})];assert.equal(project(f.snapshot,f.topics,f.monitoring,'2026-10-12T04:06:00.000Z').find(p=>p.recordId==='a').monitoring.state,'stale');
 f.monitoring.operations.observations.paused=true;assert.equal(project(f.snapshot,f.topics,f.monitoring).find(p=>p.recordId==='a').monitoring.state,'paused');assert.deepEqual(first.find(p=>p.recordId==='a').monitoring.checks.map(c=>c.id),['a']);
});
test('large batches avoid rescanning every unrelated check for every holding',()=>{
 const records=Array.from({length:100},(_,i)=>record(String(i),'Synthetic '+i,'one'));let inspected=0;
 const checks=records.flatMap(r=>Array.from({length:10},(_,i)=>({...check(r.id+':'+i,r.id),get recordId(){inspected++;return r.id;}})));
 const positions=project({version:1,records},[topic('one')],{checks,operations:{observations:{paused:false}}});assert.equal(positions.length,100);assert(positions.every(p=>p.monitoring.current&&p.monitoring.checks.length===10));assert(inspected<=3000,`Unrelated check scans grew to ${inspected}`);
});
