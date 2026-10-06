import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {companyDirectoryTime} from '../server/company-directory-time.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {companyEntitiesPacket,companyEntitiesPrompt} from '../server/company-entities.mjs';
import {digest} from '../server/codex-research.mjs';
import {COMPANY_DIRECTORY} from '../shared/company-directory.mjs';
import {workbook,szRows,szMeta,shResponse} from './helpers/directory-workbooks.mjs';
const at='2026-10-04T12:00:00Z',modelConfig={binary:'/synthetic/codex',model:'synthetic',timeoutMs:1000};
const cnIdentity={symbol:'002594.SZ',reportedListingDate:'2011-06-30',directoryReceivedAt:at};
const material={publishedAt:'2011-06-29',datePrecision:'day',availableAt:'2026-10-03T12:00:00Z'};
test('historical publication days are compared without inventing a timezone or proving historical listing',()=>{
 const before=companyDirectoryTime(cnIdentity,material);assert.equal(before.assessment.listingDateRelation,'before');assert.equal(before.assessment.comparisonTimezone,null);assert.equal(before.assessment.directoryAvailability,'observed-after-material-receipt');assert.equal(before.assessment.historicalIssuerValidity,'unverified');assert.equal(before.assessment.historicalTradingEligibility,'unverified');assert.match(before.note,/时区未核对/);assert.match(before.note,/事后主体研究/);
 for(const [value,relation] of [['2011-06-30','same-day'],['2011-07-01','after']]){const a=companyDirectoryTime(cnIdentity,{...material,publishedAt:value}).assessment;assert.equal(a.listingDateRelation,relation);assert.equal(a.historicalTradingEligibility,'unverified');}
});
test('publication instants use each market date across midnight and US daylight saving, not UTC or text prefix',()=>{
 for(const [symbol,publication,listing,expected,zone] of [
  ['002594.SZ','2011-06-29T16:30:00Z','2011-06-30','same-day','Asia/Shanghai'],
  ['01211.HK','2011-06-29T16:30:00Z','2011-06-30','same-day','Asia/Hong_Kong'],
  ['ACME.US','2026-07-02T03:30:00Z','2026-07-02','before','America/New_York'],
  ['ACME.US','2026-01-02T04:30:00Z','2026-01-02','before','America/New_York'],
  ['ACME.US','2026-07-02T00:30:00-04:00','2026-07-02','same-day','America/New_York']]){
  const a=companyDirectoryTime({...cnIdentity,symbol,reportedListingDate:listing},{...material,publishedAt:publication,datePrecision:'instant'}).assessment;assert.equal(a.listingDateRelation,expected,publication);assert.equal(a.comparisonTimezone,zone);assert.equal(a.historicalIssuerValidity,'unverified');
 }
});
test('unknown, inconsistent and invalid date evidence never defaults to now, UTC or material receipt',()=>{
 for(const value of [{publishedAt:null,datePrecision:'unknown'},{publishedAt:'2026-02-30',datePrecision:'day'},{publishedAt:'2011-06-29',datePrecision:'instant'},{publishedAt:'2011-06-29T12:00:00',datePrecision:'instant'},{publishedAt:'2011-06-29T24:00:00Z',datePrecision:'instant'},{publishedAt:'2011-06-29T12:00:00Z',datePrecision:'day'},{publishedAt:'2011-06-29',datePrecision:'unknown'}]){
  const a=companyDirectoryTime(cnIdentity,{...material,...value}).assessment;assert.equal(a.listingDateRelation,'unknown');assert.equal(a.materialPublishedAt,null);assert.equal(a.comparisonDate,null);
 }
 for(const listing of [null,'2026-02-30','2011-06-30T00:00:00Z'])assert.equal(companyDirectoryTime({...cnIdentity,reportedListingDate:listing},material).assessment.listingDateRelation,'unknown');
 assert.equal(companyDirectoryTime({...cnIdentity,symbol:'UNSUPPORTED'}, {...material,publishedAt:'2011-06-29T12:00:00Z',datePrecision:'instant'}).assessment.listingDateRelation,'unknown');
 assert.equal(companyDirectoryTime({...cnIdentity,directoryReceivedAt:null},material).assessment.directoryAvailability,'unknown');
 assert.equal(companyDirectoryTime(cnIdentity,{...material,availableAt:'2026-10-04'}).assessment.directoryAvailability,'unknown');
});
test('directory availability uses exact frozen observation and material receipt, not source generation day or publication time',()=>{
 const source={...cnIdentity,directoryReceivedAt:'2026-10-03T08:00:00+08:00'};
 const before=companyDirectoryTime(source,{...material,availableAt:'2026-10-03T00:00:00Z'}).assessment;assert.equal(before.directoryAvailability,'observed-by-material-receipt');assert.equal(before.materialPublishedAt,'2011-06-29');
 const after=companyDirectoryTime(source,{...material,availableAt:'2026-10-02T23:59:59.999Z'}).assessment;assert.equal(after.directoryAvailability,'observed-after-material-receipt');
});
async function fixture(path=':memory:'){
 const store=openStore(path),fetcher=async url=>{
  if(url.includes('query.sse')){const u=new URL(url);return Response.json(shResponse(u.searchParams.get('STOCK_TYPE'),Number(u.searchParams.get('pageHelp.pageNo'))));}
  if(url.includes('SHOWTYPE=JSON'))return Response.json(szMeta());
  if(url.includes('SHOWTYPE=xlsx'))return new Response(workbook(szRows(),{name:'A股列表'}));
  throw Error('Unexpected network target');
 },service=createService(store,{mode:'research',modelConfig,now:()=>Date.parse(at),fetcher,companyEntityRunner:async p=>{
  const resolution={mentions:[{name:'比亚迪',quote:'比亚迪讨论业务。',quoteField:'body',entityType:'company',resolution:'candidate',symbols:['002594.SZ'],reason:'Synthetic identity candidate; historical validity unverified'}],scopeNote:'Synthetic',missingEvidence:['Historical legal issuer']},rawOutput=JSON.stringify(resolution);
  return {status:'candidate',reviewStatus:'unreviewed',resolution,rawOutput,trace:{model:modelConfig.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};
 }});
 service.securityDirectory.refresh({market:'CN',requestId:'temporal-directory-cn-0001'});await service.securityDirectory.wait();assert.equal(service.securityDirectory.status({market:'CN'}).attempts[0].status,'complete');
 const r=service.research;let t=r.create({title:'Historical synthetic identity',summary:'No trades'});t=r.saveMaterial(t.id,{version:t.version,title:'Historical synthetic material',sourceName:'Synthetic',url:'https://example.test/historical',body:'比亚迪讨论业务。',publishedAt:'2011-06-29',scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'Research only'});
 const m=r.materialList(t.id).materials[0],request={version:t.version,materialId:m.id,revision:m.revision};return {store,service,r,t,m,request,async close(){await service.close();store.close();}};
}
test('model packet freezes per-security temporal evidence and preserves before-listing companies as research candidates',async()=>{
 const f=await fixture();try{
  const p=companyEntitiesPacket(f.store,f.r,f.t.id,f.request),c=p.input.directory.find(c=>c.symbol==='002594.SZ');assert.equal(c.temporalAssessment.listingDateRelation,'before');assert.equal(c.temporalAssessment.reportedListingDate,'2011-06-30');assert.equal(c.temporalAssessment.historicalTradingEligibility,'unverified');assert.match(c.identityBasis,/早于目录报告上市日/);assert.equal(p.schema,'company-entities-2');assert.equal(p.input.directoryTimeVersion,'company-directory-time-1');assert.equal(p.inputHash,digest(p.input));assert.match(companyEntitiesPrompt(p),/temporalAssessment/);
  const hk=p.input.directory.find(c=>c.symbol==='01211.HK');assert.equal(hk.temporalAssessment.listingDateRelation,'unknown');assert.equal(hk.temporalAssessment.directoryAvailability,'unknown');
  const before=f.service.securityDirectory.current('CN');assert.equal(before.entries.find(e=>e.symbol==='002594.SZ').temporalAssessment,undefined);assert.equal(f.service.securityDirectory.search({market:'CN',q:'比亚迪'}).items[0].temporalAssessment,undefined);
 }finally{await f.close();}
});
test('a confirmed identity retains frozen temporal evidence and original material/directory rows across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'directory-time-restart-')),path=join(dir,'test.sqlite'),f=await fixture(path);try{
  const protectedRows=()=>JSON.stringify(['research_materials','security_directory_snapshots'].map(table=>f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),baseline=protectedRows();
  const a=f.service.companyEntities.start(f.t.id,{...f.request,requestId:'temporal-identity-run-0001'});await f.service.companyEntities.wait(a.id);
  f.service.companyEntities.decide(f.t.id,a.id,{mentionIndex:0,version:0,action:'link',symbol:'002594.SZ',note:'Synthetic present-day identity; history unverified',topicVersion:f.t.version});
  const c=f.r.get(f.t.id).companies[0];assert.equal(c.entityResolution.identity.temporalAssessment.listingDateRelation,'before');assert.equal(protectedRows(),baseline);const saved=f.service.companyEntities.get(f.t.id,a.id),history=f.r.history(f.t.id);
  await f.close();const store=openStore(path),service=createService(store,{mode:'research',now:()=>Date.parse(at)});try{assert.deepEqual(service.companyEntities.get(f.t.id,a.id),saved);assert.deepEqual(service.research.history(f.t.id),history);assert.deepEqual(service.research.get(f.t.id).companies[0].entityResolution.identity.temporalAssessment,c.entityResolution.identity.temporalAssessment);}finally{await service.close();store.close();}
 }finally{await f.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
test('legacy identity candidates remain readable and unmodified but cannot be newly linked under the changed time contract',async()=>{
 const f=await fixture();try{
  const a=f.service.companyEntities.start(f.t.id,{...f.request,requestId:'temporal-legacy-run-0001'});await f.service.companyEntities.wait(a.id);
  const row=f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(a.id),old=JSON.parse(row.payload);old.packet.schema='company-entities-1';delete old.packet.input.directoryTimeVersion;
  for(const c of old.packet.input.directory){delete c.temporalAssessment;c.identityBasis=c.directorySnapshotId?f.service.securityDirectory.search({market:'CN',q:c.symbol}).items.find(i=>i.symbol===c.symbol).identityBasis:COMPANY_DIRECTORY.find(i=>i.symbol===c.symbol).identityBasis;}
  old.packet.inputHash=digest(old.packet.input);old.candidate.trace.inputHash=old.packet.inputHash;
  const frozen=JSON.stringify(old);f.store.db.prepare('UPDATE company_entity_runs SET payload=? WHERE id=?').run(frozen,a.id);
  const readable=f.service.companyEntities.get(f.t.id,a.id);assert.equal(readable.status,'candidate');assert.equal(readable.stale,true);assert.deepEqual(readable.packet,old.packet);assert.deepEqual(readable.candidate,old.candidate);
  assert.throws(()=>f.service.companyEntities.decide(f.t.id,a.id,{mentionIndex:0,version:0,action:'link',symbol:'002594.SZ',note:'Reject outdated time assessment',topicVersion:f.t.version}),/已变化/);
  assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(a.id).payload,frozen);assert.equal(f.r.get(f.t.id).companies.length,0);
  f.service.companyEntities.decide(f.t.id,a.id,{mentionIndex:0,version:0,action:'reject',symbol:'',note:'Keep old result but exclude from new research',topicVersion:f.t.version});assert.equal(f.service.companyEntities.get(f.t.id,a.id).reviews[0][0].action,'reject');assert.equal(f.store.db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(a.id).payload,frozen);
 }finally{await f.close();}
});
