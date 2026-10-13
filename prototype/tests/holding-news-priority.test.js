import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {hash} from '../server/providers.mjs';
import {marketReviewFixture} from './fixtures/market-review.mjs';
import {selectHoldingSource} from '../server/holding-news-priority.mjs';
import {classifyHeadline} from '../server/triage.mjs';
import {digest} from '../server/codex-research.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const at='2026-10-02T14:00:00.000Z';
const news=(id,title)=>({id:hash(id),title,url:`https://example.com/${id}`,publisher:'Synthetic',publishedAt:at});
function actual(f,symbol='INTC.US',extra={}){const p=f.service.actualHoldings.preview({rows:[{account:'Synthetic private account',symbol,quantity:'1',unitCost:'90',price:'100',asOf:at,source:'Synthetic fixture',feeBasis:'included',topicId:'',topicVersion:'',...extra}]});assert(p.canApply);f.service.actualHoldings.apply({id:p.id,hash:p.hash});}
function setup(extra={}){const store=openStore(':memory:'),service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:async()=>{throw Error('No network in synthetic test');},...extra});for(const lane of Object.keys(service.operations().tasks))service.controlOperation(lane,'pause');return {store,service,async close(){await service.close();store.close();}};}
test('actual holdings affect news and continuity risk priority without editing accounts or research',async()=>{
 const f=setup();try{actual(f);const incoming=news('held','Intel denies acquisition of ComputeWorks server business'),other=news('unheld','AMD denies acquisition of ComputeWorks server business');f.store.ingest([incoming,other,news('origin','Intel reportedly plans acquisition of ComputeWorks server business')],at);f.service.research.process();f.service.processEvents();
  const before=f.store.db.prepare('SELECT total_changes() n').get().n,s=f.service.snapshot(),held=s.research.inbox.find(n=>n.id===incoming.id);assert.equal(held.researchPriority.level,'urgent');assert.deepEqual(held.researchPriority.held,['INTC.US']);assert.equal(s.research.inbox.find(n=>n.id===other.id).researchPriority.level,'high');assert.equal(s.research.inbox[0].id,incoming.id);
  assert(f.service.eventContinuity({state:'all'}).items.some(c=>c.priority.held.includes('INTC.US')));assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(held.researchPriority.tradeSignal,false);
 }finally{await f.close();}
});
test('market simulation holdings also affect news priority without borrowing structure rehearsal positions',async()=>{
 const f=marketReviewFixture();try{const n=news('sim-held','Apple denies acquisition of ComputeWorks server business');f.store.ingest([n],at);f.service.research.addEvidence(f.topic.id,{version:f.topic.version,newsId:n.id,stance:'against',family:'other',step:'fact',interpretation:'Synthetic explicit source association'});f.service.research.process();f.service.processEvents();const books=Object.fromEntries(Object.entries(f.service.marketSimulations).map(([id,m])=>[id,m.snapshot().lots]));assert.equal(f.service.snapshot().research.inbox.find(x=>x.id===n.id).researchPriority.level,'urgent');assert.deepEqual(Object.fromEntries(Object.entries(f.service.marketSimulations).map(([id,m])=>[id,m.snapshot().lots])),books);
 }finally{await f.close();}
});
test('closed records and mere watches are not current holdings, and reference projections omit account details',async()=>{
 const f=setup();try{actual(f);actual(f,'INTC.US',{account:'Second synthetic account'});f.store.addWatch('AMD.US');const n=news('held-close','Intel denies acquisition of ComputeWorks server business');f.store.ingest([n],at);f.service.research.process();f.service.processEvents();assert.deepEqual(f.service.snapshot().research.inbox[0].researchPriority.held,['INTC.US']);assert(f.service.actualHoldings.holdingReferences().every(r=>Object.keys(r).sort().join(',')==='symbol,topicId'));
  actual(f,'INTC.US',{quantity:'0',reason:'Synthetic close'});actual(f,'INTC.US',{account:'Second synthetic account',quantity:'0',reason:'Synthetic close'});assert.equal(f.service.snapshot().research.inbox[0].researchPriority.level,'high');assert.deepEqual(f.service.actualHoldings.holdingReferences(),[]);
 }finally{await f.close();}
});
test('bounded risk preference always dispatches the oldest ordinary source by the fourth selection',()=>{
 const rows=[news('ordinary','Company files for bankruptcy'),...Array.from({length:8},(_,i)=>news('risk'+i,`Intel denies acquisition of ComputeWorks${i} server business`))].map(n=>({id:n.id,news_id:n.id,revision:1,payload:JSON.stringify({screening:classifyHeadline(n)})}));let burst=0;const chosen=[];
 while(rows.length){const choice=selectHoldingSource(rows,[{symbol:'INTC.US'}],burst);chosen.push(choice);burst=choice.nextBurst;rows.splice(rows.findIndex(r=>r.id===choice.row.id),1);}
 assert.equal(chosen[3].row.news_id,hash('ordinary'));assert.equal(chosen[3].selection.selectedFor,'fifo-fairness');assert(chosen.every(c=>c.selection.materiality==='unassessed'&&!c.selection.tradeSignal));assert.equal(new Set(chosen.map(c=>c.row.id)).size,9);assert.equal(selectHoldingSource([],[],0),null);
});
test('real automatic preparation follows held risk ordering, persists fairness through restart and keeps model inputs account-free',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'holding-priority-')),path=join(directory,'fixture.sqlite'),config={binary:'/test/codex',model:'synthetic',timeoutMs:1000},reads=[],packets=[];let store,service;
 const open=()=>{store=openStore(path);service=createService(store,{mode:'research',now:()=>Date.parse(at),modelConfig:config,fetcher:async()=>{throw Error('No network');},sourceReader:async url=>{reads.push(url);return {url,title:'Synthetic original',sourceName:'Synthetic',scope:'extracted-text',body:'Synthetic public source for priority and restart verification. '.repeat(30)};},materialEventRunner:async p=>{packets.push(p);const decomposition={events:[],scopeNote:'Synthetic no concrete event',missingEvidence:['Independent evidence']},rawOutput=JSON.stringify(decomposition);return {status:'candidate',reviewStatus:'unreviewed',decomposition,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};}});for(const lane of Object.keys(service.operations().tasks))service.controlOperation(lane,'pause');};
 const close=async()=>{await service.close();store.close();};
 try{open();actual({service});service.researchPipeline.configure({version:1,dailyCalls:99,includeClues:false,extractEvents:true,automatic:true,screenUnselected:false,researchPrices:false,directoryMarkets:[]});store.ingest([news('old-ordinary','Company files for bankruptcy'),...Array.from({length:4},(_,i)=>news('auto-risk'+i,`Intel denies acquisition of ComputeWorks${i} server business`))],at);service.research.process();const account=store.db.prepare('SELECT * FROM actual_holding_records').all();
  service.controlOperation('discovery','resume');await service.runOperation('discovery');assert(reads[0]?.endsWith('/auto-risk0'));assert.equal(store.db.prepare("SELECT value FROM settings WHERE key='research_pipeline_source_burst'").get().value,'1');await close();open();
  for(let i=0;i<30&&reads.length<5;i++){service.controlOperation('discovery','resume');await service.runOperation('discovery');for(const job of service.researchPipeline.snapshot().events.items)if(job.kind==='extract'&&job.runId)await service.materialEvents.wait(job.runId);}
  assert.equal(reads.length,5);assert(reads[3].endsWith('/old-ordinary'));assert.deepEqual(store.db.prepare('SELECT * FROM actual_holding_records').all(),account);assert(packets.length>0);assert(!JSON.stringify(packets).includes('Synthetic private account'));assert(!JSON.stringify(packets).includes('unitCost'));
  const decisions=store.db.prepare("SELECT payload FROM research_pipeline_items WHERE json_extract(payload,'$.sourcePriority') IS NOT NULL").all().map(r=>JSON.parse(r.payload).sourcePriority);assert.equal(decisions.length,5);assert(decisions.some(d=>d.selectedFor==='fifo-fairness'));assert(decisions.every(d=>d.selectedAt===at));
 }finally{await close();rmSync(directory,{recursive:true,force:true});}
});
test('pause, quota and a failed priority write do not start a source read or consume the fairness turn',async()=>{
 for(const reason of ['pause','quota','write']){let reads=0;const f=setup({modelConfig:{binary:'/test/codex',model:'synthetic',timeoutMs:1000},sourceReader:async()=>{reads++;throw Error('Should not read');}});
  try{actual(f);f.service.researchPipeline.configure({version:1,dailyCalls:1,includeClues:false,extractEvents:true,automatic:true,screenUnselected:false,researchPrices:false,directoryMarkets:[]});f.store.ingest([news('blocked','Intel denies acquisition of ComputeWorks server business')],at);f.service.research.process();
   if(reason==='pause')assert.throws(()=>f.service.runOperation('discovery'),/暂停/);
   else{if(reason==='quota')f.store.db.prepare('INSERT INTO research_pipeline_attempts(item_id,run_id,at) VALUES(?,?,?)').run('synthetic-used','synthetic-used',at);else f.store.db.exec("CREATE TRIGGER fail_priority BEFORE UPDATE OF payload ON research_pipeline_items WHEN json_extract(NEW.payload,'$.sourcePriority') IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic priority failure'); END");f.service.controlOperation('discovery','resume');await f.service.runOperation('discovery');}
   assert.equal(reads,0);assert.equal(f.store.db.prepare("SELECT value FROM settings WHERE key='research_pipeline_source_burst'").get(),undefined);assert.equal(f.service.research.list().length,0);
  }finally{await f.close();}
 }
});
test('a priority for an older news revision is not reused for a revised source',()=>{
 const n=news('changed','Company files for bankruptcy'),r={id:n.id,news_id:n.id,revision:2,payload:JSON.stringify({screening:classifyHeadline(n)})};const s=selectHoldingSource([r],[],0,new Map([[n.id,{revision:1,priority:{level:'urgent',held:['INTC.US']}}]]));assert.equal(s.selection.selectedFor,'fifo');assert.deepEqual(s.selection.held,[]);
});
