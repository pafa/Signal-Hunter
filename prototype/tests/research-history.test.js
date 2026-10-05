import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../server/store.mjs';import {openResearch} from '../server/research.mjs';import {createService} from '../server/service.mjs';import {createHandler} from '../server/index.mjs';
const clock=()=> '2026-10-04T00:00:00Z';
function seed(r){let t=r.create({title:'History fixture',summary:'Synthetic revision inspection'});for(let i=2;i<=62;i++)t=i%3===0?r.addEvidence(t.id,{version:t.version,claim:'Evidence '+i,sourceName:'Synthetic',stance:'unverified',family:'other',step:'fact',interpretation:'Fixture only'}):r.update(t.id,{version:t.version,nextEvidence:'Observation '+i});return t;}
test('history pages cover every saved version exactly once, freeze their ceiling and preserve complete details at page boundaries',()=>{
 const s=openStore(':memory:'),r=openResearch(s,{seed:false,clock}),t=seed(r);try{
 const before=r.history(t.id),first=r.historyPage(t.id),seen=[...first.items.map(x=>x.version)];assert.equal(first.total,62);assert.equal(first.items.length,25);assert(!Object.hasOwn(first.items[0],'topic'));assert.equal(first.nextCursor,38);
 r.update(t.id,{version:62,nextEvidence:'A later live revision'});let page=first;while(page.nextCursor){page=r.historyPage(t.id,{before:page.nextCursor,ceiling:first.ceiling});seen.push(...page.items.map(x=>x.version));assert.equal(page.total,62);}
 assert.deepEqual(seen,before.map(x=>x.version));assert.equal(r.historyPage(t.id).total,63);
 for(const version of [62,38,37,13,12,1]){const d=r.historyDetail(t.id,version),old=before.find(x=>x.version===version),prior=before.find(x=>x.version===version-1);assert.deepEqual(d.topic,old.topic);assert.equal(d.previousVersion,version===1?null:version-1);assert.deepEqual(d.addedEvidenceIds,old.topic.evidence.filter(e=>!prior?.topic.evidence.some(p=>p.id===e.id)).map(e=>e.id));}
 assert.equal(r.historyDetail(t.id,38).addedEvidenceIds.length,0);assert.deepEqual(r.history(t.id).slice(1),before);
 }finally{s.close();}
});
test('history rejects bad cursors, missing neighbors and identity corruption instead of inventing new evidence',()=>{
 const s=openStore(':memory:'),r=openResearch(s,{seed:false,clock}),t=seed(r);try{
 for(const p of [{limit:0},{limit:101},{before:0},{before:63},{ceiling:63},{limit:'2.5'},{before:'Infinity'},{ceiling:'9007199254740992'},{offset:1}])assert.throws(()=>r.historyPage(t.id,p),/参数/);
 for(const v of ['01',0,-1,1.5,'1e2',64])assert.throws(()=>r.historyDetail(t.id,v));assert.throws(()=>r.historyPage('missing'));
 s.db.prepare('DELETE FROM research_versions WHERE topic_id=? AND version=37').run(t.id);assert.throws(()=>r.historyDetail(t.id,38),/相邻/);
 const row=s.db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=62').get(t.id),bad={...JSON.parse(row.payload),id:'wrong'};s.db.prepare('UPDATE research_versions SET payload=? WHERE topic_id=? AND version=62').run(JSON.stringify(bad),t.id);assert.throws(()=>r.historyDetail(t.id,62),/不匹配/);
 }finally{s.close();}
});
test('history HTTP validates summary parameters and exact detail while preserving the legacy full route and account',async()=>{
 const s=openStore(':memory:'),service=createService(s,{mode:'research'}),r=service.research,t=seed(r),handler=createHandler(s,service),book=service.paper.snapshot();
 const call=async path=>{let status,body;await handler({method:'GET',url:path,headers:{host:'127.0.0.1:4179'}},{writeHead:n=>status=n,end:b=>body=JSON.parse(b)});return {status,body};};
 try{const base=`/api/research/${t.id}/history`,full=await call(base);assert.equal(full.body.length,62);const page=await call(base+'?view=summary&limit=25');assert.equal(page.status,200);assert.equal(page.body.items.length,25);const d=await call(base+'/38');assert.equal(d.status,200);assert.equal(d.body.topic.version,38);assert.equal(d.body.addedEvidenceIds.length,0);
 for(const suffix of ['?view=summary&view=summary','?view=full','?view=summary&limit=2&limit=3','?view=summary&offset=1','/62?view=summary','/0','/missing'])assert.equal((await call(base+suffix)).status,400);
 assert.deepEqual(r.history(t.id),full.body);assert.deepEqual(service.paper.snapshot(),book);
 }finally{s.close();}
});
test('paged and detailed history survive reopening without altering stored source versions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-history-')),path=join(dir,'test.sqlite');let s=openStore(path);try{let r=openResearch(s,{seed:false,clock});const t=seed(r),page=r.historyPage(t.id,{before:38,ceiling:62}),detail=r.historyDetail(t.id,37),rows=s.db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all();s.close();s=openStore(path);r=openResearch(s,{seed:false,clock});assert.deepEqual(r.historyPage(t.id,{before:38,ceiling:62}),page);assert.deepEqual(r.historyDetail(t.id,37),detail);assert.deepEqual(s.db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all(),rows);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
