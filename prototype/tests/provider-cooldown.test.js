import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createProviderGate} from '../server/provider-gate.mjs';
const start=Date.parse('2026-10-12T00:00:00Z'),api='https://api.hkma.gov.hk/public/press-releases?lang=en',rss='https://www.hkma.gov.hk/eng/other-information/rss/rss_press-release.xml',key='source:api.hkma.gov.hk';

test('405 keeps response evidence and cools only that host across a new gate, then resumes normally',async()=>{
 const s=openStore(':memory:');let at=start,calls=0;
 const fetcher=async url=>{calls++;return new Response(url===rss?'<rss/>':'upstream denied',{status:calls===1?405:200});};
 try{let gate=createProviderGate(s,{fetcher,now:()=>at});const response=await gate(api);assert.equal(response.status,405);assert.equal(await response.text(),'upstream denied');assert.equal(s.checks()[key].state,'error');assert.equal(s.checks()[key].retryAt,new Date(start+1800000).toISOString());
  assert.equal((await gate(rss)).status,200);gate=createProviderGate(s,{fetcher,now:()=>at});at=start+1799999;await assert.rejects(gate(api),/暂停请求至/);assert.equal(calls,2);assert.equal(s.checks()[key].consecutiveFailures,1);at++;assert.equal((await gate(api)).status,200);assert.equal(calls,3);assert.equal(s.checks()[key].state,'ok');assert.equal(s.checks()[key].retryAt,null);
 }finally{s.close();}
});

test('Retry-After seconds and HTTP-date extend the existing cooldown without shortening it',async()=>{
 for(const [status,header,delay] of [[429,'7200',7200000],[503,'120',120000],[405,'Mon, 12 Oct 2026 03:00:00 GMT',10800000],[405,'Monday, 12-Oct-26 03:00:00 GMT',10800000],[405,'Mon Oct 12 03:00:00 2026',10800000],[403,'1',1800000],[502,'0',60000],[503,'Sun, 11 Oct 2026 23:00:00 GMT',60000]]){
  const s=openStore(':memory:');try{const gate=createProviderGate(s,{fetcher:async()=>new Response('fixture',{status,headers:{'retry-after':header}}),now:()=>start});await gate(api);assert.equal(s.checks()[key].retryAt,new Date(start+delay).toISOString(),header);}finally{s.close();}
 }
});

test('malformed Retry-After cannot crash the gate or shorten the default cooling period',async()=>{
 for(const value of ['-1','1.5','NaN','Infinity','not a date','99999999999999999999999999999999999','120, 240','2026-10-12','Tue, 12 Oct 2026 03:00:00 GMT','Tue, 31 Feb 2026 03:00:00 GMT']){
  const s=openStore(':memory:');try{await createProviderGate(s,{fetcher:async()=>new Response('',{status:429,headers:{'retry-after':value}}),now:()=>start})(api);assert.equal(s.checks()[key].retryAt,new Date(start+1800000).toISOString(),value);}finally{s.close();}
 }
});

test('late concurrent failures and successes cannot shorten another request cooling period',async()=>{
 const s=openStore(':memory:');const release=[];let at=start;
 try{const gate=createProviderGate(s,{now:()=>at,fetcher:()=>new Promise(r=>release.push(r))});const long=gate(api),short=gate(api),success=gate(api);
  release[0](new Response('',{status:429,headers:{'retry-after':'7200'}}));await long;const until=s.checks()[key].retryAt;at+=1000;release[1](new Response('',{status:503}));await short;assert.equal(s.checks()[key].retryAt,until);assert.equal(s.checks()[key].consecutiveFailures,2);release[2](new Response('ok'));await success;assert.equal(s.checks()[key].retryAt,until);assert.equal(s.checks()[key].state,'error');
 }finally{s.close();}
});

test('cancellation and paused contexts keep a late 405 from changing persisted health',async()=>{
 const s=openStore(':memory:');let resolve,paused=false;const abort=new AbortController();
 try{const gate=createProviderGate(s,{now:()=>start,fetcher:()=>new Promise(r=>resolve=r)}),context={signal:abort.signal,assertActive(){if(paused)throw Error('paused');}};
  const promise=gate(api,{},context);paused=true;abort.abort();resolve(new Response('blocked',{status:405}));await assert.rejects(promise,/paused/);assert.equal(s.checks()[key],undefined);
 }finally{s.close();}
});


test('normal news cycles continue other sources while cooling, survive service restart, and recover after the deadline',async()=>{
 const s=openStore(':memory:');let at=start,hkma=0,fed=0,service;
 s.setSettings({newsDiscoveryEnabled:false,newsTrackingEnabled:false,newsFedEnabled:true,newsHkmaEnabled:true});
 const fetcher=async url=>{if(new URL(url).hostname==='api.hkma.gov.hk'){hkma++;return hkma===1?new Response('synthetic denied body',{status:405}):Response.json({header:{success:true},result:{datasize:0,records:[]}});}fed++;return new Response('<rss><channel><title>Synthetic empty feed</title></channel></rss>');};
 try{service=createService(s,{mode:'research',now:()=>at,fetcher});await service.refreshNews();assert.equal(hkma,1);assert.equal(fed,1);assert.equal(s.checks().news.state,'partial');const failed=s.db.prepare("SELECT id,payload FROM news_intake_runs WHERE query_id='hkma'").get();assert.equal(JSON.parse(failed.payload).state,'error');
  await service.close();at+=600000;service=createService(s,{mode:'research',now:()=>at,fetcher});await service.refreshNews();assert.equal(hkma,1);assert.equal(fed,2);assert.equal(s.checks().news.state,'partial');
  at=start+1800000;await service.refreshNews();assert.equal(hkma,2);assert.equal(fed,3);assert.equal(s.checks().news.state,'ok');assert.equal(s.checks()[key].retryAt,null);assert.equal(s.db.prepare('SELECT payload FROM news_intake_runs WHERE id=?').get(failed.id).payload,failed.payload);assert(s.db.prepare("SELECT body FROM news_source_responses WHERE body='synthetic denied body'").get());
 }finally{await service?.close();s.close();}
});
