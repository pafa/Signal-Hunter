import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {materialComparisonSnapshot} from '../server/semantic-materials.mjs';
import {financialFilingMaterial} from '../server/financial-filing-material.mjs';
import {filingAt,filingDocuments,syntheticFilingHtml} from './helpers/financial-filing-fixture.mjs';

const accession='0001045810-26-000075';
function fixture(path=':memory:'){
 const store=openStore(path),db=store.db,materials=openMaterials(db,{clock:()=>filingAt});
 const save=(html=syntheticFilingHtml)=>{const docs=filingDocuments(html),m=financialFilingMaterial('NVDA.US',docs,accession),prepared=materials.prepare('synthetic-cache-test',{...m,filingDocuments:docs},'public-filing');prepared.persist();return prepared.material;};
 return {store,db,materials,save,material:save()};
}

test('material readers return isolated nested values and never accept a cached wrong revision',()=>{
 const f=fixture();try{
  const original=immutableMaterialSnapshot(f.db,f.material),returned=f.materials.get(f.material.id);
  returned.body='caller edit';returned.filingSource.sources[0].sha256='0'.repeat(64);returned.filingSource.selection.ranges.length=0;
  assert.deepEqual(immutableMaterialSnapshot(f.db,f.material),original);
  assert.throws(()=>immutableMaterialSnapshot(f.db,{id:f.material.id,revision:f.material.revision+1}),/校验/);
  assert.deepEqual(f.materials.detail({evidence:[{materialId:f.material.id,materialRevision:f.material.revision}]},f.material.id),original);
 }finally{f.store.close();}
});

test('warm material validation detects source corruption, missing originals and derived edits',()=>{
 const f=fixture();try{
  const original=immutableMaterialSnapshot(f.db,f.material),sha=original.filingSource.sources[2].sha256,raw=f.db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(sha).body;
  const read=()=>immutableMaterialSnapshot(f.db,f.material);
  f.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('corrupt raw'),sha);assert.throws(read,/原始响应校验失败/);
  f.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(raw,sha);assert.deepEqual(read(),original);
  f.db.prepare('DELETE FROM research_source_documents WHERE sha256=?').run(sha);assert.throws(read,/原始响应校验失败/);
  f.db.prepare('INSERT INTO research_source_documents VALUES(?,?)').run(sha,raw);assert.deepEqual(read(),original);
  const payload=f.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(f.material.id).payload;
  f.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify({...original,body:original.body+'\nchanged derived text'}),f.material.id);assert.throws(read,/校验/);
  f.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(payload,f.material.id);assert.deepEqual(read(),original);
 }finally{f.store.close();}
});

test('peer commits and another database cannot borrow a successful material validation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'material-read-cache-')),path=join(dir,'db.sqlite'),f=fixture(path),other=fixture();let peer;
 try{
  assert.deepEqual(immutableMaterialSnapshot(f.db,f.material),f.material);peer=new DatabaseSync(path);
  const sha=f.material.filingSource.sources[2].sha256;peer.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('peer corruption'),sha);
  assert.throws(()=>immutableMaterialSnapshot(f.db,f.material),/原始响应校验失败/);
  assert.deepEqual(immutableMaterialSnapshot(other.db,other.material),other.material);
  peer.prepare('DELETE FROM research_materials WHERE id=?').run(f.material.id);assert.throws(()=>f.materials.get(f.material.id),/不存在/);
 }finally{peer?.close();f.store.close();other.store.close();rmSync(dir,{recursive:true,force:true});}
});

test('transaction validation neither hides uncommitted corruption nor publishes rolled-back materials',()=>{
 const f=fixture();try{
  immutableMaterialSnapshot(f.db,f.material);const sha=f.material.filingSource.sources[2].sha256;
  f.db.exec('BEGIN');f.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('uncommitted corruption'),sha);
  assert.throws(()=>immutableMaterialSnapshot(f.db,f.material),/原始响应校验失败/);f.db.exec('ROLLBACK');assert.deepEqual(immutableMaterialSnapshot(f.db,f.material),f.material);
  f.db.exec('BEGIN');const transient=f.save(syntheticFilingHtml.replace('USD 200','USD 201'));assert.equal(immutableMaterialSnapshot(f.db,transient).revision,2);f.db.exec('ROLLBACK');
  assert.throws(()=>immutableMaterialSnapshot(f.db,transient),/不存在/);assert.deepEqual(materialComparisonSnapshot(f.db,f.material).body,f.material.body);
 }finally{if(f.db.isTransaction)f.db.exec('ROLLBACK');f.store.close();}
});

test('historical material cache cannot bypass current-revision comparison after an append',()=>{
 const f=fixture();try{
  materialComparisonSnapshot(f.db,f.material);const next=f.save(syntheticFilingHtml.replace('USD 200','USD 202'));
  assert.equal(next.documentId,f.material.documentId);assert.equal(next.revision,2);
  assert.deepEqual(immutableMaterialSnapshot(f.db,f.material),f.material);
  assert.throws(()=>materialComparisonSnapshot(f.db,f.material));
  assert.equal(materialComparisonSnapshot(f.db,f.material,{historical:true}).body,f.material.body);
  assert.equal(materialComparisonSnapshot(f.db,next).body,next.body);
 }finally{f.store.close();}
});
