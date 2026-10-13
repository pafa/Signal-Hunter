import test from 'node:test';
import assert from 'node:assert/strict';
import {make,event,jobs,facts} from './helpers/financial-recovery-fixture.mjs';
import {filingMap,filingIndex,quarterlyUrl,syntheticFilingHtml} from './helpers/financial-filing-fixture.mjs';
import {financialMaterial,SEC_TICKERS_URL,secFactsUrl} from '../server/financial-source-material.mjs';
import {HOLDINGS_FINANCIAL_INTERVAL,HOLDINGS_FINANCIAL_VERSION} from '../server/holdings-financial-basis.mjs';
import {validateFinancialFollowup} from '../server/system-financial-revisions.mjs';
import {openStore} from '../server/store.mjs';
import {openMarketSimulation} from '../server/market-simulation.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {conditionalDossier,conditionBody} from './helpers/research-conditions-fixture.mjs';
import {researchObservationSubjects} from '../server/research-observation-subjects.mjs';
import {projectActualResearch} from '../server/actual-research.mjs';

const checks=f=>f.store.db.prepare('SELECT payload FROM holdings_financial_checks').all().map(r=>JSON.parse(r.payload));
const refreshes=f=>jobs(f).filter(j=>j.p.financialFollowup?.schema===HOLDINGS_FINANCIAL_VERSION);
function holding(f,quantity='1.5',extra={}){
 const p=f.service.actualHoldings.preview({rows:[{account:'SYNTHETIC_PRIVATE_ACCOUNT_72819',symbol:'NVDA.US',quantity,unitCost:'117.43',price:'',asOf:'2026-10-08T00:00:00Z',source:'Synthetic snapshot',feeBasis:'included',reason:'Synthetic update',...extra}]});
 assert.equal(p.canApply,true);f.service.actualHoldings.apply({id:p.id,hash:p.hash});
}
function setup(options={}){
 let value=200,onRead=null,filingText=syntheticFilingHtml;
 const f=make({mode:'normal',fetcher:async url=>{
  if(onRead)await onRead(url);
  if(url===quarterlyUrl)return new Response(filingText,{headers:{'content-type':'text/html'}});
  const current=structuredClone(facts);current.facts['us-gaap'].Revenues.units.USD[0].val=value;
  return new Response(JSON.stringify(url===SEC_TICKERS_URL?filingMap:url===secFactsUrl('0001045810')?current:filingIndex()));
 },...options});
 return Object.assign(f,{change:x=>value=x,changeFiling:()=>filingText=syntheticFilingHtml.replace('</body>','<p>Revenue outlook was revised. Synthetic evidence only.</p></body>'),onRead:fn=>onRead=fn});
}
async function ready(f){f.add(1);await f.until(()=>jobs(f).some(j=>j.status==='completed'));assert.ok(event(f).dossier);}

test('a held issuer gets a versioned new dossier without intermediate approval, retaining old evidence and account rows',async()=>{
 const f=setup();try{
  await ready(f);holding(f);const original=event(f),history=JSON.stringify(f.service.research.historyDetail(original.id,original.version));
  const accounts=f.store.db.prepare('SELECT * FROM actual_holding_records').all(),calls=f.calls.dossier;
  f.change(300);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);
  await f.until(()=>refreshes(f).some(j=>j.status==='completed'));
  const latest=event(f),job=refreshes(f)[0];
  assert.equal(f.queue.snapshot().events.holdingsFinancial[0].status,'completed');
  assert.equal(f.calls.dossier,calls+1);assert.equal(latest.version,original.version+2);
  assert.deepEqual(latest.evidence.slice(0,original.evidence.length),original.evidence);
  assert.equal(JSON.stringify(f.service.research.historyDetail(original.id,original.version)),history);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM actual_holding_records').all(),accounts);
  assert.equal(validateFinancialFollowup(f.store.db,f.service.research.get(latest.id),job).version,original.version);
  assert.ok(f.packets.at(-1).input.evidence.some(e=>e.material?.financialSource?.selected.some(v=>v.value===300)));
  assert.ok(!JSON.stringify(f.packets.at(-1)).includes('SYNTHETIC_PRIVATE_ACCOUNT_72819'));
  const count=f.requests.length;await f.drive(10);assert.equal(f.requests.length,count);assert.equal(refreshes(f).length,1);
 }finally{await f.close();}
});

test('no holdings and paused financial sources perform no periodic reads; same bytes after new receipt do not invoke a model',async()=>{
 const f=setup();try{
  await ready(f);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);const count=f.requests.length;await f.drive(8);assert.equal(f.requests.length,count);
  holding(f);f.queue.configure({...f.queue.snapshot().settings,financialSources:false});await f.drive(8);assert.equal(f.requests.length,count);
  f.queue.configure({...f.queue.snapshot().settings,financialSources:true});const version=event(f).version,calls=f.calls.dossier;
  await f.until(()=>checks(f).some(c=>c.status==='unchanged'));assert.equal(event(f).version,version);assert.equal(f.calls.dossier,calls);assert.equal(refreshes(f).length,0);
  f.advance(24*3600000+1);await f.until(()=>checks(f).some(c=>c.status==='unchanged'&&c.startedAt.startsWith('2026-10-09')));
  assert.equal(event(f).version,version);assert.equal(f.calls.dossier,calls);
 }finally{await f.close();}
});

test('financial evidence is queued while the model allowance is exhausted, and resumes through the original quota',async()=>{
 const f=setup();try{
  await ready(f);holding(f);const calls=f.calls.dossier,used=f.queue.snapshot().callsInLast24Hours;
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:used});f.change(301);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);
  await f.until(()=>refreshes(f).length===1);await f.drive(8);assert.equal(f.calls.dossier,calls);assert.equal(refreshes(f)[0].status,'queued');
  const queued=refreshes(f)[0],bad={...queued,payload:JSON.stringify({...queued.p,financialFollowup:{...queued.p.financialFollowup,proof:{...queued.p.financialFollowup.proof,nextBasis:'0'.repeat(64)}}})};
  assert.throws(()=>validateFinancialFollowup(f.store.db,f.service.research.get(queued.topic_id),bad),/依据不连续/);
  f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100,financialSources:false});await f.drive(8);assert.equal(refreshes(f)[0].status,'queued');assert.equal(f.calls.dossier,calls);
  f.queue.configure({...f.queue.snapshot().settings,financialSources:true});await f.until(()=>refreshes(f)[0]?.status==='completed');assert.equal(f.calls.dossier,calls+1);
 }finally{await f.close();}
});

test('a sale during the source read stops the update and later reads, preserving the old dossier',async()=>{
 const f=setup();try{
  await ready(f);holding(f);const original=event(f);f.change(302);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);
  f.onRead(()=>{f.onRead(null);holding(f,'0');});await f.drive(8);
  assert.deepEqual(event(f),original);assert.equal(refreshes(f).length,0);assert.equal(f.queue.snapshot().events.holdingsFinancial[0].status,'interrupted');const count=f.requests.length;f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);await f.drive(8);assert.equal(f.requests.length,count);
 }finally{await f.close();}
});

test('failed periodic reads retain old research, retry twice with persisted delay, then cool down',async()=>{
 const f=setup();try{
  await ready(f);holding(f);const original=event(f);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);f.setMode('fail');
  await f.until(()=>checks(f).some(c=>c.status==='retry'&&c.attempt===1));await f.drive(8);assert.equal(checks(f)[0].attempt,1);
  f.advance(60001);await f.until(()=>checks(f)[0]?.attempt===2);f.advance(120001);await f.until(()=>checks(f)[0]?.status==='unavailable');
  await f.drive(8);assert.equal(checks(f)[0].attempt,3);assert.deepEqual(event(f),original);assert.equal(refreshes(f).length,0);
 }finally{await f.close();}
});

test('market holdings are projected without evaluating quotes, exits or private account data',()=>{
 const store=openStore(':memory:');try{
  const sim=openMarketSimulation(store,{}, {getInputs:()=>{throw Error('must not evaluate quotes');},getResearchContext:()=>{throw Error('must not evaluate research');}});
  store.db.prepare('INSERT INTO market_sim_book VALUES(1,?)').run(JSON.stringify({lots:[{symbol:'NVDA.US',qty:2},{symbol:'NVDA.US',qty:1},{symbol:'AAPL.US',qty:0},{symbol:'00700.HK',qty:10}]}));
  assert.deepEqual(sim.holdingSymbols(),['NVDA.US','00700.HK']);
 }finally{store.close();}
});

test('an amended filing without changed facts also creates a new automatic dossier',async()=>{
 const f=setup();try{
  await ready(f);holding(f);const original=event(f),calls=f.calls.dossier;f.changeFiling();f.advance(24*3600000+1);
  await f.until(()=>refreshes(f).some(j=>j.status==='completed'));assert.equal(f.calls.dossier,calls+1);
  assert.notEqual(event(f).financialSources[0].filings[0].materialId,original.financialSources[0].filings[0].materialId);
  assert.equal(validateFinancialFollowup(f.store.db,f.service.research.get(original.id),refreshes(f)[0]).version,original.version);
 }finally{await f.close();}
});

test('a restarted service retains periodic retry deadlines and attempts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'holdings-financial-')),path=join(dir,'synthetic.sqlite');let f=setup({path});
 try{
  await ready(f);holding(f);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);f.setMode('fail');await f.until(()=>checks(f)[0]?.status==='retry');const before=checks(f)[0];await f.close();
  f=setup({path});f.setMode('fail');f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);await f.drive(8);assert.deepEqual(checks(f)[0],before);
  f.advance(60001);await f.until(()=>checks(f)[0]?.attempt===2);assert.equal(refreshes(f).length,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('new financial evidence and an adopted dossier resume holding conditions while old material and opening research remain',async()=>{
 const f=setup({researchRunner:conditionalDossier,sourceReader:async url=>({url,title:'Synthetic financial monitoring',sourceName:'Synthetic',body:'NVIDIA 拟回购普通股，授权规模不等于实际执行金额。'+conditionBody.repeat(4),scope:'extracted-text'})});
 try{
  await ready(f);const original=event(f);holding(f,'1.5',{topicId:original.id,topicVersion:original.version});
  f.change(350);f.advance(HOLDINGS_FINANCIAL_INTERVAL+1);await f.until(()=>refreshes(f).some(j=>j.status==='completed'));
  const current=f.service.research.get(original.id),subjects=researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[current]);
  assert.equal(subjects[0].ready,true);assert.equal(subjects[0].fresh,true,'an old retained financial snapshot must not expire the new dossier that already includes its replacement');assert.equal(subjects[0].changed,false);
  await f.service.runOperation('observations');const checks=f.service.observations.summary().researchChecks.filter(c=>c.subject.id===original.id);
  assert.equal(checks.find(c=>c.group==='nextCheck')?.status,'false');
  const record=f.service.actualHoldings.snapshot().records[0],projection=projectActualResearch(record,[current],{subjects,researchChecks:checks,getTopicVersion:(id,v)=>f.service.research.historyDetail(id,v).topic},'2026-10-08T06:00:00.001Z');
  assert.equal(record.topicVersion,original.version);assert.equal(projection.link.status,'current');assert.equal(projection.currentBinding.runId,current.dossier.sourceModelRun.id);
  assert.ok(current.evidence.length>original.evidence.length);assert.deepEqual(current.evidence.slice(0,original.evidence.length),original.evidence);
  // A later source not included in this dossier must still expire it.
  f.advance(60000);
  const read=id=>JSON.parse(f.store.db.prepare('SELECT payload FROM research_materials WHERE id=?').get(id).payload),latest=read(current.financialSources[0].materialId);
  const documents=latest.financialSource.sources.map(d=>({url:d.url,receivedAt:'2026-10-08T06:01:00.001Z',body:Buffer.from(f.store.db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(d.sha256).body)}));
  const amended=JSON.parse(documents[1].body);amended.facts['us-gaap'].Revenues.units.USD[0].val=400;documents[1].body=Buffer.from(JSON.stringify(amended));
  let sibling=f.service.research.create({title:'Independent synthetic financial update',summary:'A later source not yet considered by the original dossier'});
  sibling=f.service.research.addCompany(sibling.id,{version:sibling.version,symbol:'NVDA.US',note:'Synthetic issuer only'});
  f.service.research.recordFinancialSource(sibling.id,{version:sibling.version},{symbol:'NVDA.US',status:'saved'},{...financialMaterial('NVDA.US',documents),financialDocuments:documents});
  const subject=()=>researchObservationSubjects(f.store,f.service.research,f.service.modelResearch,[current])[0];
  assert.equal(subject().ready,true);assert.equal(subject().fresh,false);assert.equal(subject().changed,true);
  // Historical evidence is retained AND verified, even after supersession.
  const old=read(original.financialSources[0].materialId);f.store.db.prepare('UPDATE research_source_documents SET body=? WHERE sha256=?').run(Buffer.from('{}'),old.financialSource.sources[1].sha256);
  assert.equal(subject().ready,false);

 }finally{await f.close();}
});
