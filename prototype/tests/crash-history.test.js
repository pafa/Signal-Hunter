import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openMarketSimulation} from '../server/market-simulation.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {inventoryDatabase,compareInventories} from '../server/database-inventory.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';

const at='2026-10-03T10:00:00.000Z',now=()=>Date.parse(at);
const item={id:'crash-fixture',title:'Synthetic original news',publisher:'Fixture',url:'https://example.org/fixture',publishedAt:at};
const imports=name=>JSON.stringify(new URL('../server/'+name+'.mjs',import.meta.url).href);
const marketCommand=kind=>({requestId:'crash-request-'+kind,version:1,config:{...strategyProfiles[kind].suggestedConfig,cashFloorPct:50},note:'Synthetic configuration only'});

// The gate is a connection-local SQLite trigger: the current projection has
// already changed but its matching history INSERT has not run. For market pools,
// both event and book have changed but the idempotency receipt is still pending.
// SIGKILL prevents
// JS catch/finally, service.close(), or db.close() from doing the recovery.
function writer(path,topicId,kind,phase){
 const history={news:'revisions',research:'research_versions',paper:'paper_versions'}[kind]||'market_sim_commands_'+kind;
 const source=`
 import {writeSync} from 'node:fs';
 import {openStore} from ${imports('store')};
 import {createService} from ${imports('service')};
 const store=openStore(${JSON.stringify(path)}),service=createService(store,{mode:'research',now:()=>Date.parse(${JSON.stringify(at)}),fetcher:()=>{throw Error('No external requests');}});
 store.db.exec('PRAGMA wal_autocheckpoint=0');
 const stop=()=>{writeSync(1,'CRASH_GATE\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
 if(${JSON.stringify(phase)}==='during'){
  store.db.function('crash_gate',stop);
  store.db.exec('CREATE TEMP TRIGGER stop_history BEFORE INSERT ON ${history} BEGIN SELECT crash_gate(); END');
 }
 if(${JSON.stringify(kind)}==='news')store.ingest([{...${JSON.stringify(item)},title:'Synthetic revised news'}],${JSON.stringify(at)});
 if(${JSON.stringify(kind)}==='research')service.research.update(${JSON.stringify(topicId)},{version:1,nextEvidence:'Synthetic revised research'});
 if(${JSON.stringify(kind)}==='paper'){const b=service.paper.snapshot();service.paper.updateParams({version:b.version,...b.params,cashFloorPct:40});}
 ${strategyProfiles[kind]?`service.marketSimulations[${JSON.stringify(kind)}].configure(${JSON.stringify(marketCommand(kind))});`:''}
 if(${JSON.stringify(phase)}==='after')stop();
 throw Error('Crash gate was not reached');
 `;
 return spawnWriter(source);
}
function spawnWriter(source){
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stderr.on('data',b=>errors+=b);
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const ready=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Crash gate timed out: '+errors)),15000);
  const finish=fn=>value=>{clearTimeout(timeout);fn(value);};
  child.once('error',finish(reject));child.once('close',()=>{if(!output.includes('CRASH_GATE\n'))finish(reject)(Error('Writer exited before gate: '+errors));});
  child.stdout.on('data',b=>{output+=b;if(output.includes('CRASH_GATE\n'))finish(resolve)();});
 });
 return {child,ready,closed};
}

const fillStart='2026-10-02T14:00:00.000Z';
const fillConfig={issuerCapPct:25,themeCapPct:40,cashFloorPct:20,feeBps:10,slippageBps:0,maxHoldDays:5,maxOrderMinutes:60,quoteMaxAgeSeconds:120,allowOvernight:true};
function fillQuote(at,capacity=40){
 return {id:'synthetic-fill:'+at,symbol:'AAPL.US',currency:'USD',kind:'market-simulation-input',verified:true,source:'synthetic-crash-only',rulesVersion:'fixture-only',issuerId:'synthetic-issuer',asOf:at,receivedAt:at,validUntil:'2026-10-02T20:00:00Z',bid:'100',ask:'100',mark:'100',fx:{id:'synthetic-fx',source:'synthetic-crash-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-02T20:00:00Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-02T13:00:00Z',sessionClose:'2026-10-02T20:00:00Z',sellableAt:at,settlesAt:'2026-10-03T14:00:00Z',buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:capacity,availableSell:capacity};
}
// These two accounts deliberately have no strategy profile: this exercises the
// common fill/ledger/liquidity transaction, not either strategy's entry quality.
function fillFixture(path,at=fillStart,quote=fillQuote(at)){
 const store=openStore(path),research=openResearch(store,{seed:false,clock:()=>at});
 const accounts=Object.fromEntries(['aggressive','steady'].map(accountId=>[accountId,openMarketSimulation(store,research,{accountId,clock:()=>at,getInputs:()=>({quotes:{'AAPL.US':quote}})})]));
 return {store,research,accounts,set(next,q=fillQuote(next)){at=next;quote=q;},close(){store.close();}};
}
function proposeFill(sim,topic,side){
 const command=extra=>({requestId:randomUUID(),version:sim.snapshot().version,...extra});
 sim.propose(command({order:{topicId:topic.id,topicVersion:topic.version,symbol:'AAPL.US',side,qty:100,limitPrice:'100',budgetUSD:11000,expiresAt:'2026-10-02T14:30:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic crash case',trigger:'Fixture approval',invalidation:'Fixture only'}}));
 const order=sim.snapshot().orders.at(-1),review=sim.review(order.id);
 assert.equal(review.eligible,true,review.reasons.join(';'));
 sim.decide(order.id,command({action:'approve',note:'Synthetic crash approval',confirmSimulation:true,fingerprint:review.fingerprint}));
}
function fillWriter(path,at,quote,phase){
 return spawnWriter(`
 import {writeSync} from 'node:fs';
 import {openStore} from ${imports('store')};
 import {openResearch} from ${imports('research')};
 import {openMarketSimulation} from ${imports('market-simulation')};
 const store=openStore(${JSON.stringify(path)}),clock=()=>${JSON.stringify(at)};
 const research=openResearch(store,{seed:false,clock});
 const sim=openMarketSimulation(store,research,{accountId:'aggressive',clock,getInputs:()=>({quotes:{'AAPL.US':${JSON.stringify(quote)}}})});
 store.db.exec('PRAGMA wal_autocheckpoint=0');
 const stop=()=>{writeSync(1,'CRASH_GATE\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
 if(${JSON.stringify(phase)}==='during'){
  store.db.function('crash_gate',stop);
  store.db.exec('CREATE TEMP TRIGGER stop_fill AFTER INSERT ON market_sim_liquidity BEGIN SELECT crash_gate(); END');
 }
 sim.process();
 if(${JSON.stringify(phase)}==='after')stop();
 throw Error('Fill crash gate was not reached');
 `);
}

for(const side of ['buy','sell'])for(const phase of ['during','after']){
 test(`${side} fill SIGKILL ${phase} commit preserves cash, FIFO, history and shared quote capacity`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'signal-fill-crash-')),path=join(dir,'fixture.sqlite');
  let f,reader,process;
  try{
   f=fillFixture(path);
   let topic=f.research.create({title:'Synthetic shared-liquidity crash',summary:'No real data or strategy validation'});
   topic=f.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Synthetic fixture'});
   for(const sim of Object.values(f.accounts)){
    sim.initialize({requestId:randomUUID(),version:0,initialUSD:100000,config:fillConfig,confirmSimulation:true});
    proposeFill(sim,topic,'buy');
   }
   if(side==='sell'){
    const boughtAt='2026-10-02T14:00:01.000Z';f.set(boughtAt,fillQuote(boughtAt,200));
    for(const sim of Object.values(f.accounts))assert.equal(sim.process().fills.length,1);
    for(const sim of Object.values(f.accounts))proposeFill(sim,topic,'sell');
   }
   const executionAt='2026-10-02T14:00:02.000Z',quote=fillQuote(executionAt);
   const before=inventoryDatabase(path),oldBook=f.accounts.aggressive.snapshot();
   const oldEvents=f.store.db.prepare('SELECT * FROM market_sim_events_aggressive ORDER BY version').all();
   f.close();f=null;
   reader=new DatabaseSync(path,{readOnly:true});reader.prepare('SELECT COUNT(*) FROM market_sim_liquidity').get();
   process=fillWriter(path,executionAt,quote,phase);await process.ready;
   const visible=inventoryDatabase(path),changed=compareInventories(before,visible).tables.filter(t=>!t.identical).map(t=>t.name).sort();
   assert.deepEqual(changed,phase==='during'?[]:['market_sim_book_aggressive','market_sim_events_aggressive','market_sim_liquidity']);
   if(phase==='after')assert.ok(statSync(path+'-wal').size>32);
   assert.equal(process.child.kill('SIGKILL'),true);assert.equal((await process.closed).signal,'SIGKILL');
   f=fillFixture(path,executionAt,quote);reader.close();reader=null;
   assert.equal(compareInventories(visible,inventoryDatabase(path)).passed,true,'reopen cannot change any table');
   let book=f.accounts.aggressive.snapshot();
   assert.equal(book.orders.at(-1).filledQty,phase==='after'?40:0);
   assert.equal(book.fills.length,oldBook.fills.length+(phase==='after'?1:0));
   // Replay exactly the same quote: an uncommitted fill may execute once; a
   // committed fill keeps its original ID, amounts, allocations and event.
   const committedFill=phase==='after'?book.fills.at(-1):null;
   const committedEvent=phase==='after'?f.accounts.aggressive.event(book.version):null;
   book=f.accounts.aggressive.process();
   assert.equal(book.orders.at(-1).filledQty,40);assert.equal(book.orders.at(-1).status,'partial');
   assert.equal(book.fills.length,oldBook.fills.length+1);
   if(committedFill)assert.deepEqual(book.fills.at(-1),committedFill);
   assert.equal(book.cashCents,oldBook.cashCents-(side==='buy'?400400:0));
   assert.equal(book.feesCents,oldBook.feesCents+400);
   assert.equal(book.lots.reduce((n,l)=>n+l.qty,0),side==='buy'?40:60);
   assert.equal(book.lots.reduce((n,l)=>n+l.costCents,0),side==='buy'?400400:600600);
   assert.equal(book.unsettledCashCents,side==='sell'?399600:0);
   assert.equal(book.realizedCents,side==='sell'?-800:0);
   if(side==='sell')assert.deepEqual(book.fills.at(-1).allocations,[{lotId:oldBook.lots[0].id,qty:40,costCents:400400}]);
   const otherBefore=f.accounts.steady.snapshot(),other=f.accounts.steady.process();
   assert.equal(other.orders.at(-1).filledQty,0,'second account cannot consume the committed quote again');
   for(const key of ['cashCents','feesCents','fills','lots','unsettled'])assert.deepEqual(other[key],otherBefore[key]);
   const key=createHash('sha256').update(JSON.stringify({version:2,symbol:quote.symbol,source:quote.source,at:Date.parse(quote.asOf)})).digest('hex');
   const liquidity=JSON.parse(f.store.db.prepare('SELECT payload FROM market_sim_liquidity WHERE key=?').get(key).payload);
   assert.equal(liquidity.version,2);assert.equal(liquidity[side],40);
   f.accounts.aggressive.process();const stable=inventoryDatabase(path);f.accounts.aggressive.process();f.accounts.steady.process();
   assert.equal(compareInventories(stable,inventoryDatabase(path)).passed,true,'repeated checks append no duplicate fills or events');
   const events=f.store.db.prepare('SELECT * FROM market_sim_events_aggressive ORDER BY version').all();
   assert.deepEqual(events.slice(0,oldEvents.length),oldEvents);
   if(committedEvent)assert.deepEqual(f.accounts.aggressive.event(committedEvent.version),committedEvent);
   let previous=null;for(const row of events){const e=JSON.parse(row.payload);assert.equal(e.previousHash,previous);assert.equal(createHash('sha256').update(JSON.stringify(e)).digest('hex'),row.hash);previous=row.hash;}
   if(side==='sell'){
    f.set('2026-10-03T14:00:00.000Z');book=f.accounts.aggressive.process();
    assert.equal(book.cashCents,oldBook.cashCents+399600);assert.equal(book.unsettledCashCents,0);
    const settled=inventoryDatabase(path);f.accounts.aggressive.process();
    assert.equal(compareInventories(settled,inventoryDatabase(path)).passed,true,'recovered proceeds settle only once');
   }
  }finally{
   if(process){if(process.child.exitCode===null&&process.child.signalCode===null)process.child.kill('SIGKILL');await process.closed;}
   if(f)f.close();if(reader)reader.close();rmSync(dir,{recursive:true,force:true});
  }
 });
}

for(const kind of ['news','research','paper','aggressive','steady'])for(const phase of ['during','after']){
 test(`${kind} history survives SIGKILL ${phase} its transaction without partial writes or restart reseeding`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'signal-crash-')),path=join(dir,'fixture.sqlite');
  let store,service,reader,process;
  try{
   store=openStore(path);assertDatabaseMode(store,'research');service=createService(store,{mode:'research',now});
   store.ingest([item],at);const topic=service.research.create({title:'Synthetic saved research',summary:'Preserve history across a process crash'});
   for(const [id,sim] of Object.entries(service.marketSimulations))sim.initialize({requestId:'initialize-'+id,version:0,initialUSD:500000,config:strategyProfiles[id].suggestedConfig,confirmSimulation:true});
   const before=inventoryDatabase(path);
   await service.close();service=null;store.close();store=null;
   // Keep a real reader connected so a committed WAL remains available through
   // the crash; opening the replacement service must recover from that WAL.
   reader=new DatabaseSync(path,{readOnly:true});reader.prepare('SELECT COUNT(*) FROM news').get();
   process=writer(path,topic.id,kind,phase);await process.ready;
   const visible=inventoryDatabase(path);
   const changed=compareInventories(before,visible).tables.filter(t=>!t.identical).map(t=>t.name).sort();
   const pair=({news:['news','revisions'],research:['research_topics','research_versions'],paper:['paper_books','paper_versions']}[kind]||['market_sim_book_'+kind,'market_sim_events_'+kind,'market_sim_commands_'+kind]).sort();
   assert.deepEqual(changed,phase==='during'?[]:pair);
   if(phase==='after')assert.ok(statSync(path+'-wal').size>32,'committed data must still be in WAL');
   assert.equal(process.child.kill('SIGKILL'),true);assert.equal((await process.closed).signal,'SIGKILL');
   assert.equal(compareInventories(visible,inventoryDatabase(path)).passed,true);
   store=openStore(path);service=createService(store,{mode:'research',now,fetcher:()=>{throw Error('No external requests');}});
   reader.close();reader=null;
   assert.equal(compareInventories(visible,inventoryDatabase(path)).passed,true,'startup must not change or reseed any table');
   assert.equal(service.snapshot().research.topics.length,1);
   assert.equal(store.revisions(item.id).at(-1).title,item.title);
   assert.equal(service.research.get(topic.id).version,kind==='research'&&phase==='after'?2:1);
   assert.equal(service.paper.snapshot().params.cashFloorPct,kind==='paper'&&phase==='after'?40:35);
   assert.equal(store.newsById(item.id).title,kind==='news'&&phase==='after'?'Synthetic revised news':item.title);
   for(const [id,sim] of Object.entries(service.marketSimulations)){
    assert.equal(sim.snapshot().version,id===kind&&phase==='after'?2:1);
    assert.equal(sim.snapshot().config.cashFloorPct,id===kind&&phase==='after'?50:strategyProfiles[id].suggestedConfig.cashFloorPct);
   }
   for(const table of ['revisions','research_versions','paper_versions'])assert.equal(store.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,phase==='after'&&pair.includes(table)?2:1);
   // Recovery remains writable and appends another version, retaining the old rows.
   const recovered=inventoryDatabase(path);
   if(strategyProfiles[kind]){
    const sim=service.marketSimulations[kind],command=marketCommand(kind);
    sim.configure(command);const applied=inventoryDatabase(path);sim.configure(command);
    assert.equal(compareInventories(applied,inventoryDatabase(path)).passed,true,'same recovered command cannot append a second event');
    assert.equal(sim.snapshot().version,2);assert.equal(sim.history().length,2);
    const event=sim.event(2);assert.equal(event.previousHash,sim.event(1).hash);
    assert.deepEqual(event.state.config,command.config);
    const other=kind==='steady'?'aggressive':'steady';
    for(const suffix of ['book','events','commands'])assert.equal(applied.tables['market_sim_'+suffix+'_'+other].sha256,recovered.tables['market_sim_'+suffix+'_'+other].sha256);
   }
   store.ingest([{...item,title:'Synthetic follow-up'}],at);
   service.research.update(topic.id,{version:service.research.get(topic.id).version,nextEvidence:'Follow-up after recovery'});
   const book=service.paper.snapshot();service.paper.updateParams({version:book.version,...book.params,cashFloorPct:45});
   const appended=inventoryDatabase(path);
   for(const table of ['revisions','research_versions','paper_versions']){
    assert.equal(appended.tables[table].count,recovered.tables[table].count+1);
    assert.ok(recovered.tables[table].rows.every(row=>appended.tables[table].rows.includes(row)),'old history must remain byte-equivalent');
   }
  }finally{
   if(process){if(process.child.exitCode===null&&process.child.signalCode===null)process.child.kill('SIGKILL');await process.closed;}
   if(service)await service.close();if(store)store.close();if(reader)reader.close();rmSync(dir,{recursive:true,force:true});
  }
 });
}
