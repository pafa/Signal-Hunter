import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {evidenceCoverage} from '../server/triage.mjs';
import {researchDelta} from '../shared/claims.mjs';
const at='2026-10-04T00:00:00Z';
const item=id=>({id,title:'Synthetic '+id,publisher:'Synthetic',url:'https://example.test/'+encodeURIComponent(id),publishedAt:at});
const evidence=(id,version=1)=>({id:`e:${id}:${version}`,newsId:id,newsRevision:version,claim:'Synthetic evidence',verification:'unverified',stance:'context',family:'other',step:'fact',firstSeen:'2000-01-01T00:00:00Z'});
function fixture(){const store=openStore(':memory:'),research=openResearch(store,{seed:false,clock:()=>at});return {store,research};}
function saveFixture(store,base,id,versions){
 for(const version of versions){const t={...base,id,version};store.db.prepare('INSERT INTO research_versions VALUES(?,?,?,?,?)').run(id,version,JSON.stringify(t),at,'Synthetic history');}
 store.db.prepare('INSERT INTO research_topics VALUES(?,?)').run(id,JSON.stringify({...base,id,version:versions.at(-1)}));
}
const hydrated=(store,t)=>({...t,evidence:t.evidence.map(e=>e.newsId?{...e,availableAt:store.revisionAvailableAt(e.newsId,e.newsRevision),availabilityBasis:'新闻修订实际接收时间；历史原字段保留'}:e)});
function legacyList(store){return store.db.prepare('SELECT payload FROM research_topics').all().map(r=>{const t=hydrated(store,JSON.parse(r.payload)),prior=store.db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version<? ORDER BY version DESC LIMIT 1').get(t.id,t.version);return {...t,coverage:evidenceCoverage(t),changeSummary:researchDelta(t,prior?JSON.parse(prior.payload):null)};}).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||(a.type==='cluster'?0:1)-(b.type==='cluster'?0:1)||a.id.localeCompare(b.id));}

test('batched research reads preserve historical availability, missing sources, type affinity, ordering and sparse previous versions',()=>{
 const {store,research}=fixture();try{
  const id="quoted:'中文",base=research.create({title:'Synthetic',summary:'Test'});store.ingest([item(id)],at);store.ingest([{...item(id),title:'Synthetic revised'}],'2026-10-04T01:00:00Z');
  const ev=[evidence(id),evidence(id,2),evidence(id,'01'),evidence('missing'),{...evidence('manual'),newsId:undefined,availableAt:'manual-original'}];
  saveFixture(store,{...base,evidence:ev,type:'event'},'older',[1,3,5]);saveFixture(store,{...base,evidence:ev,type:'cluster'},'newer',[1]);
  const before=store.db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all(),expected=legacyList(store);
  assert.deepEqual(research.list(),expected);
  const history=research.history('older');assert.deepEqual(history.map(x=>x.version),[5,3,1]);
  for(const row of history){assert.deepEqual(row.topic,hydrated(store,JSON.parse(before.find(x=>x.topic_id==='older'&&x.version===row.version).payload)));assert.equal(row.topic.evidence[2].availableAt,at);assert.equal(row.topic.evidence[3].availableAt,null);}
  assert.deepEqual(store.db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all(),before);
 }finally{store.close();}
});
test('large unique source sets are chunked and repeated history references do not multiply database reads',()=>{
 const {store,research}=fixture();try{
  const base=research.create({title:'Synthetic scale',summary:'Test'}),items=Array.from({length:620},(_,i)=>item('n-'+i));store.ingest(items,at);
  for(let i=0;i<5;i++)saveFixture(store,{...base,evidence:items.slice(i*124,(i+1)*124).map(x=>evidence(x.id))},'topic-'+i,[1,2,3,4,5]);
  const expected=legacyList(store),prepare=store.db.prepare.bind(store.db);let calls=0;store.db.prepare=sql=>{calls++;return prepare(sql);};
  assert.deepEqual(research.list(),expected);assert(calls<=4,`list issued ${calls} statements for 620 references`);
  calls=0;const history=research.history('topic-1');assert.equal(history.length,5);assert(calls<=4,`history issued ${calls} statements`);assert(history.every(h=>h.topic.evidence.every(e=>e.availableAt===at)));
 }finally{store.close();}
});
test('availability is reread after source recovery and appended research versions are immediately visible',()=>{
 const {store,research}=fixture();try{
  const base=research.create({title:'Synthetic',summary:'Test'});saveFixture(store,{...base,evidence:[evidence('later')]},'history',[1,2]);
  assert.equal(research.list().find(t=>t.id==='history').evidence[0].availableAt,null);assert.equal(research.history('history')[0].topic.evidence[0].availableAt,null);
  store.ingest([item('later')],at);assert.equal(research.list().find(t=>t.id==='history').evidence[0].availableAt,at);assert.equal(research.history('history')[0].topic.evidence[0].availableAt,at);
  research.update('history',{version:2,nextEvidence:'New next step'});const latest=research.list().find(t=>t.id==='history');assert.equal(latest.version,3);assert.equal(latest.nextEvidence,'New next step');assert.equal(research.history('history').length,3);
  assert.deepEqual(research.list(),legacyList(store));
 }finally{store.close();}
});
