import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,output} from './automatic-research-fixture.mjs';
import {DIRECTORY_SOURCES,officialIssuerAlias,openSecurityDirectory} from '../server/security-directory.mjs';
import {openStore} from '../server/store.mjs';
import {automaticIdentity} from '../server/pipeline-event-automation.mjs';
import {workbook,hkRows,szRows,szMeta,shResponse} from './helpers/directory-workbooks.mjs';
const quote='American Express Company announced an acquisition.';
function sources(){let extra=false,broken=false;const calls=[];return {calls,change(){extra=true;},break(){broken=true;},fetcher:async url=>{
 calls.push(url);if(broken)throw Error('synthetic upstream failure');
 const s=DIRECTORY_SOURCES.find(s=>s.url===url);
 if(s)return new Response([s.header,...(s.id==='nasdaq'?['ACME|Acme Inc. - Common Stock|Q|N|N|100|N|N',...(extra?['NEW|New Company - Common Stock|Q|N|N|100|N|N']:[])]:['AXP|American Express Company Common Stock|N|AXP|N|100|N|AXP']),'File Creation Time: 1007202618:01'+'|'.repeat(s.id==='other'?6:7)].join('\n'));
 if(url.includes('hkex'))return new Response(workbook(hkRows(url.includes('_c.xlsx')?'cn':'en','07/10/2026')));
 if(url.includes('query.sse')){const u=new URL(url),type=u.searchParams.get('STOCK_TYPE');return Response.json(shResponse(type,Number(u.searchParams.get('pageHelp.pageNo')),type==='1'?2:1));}
 if(url.includes('SHOWTYPE=JSON'))return Response.json(szMeta('2026-10-07'));
 if(url.includes('SHOWTYPE=xlsx'))return new Response(workbook(szRows(),{name:'A股列表'}));
 throw Error('Unexpected source');
 }};}
const enable=(f,markets=['US','CN','HK'])=>{const s=f.queue.snapshot().settings;f.queue.configure({version:s.version,dailyCalls:s.dailyCalls,includeClues:false,extractEvents:true,automatic:true,directoryMarkets:markets});};
const status=f=>f.queue.snapshot().directories.items;
test('official issuer aliases strip only explicit security types and retain multiple-class ambiguity',()=>{
 assert.equal(officialIssuerAlias('American Express Company Common Stock'),'American Express Company');
 assert.equal(officialIssuerAlias('Acme Inc. - Class A Common Stock'),'Acme Inc.');
 for(const name of ['American Express National Bank','Example Fund','Example Inc. ADS each representing two Ordinary Shares'])assert.equal(officialIssuerAlias(name),null);
 const mention={name:'Acme Inc.',entityType:'company',resolution:'candidate',symbols:['ACME.US']};
 assert.equal(automaticIdentity(mention,[{symbol:'ACME.US',name:'Acme Class A',aliases:['Acme Inc.']},{symbol:'ACME.B.US',name:'Acme Class B',aliases:['Acme Inc.']}]),null);
});
test('new automatic queue prepares all three markets before identity; refresh preserves frozen completed input',async()=>{
 const source=sources(),packets=[];const f=fixture({fetcher:source.fetcher,sourceReader:async url=>({url,title:'Public test acquisition',sourceName:'Synthetic',body:quote+' Synthetic test material.'.repeat(30),scope:'extracted-text'}),extractionRunner:p=>output(p,'decomposition',{events:[{title:'American Express acquisition',actor:'American Express Company',action:'announced',object:'acquisition',stage:'announced',eventTime:'未知',quote,quoteField:'body',boundaryReason:'single event',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'Synthetic',missingEvidence:['independent verification']}),identityRunner:p=>{packets.push(p);return output(p,'resolution',{mentions:[{name:'American Express Company',quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['AXP.US'],reason:'Exact official issuer alias in frozen synthetic directory'}],scopeNote:'Synthetic',missingEvidence:['listing and tradeability']});}});
 try{
  enable(f);const paper=f.service.paper.snapshot();f.add(1);await f.drive(40);assert.equal(f.queue.snapshot().counts.completed,1,JSON.stringify(f.queue.snapshot()));
  assert.equal(packets.length,1);assert.deepEqual(packets[0].input.directoryCoverage.coveredMarkets,['US','CN','HK']);assert.equal(packets[0].input.directoryBasis.snapshotIds.length,3);
  assert(status(f).every(s=>s.status==='ready'&&s.attemptsInLast24Hours===1));assert(source.calls.some(u=>u.includes('hkex')));assert(source.calls.some(u=>u.includes('sse')));
  const event=f.service.research.list().find(t=>t.eventExtraction);assert.equal(event.companies[0].symbol,'AXP.US');assert.equal(event.companies[0].identityReviewed,false);assert.deepEqual(f.service.paper.snapshot(),paper);
  const id=f.store.db.prepare('SELECT id FROM company_entity_runs').get().id,run=f.service.companyEntities.get(event.id,id),hash=run.packet.inputHash;
  source.change();f.service.securityDirectory.refresh({market:'US',requestId:'manual-changed-directory-0001'});await f.service.securityDirectory.wait();
  const after=f.service.companyEntities.get(event.id,id);assert.equal(after.stale,false);assert.equal(after.packet.inputHash,hash);assert.notEqual(f.service.securityDirectory.current().id,after.packet.input.directoryBasis.snapshotIds[0]);
  const calls=source.calls.length;await f.drive(8);assert.equal(source.calls.length,calls,'fresh directories are reused');
  assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});
test('failed directory preparation degrades without a human gate, retries with backoff and stops after three attempts per day',async()=>{
 const source=sources();source.break();const f=fixture({fetcher:source.fetcher});try{
  enable(f,['US']);f.add(1);await f.until(()=>f.queue.snapshot().counts.completed===1);assert.equal(status(f)[0].lastAttempt.status,'failed');assert.equal(source.calls.length,2);
  await f.drive(5);assert.equal(source.calls.length,2);f.advance(60000);await f.step();assert.equal(source.calls.length,4);
  f.advance(120000);await f.step();assert.equal(source.calls.length,6);assert.equal(status(f)[0].status,'observing');await f.drive(8);assert.equal(source.calls.length,6);
  const p=JSON.parse(f.store.db.prepare('SELECT payload FROM company_entity_runs').get().payload).packet;assert.deepEqual(p.input.directoryBasis.snapshotIds,[]);assert.deepEqual(p.input.directoryCoverage.missingMarkets,['US','CN','HK']);
  f.advance(86400000);await f.step();assert.equal(source.calls.length,8);
 }finally{await f.close();}
});
test('pause during a directory response prevents publishing its snapshot and retains a failed attempt',async()=>{
 const source=sources();let release,entered;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});const f=fixture({fetcher:async(...args)=>{entered();await gate;return source.fetcher(...args);}});
 try{enable(f,['US']);const pending=f.step();await started;f.service.controlOperation('discovery','pause');release();await pending;assert.equal(f.service.securityDirectory.current(),null);assert.equal(status(f)[0].lastAttempt.status,'failed');assert.equal(source.calls.length,2);}finally{release();await f.close();}
});
test('restart reuses preparation receipts; frozen empty basis never acquires later snapshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'automatic-directory-')),path=join(dir,'test.sqlite'),source=sources();let f=fixture({path,fetcher:source.fetcher});
 try{enable(f,['US']);const basis=f.service.securityDirectory.freezeBasis();await f.step();const id=f.service.securityDirectory.current().id;assert.equal(f.service.securityDirectory.selection('American Express Company',basis),null);await f.close();f=fixture({path,fetcher:source.fetcher});await f.step();assert.equal(source.calls.length,2);assert.equal(f.service.securityDirectory.current().id,id);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('future-dated official directory stays visible but cannot enter frozen identity coverage',async()=>{
 const source=sources(),f=fixture({fetcher:async url=>url.includes('hkex')?new Response(workbook(hkRows(url.includes('_c.xlsx')?'cn':'en','12/10/2026'))):source.fetcher(url)});
 try{enable(f,['HK']);await f.step();const s=status(f).find(s=>s.market==='HK');assert.equal(s.lastAttempt.status,'complete');assert.equal(s.status,'future-dated');assert.equal(s.snapshotId,null);assert(s.excludedSnapshot.eligible>0);assert.deepEqual(f.service.securityDirectory.freezeBasis().snapshotIds,[]);f.add(1);await f.until(()=>f.queue.snapshot().counts.completed===1);}
 finally{await f.close();}
});
test('frozen basis rejects absent, future or duplicated snapshots and invalid dates',async()=>{
 const store=openStore(':memory:'),source=sources(),d=openSecurityDirectory(store,{now:()=>Date.parse('2026-10-08T00:00:00Z'),fetcher:source.fetcher});
 try{d.refresh({requestId:'frozen-directory-test-0001'});await d.wait();const b=d.freezeBasis();assert.equal(d.selection('American Express Company',b).entries[0].symbol,'AXP.US');
  for(const bad of [{...b,snapshotIds:['missing']},{...b,snapshotIds:[...b.snapshotIds,...b.snapshotIds]},{...b,asOf:'2026-10-09T00:00:00.000Z'},{...b,asOf:'2026-10-07T00:00:00.000Z'},{...b,asOf:'not-a-date'}])assert.throws(()=>d.selection('AXP.US',bad));
 }finally{await d.close();store.close();}
});
