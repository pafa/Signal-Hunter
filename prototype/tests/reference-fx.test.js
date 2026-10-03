import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openReferenceFx,parseReferenceFx,convertReferenceFx,FX_SOURCE} from '../server/reference-fx.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {quoteIssues} from '../server/market-sim-risk.mjs';
const xml=(date='2026-10-02',rates={USD:'1.2',CNY:'8',HKD:'9.6'})=>`<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time="${date}">${Object.entries(rates).map(([c,r])=>`<Cube currency="${c}" rate="${r}"/>`).join('')}</Cube></Cube></gesmes:Envelope>`;
const initial=Date.parse('2026-10-03T08:00:00Z');
function setup(path=':memory:'){
 const s=openStore(path);let time=initial,raw=xml(),calls=0,fetcher=async(url,opts)=>{calls++;assert.equal(url,FX_SOURCE);assert.equal(opts.redirect,'error');return new Response(raw);};
 const options={now:()=>time,fetcher:(...args)=>fetcher(...args)},fx=openReferenceFx(s,options);
 return {s,fx,options,setRaw:v=>raw=v,advance:(ms=60001)=>time+=ms,setFetcher:v=>fetcher=v,calls:()=>calls,refresh:()=>fx.refresh({requestId:randomUUID()}),async close(){await fx.close();s.close();}};
}
test('ECB reference parsing retains source ratios and uses exact decimal cross conversion',()=>{
 const parsed=parseReferenceFx(xml());assert.equal(parsed.sourceDate,'2026-10-02');assert.equal(parsed.publicationInstant,null);assert.equal(parsed.executable,false);assert.equal(parsed.usdPerUnit.CNY,'0.150000000000');
 assert.equal(convertReferenceFx(parsed,'CNY','100').usdAmount,'15.00');assert.equal(convertReferenceFx(parsed,'HKD','0.04').usdAmount,'0.01');assert.equal(convertReferenceFx(parsed,'USD','100.005').usdAmount,'100.01');
 assert.throws(()=>convertReferenceFx(parsed,'EUR','1'));for(const amount of ['-1','1e3','1.0000001','NaN'])assert.throws(()=>convertReferenceFx(parsed,'CNY',amount));
});
test('ambiguous, duplicate, incomplete, malicious and impossible-date responses are rejected',()=>{
 const good=xml();for(const bad of [xml('2026-02-30'),xml('2026-10-02',{USD:'1',HKD:'8'}),good.replace('rate="8"','rate="0"'),good.replace('rate="8"','rate="NaN"'),good.replace('currency="CNY"','currency="USD"'),good.replace('</Cube></Cube>','</Cube><Cube time="2026-10-01"/></Cube>'),'<!DOCTYPE x>'+good,good.replace('European Central Bank','Other'),good.repeat(1000)])assert.throws(()=>parseReferenceFx(bad));
});
test('same request never refetches; same raw snapshot retains first receipt, revisions append and restart preserves',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reference-fx-')),path=join(dir,'fx.sqlite'),f=setup(path);let reopened;
 try{const request={requestId:randomUUID()},first=await f.fx.refresh(request);assert.equal(first.status,'succeeded');assert.deepEqual(await f.fx.refresh(request),first);assert.equal(f.calls(),1);const snapshot=f.fx.status().current;
 assert.throws(()=>f.fx.refresh({requestId:randomUUID()}),/一分钟/);f.advance();await f.refresh();assert.equal(f.fx.status().history.length,1);assert.deepEqual(f.fx.status().current,snapshot);
 f.setRaw(xml('2026-10-02',{USD:'1.3',CNY:'8',HKD:'9.6'}));f.advance();await f.refresh();const final=f.fx.status();assert.equal(final.history.length,2);assert.equal(f.fx.convert({snapshotId:snapshot.id,currency:'CNY',amount:'100'}).usdAmount,'15.00');
 await f.close();reopened=openStore(path);const fx=openReferenceFx(reopened,f.options);assert.deepEqual(fx.status(),final);assert.equal(f.calls(),3);await fx.close();
 }finally{if(reopened)reopened.close();else await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('future and regressed source dates remain archived while valid current data and old conversions survive',async()=>{
 const f=setup();try{await f.refresh();const old=f.fx.status().current;f.advance();f.setRaw(xml('2026-10-05'));const future=await f.refresh();assert.equal(future.status,'quarantined');assert.equal(future.reason,'future-source-date');assert.equal(f.fx.status().current.id,old.id);assert.throws(()=>f.fx.convert({snapshotId:future.snapshotId,currency:'USD',amount:'1'}));
 f.advance();f.setRaw(xml('2026-10-01'));assert.equal((await f.refresh()).reason,'source-date-regression');assert.equal(f.fx.status().current.id,old.id);f.advance();f.setRaw(xml('2026-10-03'));await f.refresh();assert.equal(f.fx.status().current.sourceDate,'2026-10-03');
 }finally{await f.close();}
});
test('parse/network/storage failures retain active data and failed requests require a new request id',async()=>{
 const f=setup();try{await f.refresh();const old=f.fx.status().current;f.advance();f.setRaw('<invalid/>');const id=randomUUID();assert.equal((await f.fx.refresh({requestId:id})).status,'failed');assert.ok(f.s.db.prepare('SELECT payload FROM reference_fx_attempts WHERE id=?').get(id).payload.includes('<invalid/>'));assert.equal(JSON.stringify(f.fx.status()).includes('<invalid/>'),false);assert.deepEqual(f.fx.status().current,old);assert.equal((await f.fx.refresh({requestId:id})).status,'failed');
 f.advance();f.setFetcher(async()=>{throw new Error('secret provider details');});assert.equal((await f.refresh()).status,'failed');assert.equal(JSON.stringify(f.fx.status()).includes('secret'),false);
 f.advance();f.setFetcher(async()=>new Response(xml('2026-10-03')));f.s.db.exec("CREATE TRIGGER no_fx BEFORE INSERT ON reference_fx_snapshots BEGIN SELECT RAISE(ABORT,'test failure'); END");assert.equal((await f.refresh()).status,'failed');assert.deepEqual(f.fx.status().current,old);
 }finally{await f.close();}
});
test('lease ownership isolates concurrent refreshes and expired worker cannot commit over successor',async()=>{
 const f=setup();let release;f.setFetcher(()=>new Promise(r=>release=r));
 try{const first=f.refresh();assert.throws(()=>f.refresh(),/正在更新/);f.advance();f.setFetcher(async()=>new Response(xml()));const successor=await f.refresh();assert.equal(successor.status,'succeeded');release(new Response(xml('2026-10-03')));assert.equal((await first).status,'failed');assert.equal(f.fx.status().current.sourceDate,'2026-10-02');}
 finally{await f.close();}
});
test('offline and restore modes deny updates, corrupted snapshots cannot be converted',async()=>{
 const s=openStore(':memory:'),offline=openReferenceFx(s,{enabled:false,fetcher:()=>assert.fail('no network')});try{assert.throws(()=>offline.refresh({requestId:randomUUID()}),/不启用/);}finally{await offline.close();s.close();}
 const f=setup();try{await f.refresh();f.s.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>f.refresh(),/恢复副本/);f.s.db.exec("UPDATE reference_fx_snapshots SET payload=replace(payload,'\"8\"','\"9\"')");assert.throws(()=>f.fx.status(),/快照无效/);}finally{await f.close();}
});
test('HTTP uses fixed source and provides traceable conversions without exposing raw data or altering accounts',async()=>{
 const s=openStore(':memory:');let calls=0;const service=createService(s,{mode:'research',now:()=>initial,fetcher:async()=>{calls++;return new Response(xml());}}),handler=createHandler(s,service);
 const call=async(method,url,data={})=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(data);}},{writeHead:v=>status=v,end:v=>result=JSON.parse(v)});return {status,result};};
 try{const before=service.paper.snapshot();assert.equal((await call('GET','/api/reference-fx')).result.current,null);assert.equal(calls,0);
 assert.equal((await call('POST','/api/reference-fx/refresh',{requestId:randomUUID(),url:'https://example.invalid'})).status,400);assert.equal(calls,0);
 assert.equal((await call('POST','/api/reference-fx/refresh',{requestId:randomUUID()})).result.status,'succeeded');assert.equal((await call('GET','/api/reference-fx/convert?currency=CNY&amount=100')).result.usdAmount,'15.00');assert.equal('raw' in (await call('GET','/api/reference-fx')).result.current,false);assert.deepEqual(service.paper.snapshot(),before);assert.equal(service.marketSimulation.snapshot().configured,false);
 }finally{await service.close();s.close();}
});
test('reference FX cannot be relabeled as executable through outer quote verification',()=>{
 const q={symbol:'AAPL.US',currency:'USD',kind:'market-simulation-input',verified:true,source:'synthetic',rulesVersion:'test',id:'q',issuerId:'issuer',asOf:'2026-10-03T08:00:00Z',receivedAt:'2026-10-03T08:00:00Z',validUntil:'2026-10-03T08:01:00Z',bid:'1',ask:'1',mark:'1',fx:{id:'fx',source:'ECB',usdPerUnit:'1',asOf:'2026-10-03T08:00:00Z',receivedAt:'2026-10-03T08:00:00Z',validUntil:'2026-10-03T08:01:00Z',kind:'reference-fx',executable:false}};
 assert.deepEqual(quoteIssues('AAPL.US',q,{quoteMaxAgeSeconds:60},'2026-10-03T08:00:00Z'),['AAPL.US：参考汇率不能作为成交或账本FX']);
});
test('shutdown waits for every in-flight response, including an expired worker superseded in-process',async()=>{
 const f=setup();let release,first,closing,closed=false;
 try{f.setFetcher(()=>new Promise(r=>release=r));first=f.refresh();f.advance();f.setFetcher(async()=>new Response(xml()));await f.refresh();closing=f.fx.close().then(()=>{closed=true;});await new Promise(setImmediate);assert.equal(closed,false);}
 finally{release?.(new Response(xml()));await first;await closing;f.s.close();}
});
