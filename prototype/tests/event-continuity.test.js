import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openContinuity,describeNews,compareReports,originFamily,researchPriority} from '../server/event-continuity.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {hash} from '../server/providers.mjs';
const at='2026-10-01T10:00:00.000Z';
const news=(id,title,extra={})=>({id:hash(id),title,url:`https://example.invalid/${id}`,publisher:'Reuters',publishedAt:at,revisionFirstSeen:at,revision:1,...extra});
const initial=news('proposal','Intel reportedly plans acquisition of ComputeWorks server business');
const denial=news('denial','Intel denies acquisition of ComputeWorks server business');
const topic={id:'cpu-research',version:1,title:'Intel ComputeWorks server business acquisition',status:'active',companies:[{symbol:'INTC.US'}],evidence:[]};
const setup=()=>{const store=openStore(':memory:');return {store,c:openContinuity(store,{clock:()=>at})};};

test('recalls a rumor and denial together without promoting either to a fact or buy signal',()=>{
 const a=describeNews(denial),b=describeNews(initial),match=compareReports(a,b);
 assert.equal(b.messageStatus,'rumor');assert.equal(a.messageStatus,'denial-reported');assert.equal(match.kind,'counterevidence');assert.match(match.reasons.join(' '),/阶段表述对照/);
 assert.equal(a.materiality.factProbability,null);assert.equal(a.materiality.tradeSignal,false);
});
test('matching avoids company-only, unrelated acquisitions and price-only co-movement',()=>{
 assert.equal(compareReports(describeNews(initial),describeNews(news('other','Intel acquisition of NewFab factory'))),null);
 assert.equal(compareReports(describeNews(news('price','Intel shares rise today')),describeNews(news('price2','AMD shares rise today'))),null);
 assert.equal(compareReports(describeNews(initial),describeNews({...initial,id:hash('old'),publishedAt:'2025-10-01T10:00:00Z'})),null);
});
test('unknown companies can be recalled from specific shared terms rather than the maintained directory',()=>{
 const a=describeNews(news('unknown1','Solstice Robotics completed acquisition of Boreal Systems automation platform'));
 const b=describeNews(news('unknown2','Solstice Robotics denies acquisition of Boreal Systems automation platform'));
 assert.equal(a.symbols.length,0);assert.equal(compareReports(b,a).kind,'counterevidence');
});
test('same-source reposting is not independent confirmation and reported attribution is distinguished',()=>{
 assert.equal(originFamily(initial).key,originFamily({...initial,publisher:'路透社'}).key);
 const attributed=originFamily({...initial,title:'Intel acquisition of ComputeWorks server business, Bloomberg reports'});
 assert.equal(attributed.key,'bloomberg');assert.equal(attributed.independence,'unverified');
 assert.equal(originFamily({...initial,publisher:''}).key,'unknown');
});
test('risk-linked headlines move ahead of normal research; repetition never increases priority',()=>{
 const record=describeNews(denial),base=researchPriority(record,{positions:[{symbol:'INTC.US'}]});
 assert.equal(base.level,'urgent');assert.equal(base.tradeSignal,false);assert.equal(base.materiality,'unassessed');
 assert.equal(researchPriority(record,{positions:[{symbol:'AMD.US',topicId:topic.id}],relatedTopicIds:[topic.id]}).level,'urgent');
 assert.equal(researchPriority(record,{repeat:true}).level,researchPriority(record).level);
});
test('suggestions preserve input revisions, distinguish history from research, and survive repeat ingestion',()=>{
 const {store,c}=setup();try{
 store.ingest([initial,denial],at);c.process([topic]);const before=c.snapshot({state:'all'});assert.equal(before.items.length,3);assert.equal(before.items.filter(c=>c.type==='news').length,1);
 const pair=before.items.find(i=>i.type==='news');assert.equal(pair.kind,'counterevidence');const detail=c.detail(pair.id);assert.equal(detail.independentSourceCount,null);assert.equal(detail.revisions.length,2);
 store.ingest([initial,denial],'2026-10-01T11:00:00Z');c.process([topic]);assert.deepEqual(c.snapshot({state:'all'}).items.map(i=>i.id),before.items.map(i=>i.id));
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM event_descriptors').get().n,2);
 }finally{store.close();}
});
test('link, exclude and undo append audited decisions; stale writers and invalid input are rejected',()=>{
 const {store,c}=setup();try{
 store.ingest([initial,denial],at);c.process([]);const id=c.snapshot().items[0].id;
 c.decide(id,{state:'linked',version:0,note:'Same proposed acquisition response'});assert.equal(c.snapshot().counts.linked,1);
 assert.throws(()=>c.decide(id,{state:'dismissed',version:0,note:'Stale'}),/已变化/);
 c.decide(id,{state:'pending',version:1,note:'Reopen for review'});c.decide(id,{state:'dismissed',version:2,note:'Different underlying transaction'});
 assert.equal(c.detail(id).history.length,3);assert.equal(c.snapshot({state:'dismissed'}).items.length,1);
 assert.throws(()=>c.decide(id,{state:'linked',version:3,note:''}),/依据/);
 assert.throws(()=>c.decide(id,{state:'linked',version:3,note:'a',automaticTrade:true}),/依据/);
 }finally{store.close();}
});
test('new headline revisions invalidate old candidate actions and preserve old decisions',()=>{
 const {store,c}=setup();try{
 store.ingest([initial,denial],at);c.process([]);const old=c.snapshot().items[0];c.decide(old.id,{state:'linked',version:0,note:'Initial assessment'});
 store.ingest([{...denial,title:'Intel terminates acquisition of ComputeWorks server business'}],'2026-10-01T11:00:00Z');c.process([]);
 assert.equal(c.detail(old.id).current,false);assert.equal(c.detail(old.id).history[0].state,'linked');assert.throws(()=>c.decide(old.id,{state:'pending',version:1,note:'Outdated'}),/新版本/);
 const fresh=c.snapshot().items[0];assert.equal(fresh.state,'pending');assert.notEqual(fresh.id,old.id);assert.equal(c.detail(fresh.id).revisions.length,3);assert.equal(c.detail(fresh.id).previousDecisions[0].history[0].note,'Initial assessment');
 }finally{store.close();}
});
test('research changes and archived topics remain discoverable without overwriting evidence',()=>{
 const {store,c}=setup();try{
 store.ingest([initial],at);c.process([topic]);const id=c.snapshot().items[0].id;
 const changed={...topic,status:'archived',version:2};c.process([changed]);assert.equal(c.detail(id).current,false);assert.equal(c.snapshot().items[0].right.status,'archived');assert.deepEqual(changed.evidence,[]);
 }finally{store.close();}
});
test('decisions and descriptors persist after reopening an isolated database',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-events-'));let store=openStore(join(dir,'test.sqlite'));try{
 let c=openContinuity(store);store.ingest([initial,denial],at);c.process([]);const id=c.snapshot().items[0].id;c.decide(id,{state:'dismissed',version:0,note:'review fixture'});store.close();store=openStore(join(dir,'test.sqlite'));c=openContinuity(store);c.process([]);
 assert.equal(c.detail(id).state,'dismissed');assert.equal(c.detail(id).history.length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('pagination, search and bounded coverage are explicit and bad parameters fail',()=>{
 const {store,c}=setup();try{
 store.ingest([initial,denial],at);c.process([topic]);const page=c.snapshot({limit:1});assert.equal(page.total,3);assert.equal(page.items.length,1);assert.equal(page.coverage.newsIndexed,2);assert.equal(page.coverage.newsMatchesPerNews,5);
 assert.equal(c.snapshot({q:'ComputeWorks'}).total,3);assert.equal(c.snapshot({offset:999}).items.length,0);
 for(const params of [{offset:-1},{limit:101},{state:'confirmed'},{q:'x'.repeat(121)}])assert.throws(()=>c.snapshot(params),/参数/);
 }finally{store.close();}
});
test('HTTP decision changes only link organization; history, evidence, watches and paper account remain intact',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'demo'}),handler=createHandler(store,service);
 const call=async(method,url,data)=>{let status,result;await handler({headers:{host:'127.0.0.1:4179','content-type':'application/json'},method,url,async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>{status=v;},end:body=>{result=JSON.parse(body);}});return {status,result};};
 try{
 store.ingest([initial,denial],at);const paper=JSON.stringify(service.paper.snapshot()),research=JSON.stringify(service.research.list()),watches=JSON.stringify(store.watchlist());
 service.processEvents();const list=await call('GET','/api/events');assert.equal(list.status,200);const candidate=list.result.items.find(c=>c.type==='news');
 assert.equal((await call('POST',`/api/events/${candidate.id}`,{state:'linked',version:0,note:'Synthetic review'})).status,200);
 assert.equal((await call('GET',`/api/events/${candidate.id}`)).result.state,'linked');
 assert.equal((await call('GET',`/api/news/${initial.id}`)).result.triage.messageStatus,'rumor');
 assert.equal(JSON.stringify(service.paper.snapshot()),paper);assert.equal(JSON.stringify(service.research.list()),research);assert.equal(JSON.stringify(store.watchlist()),watches);
 assert.equal((await call('GET','/api/events?limit=bad')).status,400);
 }finally{await service.close();store.close();}
});

// Synthetic regressions for boilerplate overlap observed during a read-only RSS probe.
test('generic legislative and clinical phrasing does not merge distinct events',()=>{
 const pairs=[
  ['Senate blocks bill to address electricity costs','Senate blocks bill to limit stock trading by lawmakers'],
  ['Northstar drug combination improves weight loss in trial','Boreal weight loss drug cuts muscle loss with hormone therapy trial'],
  ['Oil prices rise as refinery imports increase','Oil prices rise on peace talks and exports'],
 ];
 for(const [a,b] of pairs)assert.equal(compareReports(describeNews(news('generic1',a)),describeNews(news('generic2',b))),null);
});

test('different companies with matching industry terms are analogies rather than one event',()=>{
 const a=describeNews(news('a','Intel server processor platform launch accelerates adoption'));
 const b=describeNews(news('b','AMD server processor platform launch accelerates adoption'));
 assert.equal(compareReports(a,b).kind,'analogy');
});

test('same-batch arrivals use publication ordering and pair priority keeps an earlier adverse holding alert',()=>{
 const {store,c}=setup();try{
 store.ingest([{...denial,publishedAt:'2026-10-01T08:00:00Z'},{...initial,publishedAt:'2026-10-01T09:00:00Z'}],at);c.process([]);const row=c.snapshot({positions:[{symbol:'INTC.US'}]}).items[0];
 assert.equal(row.left.id,initial.id);assert.equal(row.priority.level,'urgent');assert.match(row.priority.reasons[0],/配对报道/);
 }finally{store.close();}
});

test('an indexing failure preserves prior candidates and does not stop other maintenance lanes',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'demo'});try{
 store.ingest([initial,denial],at);service.processEvents();const before=service.eventContinuity().total;
 store.db.exec("CREATE TRIGGER fail_event_index BEFORE INSERT ON event_descriptors BEGIN SELECT RAISE(ABORT,'index fixture failure'); END");
 store.ingest([news('later','Intel acquisition of ComputeWorks server business completed')],at);await service.tick();
 assert.equal(service.eventContinuity().total,before);assert.equal(service.eventContinuity().health.state,'error');assert.match(service.eventContinuity().health.error,/fixture/);
 assert.ok(service.operations().history.length>0);store.db.exec('DROP TRIGGER fail_event_index');await service.tick();assert.equal(service.eventContinuity().health.state,'ok');assert.ok(service.eventContinuity().total>before);
 }finally{await service.close();store.close();}
});
