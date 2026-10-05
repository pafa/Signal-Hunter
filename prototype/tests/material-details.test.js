import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
const input={title:'Synthetic announcement',sourceName:'Synthetic fixture',url:'https://example.invalid/material',publishedAt:'2026-10-01',scope:'excerpt',body:'Original text. '.repeat(5000),stance:'unverified',family:'corporate',step:'fact',interpretation:'Synthetic evidence only'};
function setup(){const store=openStore(':memory:'),service=createService(store,{mode:'research',clock:()=> '2026-10-04T00:00:00Z'}),research=service.research,topic=research.create({title:'Material inspection',summary:'Synthetic test'});return {store,service,research,topic};}
test('summary preserves every immutable revision and evidence metadata, detail and packet retain full original text',()=>{
 const {store,research:r,topic:t}=setup();try{
  r.saveMaterial(t.id,{...input,version:1});r.saveMaterial(t.id,{...input,body:'Revised text',version:2});
  const full=r.materialList(t.id),summary=r.materialList(t.id,{view:'summary'}),packet=r.packet(t.id);
  assert.equal(summary.materials.length,2);for(let i=0;i<2;i++){const {body,publicationDateEvidence,extractionEvidence,...meta}=full.materials[i];assert.deepEqual(summary.materials[i],meta);assert.equal(r.materialDetail(t.id,meta.id).body,body);assert.equal(packet.input.evidence[i].material.body,body);}
  assert(JSON.stringify(summary).length<JSON.stringify(full).length/10);assert.equal(r.history(t.id).find(v=>v.version===2).topic.evidence.length,1);
  const other=r.create({title:'Other topic',summary:'No linked material'});assert.throws(()=>r.materialDetail(other.id,full.materials[0].id),/未关联/);assert.throws(()=>r.materialDetail(t.id,'f'.repeat(64)),/未关联/);assert.throws(()=>r.materialList(t.id,{view:'invalid'}),/视图/);
  const first=full.materials[0];store.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify({...first,body:'tampered'}),first.id);assert.throws(()=>r.materialDetail(t.id,first.id),/校验失败/);
 }finally{store.close();}
});
test('HTTP summary is explicit and validated, exact linked detail is read-only and full list stays compatible',async()=>{
 const {store,service,research:r,topic:t}=setup(),handler=createHandler(store,service);
 const call=async path=>{let status,body;await handler({method:'GET',url:path,headers:{host:'127.0.0.1:4179'}},{writeHead:n=>status=n,end:b=>body=JSON.parse(b)});return {status,body};};
 try{
  r.saveMaterial(t.id,{...input,version:1});const before=r.get(t.id),book=service.paper.snapshot(),base=`/api/research/${t.id}/materials`;
  const full=await call(base),summary=await call(base+'?view=summary');assert.equal(full.status,200);assert.equal(summary.status,200);assert.equal(full.body.materials[0].body,input.body.trim());assert(!Object.hasOwn(summary.body.materials[0],'body'));
  const id=summary.body.materials[0].id,detail=await call(base+'/'+id);assert.equal(detail.status,200);assert.equal(detail.body.body,input.body.trim());
  for(const query of ['?view=bad','?view=summary&view=full','?offset=1'])assert.equal((await call(base+query)).status,400);
  const other=r.create({title:'Unlinked',summary:'Synthetic topic'});assert.equal((await call(`/api/research/${other.id}/materials/${id}`)).status,400);
  assert.deepEqual(r.get(t.id),before);assert.deepEqual(service.paper.snapshot(),book);
 }finally{store.close();}
});
