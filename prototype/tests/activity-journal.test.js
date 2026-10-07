import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {openActivityJournal} from '../server/activity-journal.mjs';
import {createPersistentScheduler} from '../server/persistent-scheduler.mjs';
import {mergeActivity,groupActivity,activityText} from '../shared/activity-view.mjs';
const at='2026-10-07T00:00:00Z',now=()=>Date.parse(at);
async function fixture(fn){const store=openStore(':memory:'),service=createService(store,{mode:'research',now,instance:{id:'test-instance'}});try{await fn({store,service,db:store.db});}finally{await service.close();store.close();}}
const insert=(db,i)=>db.prepare("INSERT INTO operation_runs(name,token,started_at,completed_at,outcome,summary) VALUES('news',?,?,?,'skipped',?)").run('synthetic-'+i,at,at,JSON.stringify({skipReasons:[{reason:'cooldown',count:1}]}));
test('journal backfills once, pages stable IDs forward/backward and rolls back with the source transaction',()=>fixture(({db,service})=>{
 for(let i=0;i<8;i++)insert(db,i);const a=service.activity({limit:'3'});assert.deepEqual(a.items.map(r=>r.id),[6,7,8]);assert.equal(a.hasMore,true);
 const old=service.activity({before:String(a.olderCursor),limit:'3'});assert.deepEqual(old.items.map(r=>r.id),[3,4,5]);
 insert(db,8);insert(db,9);insert(db,10);const b=service.activity({after:String(a.cursor),limit:'2'});assert.deepEqual(b.items.map(r=>r.id),[9,10]);assert.equal(b.cursor,10);assert.equal(b.hasMore,true);const c=service.activity({after:String(b.cursor),limit:'2'});assert.deepEqual(c.items.map(r=>r.id),[11]);
 const count=db.prepare('SELECT count(*) n FROM activity_journal').get().n;db.exec('BEGIN');insert(db,11);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) n FROM activity_journal').get().n,count);
 openActivityJournal(db,{now});assert.equal(db.prepare('SELECT count(*) n FROM activity_journal').get().n,count);
 for(const input of [{limit:'0'},{limit:'201'},{after:'x'},{after:'1',before:'1'},{topic:[]},{issues:'yes'},{sql:'DROP'}])assert.throws(()=>service.activity(input));
}));
test('migration preserves prior sources and history persists through reopening, without pretending to recover unrecorded transitions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'signal-journal-')),path=join(root,'test.sqlite');let store=openStore(path),service=createService(store,{mode:'research',now});
 try{insert(store.db,1);await service.close();store.close();store=openStore(path);service=createService(store,{mode:'research',now});assert.equal(service.activity({}).items.length,1);assert.equal(store.db.prepare('SELECT count(*) n FROM operation_runs').get().n,1);}finally{await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
test('pipeline audit and model status resolve one news/research chain, while an expired raw running row is never current work',()=>fixture(({db,service})=>{
 const topic='synthetic-topic',news='a'.repeat(64),item='b'.repeat(64),run='synthetic-run';db.prepare('INSERT INTO research_pipeline_items VALUES(?,?,?,?,?,?,?,?)').run(item,news,1,'rules','running',topic,run,JSON.stringify({title:'Fixture',createdAt:at}));
 db.prepare('INSERT INTO research_pipeline_audit(item_id,action,at,payload) VALUES(?,?,?,?)').run(item,'preparing',at,'{}');
 db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run(run,topic,'running',at,now()+1000,JSON.stringify({model:'fixture',createdAt:at}));
 let events=service.activity({topic}).items;assert(events.some(r=>r.kind==='pipeline'&&r.topicId===topic&&r.newsId===news));assert.equal(service.activity({}).processing.length,1);
 db.prepare("UPDATE model_research_runs SET status='candidate',payload=? WHERE id=?").run(JSON.stringify({model:'fixture',finishedAt:at}),run);assert.equal(service.activity({}).processing.length,0);assert.equal(service.workbenchQueue({kind:'model'}).total,1);assert.equal(service.workbenchQueue({kind:'pipeline'}).total,0);
 db.prepare("UPDATE model_research_runs SET status='running',expires_at=? WHERE id=?").run(now()-1,run);assert.equal(service.activity({}).processing.length,0);assert.equal(service.workbenchQueue({kind:'pipeline'}).items[0].status,'interrupted');
}));
test('GET journal and queue never tick tasks or mutate business data and keep host and instance guards',()=>fixture(async({db,store,service})=>{
 insert(db,1);const before=db.prepare('SELECT total_changes() n').get().n;const handler=createHandler(store,service);async function read(url,headers={}){let status,body;await handler({method:'GET',url,headers:{host:'127.0.0.1:4179',...headers}},{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});return {status,body};}
 assert.equal((await read('/api/activity')).status,200);assert.equal((await read('/api/workbench-queue')).status,200);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 assert.equal((await read('/api/activity',{'x-signal-instance':'other'})).status,409);assert.equal((await read('/api/activity',{origin:'https://evil.invalid'})).status,403);
 db.prepare("INSERT OR REPLACE INTO settings VALUES('restore_review_required','1')").run();assert.equal((await read('/api/activity')).status,200);const n=db.prepare('SELECT count(*) n FROM activity_journal').get().n;insert(db,2);assert.equal(db.prepare('SELECT count(*) n FROM activity_journal').get().n,n);
}));
test('merge deduplicates reconnect output and groups only matching no-op facts, preserving failures and human decisions',()=>{
 const a={id:1,kind:'operation',lane:'news',action:'skipped',at,detail:{skipReasons:[{reason:'cooldown',count:1}]}},b={...a,id:2},c={...a,id:3,action:'error',detail:{error:'来源失败'}};
 assert.deepEqual(mergeActivity([b,a],[b,c]).map(r=>r.id),[1,2,3]);const groups=groupActivity([a,b,c]);assert.equal(groups.length,2);assert.equal(groups[0].count,2);assert.match(activityText(a),/等待采集冷却结束/);assert.match(activityText(c),/来源失败/);
});
test('opt-in idle backoff is bounded, leaves acquisition lanes unchanged and manual retry immediately claims work',()=>fixture(async({db})=>{
 let clock=now();const scheduler=createPersistentScheduler(db,{fixtureIdle:()=>({skipped:'no-queued-items'}),fixtureQuote:()=>({skipped:'cooldown'})},{now:()=>clock,intervals:{fixtureIdle:10000,fixtureQuote:10000},idleBackoff:['fixtureIdle']});
 try{await scheduler.run('fixtureIdle');assert.equal(Date.parse(scheduler.snapshot().fixtureIdle.nextRunAt)-clock,30000);clock+=30000;await scheduler.run('fixtureIdle');assert.equal(Date.parse(scheduler.snapshot().fixtureIdle.nextRunAt)-clock,60000);await scheduler.run('fixtureQuote');assert.equal(Date.parse(scheduler.snapshot().fixtureQuote.nextRunAt)-clock,10000);await scheduler.run('fixtureIdle',{force:true});assert.equal(scheduler.history()[0].name,'fixtureIdle');}finally{await scheduler.stop();}
}));
