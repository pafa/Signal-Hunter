import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {openNewsIntake,newsQueries} from '../server/news-intake.mjs';
import {officialQueries,sourcePageUrl,parseOfficialPage,newsWindow} from '../server/news-sources.mjs';
import {hash} from '../server/providers.mjs';
import {time} from '../src/major/api.js';
import {safeErrorText} from '../shared/safe-errors.mjs';
import {newsIntakeErrors} from '../shared/news-sources.mjs';
const at='2026-10-02T12:00:00.000Z';
const query=id=>officialQueries({newsFedEnabled:true,newsHkmaEnabled:true,newsCsrcEnabled:true},at).find(q=>q.id===id);
const record=(id=1,title='Synthetic release')=>({title,link:`https://www.hkma.gov.hk/eng/news-and-media/press-releases/2026/10/fixture-${id}/`,date:'2026-10-01'});
const hk=records=>JSON.stringify({header:{success:true},result:{datasize:records.length,records}});
const page=(start,n=100)=>hk(Array.from({length:n},(_,i)=>record(start+i)));
const rss=(link='https://www.federalreserve.gov/newsevents/pressreleases/fixture.htm',date='Thu, 01 Oct 2026 14:00:00 GMT')=>`<rss><channel><item><title>Synthetic monetary decision</title><link>${link}</link><pubDate>${date}</pubDate></item></channel></rss>`;
async function fixture(run){const s=openStore(':memory:'),intake=openNewsIntake(s,{clock:()=>at});try{await run(s,intake);}finally{s.close();}}
const call=async(handler,method,url,data={})=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:x=>status=x,end:x=>result=JSON.parse(x)});return {status,result};};

test('official adapters preserve identity, explicit dates and independent provenance',()=>{
 const f=parseOfficialPage(query('fed'),rss()).items[0];assert.equal(f.publishedAt,'2026-10-01T14:00:00.000Z');assert.equal(f.datePrecision,'instant');
 const h=parseOfficialPage(query('hkma'),hk([record()])).items[0];assert.equal(h.publishedAt,'2026-10-01');assert.equal(h.datePrecision,'day');assert.equal(time(h.publishedAt),'2026-10-01（仅日期）');
 const value={data:{channelId:'a1a078ee0bc54721ab6b148884c784a8',page:1,total:1,results:[{title:'合成官方要闻',url:'//www.csrc.gov.cn/csrc/c100028/fixture/content.shtml',publishedTimeStr:'2026-10-01 15:12:33'}]}};
 const c=parseOfficialPage(query('csrc'),JSON.stringify(value)).items[0];assert.equal(c.publishedAt,'2026-10-01');assert.equal(c.sourcePublishedAt,'2026-10-01 15:12:33');assert.equal(c.datePrecision,'day');assert.equal(c.publisher,'中国证监会');
 assert.equal(new Set([f.id,h.id,c.id]).size,3);assert.equal(new Set([f.originKey,h.originKey,c.originKey]).size,3);
 assert.equal(parseOfficialPage(query('hkma'),hk([record(1,'Corrected title')])).items[0].id,h.id);
});

test('adapters reject wrong schemas, entities, unsafe URLs and missing timezone without fabricating time',()=>{
 for(const body of ['<html/>','<!DOCTYPE rss><rss><channel/></rss>'])assert.throws(()=>parseOfficialPage(query('fed'),body));
 assert.equal(parseOfficialPage(query('fed'),rss('https://attacker.example/a')).items.length,0);
 assert.equal(parseOfficialPage(query('fed'),rss(undefined,'2026-10-01 14:00:00')).items.length,0);
 assert.throws(()=>parseOfficialPage(query('hkma'),'{}'));
 const r=parseOfficialPage(query('hkma'),hk([record(),{...record(2),date:'2026-02-30'}, {...record(3),link:''},{...record(4),link:'http://www.hkma.gov.hk/a'},null]));
 assert.equal(r.items.length,1);assert.equal(r.rejectedCount,4);assert.equal(r.rejections.length,4);
 const wrong={data:{channelId:'wrong',page:1,total:0,results:[]}};assert.throws(()=>parseOfficialPage(query('csrc'),JSON.stringify(wrong)));
});

test('fixed URLs and bounded date windows cannot turn backfill into arbitrary network access',()=>{
 for(const patch of [{sourceId:'fed'},{from:'2026-02-30'},{from:'2026-08-01'},{to:'2026-10-03'},{from:'2026-10-02',to:'2026-10-01'},{url:'https://example.org'}])assert.throws(()=>newsWindow({sourceId:'hkma',from:'2026-09-25',to:'2026-10-02',...patch},at));
 const window=newsWindow({sourceId:'hkma',from:'2026-09-02',to:'2026-10-02'},at);assert.equal(window.from,'2026-09-02');
 const url=new URL(sourcePageUrl({...query('hkma'),url:'http://127.0.0.1/secret'},2));assert.equal(url.hostname,'api.hkma.gov.hk');assert.equal(url.searchParams.get('offset'),'100');assert.equal(url.searchParams.get('choose'),'date');assert.throws(()=>sourcePageUrl(query('hkma'),4));
});

test('window exclusions, duplicates and malformed entries stay distinguishable in receipts',()=>{
 const r=parseOfficialPage(query('hkma'),hk([record(),record(),{...record(2),date:'2026-09-01'},{...record(3),date:'not-a-date'}]));
 assert.equal(r.rawCount,4);assert.equal(r.acceptedCount,1);assert.equal(r.duplicates,1);assert.equal(r.outsideWindow,1);assert.equal(r.rejectedCount,1);assert.equal(r.sourceObservedFrom,'2026-09-01');
});

test('paged intake freezes raw responses and exact revision receipts without backdating availability',()=>fixture(async(s,intake)=>{
 const responses=[page(0),hk(Array.from({length:5},(_,i)=>({...record(100+i),date:'2026-09-30'})))];let calls=0;const result=await intake.run(query('hkma'),async()=>new Response(responses[calls++]));
 assert.equal(result.state,'ok');assert.equal(result.coverage,'api-range-exhausted');assert.equal(result.pages,2);assert.equal(result.sourceObservedFrom,'2026-09-30');assert.equal(result.sourceObservedTo,'2026-10-01');assert.equal(result.added,105);assert.equal(s.news()[0].firstSeen,at);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM news_source_responses').get().n,2);assert.equal(intake.detail(result.id).pages.length,2);
 assert.equal(s.db.prepare('SELECT body FROM news_source_responses WHERE hash=?').get(hash(responses[0])).body,responses[0]);
 const later='2026-10-02T13:00:00.000Z',next=openNewsIntake(s,{clock:()=>later}),updated=await next.run(query('hkma'),async()=>new Response(hk([record(0,'Correction')])));
 assert.equal(updated.updated,1);const n=s.newsById(parseOfficialPage(query('hkma'),hk([record(0)])).items[0].id);assert.equal(n.firstSeen,at);assert.equal(n.revisionFirstSeen,later);assert.equal(n.revision,2);assert.equal(n.publishedAt,'2026-10-01');
}));

test('a later failed page preserves earlier news and marks the source incomplete',()=>fixture(async(s,intake)=>{
 let calls=0;const r=await intake.run(query('hkma'),async()=>++calls===1?new Response(page(0)):new Response('unavailable',{status:503}));
 assert.equal(r.state,'partial');assert.equal(r.pages,1);assert.equal(r.added,100);assert.equal(s.news().length,100);assert.equal(r.coverage,'incomplete');assert.equal(intake.detail(r.id).pages[1].payload.state,'partial');
}));

test('repeated and overlapping pages never certify exhaustion, and page budgets are explicit',()=>fixture(async(s,intake)=>{
 const repeated=await intake.run(query('hkma'),async()=>new Response(page(0)));assert.equal(repeated.state,'partial');assert.equal(repeated.added,100);assert.equal(repeated.pages,1);
 let calls=0;const overlap=await intake.run(query('hkma'),async()=>new Response(++calls===1?page(0):page(99,2)));assert.equal(overlap.state,'partial');assert.equal(overlap.coverage,'unstable-pagination');assert.equal(overlap.duplicates,1);
 calls=0;const capped=await intake.run(query('hkma'),async()=>new Response(page(1000+100*calls++)));assert.equal(calls,3);assert.equal(capped.coverage,'page-budget-reached');assert.equal(capped.possiblyTruncated,true);assert.equal(capped.acceptedCount,300);
}));

test('malformed successful responses are retained for diagnosis and never treated as empty feeds',()=>fixture(async(s,intake)=>{
 const bad='{"unexpected":true}';const r=await intake.run(query('hkma'),async()=>new Response(bad));assert.equal(r.state,'error');assert.equal(r.added,0);assert.equal(s.news().length,0);assert.equal(s.db.prepare('SELECT body FROM news_source_responses').get().body,bad);assert.equal(intake.detail(r.id).pages[0].payload.state,'error');
}));

test('pause during pagination keeps committed pages but cannot ingest the late response',()=>fixture(async(s,intake)=>{
 const controller=new AbortController();let calls=0;
 const context={signal:controller.signal,assertActive(){if(controller.signal.aborted)throw Error('paused');}};
 const r=await intake.run(query('hkma'),async()=>{if(++calls===2)controller.abort();return new Response(page((calls-1)*100));},context);
 assert.equal(r.state,'cancelled');assert.equal(r.added,100);assert.equal(s.news().length,100);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM news_source_responses').get().n,1);
}));

test('page receipt failure rolls back normalized rows and version links while retaining the raw response',()=>fixture(async(s,intake)=>{
 s.db.exec("CREATE TRIGGER page_failure BEFORE UPDATE ON news_intake_pages WHEN json_extract(NEW.payload,'$.state')='committed' BEGIN SELECT RAISE(ABORT,'fixture page fault'); END");
 const r=await intake.run(query('hkma'),async()=>new Response(hk([record()])));assert.equal(r.state,'error');assert.equal(r.pages,0);assert.equal(r.added,0);assert.equal(s.news().length,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM news_intake_observations').get().n,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM news_source_responses').get().n,1);
}));

test('enabled sources collect independently, a 403 does not suppress another host, and old defaults persist',async()=>{
 const s=openStore(':memory:');assert.equal(newsQueries(s.getSettings()).filter(q=>q.enabled).length,1);s.setSettings({newsDiscoveryEnabled:false,newsHkmaEnabled:true,newsFedEnabled:true});let calls=0;
 const service=createService(s,{mode:'research',now:()=>Date.parse(at),fetcher:async url=>{calls++;return new URL(url).hostname==='www.federalreserve.gov'?new Response('denied',{status:403}):new Response(hk([record()]));}});
 try{await service.runOperation('news');assert.equal(calls,2);assert.equal(s.news().length,1);assert.equal(s.checks().news.state,'partial');assert.equal(service.operations().tasks.news.outcome,'partial');assert.equal(service.snapshot().newsIntake.queries.find(q=>q.id==='fed').last.state,'error');assert.throws(()=>s.setSettings({newsFedEnabled:'yes'}));}finally{await service.close();s.close();}
});

test('backfill HTTP validates controls, persists task input, preserves latest news health and returns page receipts',async()=>{
 const s=openStore(':memory:');let now=Date.parse(at),calls=0;const service=createService(s,{mode:'research',now:()=>now,fetcher:async()=>{calls++;return new Response(hk([record()]));}}),handler=createHandler(s,service),input={sourceId:'hkma',from:'2026-09-25',to:'2026-10-02'};
 try{
  assert.equal((await call(handler,'POST','/api/news/backfill',input)).status,400);assert.equal(calls,0);
  s.setSettings({newsHkmaEnabled:true});assert.equal((await call(handler,'POST','/api/news/backfill',{...input,url:'http://localhost'})).status,400);
  s.status('news',{state:'error',attemptedAt:at,error:'Existing latest-lane failure'});
  assert.equal((await call(handler,'POST','/api/news/backfill',input)).status,200);assert.equal(calls,1);assert.equal(s.checks().news.state,'error');assert.equal(s.checks()['news-backfill'].state,'ok');
  assert.deepEqual(service.operations().history[0].input,{kind:'backfill',...input});
  const id=service.snapshot().newsIntake.recent[0].id;const detail=await call(handler,'GET','/api/news/intake/'+id);assert.equal(detail.status,200);assert.equal(detail.result.pages[0].payload.state,'committed');
  assert.equal((await call(handler,'POST','/api/news/backfill',input)).status,400);assert.equal(calls,1);
  now+=61000;service.controlOperation('news','pause');assert.equal((await call(handler,'POST','/api/news/backfill',input)).status,400);assert.equal(calls,1);
 }finally{await service.close();s.close();}
});

test('official subscriptions and raw snapshots survive restart and research preserves day precision',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-news-source-')),path=join(dir,'fixture.sqlite');let s=openStore(path),service=createService(s,{mode:'research',now:()=>Date.parse(at),fetcher:async()=>new Response(hk([record()]))});
 try{s.setSettings({newsDiscoveryEnabled:false,newsHkmaEnabled:true});await service.runOperation('news');const news=s.news()[0],topic=service.research.createFromNews({newsId:news.id,newsRevision:1});assert.equal(topic.evidence[0].datePrecision,'day');assert.equal(topic.evidence[0].availableAt,at);await service.close();s.close();s=openStore(path);service=createService(s,{mode:'research'});assert.equal(s.getSettings().newsHkmaEnabled,true);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM news_source_responses').get().n,1);assert.equal(service.newsIntakeDetail(service.snapshot().newsIntake.recent[0].id).pages.length,1);}finally{await service.close();s.close();rmSync(dir,{recursive:true,force:true});}
});

test('only exact owned intake errors survive public diagnostic projection',()=>{
 for(const message of newsIntakeErrors){assert.equal(safeErrorText(message),message);assert.equal(safeErrorText(message+' /private/token-secret'),'任务失败，请检查来源或运行配置');}
});

test('HTTP error bodies and status receipts are retained without parsing or committing news',()=>fixture(async(s,intake)=>{
 const body='<html>synthetic upstream failure</html>',r=await intake.run(query('hkma'),async()=>new Response(body,{status:502,headers:{'content-type':'text/html','retry-after':'60','date':'Fri, 02 Oct 2026 12:00:00 GMT','set-cookie':'not part of retained metadata'}}));
 assert.equal(r.state,'error');assert.equal(r.coverage,'incomplete');assert.equal(r.ingestCommitted,false);assert.equal(r.pages,0);assert.equal(s.news().length,0);
 const p=intake.detail(r.id).pages[0];assert.equal(p.responseHash,hash(body));assert.equal(p.receivedAt,at);assert.equal(p.payload.httpStatus,502);assert.equal(p.payload.responseHeaders['retry-after'],'60');assert.equal(p.payload.responseHeaders['content-type'],'text/html');assert.equal(p.payload.responseHeaders['set-cookie'],undefined);assert.equal(s.db.prepare('SELECT body FROM news_source_responses WHERE hash=?').get(p.responseHash).body,body);
}));
test('successful-page receipts survive a later HTTP error and both exact response bodies remain',()=>fixture(async(s,intake)=>{
 const good=page(0),bad='synthetic rate limit';let calls=0;const r=await intake.run(query('hkma'),async()=>++calls===1?new Response(good,{headers:{'content-type':'application/json'}}):new Response(bad,{status:429,headers:{'retry-after':'120'}}));
 assert.equal(r.state,'partial');assert.equal(r.acceptedCount,100);assert.equal(r.added,100);assert.equal(s.db.prepare('SELECT count(*) n FROM news_source_responses').get().n,2);
 const receipts=intake.detail(r.id).pages;assert.equal(receipts[0].payload.httpStatus,200);assert.equal(receipts[0].payload.state,'committed');assert.equal(receipts[1].payload.httpStatus,429);assert.equal(receipts[1].payload.state,'partial');assert.equal(receipts[1].responseHash,hash(bad));assert.equal(s.db.prepare('SELECT body FROM news_source_responses WHERE hash=?').get(hash(good)).body,good);
}));
test('oversized HTTP errors fail without storing a truncated body or committing normalized news',()=>fixture(async(s,intake)=>{
 const r=await intake.run(query('hkma'),async()=>new Response('x'.repeat(2_000_001),{status:503}));assert.equal(r.state,'error');assert.equal(r.ingestCommitted,false);assert.equal(s.db.prepare('SELECT count(*) n FROM news_source_responses').get().n,0);assert.equal(intake.detail(r.id).pages[0].responseHash,null);assert.match(r.error,/大小限制/);
}));

test('an empty HTTP error still records status and an exact empty response without pretending to be an empty feed',()=>fixture(async(s,intake)=>{
 const r=await intake.run(query('hkma'),async()=>new Response(null,{status:503}));assert.equal(r.state,'error');assert.equal(r.ingestCommitted,false);const p=intake.detail(r.id).pages[0];assert.equal(p.payload.httpStatus,503);assert.equal(p.responseHash,hash(''));assert.equal(s.db.prepare('SELECT body,bytes FROM news_source_responses WHERE hash=?').get(p.responseHash).body,'');assert.equal(s.db.prepare('SELECT bytes FROM news_source_responses WHERE hash=?').get(p.responseHash).bytes,0);
}));
