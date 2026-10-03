import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../server/store.mjs';
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
