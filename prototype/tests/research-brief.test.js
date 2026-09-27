import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {syncResearchWatches} from '../server/workflow.mjs';
import {eventDate} from '../src/integrated/daily-model.js';
const now='2026-09-25T04:30:00Z';
function brief(){return {id:'attachment-test',title:'Test event',summary:'Conditional research',label:'能源供给拐点',eventPublishedAt:'2026-09-24T16:16:00Z',eventTimeBasis:'Publisher time',attachment:{fileName:'input.txt',sha256:'a'.repeat(64),windowStart:'2026-09-24T12:00:00Z',windowEnd:'2026-09-25T00:00:00Z'},chain:[{id:'fact',title:'Fact',question:'What changed?'}],companies:[{symbol:'293.HK',name:'Cathay',role:'Research',note:'Fuel sensitivity'}],evidence:[{id:'e1',claim:'Reported discussion, not implementation',sourceName:'Reuters',url:'https://www.reuters.com/example',originKey:'Reuters',verification:'reported',stance:'supports',family:'corporate',step:'fact',interpretation:'Conditional',publishedAt:'2026-09-24T16:16:00Z'}],assessment:{status:'unverified',claim:'Passage improves by deadline',probability:30,basis:'Subjective, uncalibrated',impactIfTrue:'Cost relief',impactIfFalse:'Cost risk',horizon:'Weeks',resolveBy:'2026-10-25'},hypothesis:{action:'observe',logic:'Conditional',trigger:'Review risk',invalidation:'Failure',industryHorizon:'Quarter',holdingHorizon:'Weeks',reviewAt:'2026-09-26'},nextEvidence:'Operating data',dossier:{sections:[{id:'summary',title:'Analysis',paragraphs:['A conditional interpretation'],sourceIds:['e1'],table:{columns:['State','Effect'],rows:[['Open','Review']]}}]}};}
test('attachment import preserves prior research and paper, records actual first seen, and follows only linked securities',()=>{
 const store=openStore(':memory:');try{const r=openResearch(store,{clock:()=>now}),paper=openPaper(store,r,{clock:()=>now}),prior=JSON.stringify(r.get('agent-cpu')),book=JSON.stringify(paper.snapshot()),input=brief(),made=r.importBrief(input);
 assert.equal(made.origin,'attachment-research');assert.equal(made.evidence[0].firstSeen,now);assert.equal(made.assessment.method,'subjective-analyst');assert.equal(made.hypothesis.action,'observe');assert.equal(made.companies[0].symbol,'00293.HK');assert.equal(made.dossier.basedOnResearchVersion,1);assert.equal(JSON.stringify(r.get('agent-cpu')),prior);assert.equal(JSON.stringify(paper.snapshot()),book);
 const watches=syncResearchWatches(store,[made]);assert.deepEqual(watches.added,['00293.HK']);assert.equal(store.watchlist().length,1);
 r.update(made.id,{version:1,hypothesis:{logic:'User revision'}});assert.equal(r.importBrief(input).version,2);assert.equal(r.get(made.id).hypothesis.logic,'User revision');assert.equal(r.history(made.id).length,2);
 const changed=brief();changed.summary='Changed';assert.throws(()=>r.importBrief(changed),/不同内容/);
 }finally{store.close();}
});
test('invalid attachment content cannot mutate research or promote an observation into trading',()=>{
 const store=openStore(':memory:');try{const r=openResearch(store,{seed:false,clock:()=>now});const attempts=[b=>b.hypothesis.action='buy',b=>b.assessment.probability=101,b=>b.attachment.windowEnd='2027-01-01T00:00:00Z',b=>b.evidence[0].url='javascript:alert(1)',b=>b.dossier.sections[0].sourceIds=['missing'],b=>b.companies.push({...b.companies[0]}),b=>b.dossier.sections[0].table.rows=[['Wrong column count']]];
 for(const change of attempts){const input=brief();change(input);assert.throws(()=>r.importBrief(input));assert.equal(r.list().length,0);}
 }finally{store.close();}
});
test('event chart uses the actual event in each market, not older background evidence',()=>{
 const topic={eventPublishedAt:'2026-09-24T16:16:00Z',evidence:[{publishedAt:'2026-03-03'}]};assert.equal(eventDate(topic,'Asia/Hong_Kong'),'2026-09-25');assert.equal(eventDate(topic,'America/New_York'),'2026-09-24');assert.equal(eventDate({evidence:topic.evidence}),'2026-03-03');
});
