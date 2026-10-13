import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMaterialEvents,materialEventsPrompt,MATERIAL_EVENTS_VERSION} from '../server/material-events.mjs';
import {eventComparisonSnapshot} from '../server/semantic-event-scopes.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';

const source='NVIDIA today announced that its Board of Directors has authorized an additional $150 billion under the company’s existing share repurchase program, increasing the total remaining amount authorized to $235 billion.';
function event(quote=source,title='NVIDIA宣布董事会批准增加1500亿美元股份回购授权'){
 return {title,actor:'NVIDIA',action:'批准',object:'股份回购授权',stage:'宣布批准',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown',quote,quoteField:'body',boundaryReason:'同一回购决定'};
}
function candidate(e=event()){return {events:[e],scopeNote:'仅分析冻结材料',missingEvidence:['核验公开原件']};}
function packet(body=source,schema=MATERIAL_EVENTS_VERSION){return {schema,input:{material:{title:'公开资料',body}}};}
function project(body,quote,title){return validateMaterialEvents(candidate(event(quote,title)),packet(body));}

test('R42 public wording cannot turn an ambiguous dollar sign into USD; raw text and gaps survive',()=>{
 const raw=candidate();raw.missingEvidence=Array.from({length:20},(_,i)=>`原缺口${i}`);const before=JSON.stringify(raw);
 const result=validateMaterialEvents(raw,packet());assert.equal(result.events[0].title,'NVIDIA宣布董事会批准增加〔金额待核〕股份回购授权');assert.equal(result.events[0].quote,source);assert.deepEqual(result.missingEvidence.slice(1),raw.missingEvidence);assert.equal(JSON.stringify(raw),before);
 assert.match(materialEventsPrompt(packet()),/不因公司国别或交易所推定/);
 assert.equal(project(source,source,'NVIDIA批准$150 billion股份回购授权').events[0].title,'NVIDIA批准$150 billion股份回购授权');
});
test('explicit same-unit equivalent amounts and percentages survive; FX, magnitude and unsupported inferences do not',()=>{
 for(const [quote,title] of [['授权US$150 billion','授权1500亿美元'],['人民币1.25亿元','CNY 125 million'],['持股12.5 percent','持股12.5%']])assert.equal(project(quote,quote,title).events[0].title,title);
 for(const [quote,title] of [['授权US$150 billion','授权150亿美元'],['授权HK$150 billion','授权1500亿美元'],['授权¥150 billion','授权1500亿元'],['持股12.5%','持股125%'],['授权$150 billion','授权$150000 million']])assert.match(project(quote,quote,title).events[0].title,/待核/);
});
test('full source context and every quote occurrence prevent cropped signs, ranges, units and matching elsewhere',()=>{
 for(const [body,quote,title] of [['(USD 150 billion)','USD 150 billion','授权1500亿美元'],['- USD 150 billion','USD 150 billion','授权1500亿美元'],['USD 100 billion—USD 150 billion','USD 150 billion','授权1500亿美元'],['HK$150 billion','150 billion','授权1500亿美元'],['旧报告USD 150 billion。本事项$150 billion。','$150 billion','授权1500亿美元'],['(USD 150 billion)。USD 150 billion','USD 150 billion','授权1500亿美元']])assert.match(project(body,quote,title).events[0].title,/待核/,body);
});
test('all event descriptive fields are guarded, valid bounds retained, legacy versions preserved exactly',()=>{
 const raw=candidate();for(const k of ['actor','action','object','stage','boundaryReason'])raw.events[0][k]='原叙述1500亿美元';raw.events[0].title='甲'.repeat(138)+'1%';
 const result=validateMaterialEvents(raw,packet());assert(result.events[0].title.length<=140);assert.match(result.events[0].title,/待核$/);for(const k of ['actor','action','object','stage','boundaryReason'])assert.match(result.events[0][k],/金额待核/);
 assert.deepEqual(validateMaterialEvents(raw,packet(source,'material-events-2')),raw);
 const v1=structuredClone(raw);delete v1.events[0].timeRole;assert.deepEqual(validateMaterialEvents(v1,packet(source,'material-events-1'),{allowLegacy:true}),v1);
});
test('projected occurrence continues automatically through dossier, verifies provenance, preserves source and blocks forged projection',async()=>{
 let extractionRaw,packetTitle;
 const f=fixture({sourceReader:async url=>({url,title:'公开措辞开发样本',sourceName:'合成流程夹具',body:source+'合成补足长度，不构成额外证据。'.repeat(40),scope:'extracted-text'}),extractionRunner:p=>{const raw=candidate();extractionRaw=JSON.stringify(raw);return {...output(p,'decomposition',raw),decomposition:validateMaterialEvents(raw,p)};},researchRunner:p=>{packetTitle=p.input.eventExtraction.event.title;return dossier(p);}});
 try{
  const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>f.queue.snapshot().counts.completed===1);
  assert.deepEqual(f.calls,{extract:1,identity:1,dossier:1,semantic:0,semanticInvocations:0});const t=f.service.research.list().find(t=>t.eventExtraction);assert.match(t.title,/金额待核/);assert.equal(t.title,packetTitle);assert.equal(t.dossier.actor.kind,'system');assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);assert.deepEqual(f.service.paper.snapshot(),paper);
  const run=JSON.parse(f.store.db.prepare('SELECT payload FROM material_event_runs').get().payload);assert.equal(run.candidate.rawOutput,extractionRaw);const ref={id:t.id,revision:1};assert.equal(eventComparisonSnapshot(f.store.db,ref).eventFocus.title,t.title);
  assert(f.service.research.materialList(t.id).materials[0].body.startsWith(source));
  run.candidate.decomposition.events[0].title='伪造投影';f.store.db.prepare('UPDATE material_event_runs SET payload=? WHERE id=?').run(JSON.stringify(run),run.id);assert.throws(()=>eventComparisonSnapshot(f.store.db,ref));assert.equal(f.service.materialEvents.get(run.topicId,run.id).stale,true);
 }finally{await f.close();}
});
