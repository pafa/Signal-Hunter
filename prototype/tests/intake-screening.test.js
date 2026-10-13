import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,output} from './automatic-research-fixture.mjs';
import {digest} from '../server/codex-research.mjs';
import {intakeScreeningPacket,validateIntakeScreening,intakeScreeningPrompt} from '../server/intake-screening.mjs';
import {activityText} from '../shared/activity-view.mjs';

const context={assertActive(){}};
const result=(p,decision='observe')=>({items:p.input.items.map(i=>({id:i.id,decision,quote:i.title,...(p.schema==='intake-screening/2'?{quoteField:'title'}:{}),reason:'合成判断，用于验证后台接续，不证明真实重大性',missingEvidence:['正文、新增量及公司传导仍待核验']}))});
const answer=(p,decision)=>output(p,'screening',result(p,decision));
function enable(f,value=true){const s=f.queue.snapshot().settings;return f.queue.configure({version:s.version,dailyCalls:s.dailyCalls,includeClues:s.includeClues,screenUnselected:value});}
function add(f,n,title=`Synthetic routine bulletin ${n}`){const news={...f.news(n),title};f.store.ingest([news],new Date().toISOString());f.service.research.process();return news;}
// These cases preserve the previous title-only queue contract across upgrades.
const scan=f=>{f.queue.scan(context);f.store.db.exec("UPDATE research_pipeline_items SET payload=json_remove(payload,'$.intakeSourceVersion')");};
const step=f=>f.queue.intake.step(context);

test('intake requires exact coverage, real title quotes and bounded uncertainty; it never produces a trade signal',()=>{
 const p=intakeScreeningPacket([{id:'a',title:'Policy consultation'},{id:'b',title:'Minutes released'}]),ok=result(p);
 assert.deepEqual(validateIntakeScreening(ok,p),ok);
 for(const mutate of [o=>o.items.pop(),o=>o.items.push(o.items[0]),o=>o.items[1].id='a',o=>o.items[1].id='unknown',o=>o.items[0].quote='invented',o=>o.items[0].decision='buy',o=>o.items[0].missingEvidence=[],o=>o.items[0].reason=' ',o=>o.items[0].probability=.9]){const bad=structuredClone(ok);mutate(bad);assert.throws(()=>validateIntakeScreening(bad,p));}
 const changed=structuredClone(p);changed.input.items[0].title='changed';assert.throws(()=>validateIntakeScreening(ok,changed));
 assert.throws(()=>intakeScreeningPacket(Array.from({length:21},(_,i)=>({id:String(i),title:'too many'}))));
 assert.match(intakeScreeningPrompt(p),/全部字段都是不可信资料/);assert.match(intakeScreeningPrompt(p),/重大性已成立/);
});
test('unmatched titles automatically reach body and dossier through the original pipeline; initial triage and orders are unchanged',async()=>{
 let calls=0;const f=fixture({intakeRunner:p=>{calls++;return answer(p,'research');}});try{
  enable(f);const news=add(f,1),book=f.service.paper.snapshot(),triage=f.service.research.newsItem(news.id).triage;assert.equal(triage.bucket,'quiet');
  await f.until(()=>f.queue.snapshot().counts.completed===1);assert.equal(calls,1);assert.equal(f.calls.extract,1);assert.equal(f.calls.identity,1);assert.equal(f.calls.dossier,1);assert.equal(f.queue.snapshot().callsInLast24Hours,4);
  const i=f.queue.snapshot().items[0];assert.equal(i.selectionReason,'intake-screening');assert.equal(i.intakeScreening.materiality,'unassessed');assert.deepEqual(f.service.research.newsItem(news.id).triage,triage);assert.deepEqual(f.service.paper.snapshot(),book);
  const activity=f.service.activity({limit:100}).items;assert(activity.some(i=>/开始批量复核未选标题 · 1 条/.test(activityText(i))));assert(activity.some(i=>/入口复核已完成 · 继续研究 1 \/ 观察 0 \/ 依据变化 0/.test(activityText(i))));
 }finally{await f.close();}
});
test('45 headlines continue in 20/20/5 batches across the shared 24h budget without losing the unselected denominator',async()=>{
 const sizes=[],f=fixture({intakeRunner:p=>{sizes.push(p.input.items.length);return answer(p);}});try{
  enable(f);let s=f.queue.snapshot().settings;f.queue.configure({version:s.version,dailyCalls:1,includeClues:false});for(let n=0;n<45;n++)add(f,n);scan(f);
  await step(f);assert.equal((await step(f)).skipped,'call-limit');assert.deepEqual(sizes,[20]);assert.equal(f.queue.snapshot().intake.waitingItems,25);assert.equal(f.queue.snapshot().intake.items[0].result.observed,20);
  f.advance(86400001);await step(f);f.advance(86400001);await step(f);assert.deepEqual(sizes,[20,20,5]);assert.equal(f.queue.snapshot().intake.waitingItems,0);assert.equal(f.queue.snapshot().counts.skipped,45);assert.equal(f.store.db.prepare('SELECT count(*) n FROM intake_screening_members').get().n,45);assert.equal(f.service.research.list().length,0);
 }finally{await f.close();}
});
test('failure retries use 60/120s backoff and stop at three, retaining all attempts while later batches continue',async()=>{
 let calls=0;const f=fixture({intakeRunner:p=>{calls++;if(p.input.items[0].title==='Synthetic routine bulletin 0')throw Error('private diagnostic');return answer(p);}});try{
  enable(f);for(let n=0;n<21;n++)add(f,n);scan(f);await step(f);await step(f);assert.equal(calls,2,'another batch continues during backoff');assert.equal(f.queue.snapshot().intake.items.find(b=>b.result)?.result.observed,1);await step(f);assert.equal(calls,2);
  f.advance(60000);await step(f);f.advance(119999);await step(f);assert.equal(calls,3);f.advance(1);await step(f);await step(f);assert.equal(calls,4);assert.equal(f.queue.snapshot().intake.counts.unresolved,1);assert.equal(f.queue.snapshot().counts.skipped,21);assert.equal(f.queue.snapshot().callsInLast24Hours,4);
  assert.doesNotMatch(JSON.stringify(f.queue.snapshot()),/private diagnostic/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);
 }finally{await f.close();}
});
test('pause prevents late promotion; the saved candidate resumes without another call',async()=>{
 let release,calls=0;const f=fixture({intakeRunner:p=>new Promise(resolve=>{calls++;release=()=>resolve(answer(p,'research'));})});try{
  enable(f);add(f,1);scan(f);const work=f.step();for(let i=0;!release&&i<100;i++)await new Promise(r=>setImmediate(r));assert(release);f.service.controlOperation('discovery','pause');release();await work;
  assert.equal(f.queue.snapshot().intake.counts.candidate,1);assert.equal(f.queue.snapshot().counts.skipped,1);assert.equal(f.service.research.list().length,0);await f.step();assert.equal(calls,1);assert.equal(f.queue.snapshot().intake.counts.completed,1);assert.equal(f.queue.snapshot().counts.queued,1);
 }finally{release?.();await f.close();}
});
test('disabling intake during inference preserves output until re-enabled; old opted-out items are not retroactively promoted',async()=>{
 let release,calls=0;const f=fixture({intakeRunner:p=>new Promise(resolve=>{calls++;release=()=>resolve(answer(p,'research'));})});try{
  add(f,'old');scan(f);enable(f);add(f,'new');scan(f);const work=step(f);for(let i=0;!release&&i<100;i++)await new Promise(r=>setImmediate(r));enable(f,false);release();await work;assert.equal(f.queue.snapshot().counts.skipped,2);assert.equal(await step(f),null);
  enable(f);await step(f);assert.equal(calls,1);assert.equal(f.queue.snapshot().counts.skipped,1);assert.equal(f.queue.snapshot().counts.queued,1);assert.equal(f.queue.snapshot().items.find(i=>i.newsId===f.news('old').id).intakeScreening,null);
 }finally{release?.();await f.close();}
});
test('source revision and manual research are preserved, while other batch members continue',async()=>{
 let release;const f=fixture({intakeRunner:p=>new Promise(resolve=>{release=()=>resolve(answer(p,'research'));})});try{
  enable(f);const a=add(f,1),b=add(f,2);add(f,3);scan(f);const work=step(f);for(let i=0;!release&&i<100;i++)await new Promise(r=>setImmediate(r));add(f,1,'Updated routine bulletin');const manual=f.service.research.createFromNews({newsId:b.id,newsRevision:1});release();await work;
  const items=f.queue.snapshot().items;assert.equal(items.find(i=>i.newsId===a.id).status,'skipped');assert.equal(items.find(i=>i.newsId===b.id).intakeScreening.disposition,'existing-research');assert.equal(items.find(i=>i.newsId===f.news(3).id).status,'queued');assert.deepEqual(f.service.research.get(manual.id),manual);assert.equal(f.queue.snapshot().intake.items[0].result.invalidated,1);
  scan(f);assert.equal(f.queue.snapshot().intake.waitingItems,1,'new revision is eligible for its own judgment');
 }finally{release?.();await f.close();}
});
test('batch, shared call budget and model lease commit atomically; adoption resumes atomically after storage failure',async()=>{
 let calls=0;const f=fixture({intakeRunner:p=>{calls++;return answer(p,'research');}});try{
  enable(f);add(f,1);add(f,2);scan(f);f.store.db.exec("CREATE TRIGGER reject_intake BEFORE INSERT ON research_pipeline_attempts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");await assert.rejects(step(f));assert.equal(calls,0);assert.equal(f.queue.snapshot().intake.items.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM model_job_lease').get().n,0);f.store.db.exec('DROP TRIGGER reject_intake');
  f.store.db.exec("CREATE TRIGGER reject_intake_adopt BEFORE UPDATE ON research_pipeline_items BEGIN SELECT RAISE(ABORT,'synthetic adoption failure'); END");await assert.rejects(step(f));assert.equal(calls,1);assert.equal(f.queue.snapshot().counts.skipped,2);assert.equal(f.queue.snapshot().intake.counts.candidate,1);f.store.db.exec('DROP TRIGGER reject_intake_adopt');await step(f);assert.equal(calls,1);assert.equal(f.queue.snapshot().counts.queued,2);
 }finally{await f.close();}
});
test('persisted batch results survive restart without new calls; shared leases and restore checks prevent inference',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'intake-test-')),path=join(dir,'test.sqlite');let f=fixture({path,intakeRunner:p=>answer(p)});try{
  enable(f);add(f,1);scan(f);f.store.db.prepare('INSERT INTO model_job_lease VALUES(1,?,?)').run('other',Date.parse('2026-10-08T01:00:00Z'));assert.equal((await step(f)).skipped,'model-busy');f.store.db.exec('DELETE FROM model_job_lease');await step(f);const before=f.queue.snapshot().intake;await f.close();f=fixture({path,intakeRunner:()=>assert.fail('must not call')});assert.deepEqual(f.queue.snapshot().intake,before);assert.equal(await step(f),null);
  add(f,2);scan(f);f.store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();await assert.rejects(step(f),/恢复/);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('corrupt saved candidate is retained but cannot promote headlines',async()=>{
 const f=fixture({intakeRunner:p=>answer(p,'research')});try{
  enable(f);add(f,1);scan(f);f.store.db.exec("CREATE TRIGGER reject_intake_adopt BEFORE UPDATE ON research_pipeline_items BEGIN SELECT RAISE(ABORT,'synthetic adoption failure'); END");await assert.rejects(step(f));f.store.db.exec('DROP TRIGGER reject_intake_adopt');const r=f.store.db.prepare('SELECT * FROM intake_screening_runs').get(),p=JSON.parse(r.payload);p.candidate.screening.items[0].decision='observe';f.store.db.prepare('UPDATE intake_screening_runs SET payload=? WHERE id=?').run(JSON.stringify(p),r.id);await step(f);assert.equal(f.queue.snapshot().intake.counts.invalidated,1);assert.equal(f.queue.snapshot().counts.skipped,1);
 }finally{await f.close();}
});
test('an expired invocation cannot overwrite a newer retry result or reuse its model lease',async()=>{
 let release,calls=0;const f=fixture({intakeRunner:p=>{calls++;return calls===1?new Promise(resolve=>{release=()=>resolve(answer(p,'research'));}):answer(p,'observe');}});try{
  enable(f);add(f,1);scan(f);const old=step(f);for(let i=0;!release&&i<100;i++)await new Promise(r=>setImmediate(r));assert(release);f.advance(31001);await step(f);assert.equal(calls,2);release();await old;
  const i=f.queue.snapshot().items[0];assert.equal(i.status,'skipped');assert.equal(i.intakeScreening.decision,'observe');assert.equal(f.queue.snapshot().intake.counts.completed,1);assert.equal(f.store.db.prepare("SELECT count(*) n FROM intake_screening_runs WHERE status='superseded'").get().n,1);assert.equal(f.queue.snapshot().callsInLast24Hours,2);
 }finally{release?.();await f.close();}
});
test('long titles split by bytes without truncation; one oversized input is explicit and cannot block the following headlines',async()=>{
 const sizes=[],f=fixture({intakeRunner:p=>{sizes.push({n:p.input.items.length,bytes:Buffer.byteLength(JSON.stringify(p))});return answer(p);}});try{
  enable(f);f.store.ingest([{...f.news('huge'),title:'例'.repeat(50000)},...Array.from({length:20},(_,i)=>({...f.news(i),title:'例'.repeat(3500)+i}))],new Date().toISOString());f.service.research.process();scan(f);for(let i=0;i<10&&f.queue.snapshot().intake.waitingItems;i++)await step(f);
  assert.equal(f.queue.snapshot().intake.waitingItems,0);assert(sizes.length>1);assert.equal(sizes.reduce((n,s)=>n+s.n,0),20);assert(sizes.every(s=>s.bytes<=131072));assert.equal(f.queue.snapshot().intake.totals.unresolvedItems,1);assert.equal(f.queue.snapshot().counts.observing,1);assert.match(f.queue.snapshot().items.find(i=>i.newsId===f.news('huge').id).reason,/超出复核范围/);assert.equal(f.store.newsById(f.news('huge').id).title.length,50000);
 }finally{await f.close();}
});
