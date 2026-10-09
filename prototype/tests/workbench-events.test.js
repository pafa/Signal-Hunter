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

test('saved succession moves retired research into history without hiding its positions or promoting old company counts',()=>{
 const old=topic('old',{companies:[{symbol:'OLD.US'}],updatedAt:'2026-10-10T08:00:00Z'}),topics=[topic('a'),topic('b'),old],before=structuredClone(topics);
 const c=cluster({history:[{topicId:'old',currentTopicId:'a',materialRevision:1,clusterVersion:2}]});
 const rows=groupEventResearch(topics,{eventClusters:[c],events:[{id:'old',risk:true}],accounts:[{positions:[{topicId:'old',symbol:'OLD.US'}]}]});
 assert.equal(rows.length,1);assert.deepEqual(rows[0].topics.map(t=>t.id),['a','b']);assert.deepEqual(rows[0].historicalTopics.map(t=>t.id),['old']);assert.equal(rows[0].allTopics.length,3);assert(rows[0].risk&&rows[0].historicalRisk);assert.equal(rows[0].positions,1);assert.equal(rows[0].companyCount,1);assert.equal(rows[0].updatedAt,topic('a').updatedAt);assert.deepEqual(topics,before);
});
test('historical membership never overrides a current owner and stale or ambiguous history stays visible independently',()=>{
 const topics=[topic('a'),topic('b'),topic('old')],c=cluster({history:[{topicId:'old',currentTopicId:'a'}]});
 const stale=groupEventResearch(topics,{eventClusters:[{...c,health:{current:false}}]});assert.equal(stale.length,3);assert(stale.find(r=>r.topics[0].id==='old').groupStale);
 const conflict=groupEventResearch(topics,{eventClusters:[c,{...c,id:'other',topicIds:['b']}]});assert.equal(conflict.find(r=>r.topics[0]?.id==='old').cluster,null);
 const assigned=groupEventResearch(topics,{eventClusters:[c,cluster({id:'new-owner',topicIds:['old']})]});assert.equal(assigned.find(r=>r.topics.some(t=>t.id==='old')).cluster.id,'new-owner');assert.equal(assigned.flatMap(r=>r.historicalTopics).length,0);
 const noAnchor=groupEventResearch(topics,{eventClusters:[c,cluster({id:'conflicting-current'})]});assert.equal(noAnchor.length,3);assert(noAnchor.every(r=>!r.cluster&&r.topics.length));assert(noAnchor.find(r=>r.topics[0].id==='old').groupStale);
 const archived=groupEventResearch([topic('a'),topic('b'),topic('old',{status:'archived'})],{eventClusters:[c]});assert.equal(archived.length,1);assert.equal(archived[0].historicalTopics[0].status,'archived');
});
