import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openSemanticEvents,validateComparison,comparisonPrompt,MATERIAL_SEMANTIC_SCHEMA,SEMANTIC_SCHEMA} from '../server/semantic-events.mjs';
import {digest} from '../server/codex-research.mjs';

const at='2026-10-03T00:00:00Z';
const packet={schema:'event-pair-material-1',input:{left:{title:'甲公司交易进展',body:'甲公司在2026年10月2日宣布签约。Today the company welcomes the new team.',publishedAt:'2026-10-02T23:30:00-07:00'},right:{title:'乙公司交易进展',body:'乙公司于2025年1月3日终止协议。',publishedAt:null}}};
const base=side=>({actor:'公司',action:'宣布',object:'交易',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'公告',quote:packet.input[side].title,quoteField:'title'});
const output=()=>({relation:'unrelated',left:base('left'),right:base('right'),reason:'不同对象',missingEvidence:['独立核验']});
const check=v=>validateComparison(v,packet,{requireTimeEvidence:true});
function explicit(){const v=output();v.left.eventTime='2026年10月2日';v.left.timeEvidence={basis:'explicit',quote:'甲公司在2026年10月2日宣布签约。',quoteField:'body'};return v;}
function relative(){const v=output();v.left.eventTime='Today';v.left.timeEvidence={basis:'relative',quote:'Today the company welcomes the new team.',quoteField:'body'};return v;}

test('event time requires a separate exact source span without translating or normalizing its date',()=>{
 const v=explicit();assert.deepEqual(check(v),v);
 const translated=explicit();translated.left.eventTime='2026-10-02';assert.throws(()=>check(translated),e=>e.code==='output');
 const metadata=explicit();metadata.left.eventTime=packet.input.left.publishedAt;assert.throws(()=>check(metadata),e=>e.code==='output');
});
test('relative evidence stays relative across publication offsets, missing dates and acquisition times',()=>{
 const v=relative();for(const publishedAt of [null,'2026-10-02','2026-10-02T23:30:00-07:00']){
  const p=structuredClone(packet);p.input.left.publishedAt=publishedAt;p.input.left.availableAt=at;
  assert.deepEqual(validateComparison(v,p,{requireTimeEvidence:true}),v);
 }
 const wrong=relative();wrong.left.eventTime='2026-10-03';assert.throws(()=>check(wrong),e=>e.code==='output');
 const misclassified=relative();misclassified.left.timeEvidence.basis='explicit';assert.throws(()=>check(misclassified),e=>e.code==='output');
});
test('time quotes cannot be borrowed from the other side, metadata or a missing body',()=>{
 for(const mutate of [v=>v.left.timeEvidence.quote=packet.input.right.body,v=>v.left.timeEvidence.quoteField='title',v=>v.left.timeEvidence.quote='2026年10月2日是已核实交割日',v=>v.left.timeEvidence.quoteField='publishedAt']){
  const v=explicit();mutate(v);assert.throws(()=>check(v),e=>e.code==='output');
 }
 const p=structuredClone(packet);delete p.input.left.body;assert.throws(()=>validateComparison(explicit(),p,{requireTimeEvidence:true}),e=>e.code==='output');
});
test('unknown cannot silently carry a date, evidence or a source field',()=>{
 assert.deepEqual(check(output()),output());
 for(const mutate of [v=>v.left.eventTime='2026-10-02',v=>v.left.timeEvidence.quote='未知',v=>v.left.timeEvidence.quoteField='body',v=>v.left.timeEvidence.basis='inferred',v=>v.left.timeEvidence.extra=true,v=>v.left.timeEvidence=[]]){
  const v=output();mutate(v);assert.throws(()=>check(v),e=>e.code==='output');
 }
});
test('new generation requires time evidence while legacy validation and reading remain available',()=>{
 const legacy=output();delete legacy.left.timeEvidence;delete legacy.right.timeEvidence;
 assert.deepEqual(validateComparison(legacy,packet),legacy);assert.throws(()=>check(legacy),e=>e.code==='output');
 for(const schema of [SEMANTIC_SCHEMA,MATERIAL_SEMANTIC_SCHEMA])for(const side of ['left','right'])assert.ok(schema.properties[side].required.includes('timeEvidence'));
 assert.match(comparisonPrompt(packet),/不能把相对词换算成确定日期/);
});
test('valid time evidence on a headline cannot refer to a nonexistent body',()=>{
 const p={schema:'event-pair-1',input:{left:{title:'甲公司2026年10月2日签约'},right:{title:'乙公司今日宣布合作'}}},v=output();
 delete v.left.quoteField;delete v.right.quoteField;v.left.quote=p.input.left.title;v.right.quote=p.input.right.title;
 v.left.eventTime='2026年10月2日';v.left.timeEvidence={basis:'explicit',quote:p.input.left.title,quoteField:'title'};
 v.right.eventTime='今日';v.right.timeEvidence={basis:'relative',quote:p.input.right.title,quoteField:'title'};
 assert.deepEqual(validateComparison(v,p,{requireTimeEvidence:true}),v);
 v.left.timeEvidence.quoteField='body';assert.throws(()=>validateComparison(v,p,{requireTimeEvidence:true}),e=>e.code==='output');
});
test('new runs reject missing time evidence and preserve their failed input for review',async()=>{
 const store=openStore(':memory:');store.ingest(['left','right'].map(id=>({id,title:id,url:`https://example.invalid/${id}`,publisher:'fixture',publishedAt:at})),at);
 const semantic=openSemanticEvents(store,{enabled:true,config:{binary:'/test/codex',model:'test',timeoutMs:1000},runner:async p=>{
  const c=output();for(const side of ['left','right']){delete c[side].timeEvidence;delete c[side].quoteField;c[side].quote=p.input[side].title;}
  const rawOutput=JSON.stringify(c);return {status:'candidate',reviewStatus:'unreviewed',comparison:c,rawOutput,trace:{model:'test',inputHash:p.inputHash,outputHash:digest(rawOutput)}};
 }});
 try{const r=semantic.start({left:{id:'left',revision:1},right:{id:'right',revision:1}}),done=await semantic.wait(r.id);assert.equal(done.status,'failed');assert.equal(done.failure.code,'output');assert.equal(done.packet.input.left.title,'left');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM semantic_decisions').get().n,0);}finally{await semantic.close();store.close();}
});
