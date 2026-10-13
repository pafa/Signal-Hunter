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

test('child financial activity filters and opens the owning research instead of the source root, without changing journal rows',()=>fixture(({db,service})=>{
 const item='financial-parent',other='other-parent',root='source-root',child='financial-child',unrelated='unrelated-child';
 for(const [id,topic] of [[item,root],[other,'other-root']])db.prepare('INSERT INTO research_pipeline_items VALUES(?,?,?,?,?,?,?,?)').run(id,(id===item?'a':'b').repeat(64),1,'rules','completed',topic,null,JSON.stringify({title:topic}));
 for(const [id,parent,topic] of [['financial-job',item,child],['unrelated-job',other,unrelated]])db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(id,parent,topic,'dossier','completed','{}');
 const audit=(action,payload)=>db.prepare('INSERT INTO research_pipeline_audit(item_id,action,at,payload) VALUES(?,?,?,?)').run(item,action,at,JSON.stringify(payload));
 audit('holdings-financial-started',{symbol:'NVDA.US',topicId:child,attempt:1});audit('holdings-financial-updated',{symbol:'NVDA.US',jobId:'financial-job'});audit('holdings-financial-failed',{symbol:'NVDA.US',topicId:child,attempt:1,retry:true,reason:'Synthetic timeout'});
 audit('preparing',{});audit('holdings-financial-started',{topicId:unrelated,jobId:'unrelated-job'});
 const raw=db.prepare('SELECT * FROM activity_journal').all(),changes=db.prepare('SELECT total_changes() n').get().n;
 const events=service.activity({topic:child}).items;assert.equal(events.length,3);assert(events.every(e=>e.topicId===child&&e.newsId==='a'.repeat(64)));
 assert.equal(service.activity({topic:root}).items.length,2);assert.equal(service.activity({topic:unrelated}).items.length,0);
 const issues=service.activity({topic:child,issues:'1'}).items;assert.deepEqual(issues.map(x=>x.action),['holdings-financial-failed']);assert.match(activityText(issues[0]),/NVDA.US.*后台等待重试.*本轮第 1 次.*Synthetic timeout/);
 assert.deepEqual(db.prepare('SELECT * FROM activity_journal').all(),raw);assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);
}));

test('active automatic model provenance is projected separately from manual runs and includes retry ownership',()=>fixture(({db,service})=>{
 const job='financial-job';db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(job,'source-item','financial-child','dossier','queued',JSON.stringify({automatic:true}));
 for(const run of ['automatic-financial','manual-research'])db.prepare('INSERT INTO model_research_runs VALUES(?,?,?,?,?,?)').run(run,'financial-child','running',at,now()+60000,JSON.stringify({createdAt:at,model:'synthetic'}));
 db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run(job,'automatic-financial',at);
 const processing=service.activity({}).processing;assert.equal(processing.find(x=>x.id==='automatic-financial').automatic,true);assert.equal(processing.find(x=>x.id==='manual-research').automatic,false);
}));

test('financial monitoring activity uses readable outcomes without creating an approval request',()=>{
 for(const [action,expected] of [['holdings-financial-started','开始检查持仓财报'],['holdings-financial-unchanged','财报未变化，继续跟踪'],['holdings-financial-updated','新财报已保存，等待更新研判'],['holdings-financial-failed','本轮财报检查未完成，稍后继续']]){
  const text=activityText({kind:'pipeline',lane:'discovery',action,detail:{symbol:'NVDA.US',attempt:3,retry:false}});assert.ok(text.includes(expected));assert.match(text,/NVDA.US/);assert.doesNotMatch(text,/holdings-financial|本人|审批/);
 }
});
