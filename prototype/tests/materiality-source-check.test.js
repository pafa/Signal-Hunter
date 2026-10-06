import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {quantityInUnit} from '../shared/source-quantities.mjs';
import {materialityInputs} from '../shared/company-materiality.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
const at='2026-10-04T00:00:00Z';
const material={title:'虚构年报金额',sourceName:'合成诊断',url:'https://example.test/quantity-source',scope:'excerpt',body:'Revenue USD 100 million. Proposed order USD 120 million, not revenue. Budget $30 million. Target margin 10%–20%.',stance:'unverified',family:'other',step:'fact',interpretation:'合成材料，数值命中不证明指标语义'};
const datum=(value,ids,kind='source')=>({value,kind,evidenceIds:ids});
const row=(ids,patch={})=>({id:'revenue',label:'营业收入',scope:'虚构主体',period:'全年',unit:'百万USD',basis:'合成测试口径',comparable:true,baseline:datum(100,ids),observed:datum(120,ids),affected:datum(30,ids),expected:datum(110,ids),...patch});
function fixture(file=':memory:'){
 const store=openStore(file),r=openResearch(store,{seed:false,clock:()=>at});let t=r.create({title:'虚构数值核对',summary:'不涉及真实公司'});t=r.saveMaterial(t.id,{version:t.version,...material});
 return {store,r,t,ids:t.evidence.map(e=>e.id)};
}
const save=(r,t,rows,replace=false)=>r.addCompany(t.id,{version:t.version,symbol:'BA.US',note:'虚构关系',materiality:rows,replace});
test('explicit shared units normalize exactly while ambiguous and unsupported units stay unknown',()=>{
 for(const unit of ['million USD','USD million','百万USD','美元百万','百万美元'])assert.deepEqual(quantityInUnit(.1,unit),{unit:'USD',normalizedValue:'100000'});
 assert.deepEqual(quantityInUnit(10,'%'),{unit:'percent',normalizedValue:'10'});
 assert.deepEqual(quantityInUnit(-2.75,'HKD million'),{unit:'HKD',normalizedValue:'-2750000'});
 for(const unit of ['$ million','万元','万元/股','million USD per year','million EUR','million USD and HKD','USD 100'])assert.equal(quantityInUnit(1,unit),null,unit);
 assert.equal(quantityInUnit(1e-8,'USD'),null);assert.equal(quantityInUnit(Infinity,'USD'),null);
});
test('actual company saves check frozen materials, retain nonmatches and never claim financial semantics',()=>{
 const {store,r,t,ids}=fixture();try{
  const next=save(r,t,[row(ids)]),v=next.companies[0].materiality.rows[0];
  assert.equal(v.baseline.sourceCheck.status,'literal-match');assert.equal(v.observed.sourceCheck.status,'literal-match');assert.equal(v.observed.sourceCheck.semanticVerified,false);assert.match(v.observed.sourceCheck.references[0].matches[0].context,/not revenue/);
  assert.equal(v.expected.sourceCheck.status,'not-found');assert.equal(v.affected.sourceCheck.status,'not-found');assert.equal(v.result.relativeChange,20);
  const m=r.packet(next.id).input.evidence[0].material,q=v.baseline.sourceCheck.references[0].matches[0];
  assert.equal(m[q.field].slice(q.start,q.end),q.raw);assert.equal(v.baseline.sourceCheck.references[0].contentHash,m.contentHash);assert.equal(v.baseline.sourceCheck.references[0].materialRevision,1);
  assert.deepEqual(r.packet(next.id).input.companies[0].materiality,next.companies[0].materiality);
 }finally{store.close();}
});
test('currency mismatches, ranges, unavailable evidence and mixed references have distinct outcomes',()=>{
 const fixtureState=fixture(),{store,r,ids}=fixtureState;let t=fixtureState.t;try{
  t=r.addEvidence(t.id,{version:t.version,claim:'Manual comment USD 100 million',sourceName:'manual',stance:'unverified',family:'other',step:'fact',interpretation:'Synthetic manual comment, not a saved material'});const manual=t.evidence.find(e=>!e.materialId).id;
  t=save(r,t,[row(ids,{id:'hkd',unit:'million HKD'}),row(ids,{id:'percent',unit:'%',baseline:datum(10,ids)}),row([manual],{id:'manual'}),row([...ids,manual],{id:'mixed'}),row(ids,{id:'unknown',unit:'万台'}),row(ids,{id:'assumption',baseline:datum(100,ids,'assumption')})]);
  const rows=t.companies[0].materiality.rows;
  assert.equal(rows[0].baseline.sourceCheck.status,'not-found');assert.equal(rows[1].baseline.sourceCheck.status,'not-found');assert.equal(rows[2].baseline.sourceCheck.status,'material-unavailable');assert.equal(rows[3].baseline.sourceCheck.status,'partial-match');assert.equal(rows[4].baseline.sourceCheck.status,'unsupported-unit-or-number');assert.equal(rows[5].baseline.sourceCheck.status,'assumption');
 }finally{store.close();}
});
test('matching scans beyond packet inventory and bounds stored quotes without losing match counts',()=>{
 const {store,r,t,ids}=fixture();try{
  const next=r.saveMaterial(t.id,{version:t.version,...material,body:Array(100).fill('USD 2 million').join('; ')+ '; USD 100 million. USD 100 million. USD 100 million. USD 100 million.'}),newId=next.evidence.find(e=>e.materialRevision===2).id;
  const saved=save(r,next,[row([newId])]),check=saved.companies[0].materiality.rows[0].baseline.sourceCheck;
  assert.equal(check.status,'literal-match');assert.equal(check.references[0].totalMatches,4);assert.equal(check.references[0].matches.length,3);assert(r.packet(saved.id).input.quantityEvidence.omitted>0);
 }finally{store.close();}
});
test('new source revisions and restart do not rewrite old checks; editing strips frozen check fields',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-source-check-'));let {store,r,t,ids}=fixture(join(dir,'test.sqlite'));
 try{
  t=save(r,t,[row(ids)]);const old=JSON.stringify(t.companies[0].materiality),oldVersion=t.version;
  t=r.saveMaterial(t.id,{version:t.version,...material,body:'Revised revenue USD 90 million, proposed order cancelled.'});assert.equal(JSON.stringify(t.companies[0].materiality),old);
  t=r.addCompany(t.id,{version:t.version,symbol:'BA.US',note:'Only relationship changed',replace:true});assert.equal(JSON.stringify(t.companies[0].materiality),old);
  const input=materialityInputs(t.companies[0].materiality);assert.equal(input[0].baseline.sourceCheck,undefined);
  const currentId=t.evidence.find(e=>e.materialRevision===2).id;t=save(r,t,[row([currentId])],true);assert.equal(t.companies[0].materiality.rows[0].baseline.sourceCheck.status,'not-found');assert.equal(JSON.stringify(r.history(t.id).find(v=>v.version===oldVersion).topic.companies[0].materiality),old);
  store.close();store=openStore(join(dir,'test.sqlite'));r=openResearch(store,{seed:false,clock:()=>at});assert.equal(r.get(t.id).companies[0].materiality.rows[0].baseline.sourceCheck.status,'not-found');assert.equal(JSON.stringify(r.history(t.id).find(v=>v.version===oldVersion).topic.companies[0].materiality),old);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('client cannot forge checks and corrupt snapshots do not receive literal matches',()=>{
 const {store,r,t,ids}=fixture();try{
  assert.throws(()=>save(r,t,[row(ids,{baseline:{...datum(100,ids),sourceCheck:{status:'literal-match'}}})]),/字段无效/);
  const record=store.db.prepare('SELECT id,payload FROM research_materials').get(),m=JSON.parse(record.payload);m.body='Forged USD 100 million';store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify(m),record.id);
  const saved=save(r,t,[row(ids)]);assert.equal(saved.companies[0].materiality.rows[0].baseline.sourceCheck.status,'material-unavailable');
 }finally{store.close();}
});
test('failed company commit preserves old source checks and version',()=>{
 const {store,r,t,ids}=fixture();try{
  const saved=save(r,t,[row(ids)]),before=JSON.stringify(r.get(t.id));store.db.exec("CREATE TRIGGER fail_source_check BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'synthetic commit failure'); END");
  assert.throws(()=>save(r,saved,[row(ids,{baseline:datum(101,ids)})],true),/synthetic commit failure/);assert.equal(JSON.stringify(r.get(t.id)),before);
 }finally{store.close();}
});
