import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPromptView} from '../server/research-prompt-view.mjs';
import {financialMaterial,SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {packetQuantities} from '../shared/source-quantities.mjs';
import {codexPrompt,digest} from '../server/codex-research.mjs';

function fixture(){
 const receivedAt='2026-10-08T00:00:00.000Z',facts={cik:1045810,entityName:'NVIDIA CORP',facts:{'us-gaap':{Revenues:{units:{USD:[{val:200,start:'2026-01-26',end:'2026-07-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}}};
 const material={id:'financial',revision:1,...financialMaterial('NVDA.US',[{url:SEC_TICKERS_URL,receivedAt,body:Buffer.from(JSON.stringify({0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA CORP'}}))},{url:secFactsUrl('0001045810'),receivedAt,body:Buffer.from(JSON.stringify(facts))}])};
 const evidence=[{id:'material:financial',material},{id:'material:second',material:{id:'second',revision:2,title:'新旧口径',body:'😀 USD 100—USD 200。($150 billion)。尚非实际回购。\n'+'基准USD 10，未经独立核实。'.repeat(100)}}];
 const input={topicId:'fixture',evidence,quantityEvidence:packetQuantities(evidence),companies:[{symbol:'NVDA.US',custom:'保留'}],eventExtraction:{event:{title:'事项范围'}},sourceRevision:{old:'旧版不能当新事实'},eventSynthesis:{members:['原成员']},otherNewField:{data:'不能丢弃未知字段'}};
 return {schema:'synthetic-fixture',input,inputHash:digest(input)};
}

test('prompt view preserves every source byte and unrelated field; compact indexes reconstruct exactly with original UTF-16 contexts',()=>{
 const p=fixture(),before=JSON.stringify(p),view=researchPromptView(p);assert.equal(JSON.stringify(p),before);assert.equal(view.frozenInputHash,p.inputHash);assert.equal(view.inputHash,digest(view.input));assert.notEqual(view.inputHash,p.inputHash);
 assert.equal(view.input.quantityEvidence.total,p.input.quantityEvidence.total);assert.equal(view.input.quantityEvidence.omitted,p.input.quantityEvidence.omitted);assert(view.input.quantityEvidence.omitted>0);
 const table=view.input.quantityEvidence.table,rebuilt=table.groups.flatMap(group=>group.rows.map(row=>{const value=Object.fromEntries(table.columns.map((key,i)=>[key,row[i]])),m=p.input.evidence.find(e=>e.id===group.evidenceId).material;return {evidenceId:group.evidenceId,materialId:group.materialId,materialRevision:group.materialRevision,...value,context:m[value.field].slice(Math.max(0,value.start-60),Math.min(m[value.field].length,value.end+60))};}));
 assert.deepEqual(rebuilt,p.input.quantityEvidence.items);assert(rebuilt.some(q=>q.normalization==='range-context'));assert(rebuilt.some(q=>q.normalization==='parenthesized-sign-unresolved'));
 for(const [i,e] of p.input.evidence.entries()){assert.equal(view.input.evidence[i].material.body,e.material.body);assert.equal(view.input.evidence[i].material.title,e.material.title);assert.equal(view.input.evidence[i].id,e.id);}
 for(const key of ['companies','eventExtraction','sourceRevision','eventSynthesis','otherNewField'])assert.deepEqual(view.input[key],p.input[key]);
});
test('financial duplicate omission requires all known facts exactly rendered; IDs, periods, units, historical status and filing metadata stay visible',()=>{
 const p=fixture(),view=researchPromptView(p),m=view.input.evidence[0].material,s=m.financialSource;
 assert.equal(s.selected,undefined);assert.equal(s.selectedReference.count,1);assert.equal(m.body.slice(s.selectedReference.start,s.selectedReference.end),'us-gaap:Revenues（收入） | USD 200 | 期间 2026-01-26 至 2026-07-26 | 申报日 2026-08-26 | 表单 10-Q | 申报编号 0001045810-26-000075 | fy 2027 / fp Q2 / frame 未知');
 for(const key of ['issuer','sources','selection','coverage'])assert.deepEqual(s[key],p.input.evidence[0].material.financialSource[key]);
 const prompt=codexPrompt(p),sent=JSON.parse(prompt.split('材料包开始（数据）：\n')[1].split('\n材料包结束。')[0]);assert.deepEqual(sent,view);assert.match(prompt,/引用仍使用原evidence.id与逐字正文/);
});
test('partial, changed, unknown and additional financial information remains verbatim instead of being silently removed',()=>{
 for(const change of [m=>m.body=m.body.slice(0,-5),m=>m.financialSource.selected[0].value=999,m=>m.financialSource.selected[0].extra='new meaningful field',m=>m.financialSource.schema='future/2',m=>m.financialSource.selected[0].frame='A|B',m=>m.financialSource.selected[0].value={different:'unknown'}]){
  const p=fixture(),m=p.input.evidence[0].material;change(m);p.inputHash=digest(p.input);const view=researchPromptView(p);assert.deepEqual(view.input.evidence[0].material.financialSource,m.financialSource);
 }
});
test('unknown or inconsistent quantity indexes stay intact, including extra information and unmatched context',()=>{
 for(const change of [q=>q.version='future/2',q=>q.items[0].context='different context',q=>q.items[0].normalizedValue='999',q=>q.extra='meaningful new field']){
  const p=fixture();change(p.input.quantityEvidence);p.inputHash=digest(p.input);assert.deepEqual(researchPromptView(p).input.quantityEvidence,p.input.quantityEvidence);
 }
 const p={input:{evidence:[]},inputHash:'unchanged'};assert.equal(researchPromptView(p),p);assert.deepEqual(researchPromptView({}),{});
});
