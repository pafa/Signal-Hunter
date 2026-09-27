import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {classifyHeadline,RULES_VERSION} from '../server/triage.mjs';
import {hash} from '../server/providers.mjs';
import {syncResearchWatches} from '../server/workflow.mjs';
import {companyIdentity,searchCompanies,headlineCompanies} from '../shared/company-directory.mjs';
import {createHandler} from '../server/index.mjs';
import {createService} from '../server/service.mjs';

const setup=()=>{let at='2026-09-25T09:00:00Z';const store=openStore(':memory:'),r=openResearch(store,{seed:false,clock:()=>at});return {store,r,setTime:x=>at=x};};
const item=(title,id=title)=>({id:hash(id),title,publisher:'Fixture',publishedAt:'2026-09-25T08:00:00Z',url:'https://example.com/'+hash(id)});
const relation=(version,extra={})=>({version,symbol:'BA.US',note:'直接涉及订单；交付进度和利润仍待核验',kind:'direct',relationStatus:'pending',direction:'unclear',...extra});

test('bounded company search resolves multilingual names and padded securities without merging listings',()=>{
 assert.ok(searchCompanies('Boeing').some(c=>c.symbol==='BA.US'));assert.ok(searchCompanies('9988').some(c=>c.symbol==='09988.HK'));assert.equal(companyIdentity('700.hk').symbol,'00700.HK');
 assert.equal(companyIdentity('BABA.US').issuerKey,companyIdentity('09988.HK').issuerKey);assert.notEqual(companyIdentity('BABA.US').securityKey,companyIdentity('09988.HK').securityKey);assert.equal(companyIdentity('UNKN.US').identityStatus,'unresolved');
});
test('ambiguous ordinary words do not become issuers; explicit corporate names and context do',()=>{
 for(const title of ['Meta-analysis studies clinical trial data','Investors arm themselves for volatility','Apple harvest is hit by frost','Amazon rainforest loses trees','A delta in growth data','On the rise: airline traffic','The oracle predicts future'])assert.deepEqual(headlineCompanies(title),[],title);
 for(const [title,symbol] of [['Apple raises iPhone revenue forecast','AAPL.US'],['Arm reports chip revenue growth','ARM.US'],['Meta buys company','META.US'],['Boeing wins aircraft order','BA.US'],['Novo Nordisk therapy is approved','NVO.US'],['腾讯拟回购','00700.HK']])assert.ok(headlineCompanies(title).some(c=>c.symbol===symbol),title);
});
test('rumor and multiple listings retain uncertainty, no inferred supplier or directional benefit',()=>{
 const t=classifyHeadline(item('Alibaba reportedly considers acquisition, sources say'));assert.equal(t.messageStatus,'rumor');assert.equal(t.bucket,'review');assert.deepEqual(t.companies.map(c=>c.symbol).sort(),['09988.HK','BABA.US']);
 for(const c of t.companies){assert.equal(c.kind,'mentioned');assert.equal(c.direction,'unclear');assert.equal(c.relationStatus,'pending');}assert.equal(t.screening.factProbability,null);assert.equal(t.screening.priceProbability,null);
});
test('title amounts do not imply major significance and urgent reversals do not place trades',()=>{
 const a=classifyHeadline(item('Boeing wins $2 billion aircraft contract'));assert.equal(a.screening.materiality,'unassessed');assert.ok(a.screening.dimensions.find(d=>d.key==='scale').question.includes('比例'));assert.equal(a.tradeSignal,false);
 const b=classifyHeadline(item('Boeing denies acquisition talks'));assert.equal(b.screening.urgency,'priority');assert.match(b.stage,/否认/);assert.equal(b.screening.tradeSignal,false);
 assert.equal(classifyHeadline(item('Company files for bankruptcy')).screening.urgency,'priority');
});
test('project force majeure and capital commitments are candidates; singular source attribution stays unconfirmed',()=>{
 const force=classifyHeadline(item("Oracle triggers 'force majeure' on data center project over power delays, source says"));assert.equal(force.bucket,'review');assert.equal(force.messageStatus,'rumor');assert.equal(force.screening.urgency,'priority');assert.ok(force.matchedRules.includes('project-risk'));assert.equal(force.companies[0].direction,'unclear');
 const investment=classifyHeadline(item('Microsoft plans $10 billion-plus Gulf investment with focus on resilience'));assert.equal(investment.bucket,'review');assert.ok(investment.matchedRules.includes('investment'));assert.equal(investment.screening.materiality,'unassessed');
 assert.equal(classifyHeadline(item('Local train service delayed by rain')).bucket,'quiet');
});
test('company relation correction and removal preserve old versions, watches and paper books',()=>{
 const {store,r}=setup();try{openResearch(store);const p=openPaper(store,r),before=store.db.prepare('SELECT * FROM paper_books').all();let t=r.create({title:'订单研究',summary:'交付与盈利待核验'});t=r.addCompany(t.id,relation(1));syncResearchWatches(store,r.list());
 t=r.addCompany(t.id,relation(t.version,{replace:true,direction:'mixed',note:'供应约束可能抵消订单收益'}));assert.equal(r.history(t.id)[1].topic.companies[0].direction,'unclear');
 assert.throws(()=>r.addCompany(t.id,relation(1,{replace:true})),/更新/);assert.throws(()=>r.addCompany(t.id,relation(t.version)),/已关联/);
 t=r.removeCompany(t.id,{version:t.version,symbol:'BA.US',note:'样例错误关联'});assert.equal(t.companies.length,0);assert.equal(r.history(t.id)[1].topic.companies[0].direction,'mixed');assert.ok(store.watchlist().some(w=>w.symbol==='BA.US'));assert.deepEqual(store.db.prepare('SELECT * FROM paper_books').all(),before);assert.equal(p.snapshot().fills.length,0);
 }finally{store.close();}
});
test('reviewed relationships require actual references while unverified rumors remain researchable',()=>{
 const {store,r}=setup();try{let t=r.create({title:'传闻研究',summary:'传闻可能影响公司'});
 assert.throws(()=>r.addCompany(t.id,relation(1,{relationStatus:'reviewed'})),/来源/);assert.throws(()=>r.addCompany(t.id,relation(1,{evidenceIds:['missing']})),/证据/);assert.throws(()=>r.addCompany(t.id,relation(1,{url:'javascript:alert(1)'})),/HTTPS/);
 t=r.addCompany(t.id,relation(1,{relationStatus:'reviewed',url:'https://example.com/source'}));assert.equal(t.companies[0].relationStatus,'reviewed');assert.equal(t.evidence.length,0);assert.equal(t.hypothesis.action,'observe');
 }finally{store.close();}
});
test('unknown security needs identity review for automatic watch, preserving pending research',()=>{
 const {store,r}=setup();try{let t=r.create({title:'陌生主体',summary:'主体待核验'});t=r.addCompany(t.id,relation(1,{symbol:'UNKN.US'}));let sync=syncResearchWatches(store,r.list());assert.equal(sync.deferred.length,1);assert.equal(store.watchlist().length,0);
 assert.throws(()=>r.addCompany(t.id,relation(t.version,{symbol:'UNKN.US',replace:true,identityReviewed:true})),/公司名/);
 t=r.addCompany(t.id,relation(t.version,{symbol:'UNKN.US',replace:true,identityReviewed:true,name:'Test Corporation',url:'https://example.com/filing'}));syncResearchWatches(store,r.list());assert.ok(store.watchlist().some(w=>w.symbol==='UNKN.US'));
 }finally{store.close();}
});
test('capacity defers and retries without evicting existing watches; manual unfollow is respected',()=>{
 const {store,r}=setup();try{for(let n=1;n<=40;n++)store.addWatch(String(n).padStart(6,'0')+'.SH');let t=r.create({title:'新事件',summary:'新公司关系'});t=r.addCompany(t.id,relation(1));assert.equal(syncResearchWatches(store,r.list()).deferred.length,1);assert.equal(store.watchlist().length,40);
 store.removeWatch('000001.SH');assert.deepEqual(syncResearchWatches(store,r.list()).added,['BA.US']);store.removeWatch('BA.US');assert.deepEqual(syncResearchWatches(store,r.list()).added,[]);
 }finally{store.close();}
});
test('cross-market relation cannot invent issuer identity from sector linkage',()=>{
 const {store,r}=setup();try{let t=r.create({title:'跨市场',summary:'行业联动'});assert.throws(()=>r.addCompany(t.id,relation(1,{kind:'listing'})),/同一发行人/);t=r.addCompany(t.id,relation(1,{symbol:'BABA.US'}));t=r.addCompany(t.id,relation(t.version,{symbol:'09988.HK',kind:'listing'}));assert.equal(t.companies[1].kind,'listing');}finally{store.close();}
});
test('all screening buckets are retained with immutable input, decision time and exact rules',()=>{
 const {store,r,setTime}=setup();try{store.ingest([item('Company files for bankruptcy'),item('Grok releases another update'),item('Scientists study ancient tools')],'2026-09-25T08:30:00Z');r.process();const stats=r.screenings.stats();assert.equal(stats.current,3);assert.deepEqual(stats.buckets.map(x=>x.bucket).sort(),['clue','quiet','review']);
 const n=item('Scientists study ancient tools'),first=r.screenings.packet(n.id).samples[0];assert.equal(first.origin,'historical-diagnostic');assert.equal(first.evaluationEligible,false);setTime('2026-09-25T10:00:00Z');r.process();assert.deepEqual(r.screenings.packet(n.id).samples[0],first);
 store.ingest([{...n,title:'Company files for bankruptcy'}],'2026-09-25T10:00:00Z');setTime('2026-09-25T10:01:00Z');r.process();const rows=r.screenings.packet(n.id).samples;assert.equal(rows.length,2);assert.equal(rows[0].input.revision,2);assert.equal(rows[1].input.title,n.title);assert.notEqual(rows[0].inputHash,rows[1].inputHash);assert.equal(r.screenings.stats().current,4);
 assert.ok(JSON.parse(store.db.prepare('SELECT payload FROM screening_rules').get().payload).sources['shared/company-directory.mjs']);
 }finally{store.close();}
});
test('post-activation intake is separate from historical diagnosis but still needs independent eligibility',()=>{
 const {store,r,setTime}=setup();try{setTime('2026-09-26T09:00:00Z');const n=item('Unknown sector opportunity');store.ingest([n],'2026-09-26T08:00:00Z');r.process();const sample=r.screenings.packet(n.id).samples[0];assert.equal(sample.origin,'prospective-intake');assert.equal(sample.evaluationEligible,false);}finally{store.close();}
});
test('review labels append versions and cannot overwrite initial classification or become orders',()=>{
 const {store,r}=setup();try{const n=item('Scientists study ancient tools');store.ingest([n],'2026-09-25T08:30:00Z');r.process();const sample=r.screenings.packet(n.id).samples[0],base={sampleId:sample.id,version:0,verdict:'major',scope:'headline-only',note:'测试复核',novelty:'新增测试事实',scale:'规模未知，需对比',mechanism:'传导路径待核验'};
 const first=r.screenings.review(base);assert.equal(first.blind,false);r.screenings.review({...base,version:1,verdict:'ordinary',note:'复核发现无公司影响'});assert.throws(()=>r.screenings.review({...base,version:1}),/更新/);
 const rows=r.screenings.packet(n.id).samples[0];assert.equal(rows.reviews.length,2);assert.equal(rows.reviews[1].verdict,'major');assert.equal(rows.triage.bucket,'quiet');assert.equal(r.list().length,0);assert.equal(openResearch(store,{seed:false}).screenings.stats().reviewed,1);
 }finally{store.close();}
});
test('review labels validate materiality explanations, source scope and URLs',()=>{
 const {store,r}=setup();try{const n=item('Boeing wins contract');store.ingest([n]);r.process();const id=r.screenings.packet(n.id).samples[0].id,base={sampleId:id,version:0,verdict:'unclear',scope:'headline-only',note:'Needs more context'};
 for(const patch of [{verdict:'major'},{scope:'source-reviewed'},{sourceUrl:'http://localhost'},{note:''},{version:-1},{verdict:'bullish'}])assert.throws(()=>r.screenings.review({...base,...patch}));assert.equal(r.screenings.stats().reviewed,0);
 }finally{store.close();}
});
test('classification and sample writes roll back together on capture failure',()=>{
 const {store,r}=setup();try{store.ingest([item('Company files for bankruptcy')]);store.db.exec("CREATE TRIGGER fail_sample BEFORE INSERT ON screening_samples BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");assert.throws(()=>r.process(),/fixture failure/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM triage').get().n,0);assert.equal(r.screenings.stats().total,0);}finally{store.close();}
});
test('current UI routing uses exact rule fingerprint even when a display version was reused during development',()=>{
 const {store,r}=setup();try{const n=item('Company files for bankruptcy');store.ingest([n]);store.db.prepare('INSERT INTO triage VALUES(?,?,?,?,?)').run(n.id,1,RULES_VERSION,JSON.stringify({bucket:'quiet',companies:[]}), '2026-09-25T08:00:00Z');r.process();assert.equal(r.newsPage({bucket:'review'}).items[0].id,n.id);assert.equal(r.snapshot().inbox[0].triage.bucket,'review');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM triage').get().n,2);}finally{store.close();}
});
test('HTTP review and relation routes return current UI data and reject stale changes',async()=>{
 const store=openStore(':memory:');try{const service=createService(store),handler=createHandler(store,service),n=item('Boeing wins $2 billion order');store.ingest([n]);service.research.process();const call=async(method,url,data)=>{let code,body;await handler({headers:{host:'127.0.0.1:4179','content-type':'application/json'},method,url,async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:c=>code=c,end:b=>body=JSON.parse(b)});return {code,body};};
 const p=await call('GET',`/api/news/${n.id}/screening`);assert.equal(p.code,200);const review=await call('POST','/api/news/screening-review',{sampleId:p.body.samples[0].id,version:0,verdict:'unclear',scope:'headline-only',note:'No margin or delivery terms yet'});assert.equal(review.code,200);assert.equal(review.body.research.screeningSamples.reviewed,1);
 const made=await call('POST','/api/research/from-news',{newsId:n.id,newsRevision:1}),id=made.body.createdTopicId;assert.ok(made.body.watchlist.some(w=>w.symbol==='BA.US'));const removed=await call('DELETE',`/api/research/${id}/companies`,{version:1,symbol:'BA.US',note:'Fixture cleanup'});assert.equal(removed.code,200);assert.equal(removed.body.research.topics.find(t=>t.id===id).companies.length,0);assert.equal(removed.body.paper.fills.length,0);
 }finally{store.close();}
});
