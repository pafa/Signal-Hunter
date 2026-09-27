import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {createService} from '../server/service.mjs';
import {claimsOf,assessmentFields} from '../shared/claims.mjs';
import {marketClock,dailyHealth,dailyEligibility,sessionFor} from '../shared/market-clock.mjs';
import {securityIdentity,issuer} from '../shared/securities.mjs';
import {EVALUATION_VERSION,forwardEligibility,outcomeLabel} from '../shared/evaluation.mjs';
const claim=(patch={})=>({kind:'outcome',status:'rumor',claim:'A test claim',probability:50,basis:'One report; no calibrated history',impactIfTrue:'Potential improvement',impactIfFalse:'Potential loss',horizon:'30 days',resolveBy:'2026-10-25',outcome:'open',evidenceIds:[],resolutionReason:'',revisionReason:'Initial test assessment',...patch});
test('fact, rumor and earnings claims coexist; revisions preserve first estimate and survive reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'claims-v8-')),path=join(dir,'test.sqlite');let s=openStore(path);
 try{let r=openResearch(s),t=r.create({title:'Test multi-claim',summary:'Test only'});
 t=r.saveClaim(t.id,{version:t.version,claim:claim({kind:'fact',status:'confirmed',probability:100})});
 t=r.saveClaim(t.id,{version:t.version,claim:claim({claim:'A separate rumor'})});
 t=r.saveClaim(t.id,{version:t.version,claim:claim({kind:'earnings',probability:null,claim:'Earnings unknown'})});
 const rumor=t.claims[1];t=r.saveClaim(t.id,{version:t.version,claim:{...claim(),id:rumor.id,claim:rumor.claim,probability:70,outcome:'unresolved',resolutionReason:'Still no outcome data',revisionReason:'New evidence changes subjective estimate'}});
 assert.equal(t.claims.length,3);assert.equal(t.claims[0].status,'confirmed');assert.equal(t.claims[2].probability,null);assert.equal(t.claims[1].firstProbability,50);assert.equal(t.claims[1].probability,70);
 assert.equal(r.history(t.id)[1].topic.claims[1].probability,50);assert.match(r.list().find(x=>x.id===t.id).changeSummary.items[0],/50% → 70%/);
 s.close();s=openStore(path);r=openResearch(s);assert.equal(r.get(t.id).claims[1].outcome,'unresolved');assert.equal(r.history(t.id).length,5);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('a null first probability stays null, and rejected or stale revisions do not change the topic',()=>{
 const s=openStore(':memory:'),r=openResearch(s);try{
 let t=r.create({title:'Null estimate',summary:'Test only'});t=r.saveClaim(t.id,{version:1,claim:claim({probability:null})});const id=t.claims[0].id;
 t=r.saveClaim(t.id,{version:2,claim:claim({id,probability:70})});assert.equal(t.claims[0].firstProbability,null);
 for(const input of [claim({id,probability:101}),claim({id,evidenceIds:['missing']}),claim({id,outcome:'true',resolutionReason:'No evidence'}),claim({id,resolveBy:'2026-02-31'}),claim({id,revisionReason:''})])assert.throws(()=>r.saveClaim(t.id,{version:3,claim:input}));
 assert.throws(()=>r.saveClaim(t.id,{version:2,claim:claim({id})}),/已更新/);assert.equal(r.get(t.id).version,3);
 }finally{s.close();}
});
test('legacy claims are read without migration; outcomes need references and do not rewrite prior probabilities',()=>{
 const s=openStore(':memory:'),r=openResearch(s);try{r.update('agent-cpu',{version:1,assessment:assessmentFields(claim())});const original=r.get('agent-cpu'),c=claimsOf(original)[0],before=s.db.prepare('SELECT total_changes() n').get().n;claimsOf(original);r.list();r.snapshot();assert.equal(s.db.prepare('SELECT total_changes() n').get().n,before);
 const t=r.saveClaim(original.id,{version:original.version,claim:claim({...assessmentFields(c),id:c.id,outcome:'partial',evidenceIds:[original.evidence[0].id],resolutionReason:'Only part of the stated mechanism supported'})});
 assert.equal(t.claims[0].outcome,'partial');assert.equal(t.claims[0].probability,c.probability);assert.equal(r.history(t.id)[1].topic.claims,undefined);
 }finally{s.close();}
});
test('service snapshot reads do not write unprocessed triage or paper records',()=>{
 const s=openStore(':memory:'),service=createService(s);try{s.ingest([{id:'read-only-test',title:'Company raises guidance',publishedAt:'2026-09-25T01:00Z',url:'https://example.org/test'}]);const before=s.db.prepare('SELECT total_changes() n').get().n;service.snapshot();service.snapshot();assert.equal(s.db.prepare('SELECT total_changes() n').get().n,before);service.research.process();assert.ok(s.db.prepare('SELECT total_changes() n').get().n>before);}finally{s.close();}
});
test('A-share holiday accepts previous close as aligned while HK trades that day',()=>{
 const at='2026-09-25T02:30:00Z';assert.equal(marketClock('002493.SZ',at).label,'休市');assert.equal(dailyHealth('002493.SZ',{lastDate:'2026-09-24'},at).status,'aligned');assert.equal(marketClock('00293.HK',at).label,'交易中');assert.equal(dailyEligibility('002493.SZ','2026-09-25',at).complete,false);
});
test('HK half day closes at 12:10 and buffer completes at 12:40, without fake lunch state',()=>{
 assert.match(marketClock('00293.HK','2026-12-24T04:20Z').label,/等待日线/);assert.equal(marketClock('00293.HK','2026-12-24T04:45Z').label,'已收盘');assert.equal(dailyEligibility('00293.HK','2026-12-24','2026-12-24T04:39Z').complete,false);assert.equal(dailyEligibility('00293.HK','2026-12-24','2026-12-24T04:40Z').complete,true);
});
test('US daylight saving, half days, holidays and buffer determine completed local day',()=>{
 assert.equal(dailyEligibility('AAPL.US','2026-09-24','2026-09-24T20:29Z').complete,false);assert.equal(dailyEligibility('AAPL.US','2026-09-24','2026-09-24T20:30Z').complete,true);
 assert.equal(dailyEligibility('AAPL.US','2026-12-23','2026-12-23T21:29Z').complete,false);assert.equal(dailyEligibility('AAPL.US','2026-12-23','2026-12-23T21:30Z').complete,true);
 assert.equal(dailyEligibility('AAPL.US','2026-11-27','2026-11-27T18:30Z').complete,true);assert.equal(sessionFor('AAPL.US','2026-07-02').half,false);assert.equal(sessionFor('AAPL.US','2026-07-03').open,false);
});
test('unknown calendars and invalid dates remain explicit; stale date differs from received age',()=>{
 assert.equal(marketClock('AAPL.US','2027-01-05T22:00Z').known,false);assert.equal(sessionFor('AAPL.US','2026-02-31').known,false);assert.equal(dailyHealth('AAPL.US',{lastDate:'2026-09-23',receivedAt:'2026-09-25T01:00Z'},'2026-09-25T01:00Z').status,'lagging');assert.equal(dailyHealth('AAPL.US',{lastDate:'2026-09-25'},'2026-09-25T01:00Z').status,'ahead');
});
test('A/H/ADR are separate securities with explicit existing issuer groups; names never merge identity',()=>{
 assert.equal(securityIdentity('9988.hk').symbol,'09988.HK');assert.equal(issuer('09988.HK'),issuer('BABA.US'));assert.notEqual(securityIdentity('09988.HK').securityKey,securityIdentity('BABA.US').securityKey);assert.equal(securityIdentity('BABA.US').listing,'ADR');assert.equal(securityIdentity('NEW.US').relationStatus,'跨市场关系未映射');assert.notEqual(issuer('600001.SH'),issuer('600001.SZ'));assert.equal(securityIdentity('AAPL.US').venue,'US-UNRESOLVED');
});
test('forward eligibility rejects known clusters, historical data, absent availability and later revisions',()=>{
 const b={protocolVersion:EVALUATION_VERSION,forwardStart:'2026-09-26T00:00:00+08:00',frozenAt:'2026-09-25T01:00Z',excludedTopicIds:['known'],excludedClusterIds:['known-cluster'],rulesHash:'fixed'};
 const r={topicId:'new',clusterId:'new-cluster',clusterReviewedAt:'2026-09-26T01:05Z',origin:'forward-capture',firstSeen:'2026-09-26T01:00Z',availableAt:'2026-09-26T01:00Z',decisionAt:'2026-09-26T01:10Z',inputHash:'immutable',rulesHash:'fixed'};
 assert.equal(forwardEligibility(r,b).eligible,true);
 for(const patch of [{topicId:'known'},{clusterId:'known-cluster'},{origin:'retrospective-case'},{firstSeen:'2026-09-25T01:00Z'},{availableAt:null},{availableAt:'2026-09-27T00:00Z'},{clusterReviewedAt:'2026-09-27T00:00Z'},{rulesHash:'tuned'},{inputHash:''}])assert.equal(forwardEligibility({...r,...patch},b).eligible,false,JSON.stringify(patch));
});
test('unresolved and partially realized outcomes never become false labels',()=>{
 for(const outcome of ['open','unresolved','partial'])assert.equal(outcomeLabel({outcome}).label,null);
 assert.equal(outcomeLabel({outcome:'true',evidenceIds:['e1'],resolutionReason:'Reviewed',resolvedAt:'2026-09-25T01:00Z'}).label,1);assert.equal(outcomeLabel({outcome:'false'}).mature,false);
});
