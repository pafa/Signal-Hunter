import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openSecurityDirectory,DIRECTORY_SOURCES,parseDirectoryFile} from '../server/security-directory.mjs';
import {directoryNameAliases} from '../server/directory-name-policy.mjs';
import {automaticIdentity,automaticIdentityDecision} from '../server/pipeline-event-automation.mjs';
import {digest} from '../server/codex-research.mjs';
import {companyEntitiesPacket} from '../server/company-entities.mjs';
import {identityDirectoryScope} from '../server/pipeline-identity-followup.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';
const at=Date.parse('2026-10-12T00:00:00Z');
const nasdaq=['CDNS|Cadence Design Systems, Inc. - Common Stock|Q|N|N|100|N|N','ACME|Acme Holdings, Inc. - Common Stock|Q|N|N|100|N|N'];
const other=['CRM|Salesforce, Inc. Common Stock|N|CRM|N|100|N|CRM','SAP|SAP  SE ADS|N|SAP|N|100|N|SAP','BAD|Bad Company Preferred ADS|N|BAD|N|100|N|BAD'];
const file=(source,rows)=>[source.header,...rows,'File Creation Time: 1009202618:01'+'|'.repeat(source.id==='other'?6:7)].join('\n');
const fetcher=async url=>{const s=DIRECTORY_SOURCES.find(s=>s.url===url);assert(s,'only fixture directory URLs');return new Response(file(s,s.id==='nasdaq'?nasdaq:other));};
const mention=(name,symbol,extra={})=>({name,entityType:'company',resolution:'candidate',symbols:[symbol],...extra});
async function setup(){const store=openStore(':memory:'),d=openSecurityDirectory(store,{fetcher,now:()=>at});d.refresh({requestId:'name-policy-test-0001'});await d.wait();return {store,d,async close(){await d.close();store.close();}};}

test('versioned issuer aliases resolve Salesforce and retain official name, rule and source',async()=>{
 const f=await setup();try{const basis=f.d.freezeBasis();assert.equal(basis.schema,'security-directory-basis/2');
  const next=f.d.selection('Salesforce released software.',basis),entry=next.entries.find(e=>e.symbol==='CRM.US');assert(entry.aliases.includes('Salesforce'));assert.equal(entry.nameEvidence.aliases.find(a=>a.alias==='Salesforce').rule,'terminal-legal-form');assert.equal(automaticIdentity(mention('Salesforce','CRM.US'),next.entries),'CRM.US');
  const legacy=f.d.selection('Salesforce released software.',{...basis,schema:'security-directory-basis/1'});assert.equal(legacy.entries.length,1);assert(!legacy.entries[0].aliases.includes('Salesforce'));assert(!legacy.entries[0].nameEvidence);assert.equal(automaticIdentity(mention('Salesforce','CRM.US'),legacy.entries),null);assert(!Object.hasOwn(legacy.basis,'namePolicy'));
 }finally{await f.close();}
});
test('reviewed short names require exact directory name and symbol, preserve provenance and do not match before review',async()=>{
 const f=await setup();try{
  for(const [name,symbol] of [['Cadence','CDNS.US'],['SAP','SAP.US']]){const selected=f.d.selection(name),e=selected.entries.find(e=>e.symbol===symbol);assert(e);assert(e.nameEvidence.aliases.some(a=>a.alias===name&&a.rule==='reviewed-issuer-name'));assert.equal(automaticIdentity(mention(name,symbol),selected.entries),symbol);assert.equal(f.d.selection(name,{...f.d.freezeBasis(),schema:'security-directory-basis/1'}).entries.length,0);}
  const cdns=f.d.current().entries.find(e=>e.symbol==='CDNS.US');assert.equal(directoryNameAliases(cdns,null,'fixture','2026-10-11T08:14:32.000Z').length,0);assert.equal(directoryNameAliases({...cdns,symbol:'OTHER.US'},null,'fixture',new Date(at).toISOString()).length,0);assert.equal(directoryNameAliases({...cdns,name:'Cadence Bank Common Stock'},null,'fixture',new Date(at).toISOString()).length,0);
  assert.equal(f.d.selection('NASDAQ:SAP').entries.length,0);assert.equal(f.d.selection('Cadence Bank').entries.some(e=>e.symbol==='ACME.US'),false);assert.equal(f.d.selection('Acme').entries.length,0);
 }finally{await f.close();}
});
test('ADS is a depositary candidate while preferred, ETF and test exclusions remain visible and cannot link',async()=>{
 const parsed=parseDirectoryFile(DIRECTORY_SOURCES[1],file(DIRECTORY_SOURCES[1],other));const sap=parsed.entries.find(e=>e.symbol==='SAP.US'),bad=parsed.entries.find(e=>e.symbol==='BAD.US');assert(sap.eligible);assert.equal(sap.securityType,'depositary-receipt-candidate');assert(!bad.eligible);
 const f=await setup();try{const x=f.d.selection('NYSE:BAD');assert.equal(x.entries.length,0);assert.equal(x.basis.excludedMatched,1);assert.deepEqual(x.basis.excludedMatches[0].reasons,['equity-type-unconfirmed']);assert.equal(automaticIdentityDecision(mention('Bad Company Preferred ADS','BAD.US'),x.entries,x.basis).code,'directory-excluded');}finally{await f.close();}
});
test('new diagnostics separate absent names, unresolved models, disagreement, products and multi-market ambiguity',()=>{
 const us={symbol:'ACME.US',name:'Acme Holdings, Inc.',aliases:['Acme Holdings']},hk={symbol:'00001.HK',name:'Acme Holdings',aliases:['Acme Holdings']};
 assert.equal(automaticIdentityDecision(mention('Absent','ACME.US'),[us]).code,'no-exact-name');
 assert.equal(automaticIdentityDecision(mention('Acme Holdings','ACME.US',{resolution:'unresolved',symbols:[]}),[us]).code,'model-unresolved');
 assert.equal(automaticIdentityDecision(mention('Acme Holdings','OTHER.US'),[us]).code,'candidate-disagrees');
 assert.equal(automaticIdentityDecision(mention('Acme Holdings','ACME.US',{entityType:'product'}),[us]).code,'not-confirmed-company');
 assert.equal(automaticIdentityDecision(mention('Acme Holdings','ACME.US',{eventConnection:{relation:'context'}}),[us]).code,'not-direct');
 assert.equal(automaticIdentityDecision(mention('Acme Holdings','ACME.US'),[us,hk]).code,'ambiguous');assert.equal(automaticIdentity(mention('Acme Holdings','ACME.US'),[us,hk]),null);
});
test('same short legal stem across two share classes remains ambiguous',()=>{
 const base={symbol:'CLASSA.US',name:'Synthetic Issuer Inc. - Class A Common Stock'},aliases=directoryNameAliases(base,'Synthetic Issuer Inc.','fixture',new Date(at).toISOString()).map(p=>p.alias);
 assert.deepEqual(aliases,['Synthetic Issuer']);const rows=[{...base,aliases},{symbol:'CLASSB.US',name:'Synthetic Issuer Inc. - Class B Common Stock',aliases}];assert.equal(automaticIdentity(mention('Synthetic Issuer','CLASSA.US'),rows),null);
});
test('Salesforce is automatically linked before the dossier without a new intermediate decision',async()=>{
 const quote='Salesforce 发布了新的企业软件组件。',packets=[];
 const f=fixture({fetcher,sourceReader:async url=>({url,title:'Synthetic Salesforce source',sourceName:'Fixture',scope:'extracted-text',body:quote+'仅用于自动身份测试。'.repeat(40)}),extractionRunner:p=>output(p,'decomposition',{events:[{title:'Salesforce合成软件事项',actor:'Salesforce',action:'发布',object:'企业软件组件',stage:'已发布',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一具体软件事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['实际影响']}),identityRunner:p=>output(p,'resolution',{mentions:[{...mention('Salesforce','CRM.US'),quote,quoteField:'body',reason:'合成冻结目录中的准确名称'}],scopeNote:'合成',missingEvidence:['实际影响']}),researchRunner:p=>{packets.push(p);return dossier(p);}});
 try{f.advance(4*86400000);f.service.securityDirectory.refresh({requestId:'automatic-name-policy-0001'});await f.service.securityDirectory.wait();const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!f.service.research.list().find(t=>t.eventExtraction)?.dossier);
  const t=f.service.research.list().find(t=>t.eventExtraction);assert.deepEqual(t.companies.map(c=>c.symbol),['CRM.US']);assert.equal(packets.length,1);assert.equal(packets[0].input.companies[0].symbol,'CRM.US');assert.equal(t.companies[0].identityReviewed,false);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});

test('a new name-policy basis resumes an unresolved completed identity once without rewriting old runs',async()=>{
 const quote='Salesforce 与 Fictional Partner 发布了新的企业软件组件。';
 const f=fixture({fetcher,sourceReader:async url=>({url,title:'Synthetic Salesforce source',sourceName:'Fixture',scope:'extracted-text',body:quote+'仅用于规则升级接续测试。'.repeat(40)}),extractionRunner:p=>output(p,'decomposition',{events:[{title:'Salesforce合成软件事项',actor:'Salesforce',action:'发布',object:'企业软件组件',stage:'已发布',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一具体软件事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['实际影响']}),identityRunner:p=>output(p,'resolution',{mentions:[{...mention('Salesforce','CRM.US'),quote,quoteField:'body',reason:'合成候选，自动关联仍需准确名称依据'},{...mention('Fictional Partner','',{resolution:'unresolved',symbols:[]}),quote,quoteField:'body',reason:'合成伙伴身份未知'}],scopeNote:'合成',missingEvidence:['实际影响']})});
 try{
  f.advance(4*86400000);const directory=f.service.securityDirectory;directory.refresh({requestId:'automatic-policy-upgrade-0001'});await directory.wait();const currentBasis=directory.freezeBasis;directory.freezeBasis=()=>({...currentBasis(),schema:'security-directory-basis/1'});
  f.add(1);const event=()=>f.service.research.list().find(t=>t.eventExtraction);await f.until(()=>!!event()?.dossier&&f.queue.snapshot().counts.completed>=1);assert.equal(event().companies.length,0);assert.equal(f.calls.identity,1);assert.equal(f.calls.dossier,1);
  const oldRuns=f.store.db.prepare('SELECT id,payload FROM company_entity_runs').all(),oldJobs=f.store.db.prepare('SELECT id,payload,status FROM research_pipeline_event_jobs').all(),paper=f.service.paper.snapshot();directory.freezeBasis=currentBasis;
  await f.until(()=>f.calls.dossier===2&&f.queue.snapshot().events.items.some(j=>j.kind==='dossier'&&j.identityFollowup&&j.status==='completed'));
  assert.deepEqual(event().companies.map(c=>c.symbol),['CRM.US']);assert.equal(f.calls.identity,2);
  for(const row of oldRuns)assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(row.id).payload,row.payload);
  for(const row of oldJobs)assert.deepEqual(f.store.db.prepare('SELECT id,payload,status FROM research_pipeline_event_jobs WHERE id=?').get(row.id),row);
  // A parser-version label alone is not new company evidence, even while a
  // second mention remains unresolved. Original snapshots are never replaced.
  const {snapshotHash,...nextSnapshot}=directory.current();nextSnapshot.parser='synthetic-parser-metadata-change';nextSnapshot.id=digest(nextSnapshot);
  f.store.db.prepare('INSERT INTO security_directory_snapshots VALUES(?,?)').run(nextSnapshot.id,JSON.stringify({...nextSnapshot,snapshotHash:digest(nextSnapshot)}));
  await f.drive(12);assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);
  // A genuinely different directory can be checked once. Returning afterwards
  // to an older semantic basis with another parser label cannot buy a retry.
  const appendSnapshot=(entries,parser)=>{const value={...nextSnapshot,entries,parser};value.id=digest(value);f.store.db.prepare('INSERT INTO security_directory_snapshots VALUES(?,?)').run(value.id,JSON.stringify({...value,snapshotHash:digest(value)}));};
  const crm=nextSnapshot.entries.find(e=>e.symbol==='CRM.US');
  appendSnapshot([...nextSnapshot.entries,{...crm,symbol:'FICT.US',sourceSymbol:'FICT',name:'Fictional Partner Inc. Common Stock'}],'synthetic-new-identity');
  await f.until(()=>f.calls.identity===3&&f.queue.snapshot().events.items.filter(j=>j.kind==='identity'&&j.status==='completed').length===3);
  assert.equal(f.calls.dossier,2);
  appendSnapshot(nextSnapshot.entries,'synthetic-returning-parser');
  await f.drive(12);assert.equal(f.calls.identity,3);assert.equal(f.calls.dossier,2);
  appendSnapshot(nextSnapshot.entries.map(e=>e.symbol==='CRM.US'?{...e,aliases:['salesforce']}:e),'synthetic-case-only-alias');
  await f.drive(12);assert.equal(f.calls.identity,3);assert.equal(f.calls.dossier,2);
  // Reproduce a pending row saved by the older case-sensitive scheduler.
  const previous=f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='identity' AND status='completed' ORDER BY rowid DESC LIMIT 1").get(),legacy=JSON.parse(previous.payload),request={...legacy.request,version:event().version,directoryBasis:directory.freezeBasis()},packet=companyEntitiesPacket(f.store,f.service.research,event().id,request),legacyId='synthetic-old-case-only-followup';
  const pending={...legacy,request,packet,identityFollowup:{...legacy.identityFollowup,scopeHash:identityDirectoryScope(packet),previousIdentityJobId:previous.id}};
  f.store.db.prepare('INSERT INTO research_pipeline_event_jobs VALUES(?,?,?,?,?,NULL,?)').run(legacyId,previous.item_id,previous.topic_id,'identity','queued',JSON.stringify(pending));
  await f.drive(12);const skipped=f.store.db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(legacyId);assert.equal(skipped.status,'invalidated');assert.equal(JSON.parse(skipped.payload).identityScopeUnchanged,true);assert.deepEqual(JSON.parse(skipped.payload).packet,packet);assert.equal(f.calls.identity,3);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(legacyId).n,0);
  // Retiring the duplicate must not block a later genuinely different basis.
  appendSnapshot([...nextSnapshot.entries,{...crm,symbol:'FICT2.US',sourceSymbol:'FICT2',name:'Fictional Partner Corporation Common Stock'}],'synthetic-later-new-identity');
  await f.until(()=>f.calls.identity===4&&f.queue.snapshot().events.items.filter(j=>j.kind==='identity'&&j.status==='completed').length===4);
  assert.equal(f.calls.dossier,2);assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});
