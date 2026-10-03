import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceQuantities,packetQuantities} from '../shared/source-quantities.mjs';
test('explicit source monetary units normalize exactly without floating point rounding or currency inference',()=>{
 for(const [text,value,unit] of [['USD 1.25 billion','1250000000','USD'],['3.2亿美元','320000000','USD'],['人民币1,234.50万元','12345000','CNY'],['HK$ -2.75 million','-2750000','HKD'],['0.000001 million USD','1','USD'],['10.25%','10.25','percent'],['−0.50 percent','-0.5','percent'],['1万亿美元','1000000000000','USD']]){
  const q=sourceQuantities(text);assert.equal(q.length,1,text);assert.equal(q[0].normalizedValue,value,text);assert.equal(q[0].unit,unit,text);assert.equal(text.slice(q[0].start,q[0].end),q[0].raw);assert.equal(q[0].raw,text);
 }
});
test('ambiguous currencies, conflicting units and abbreviated ranges never become point values',()=>{
 for(const text of ['$10 million','¥100','USD 10 HKD','$10–12 million','USD 10-20 million','(USD 100)','-USD 100','- $10']){const q=sourceQuantities(text);assert(q.length,text);assert(q.every(x=>x.normalizedValue===null),text);}
 for(const text of ['12,34 USD','1e6 USD','AB100USD','2026 revenue','100 million','v10percentExtra','USD 10 bn','USD 10.20.30'])assert.deepEqual(sourceQuantities(text),[],text);
});
test('immutable offsets and bounded packet inventory disclose omitted literals without rewriting materials',()=>{
 const text='😀合成原文\n收入 USD 0.1 million，增长 5%。',m={id:'material-fixed',revision:2,title:'合成',body:text},e=[{id:'e1',material:m}],before=JSON.stringify(e),p=packetQuantities(e);
 assert.equal(p.items.length,2);for(const q of p.items){assert.equal(m[q.field].slice(q.start,q.end),q.raw);assert.equal(q.materialRevision,2);assert.equal(q.evidenceId,'e1');}assert.equal(JSON.stringify(e),before);
 const many=packetQuantities([{id:'e2',material:{...m,body:Array(100).fill('USD 1 million').join('\n')}}]);assert.equal(many.total,100);assert.equal(many.items.length,80);assert.equal(many.omitted,20);assert.equal(packetQuantities([{id:'headline',claim:'USD 1 million'}]).total,0);
});
test('actual research packets bind quantities to source versions and reject pre-index candidates without rewriting history',async()=>{
 const {openStore}=await import('../server/store.mjs'),{openResearch}=await import('../server/research.mjs'),{digest,codexPrompt}=await import('../server/codex-research.mjs');
 const store=openStore(':memory:'),r=openResearch(store,{seed:false,clock:()=> '2026-10-04T00:00:00Z'});
 try{let t=r.create({title:'合成金额核验',summary:'仅用于测试'});const material={title:'合成公告',sourceName:'合成来源',url:'https://example.test/amounts',scope:'excerpt',body:'Proposed order USD 1.25 billion, not revenue; margin 10%.',stance:'unverified',family:'other',step:'fact',interpretation:'订单不等于收入'};
 t=r.saveMaterial(t.id,{version:t.version,...material});const history=JSON.stringify(r.history(t.id)),p=r.packet(t.id),frozen=JSON.stringify(p),items=p.input.quantityEvidence.items;
 assert.equal(items[0].normalizedValue,'1250000000');assert.equal(items[1].unit,'percent');assert.equal(items[0].evidenceId,t.evidence[0].id);assert.equal(items[0].materialId,t.evidence[0].materialId);assert.match(codexPrompt(p),/订单当收入/);assert.equal(p.inputHash,digest(p.input));
 const oldInput=structuredClone(p.input);delete oldInput.quantityEvidence;assert.throws(()=>r.adoptModelDraft(t.id,{version:t.version},{status:'candidate',trace:{topicId:t.id,topicVersion:t.version,inputHash:digest(oldInput)}}),/不匹配/);assert.equal(JSON.stringify(r.history(t.id)),history);
 r.saveMaterial(t.id,{version:t.version,...material,body:'Revised proposed order USD 2 billion, not revenue; margin 10%.'});const next=r.packet(t.id);assert.notEqual(next.inputHash,p.inputHash);assert.equal(JSON.stringify(p),frozen);assert(next.input.quantityEvidence.items.some(q=>q.materialRevision===1&&q.normalizedValue==='1250000000'));assert(next.input.quantityEvidence.items.some(q=>q.materialRevision===2&&q.normalizedValue==='2000000000'));
 }finally{store.close();}
});

test('sentence punctuation is preserved without accepting broken decimal or thousands tokens',()=>{
 for(const text of ['Amount USD 1.25 billion, not revenue.','Amount:USD 1.25 billion.','Amount,USD 1.25 billion;'])assert.equal(sourceQuantities(text)[0].normalizedValue,'1250000000');
 for(const text of ['12,34 USD','USD 12,34','USD 10.20.30','aUSD 100'])assert.equal(sourceQuantities(text).length,0);
});

test('fractional literals and signed percentage ranges do not inflate or invent point amounts',()=>{
 for(const [text,value] of [['.50 percent','0.5'],['USD .25 million','250000'],['-.50%','-0.5']])assert.equal(sourceQuantities(text)[0].normalizedValue,value);
 for(const text of ['10%-20%','10%–20%','USD 10–USD 20','（USD 100）','( USD 100 )'])assert(sourceQuantities(text).every(q=>q.normalizedValue===null),text);
});

test('HTML non-breaking and other horizontal spaces retain monetary multipliers and exact source offsets',async()=>{
 const {quantityInUnit}=await import('../shared/source-quantities.mjs');
 for(const space of ['\u00a0','\u202f','\u2009','\u3000','\t']){
  for(const [literal,value,unit] of [[`RMB${space}12.5${space}billion`,'12500000000','CNY'],[`3.2${space}亿${space}美元`,'320000000','USD'],[`12.5${space}percent`,'12.5','percent']]){
   const text=`😀公告：${literal}，仅测试。`,qs=sourceQuantities(text);assert.equal(qs.length,1);assert.equal(qs[0].normalizedValue,value,literal);assert.equal(qs[0].unit,unit);assert.equal(qs[0].raw,literal);assert.equal(text.slice(qs[0].start,qs[0].end),literal);
  }
  assert.deepEqual(quantityInUnit(12.5,`billion${space}CNY`),{unit:'CNY',normalizedValue:'12500000000'});
 }
});
test('Unicode spacing does not bypass ranges, signs, unsupported abbreviations or broken digit groups',()=>{
 for(const space of ['\u00a0','\u202f','\u2009',' ']){
  for(const text of [`USD10${space}billion${space}–${space}USD20${space}billion`,`10${space}%${space}–${space}20${space}%`,`(${space}USD100${space})`,`-${space}USD100`,`USD10${space}HKD`]){const qs=sourceQuantities(text);assert(qs.length,text);assert(qs.every(q=>q.normalizedValue===null),text);}
  for(const text of [`USD10${space}bn`,`USD12${space}345`,`12${space}345${space}USD`])assert.deepEqual(sourceQuantities(text),[],text);
 }
 for(const text of ['USD 12\nmillion','USD\n12 million','12\nUSD','USD 12\r\nHKD'])assert.deepEqual(sourceQuantities(text),[],text);
});
test('HTML entity extraction and packet indexing agree without normalizing the stored article text',async()=>{
 const {extractArticle}=await import('../server/source-reader.mjs');
 const html='<html><head><title>Synthetic financial disclosure</title></head><body><article><h1>Synthetic financial disclosure</h1><p>'+('This fictional source is only a parser test. '.repeat(8))+'Annual costs RMB12.5&nbsp;billion; quarterly costs USD&#8239;25&#8239;million. End.</p></article></body></html>';
 const article=extractArticle(html,'https://example.test/disclosure'),before=article.body,packet=packetQuantities([{id:'e',material:{id:'m',revision:1,...article}}]);
 assert.equal(packet.version,'source-quantity-literals/2');assert.equal(packet.items.length,2);assert.deepEqual(packet.items.map(q=>q.normalizedValue),['12500000000','25000000']);assert.equal(article.body,before);assert(article.body.includes('\u00a0'));assert(article.body.includes('\u202f'));
});
