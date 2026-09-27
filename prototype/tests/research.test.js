import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {classifyHeadline,evidenceCoverage} from '../server/triage.mjs';
import {planExit} from '../server/risk-rules.mjs';
import {hash} from '../server/providers.mjs';
import {createHandler} from '../server/index.mjs';
import {createService} from '../server/service.mjs';
const classify=title=>classifyHeadline({title});
const news={id:hash('research-story'),title:'Meta Muse connects to Spotify',url:'https://www.reuters.com/test',publishedAt:'2026-09-22T10:00:00Z',publisher:'Reuters'};
const research=()=>{const store=openStore(':memory:');return {store,r:openResearch(store,{clock:()=> '2026-09-24T10:00:00Z'})};};
const attachment={stance:'supports',family:'mechanism',step:'load',interpretation:'仍需核实标题对应的具体事实'};
const exit=()=>({position:{id:'p1',version:1,qty:100,sellableQty:80},evidence:{id:'e1',invalidatesThesis:true,verification:'confirmed'},requestedQty:80,quote:{id:'q1',fresh:true},market:{open:true,halted:false,sellLiquidity:true}});

test('HTTP research workflow creates a theme, associates a company and records evidence without creating trades',async()=>{
 const store=openStore(':memory:'),handler=createHandler(store,createService(store));
 const call=async(method,url,data)=>{let status,result;await handler({headers:{host:'127.0.0.1:4179','content-type':'application/json'},method,url,async *[Symbol.asyncIterator](){yield JSON.stringify(data||{});}},{writeHead:v=>{status=v;},end:body=>{result=JSON.parse(body);}});return {status,result};};
 try{const made=await call('POST','/api/research',{title:'Test theme',summary:'A causal hypothesis'});assert.equal(made.status,200);const id=made.result.createdTopicId;
 assert.equal((await call('POST',`/api/research/${id}/companies`,{version:1,symbol:'AMD.US',note:'CPU vendor, exposure unverified'})).status,200);
 const saved=await call('POST',`/api/research/${id}/evidence`,{version:2,claim:'A test-only claim',sourceName:'Fixture',stance:'unverified',family:'mechanism',step:'mechanism',interpretation:'Needs a source'});assert.equal(saved.status,200);assert.equal(saved.result.research.topics.find(t=>t.id===id).version,3);assert.deepEqual(saved.result.research.positions,[]);assert.deepEqual(saved.result.research.applications,[]);assert.equal((await call('GET',`/api/research/${id}/history`)).result.length,3);
 assert.equal((await call('PATCH',`/api/research/${id}`,{version:2,status:'archived'})).status,400);
 }finally{store.close();}
});

test('triage separates ordinary headlines, weak topic clues and structural candidates without trade advice',()=>{
 assert.equal(classify('Nvidia CEO says AI should be regulated').bucket,'quiet');
 assert.equal(classify('Grok releases another update').bucket,'clue');
 assert.equal(classify('Meta Muse tops App Store chart').bucket,'review');
 assert.equal(classify('Amazon blocks Meta Muse').bucket,'review');
 assert.equal(classify('Spotify connects to Muse').bucket,'review');
 assert.equal(classify('新华传媒拟收购财联社100%股权').bucket,'review');
 assert.equal(classify('Company files for bankruptcy').bucket,'review');
 assert.equal(classify('US imposes new export controls on chips').bucket,'review');
 assert.equal(classify('Muse band concert opens tomorrow').companies.some(c=>c.symbol==='META.US'),false);
 for(const title of ['Spotify connects to Muse','新华传媒拟收购财联社100%股权'])assert.equal(classify(title).tradeSignal,false);
});
test('acquisition stages do not turn a proposal, denial or incomplete transaction into completion',()=>{
 assert.match(classify('新华传媒拟收购100%股权').stage,/拟议/);
 assert.match(classify('Company denies completed acquisition of controlling stake').stage,/否认/);
 assert.match(classify('Company has not completed acquisition of 100% stake').stage,/尚未完成/);
 assert.match(classify('Company terminates acquisition of controlling stake').stage,/终止/);
});
test('support coverage does not count rumors, context, multiple articles from one origin or missing causal links as confirmed',()=>{
 const topic={chain:[{id:'adoption'},{id:'earnings'}],evidence:[{verification:'reported',stance:'supports',family:'adoption',originKey:'Reuters',step:'adoption'},{verification:'reported',stance:'supports',family:'adoption',originKey:'Reuters',step:'adoption'},{verification:'unverified',stance:'supports',family:'earnings',originKey:'user',step:'earnings'},{verification:'primary',stance:'context',family:'earnings',originKey:'AMD',step:'earnings'}]};
 const c=evidenceCoverage(topic);assert.equal(c.origins.length,1);assert.equal(c.families.length,1);assert.deepEqual(c.missingSteps,['earnings']);assert.equal(c.pending,1);
});
test('retrospective cases are first seen at import time and never claim discovery at publication',()=>{
 const {store,r}=research();try{const topic=r.get('agent-cpu');assert.equal(topic.origin,'retrospective-case');assert.ok(topic.evidence.every(e=>e.firstSeen==='2026-09-24T10:00:00Z'&&e.retrospective));assert.equal(r.history(topic.id).length,1);}finally{store.close();}
});
test('RSS evidence attachment freezes headline version, stays unverified and is idempotent',()=>{
 const {store,r}=research();try{store.ingest([news],'2026-09-24T09:00:00Z');let topic=r.addEvidence('agent-cpu',{...attachment,newsId:news.id,version:1});assert.equal(topic.version,2);const added=topic.evidence.at(-1);assert.equal(added.verification,'unverified');assert.equal(added.firstSeen,'2026-09-24T09:00:00Z');topic=r.addEvidence('agent-cpu',{...attachment,newsId:news.id,version:2});assert.equal(topic.version,2);
 store.ingest([{...news,title:'Correction: Spotify limits functionality'}]);assert.equal(r.get('agent-cpu').evidence.at(-1).claim,news.title);assert.equal(r.history('agent-cpu')[1].topic.evidence.some(e=>e.newsId),false);
 }finally{store.close();}
});
test('new evidence, hypothesis changes and archive append versions; stale edits are rejected',()=>{
 const {store,r}=research();try{r.update('agent-cpu',{version:1,hypothesis:{logic:'New user hypothesis',industryHorizon:'3 months',holdingHorizon:'Not defined'}});assert.throws(()=>r.update('agent-cpu',{version:1,status:'archived'}),/已更新/);assert.notEqual(r.history('agent-cpu')[1].topic.hypothesis.logic,'New user hypothesis');r.update('agent-cpu',{version:2,status:'archived'});r.update('agent-cpu',{version:3,status:'active'});assert.equal(r.history('agent-cpu').length,4);assert.ok(r.get('agent-cpu').researchUpdatedAt);}finally{store.close();}
});
test('manual verification is versioned and invalid calendar dates are rejected',()=>{
 const {store,r}=research();try{assert.throws(()=>r.update('agent-cpu',{version:1,hypothesis:{reviewAt:'2026-02-31'}}),/日期/);assert.throws(()=>r.verifyEvidence('agent-cpu',{version:1,evidenceId:'grok-linux',verdict:'confirmed',stance:'supports',note:''}),/核验依据/);const t=r.verifyEvidence('agent-cpu',{version:1,evidenceId:'grok-linux',verdict:'unverified',stance:'context',note:'待提供原始来源'});assert.equal(t.evidence.find(e=>e.id==='grok-linux').review.note,'待提供原始来源');assert.equal(r.history('agent-cpu')[1].topic.evidence.find(e=>e.id==='grok-linux').review,undefined);}finally{store.close();}
});
test('manual evidence validates source URLs and cannot promote itself to verified',()=>{
 const {store,r}=research();try{const data={...attachment,version:1,claim:'A claim',sourceName:'Someone',url:'javascript:alert(1)'};assert.throws(()=>r.addEvidence('agent-cpu',data),/HTTPS/);const t=r.addEvidence('agent-cpu',{...data,url:'https://example.org/news',verification:'primary'});assert.equal(t.evidence.at(-1).verification,'unverified');assert.throws(()=>r.addEvidence('agent-cpu',{...data,version:2,url:'https://example.org',step:'missing'}),/因果环节/);}finally{store.close();}
});
test('routing is stored once per news revision and not reinterpreted on each poll',()=>{
 const {store,r}=research();try{store.ingest([news]);assert.equal(r.snapshot().counts.pending,1);assert.equal(store.db.prepare('SELECT count(*) n FROM triage').get().n,0);r.process();r.snapshot();r.snapshot();assert.equal(store.db.prepare('SELECT count(*) n FROM triage').get().n,1);store.ingest([{...news,title:'Meta Muse tops App Store chart'}]);r.process();r.snapshot();assert.equal(store.db.prepare('SELECT count(*) n FROM triage').get().n,2);}finally{store.close();}
});
test('research persists across reopen; seed process never overwrites user work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'major-research-')),path=join(dir,'db.sqlite');let store=openStore(path);try{let r=openResearch(store);r.update('agent-cpu',{version:1,hypothesis:{logic:'Keep my change'}});store.close();store=openStore(path);r=openResearch(store);assert.equal(r.get('agent-cpu').hypothesis.logic,'Keep my change');assert.equal(r.history('agent-cpu').length,2);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('unheld or unverified adverse events cannot turn directly into exits',()=>{
 assert.equal(planExit({...exit(),position:null}).state,'observe');const value=exit();value.evidence.verification='unverified';assert.equal(planExit(value).state,'verify');assert.equal(planExit(value).priority,'urgent');assert.equal(planExit(value).automaticExecution,false);
});
test('exit gate blocks invalid quantities, stale quotes and unavailable market execution',()=>{
 for(const quantity of [0,-1,1.5,81,Infinity])assert.equal(planExit({...exit(),requestedQty:quantity}).state,'needs-parameters');
 assert.equal(planExit({...exit(),position:{...exit().position,sellableQty:150},requestedQty:120}).state,'needs-parameters');
 assert.equal(planExit({...exit(),quote:{id:'q1',fresh:false}}).state,'blocked');
 for(const market of [{open:false,halted:false,sellLiquidity:true},{open:true,halted:true,sellLiquidity:true},{open:true,halted:false,sellLiquidity:false},{}])assert.equal(planExit({...exit(),market}).state,'blocked');
});
test('human approval binds current evidence, position version, quantity and quote; matching approval never executes',()=>{
 const input=exit(),preview=planExit(input);assert.equal(preview.state,'awaiting-human');input.approval={valid:true,fingerprint:preview.fingerprint};assert.equal(planExit(input).state,'eligible-for-paper-engine');assert.equal(planExit(input).automaticExecution,false);
 assert.equal(planExit({...input,quote:{id:'q2',fresh:true}}).state,'awaiting-human');assert.equal(planExit({...input,position:{...input.position,version:2}}).state,'awaiting-human');assert.equal(planExit({...input,requestedQty:70}).state,'awaiting-human');assert.equal(planExit({...input,evidence:{...input.evidence,id:'e2'}}).state,'awaiting-human');
});

test('global memory, guidance and supply shocks route to research without automatic trade',()=>{
 assert.equal(classify('Micron raises earnings guidance on memory demand').bucket,'review');
 assert.ok(classify('DRAM prices rise for another month').topicHints.includes('memory-global'));
 assert.equal(classify('A major supply contract changes production outlook').category,'订单 / 供给冲击');
 assert.ok(classify('GigaDevice updates product roadmap').companies.some(c=>c.symbol==='03986.HK'));
 assert.equal(classify('Micron raises guidance').tradeSignal,false);
});
test('each maintained rule defines executable inputs, decision, failure output and validation boundary',async()=>{
 const {RULEBOOK,RULE_FIELDS}=await import('../shared/rulebook.mjs');assert.equal(RULEBOOK.length,31);assert.equal(new Set(RULEBOOK.map(r=>r.id)).size,31);for(const r of RULEBOOK)for(const [k] of RULE_FIELDS)assert.ok(r.specification[k]?.length>10,`${r.id} ${k}`);
});
