import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {newsQueries,openNewsIntake} from '../server/news-intake.mjs';
import {parseReutersFeedResult,hash} from '../server/providers.mjs';
import {COMPANY_ANALYSIS_FIELDS,normalizeCompanyAnalysis} from '../shared/company-directory.mjs';
import {companyResearch,watchResearchRows} from '../shared/company-view.mjs';
import {normalizeContext} from '../src/integrated/research-context.js';
import {createHandler} from '../server/index.mjs';
import {Readable} from 'node:stream';
const item=(id='a',title='AMD announces a new chip',publisher='Reuters')=>`<item><guid>${id}</guid><title>${title}</title><link>https://news.google.com/rss/articles/${id}</link><pubDate>Thu, 01 Oct 2026 05:00:00 GMT</pubDate><source url="https://www.reuters.com">${publisher}</source></item>`;
const feed=items=>`<rss><channel>${items}</channel></rss>`;

test('tracking keywords cannot narrow discovery and partial settings edits preserve other fields',()=>{
 const s=openStore(':memory:');try{s.setSettings({keywords:'AMD'});const q=newsQueries(s.getSettings());assert.equal(q.length,5);assert(!new URL(q[0].url).searchParams.get('q').includes('AMD'));assert(new URL(q[1].url).searchParams.get('q').includes('AMD'));
 s.setSettings({newsDiscoveryEnabled:false});assert.equal(s.getSettings().keywords,'AMD');assert.equal(s.getSettings().newsDiscoveryEnabled,false);
 assert.throws(()=>s.setSettings({keywords:'changed',newsTrackingEnabled:'false'}));assert.equal(s.getSettings().keywords,'AMD');assert.throws(()=>s.setSettings({privateFlag:true}));
 }finally{s.close();}
});
test('feed receipts distinguish rejected entries, empty success and possible truncation',async()=>{
 const s=openStore(':memory:'),intake=openNewsIntake(s),q=newsQueries(s.getSettings())[0];
 try{const parsed=parseReutersFeedResult(feed(item()+item('b','Other story','Other')));assert.equal(parsed.rawCount,2);assert.equal(parsed.rejectedCount,1);
 const empty=await intake.run(q,async()=>new Response(feed('')));assert.equal(empty.state,'ok');assert.equal(empty.acceptedCount,0);assert.equal(empty.observedFrom,null);
 const full=await intake.run(q,async()=>new Response(feed(Array.from({length:100},(_,i)=>item(String(i))).join(''))));assert.equal(full.possiblyTruncated,true);assert.equal(full.coverage,'observed-only');assert.equal(s.news().length,100);
 }finally{s.close();}
});
test('two intake lanes share article identity and keep exact revision receipts across late correction',async()=>{
 let at='2026-10-01T06:00:00.000Z';const s=openStore(':memory:'),intake=openNewsIntake(s,{clock:()=>at}),q=newsQueries({keywords:'AMD'});
 try{await intake.run(q[0],async()=>new Response(feed(item())));await intake.run(q[1],async()=>new Response(feed(item())));assert.equal(s.news().length,1);assert.equal(s.news()[0].revision,1);assert.equal(s.db.prepare('SELECT count(*) n FROM news_intake_observations').get().n,2);
 at='2026-10-02T06:00:00.000Z';const update=await intake.run(q[1],async()=>new Response(feed(item('a','AMD denies earlier report'))));assert.equal(update.updated,1);assert.equal(update.unobservedSeconds,86400);assert.equal(s.news()[0].firstSeen,'2026-10-01T06:00:00.000Z');assert.equal(s.news()[0].revisionFirstSeen,at);
 assert.deepEqual(s.db.prepare('SELECT revision FROM news_intake_observations ORDER BY rowid').all().map(x=>x.revision),[1,1,2]);
 }finally{s.close();}
});
test('one successful query is preserved when the other fails and disabled lanes make no requests',async()=>{
 const s=openStore(':memory:');s.setSettings({keywords:'AMD'});let calls=0;const service=createService(s,{mode:'research',fetcher:async url=>{calls++;return new URL(url).searchParams.get('q').includes('AMD')?new Response('Denied',{status:403}):new Response(feed(item()));}});
 try{await service.runOperation('news');assert.equal(calls,2);assert.equal(s.news().length,1);assert.equal(s.checks().news.state,'partial');assert.equal(service.operations().tasks.news.outcome,'partial');const coverage=service.snapshot().newsIntake;assert.equal(coverage.queries[0].last.state,'ok');assert.equal(coverage.queries[1].last.state,'error');assert.equal(coverage.queries[1].lastSuccess,null);
 }finally{await service.close();s.close();}
 const disabled=openStore(':memory:');disabled.setSettings({newsDiscoveryEnabled:false,newsTrackingEnabled:false});const offline=createService(disabled,{mode:'research',fetcher:async()=>{throw Error('should not fetch');}});try{await offline.runOperation('news');assert.equal(disabled.checks().news.state,'disabled');assert.equal(offline.operations().tasks.news.outcome,'skipped');}finally{await offline.close();disabled.close();}
});
test('paused intake cannot ingest late data and an observation write failure rolls back the article',async()=>{
 const s=openStore(':memory:'),q=newsQueries(s.getSettings())[0],intake=openNewsIntake(s);let active=true;
 try{const r=await intake.run(q,async()=>{active=false;return new Response(feed(item()));},{assertActive:()=>{if(!active)throw Error('cancelled');}});assert.equal(r.state,'error');assert.equal(s.news().length,0);
 assert.throws(()=>s.ingest([{id:hash('atomic'),title:'Atomic',publishedAt:'2026-10-01T06:00:00Z'}],'2026-10-01T06:00:00Z',()=>{throw Error('receipt write');}));assert.equal(s.news().length,0);
 s.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON news_intake_observations BEGIN SELECT RAISE(ABORT,'test receipt fault'); END");
 const failed=await intake.run(q,async()=>new Response(feed(item())));assert.equal(failed.state,'error');assert.equal(failed.ingestCommitted,false);assert.equal(failed.added,0);assert.equal(s.news().length,0);
 }finally{s.close();}
});
test('company impact is versioned, cannot overwrite stale research and does not approve orders',async()=>{
 const s=openStore(':memory:'),service=createService(s,{mode:'demo'});try{
 const topic=service.research.list().find(t=>t.companies.some(c=>c.symbol==='AMD.US')),company=topic.companies.find(c=>c.symbol==='AMD.US'),book=service.paper.snapshot();
 service.research.addCompany(topic.id,{...company,kind:'supplier',relationStatus:'pending',direction:'unclear',note:'Synthetic study only',replace:true,version:topic.version,analysis:{businessExposure:'Agent workload share is unknown',countercase:'Efficiency may offset demand'}});
 const after=service.research.list().find(t=>t.id===topic.id);assert.equal(after.version,topic.version+1);assert.equal(after.companies.find(c=>c.symbol==='AMD.US').analysis.businessExposure,'Agent workload share is unknown');assert(after.changeSummary.items.some(s=>s.includes('公司关系 / 影响分析')));
 assert.throws(()=>service.research.addCompany(topic.id,{...company,replace:true,version:topic.version}));assert.equal(service.paper.snapshot().orders.length,book.orders.length);
 const old=JSON.parse(s.db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(topic.id,topic.version).payload);assert.equal(old.companies.find(c=>c.symbol==='AMD.US').analysis,undefined);
 for(const v of [null,[],{unknown:'x'},{businessExposure:42},{pricedIn:'x'.repeat(1001)}])assert.throws(()=>normalizeCompanyAnalysis(v));assert.equal(Object.keys(normalizeCompanyAnalysis()).length,Object.keys(COMPANY_ANALYSIS_FIELDS).length);
 }finally{await service.close();s.close();}
});
test('company view separates directly cited evidence, context and same issuer securities',()=>{
 const topics=[{id:'t',title:'Synthetic',version:2,status:'active',updatedAt:'2026-10-01',companies:[{symbol:'09988.HK',name:'Alibaba',evidenceIds:['direct']},{symbol:'BABA.US',name:'ADR'}],evidence:[{id:'direct',stance:'against'},{id:'context',stance:'supports'}],hypothesis:{reviewAt:'2026-10-10'},changeSummary:{items:['New evidence']}}],book={positions:[{symbol:'BABA.US',qty:10}],orders:[{symbol:'09988.HK',status:'pending'}]};
 const d=companyResearch('09988.HK',topics,book);assert.equal(d.research[0].evidence[0].stance,'against');assert.equal(d.research[0].contextEvidence.length,1);assert.equal(d.relatedListings[0].symbol,'BABA.US');assert.equal(d.positions.length,0);assert.equal(d.orders.length,1);
 const row=watchResearchRows([{symbol:'09988.HK'}],topics,book)[0];assert.equal(row.pending,1);assert.equal(row.positionQty,0);assert.equal(row.reviewAt,'2026-10-10');assert.equal(row.latestChange,'New evidence');
});
test('navigation context accepts only bounded view state, not malformed browser storage',()=>{
 assert.equal(normalizeContext(null).view,'grid');assert.equal(normalizeContext({view:'unknown',range:99}).range,3);const c=normalizeContext({view:'table',range:6,picks:['AAPL.US','AAPL.US','<script>',...Array.from({length:10},(_,i)=>`T${i}.US`)]});assert.equal(c.view,'table');assert.equal(c.picks.length,6);assert(!c.picks.includes('<script>'));
});
test('company HTTP endpoint accepts bounded Chinese analysis and paused watching remains editable',async()=>{
 const s=openStore(':memory:'),service=createService(s,{mode:'demo'}),handler=createHandler(s,service);
 const call=async(path,data)=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:'POST',url:path,headers:{host:'127.0.0.1:4179','content-type':'application/json'}});let code,body;await handler(req,{writeHead:c=>code=c,end:x=>body=JSON.parse(x)});return {code,body};};
 try{const t=service.research.list().find(t=>t.companies.some(c=>c.symbol==='AMD.US')),c=t.companies.find(c=>c.symbol==='AMD.US');const response=await call(`/api/research/${t.id}/companies`,{...c,kind:'mentioned',relationStatus:'pending',direction:'unclear',replace:true,version:t.version,note:'合成 HTTP 验证',analysis:Object.fromEntries(Object.keys(COMPANY_ANALYSIS_FIELDS).map(k=>[k,'测'.repeat(1000)]))});assert.equal(response.code,200);assert.equal(response.body.research.topics.find(x=>x.id===t.id).version,t.version+1);
 service.controlOperation('minutes','pause');const watched=await call('/api/watchlist',{symbol:'AAPL.US'});assert.equal(watched.code,200);assert(watched.body.watchlist.some(w=>w.symbol==='AAPL.US'));assert.equal(watched.body.operations.minutes.paused,true);
 }finally{await service.close();s.close();}
});
