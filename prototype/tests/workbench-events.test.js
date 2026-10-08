import test from 'node:test';
import assert from 'node:assert/strict';
import {groupEventResearch} from '../shared/workbench-events.mjs';
const topic=(id,extra={})=>({id,title:'Same title',status:'active',updatedAt:'2026-10-08T08:00:00Z',companies:[{symbol:'AAA.US'}],...extra});
const cluster=(extra={})=>({id:'c1',title:'A specific occurrence',status:'active',version:2,health:{current:true},topicIds:['a','b'],...extra});

test('only current explicit membership groups research; matching titles and shared companies never do',()=>{
 const topics=[topic('a'),topic('b'),topic('unrelated'),topic('source-container')],before=structuredClone(topics);
 const rows=groupEventResearch(topics,{eventClusters:[cluster()]});
 assert.equal(rows.length,3);assert.deepEqual(rows.find(r=>r.cluster).topics.map(t=>t.id),['a','b']);
 assert.equal(groupEventResearch(topics).length,4);assert.deepEqual(topics,before);
});

test('a risk in any member promotes its event and counts distinct positions and securities without adding evidence confidence',()=>{
 const topics=[topic('a'),topic('b',{companies:[{symbol:'AAA.US'},{symbol:'BBB.HK'}]}),topic('newest',{updatedAt:'2026-10-09T08:00:00Z',companies:[]})];
 const rows=groupEventResearch(topics,{eventClusters:[cluster()],events:[{id:'b',risk:true}],accounts:[{id:'one',positions:[{id:'one:lot',topicId:'a',symbol:'AAA.US'}]},{id:'two',positions:[{id:'two:lot',topicId:'unrelated',symbol:'AAA.US'}]}]});
 assert.equal(rows[0].id,'cluster:c1');assert(rows[0].risk);assert.equal(rows[0].companyCount,2);assert.equal(rows[0].positions,2);assert.equal(rows[0].support,undefined);
});

test('stale, archived or conflicting memberships cannot hide separate research and keep stable topic identities',()=>{
 const topics=[topic('a'),topic('b')];
 const stale=groupEventResearch(topics,{eventClusters:[cluster({health:{current:false}})]});
 assert.equal(stale.length,2);assert(stale.every(r=>r.groupStale&&!r.cluster));
 assert.equal(groupEventResearch(topics,{eventClusters:[cluster({status:'archived'})]}).length,2);
 const conflict=groupEventResearch(topics,{eventClusters:[cluster(),cluster({id:'c2'})]});assert.equal(conflict.length,2);assert(conflict.every(r=>r.groupStale));
 const archived=groupEventResearch([topic('a',{status:'archived'}),topic('b')],{eventClusters:[cluster()]});assert.equal(archived.length,2);assert.equal(archived.find(r=>r.topics[0].id==='a').cluster,null);
});

test('new versions preserve group identity and prior research while recent member changes set the display time',()=>{
 const first=groupEventResearch([topic('a'),topic('b')],{eventClusters:[cluster()]})[0];
 const next=groupEventResearch([topic('a'),topic('b'),topic('c',{updatedAt:'2026-10-10T08:00:00Z'})],{eventClusters:[cluster({version:3,topicIds:['a','b','c']})]})[0];
 assert.equal(next.id,first.id);assert.equal(next.topics.length,3);assert.equal(next.topics[0].id,'c');assert.equal(next.updatedAt,'2026-10-10T08:00:00Z');assert.equal(first.topics.length,2);
});
