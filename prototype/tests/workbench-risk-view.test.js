import test from 'node:test';
import assert from 'node:assert/strict';
import {positionRiskEntries,riskCounts} from '../shared/workbench-risk-view.mjs';
import {projectActualMonitoring} from '../shared/actual-monitoring.mjs';
import {buildWorkbenchOverview} from '../shared/workbench-overview.mjs';
const at='2026-10-12T04:03:00Z',record={id:'record-a',version:1,topicId:'topic',topicVersion:1},topic={id:'topic',version:1,status:'active'};
const check=(reviewKind,status,reason,extra={})=>({id:reviewKind,recordId:record.id,recordVersion:1,topicId:'topic',topicVersion:1,reviewKind,status,active:status==='hit',reason,checkedAt:at,...extra});
const project=(checks,paused=false)=>projectActualMonitoring(record,topic,{checks,at,operations:{observations:{paused}}});
test('actual presentation promotes retained negative triggers, separates review from gaps and preserves every original reason',()=>{
 const reason='沿用原研究监控；建仓依据保留',checks=[check('research-version','hit','研究已有变化'),check('counterevidence','unknown','缺少可比基线',{active:true}),check('review-due','hit','已到复核时间'),check('price-coverage','unknown','未设置价格条件')],monitoring=project(checks);
 const p={id:'actual:a',account:'actual:account',monitoring,actualResearch:{link:{status:'waiting',reason,links:[{status:'legacy',reason}]},origins:[{baselineAvailable:true}],conditions:[],due:[]},referenceValuation:{issues:['缺少行情']},risks:[reason,...monitoring.risks,'缺少行情','成本未知，无法计算浮盈亏']},before=structuredClone(p);
 const entries=positionRiskEntries(p);assert.equal(entries[0].category,'risk');assert.equal(entries[0].message,'上次触发尚未确认解除：反向线索');assert.equal(entries.find(r=>r.message==='研究已有变化').category,'review');assert.equal(entries.find(r=>r.message==='已到复核时间').category,'review');assert.equal(entries.find(r=>r.message==='缺少行情').category,'gap');
 assert.equal(entries.find(r=>r.originalMessage===reason).category,'gap');assert.match(entries.find(r=>r.originalMessage===reason).message,/系统判断/);
 assert.deepEqual(entries.map(r=>r.originalMessage||r.message).sort(),p.risks.toSorted());assert.deepEqual(p,before);
 const compact=structuredClone(p);compact.monitoring.checks=checks.map(({recordVersion,topicVersion,details,...c})=>c);assert.deepEqual(positionRiskEntries(compact),entries,'HTTP summary and internal full checks classify identically');
});
test('arbitrary condition hits are review prompts, paused prior risk stays risk, and clearing/unknown does not fabricate a new risk',()=>{
 const custom=check('condition:rise','hit','Price rose',{details:{definition:{definition:{label:'Synthetic rising price'}}}}),risk=check('research-invalidation','hit','Thesis invalidated');
 let m=project([custom,risk]);let rows=positionRiskEntries({monitoring:m,risks:m.risks});assert.equal(rows.find(r=>r.message==='Price rose').category,'review');assert.equal(rows[0].category,'risk');
 m=project([custom,risk],true);rows=positionRiskEntries({monitoring:m,risks:m.risks});assert.equal(rows[0].category,'risk');assert.match(rows[0].message,/上次触发/);assert.equal(rows.find(r=>r.message==='巡检已暂停').category,'gap');
 m=project([{...risk,status:'clear',active:false},{...custom,status:'unknown',active:false}]);rows=positionRiskEntries({monitoring:m,risks:m.risks});assert(rows.every(r=>r.category==='gap'));assert.equal(rows.length,1);
});
test('overview orders proven market alerts ahead of input gaps and retains stable identities, account scope and all messages',()=>{
 const topic={id:'t',status:'active',version:1,companies:[],hypothesis:{}},lot={id:'lot',topicId:'t',topicVersion:1,symbol:'AAPL.US',qty:1,costCents:100,valueCents:null,unrealizedCents:null};
 const account=(id,alerts)=>({accountId:id,book:{orders:[]},valuation:{positions:[lot]},risk:{alerts},quotes:{}});
 const input={at,topics:[topic],marketAccounts:[account('first',[]),account('second',[{kind:'holding-review',message:'Due',symbol:'AAPL.US',lotId:'lot'},{kind:'loss-exit-review',message:'Drawdown',symbol:'AAPL.US',lotId:'lot'},{kind:'pool-stop',key:'pool',message:'Pool',blocksBuy:true}])]},before=structuredClone(input),result=buildWorkbenchOverview(input);
 assert.equal(result.risks[0].category,'risk');assert.equal(result.risks[0].account,'second');assert(result.risks.some(r=>r.category==='gap'&&r.account==='first'));assert.equal(new Set(result.risks.map(r=>r.id)).size,result.risks.length);assert.equal(result.risks.length,5);assert.deepEqual(input,before);
});
test('counts separate message volume from affected positions and never merge same symbols across accounts',()=>{
 const rows=[{account:'a',positionId:'a:1',category:'risk'},{account:'a',positionId:'a:1',category:'risk'},{account:'a',positionId:'a:1',category:'gap'},{account:'b',positionId:'b:1',category:'risk'},{account:'b',category:'gap'},{account:'b',category:'review'}];
 assert.deepEqual(riskCounts(rows),{risk:{items:3,targets:2},review:{items:1,targets:1},gap:{items:2,targets:2},items:6,targets:3});
});
