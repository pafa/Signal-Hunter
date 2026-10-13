import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';
import {DIRECTORY_SOURCES} from '../server/security-directory.mjs';
import {digest} from '../server/codex-research.mjs';
import {extractArticle} from '../server/source-reader.mjs';
import {sourceRequestAvailable} from '../server/source-links.mjs';
import {identityResearchOrigin} from '../server/system-identity-revisions.mjs';
import {documentResearchOrigin} from '../server/system-document-revisions.mjs';
import {currentDocumentResearch} from '../server/research-document-context.mjs';
const name='Arcturus Synthetic Holdings',symbol='RC65.US',quote=name+' announced an acquisition.',root='https://example.com/synthetic-1',annex='https://example.com/annex.html';
const rows=f=>f.store.db.prepare('SELECT * FROM research_pipeline_event_jobs ORDER BY rowid').all().map(r=>({...r,p:JSON.parse(r.payload)}));
const followups=f=>rows(f).filter(r=>r.p.identityFollowup&&r.p.identityFollowup.trigger!=='attachment-body');
const event=f=>f.service.research.list().find(t=>t.eventExtraction);
function make({path,attachments=false,prices=false,financial=false,identityRunner,ready=false,ambiguous=false}={}){
 let online=ready,extra=false;const requests=[],packets=[];
 const f=fixture({path,fetcher:async url=>{
  requests.push(url);const s=DIRECTORY_SOURCES.find(s=>s.url===url);
  if(s){if(!online)throw Error('Synthetic directory outage');return new Response([s.header,...(s.id==='nasdaq'?[`RC65|${name} - Common Stock|Q|N|N|100|N|N`,...(ambiguous?[`RC65B|${name} - Class B Common Stock|Q|N|N|100|N|N`]:[]),...(extra?['NEW|Unrelated Issuer - Common Stock|Q|N|N|100|N|N']:[])]:['AXP|American Express Company Common Stock|N|AXP|N|100|N|AXP']),'File Creation Time: 1007202618:01'+'|'.repeat(s.id==='other'?6:7)].join('\n'));}
  if(url.includes('eastmoney'))return Response.json({data:null});
  if(url.includes('yahoo')){const interval=new URL(url).searchParams.get('interval');return Response.json({chart:{result:[{meta:{symbol:'RC65',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval},timestamp:[Date.parse('2026-10-07T19:59Z')/1000],indicators:{quote:[{close:[101],volume:[1000]}]}}]}});}
  return new Response('Synthetic unavailable financial source',{status:403});
 },sourceReader:async url=>({url,...extractArticle(`<html><head><title>Synthetic acquisition</title></head><body><article><h1>Synthetic acquisition</h1><p>${quote.repeat(25)}${url===annex?'ANNEX-IDENTITY-EVIDENCE':''}</p>${attachments&&url===root?`<a href="${annex}">附件</a>`:''}</article></body></html>`,url)}),
 extractionRunner:p=>output(p,'decomposition',{events:p.input.material.url===root?[{title:'Synthetic acquisition',actor:name,action:'announced',object:'acquisition',stage:'announced',eventTime:'未知',quote,quoteField:'body',boundaryReason:'single synthetic event',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}]:[],scopeNote:'Synthetic process validation',missingEvidence:['Independent verification']}),
 identityRunner:p=>{packets.push(p);if(identityRunner)return identityRunner(p);const found=p.input.directory.some(c=>c.symbol===symbol);return output(p,'resolution',{mentions:[{name,quote,quoteField:'body',entityType:'company',resolution:found?'candidate':'unresolved',symbols:found?[symbol]:[],reason:'Only frozen synthetic directory evidence',...(p.input.identityAttachment?{eventConnection:{relation:'direct',anchorQuote:p.input.eventFocus.quote,reason:'Same synthetic acquisition in the attachment'}}:{})}],scopeNote:'Synthetic process validation',missingEvidence:['Listing and tradeability']});},
 researchRunner:p=>{const d=dossier(p),sourceRequests=p.input.evidence.flatMap(e=>(e.material?.sourceLinks?.links||[]).filter(l=>sourceRequestAvailable(p,e.id,l.url)).map(l=>({evidenceId:e.id,url:l.url,reason:'Read explicit attachment'}))).slice(0,3),value={...d,sourceRequests},rawOutput=JSON.stringify({...JSON.parse(d.rawOutput),sourceRequests});return {...value,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};}});
 if(!path||f.queue.snapshot().settings.directoryMarkets.length===0)f.queue.configure({...f.queue.snapshot().settings,directoryMarkets:['US'],researchPrices:prices,financialSources:financial});
 return Object.assign(f,{requests,packets,recover(){online=true;f.advance(60001);},async refreshUnrelated(){extra=true;f.service.securityDirectory.refresh({market:'US',requestId:'unrelated-directory-refresh-0001'});await f.service.securityDirectory.wait();}});
}
async function initial(f,{attachments=false}={}){f.add(1);await f.until(()=>{const t=event(f);return f.queue.snapshot().counts.completed>=1&&t?.dossier&&(!attachments||t.documentContext?.entries.every(e=>e.status==='available')&&rows(f).some(r=>r.kind==='identity'&&r.p.identityFollowup?.trigger==='attachment-body'&&r.status==='completed'))&&rows(f).filter(r=>r.kind==='dossier').every(r=>r.status==='completed');});}
const completed=f=>followups(f).some(r=>r.kind==='dossier'&&r.status==='completed');

test('directory recovery appends identity and dossier generations, retaining all previous output and using no human gate',async()=>{
 const f=make();try{await initial(f);const old=rows(f).map(r=>({id:r.id,payload:r.payload})),book=f.service.paper.snapshot(),before=event(f);assert.equal(before.companies.length,0);f.recover();await f.until(()=>completed(f));
  assert.equal(event(f).companies[0].symbol,symbol);assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);assert.equal(followups(f).length,2);assert.deepEqual(identityResearchOrigin(f.store.db,f.service.research.get(before.id)),f.service.research.historyDetail(before.id,before.version).topic);
  for(const r of old)assert.equal(rows(f).find(x=>x.id===r.id).payload,r.payload);assert.deepEqual(f.service.paper.snapshot(),book);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
  await f.refreshUnrelated();await f.drive(12);assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);
 }finally{await f.close();}
});

test('available attachments survive new identity, frozen price preparation and dossier adoption; tampered lineage is rejected',async()=>{
 const f=make({attachments:true,prices:true,financial:true});try{await initial(f,{attachments:true});const first=rows(f).find(r=>r.kind==='dossier'),before=f.service.research.get(event(f).id);f.recover();
  for(let i=0;i<8&&!completed(f);i++){await f.drive(12);f.advance(120001);}assert(completed(f),JSON.stringify(rows(f).map(r=>({kind:r.kind,status:r.status,reason:r.p.reason}))));const current=f.service.research.get(before.id);
  assert.equal(current.researchPrices.length,2);assert(current.researchPrices.every(r=>r.status==='saved'));assert.equal(current.financialSources[0].status,'unavailable');assert.equal(current.documentContext.entries[0].status,'available');assert.equal(currentDocumentResearch(f.store,f.service.research,current),true);assert(current.evidence.some(e=>e.documentRole==='linked-attachment'));assert.equal(documentResearchOrigin(f.store.db,current,first.p.adoptedVersion,first.run_id).version,first.p.adoptedVersion);
  const job=followups(f).find(r=>r.kind==='dossier'),p=structuredClone(job.p);assert.equal(p.identityFollowup.preparations.length,3);p.identityFollowup.preparations[0].hash='tampered';f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),job.id);assert.throws(()=>identityResearchOrigin(f.store.db,current));assert.equal(currentDocumentResearch(f.store,f.service.research,current),false);
 }finally{await f.close();}
});

test('ambiguous identity does not add a security or rerun a dossier, including unrelated directory refreshes',async()=>{
 const f=make({ambiguous:true});try{await initial(f);f.recover();await f.until(()=>followups(f).some(r=>r.status==='completed'));assert.equal(event(f).companies.length,0);assert.equal(f.calls.dossier,1);assert.equal(f.calls.identity,2);await f.refreshUnrelated();await f.drive(12);assert.equal(f.calls.identity,2);assert.equal(followups(f).length,1);}finally{await f.close();}
});

test('user edit, identity rejection, source revision, archive, quota and restore gate prevent automatic identity mutation',async()=>{
 for(const gate of ['edit','reject','source','archive','quota','restore']){const f=make();try{await initial(f);const t=event(f),old=rows(f).find(r=>r.kind==='identity');
  if(gate==='edit')f.service.research.update(t.id,{version:t.version,nextEvidence:'Personal edit'});
  if(gate==='archive')f.service.research.update(t.id,{version:t.version,status:'archived'});
  if(gate==='source')f.revise(1);
  if(gate==='reject')f.service.companyEntities.decide(t.id,old.run_id,{action:'reject',mentionIndex:0,version:0,topicVersion:t.version,symbol:'',note:'Personal rejection'});
  if(gate==='quota')f.queue.configure({...f.queue.snapshot().settings,dailyCalls:f.queue.snapshot().callsInLast24Hours});
  if(gate==='restore')f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();
  f.recover();if(gate==='restore')await assert.rejects(()=>f.step(),/恢复/);else await f.drive(12);assert.equal(followups(f).length,0,gate);assert.equal(f.service.research.get(t.id).companies.length,0);
 }finally{await f.close();}}
});

test('restart resumes one new identity generation; three failed calls retain the old dossier without resetting allowance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'identity-followup-')),path=join(dir,'test.sqlite');let f=make({path});
 try{await initial(f);const before=f.service.research.get(event(f).id);f.recover();await f.until(()=>followups(f).some(r=>r.status==='queued'));await f.close();f=make({path,ready:true,identityRunner:()=>{throw Error('Synthetic remote failure');}});f.advance(60001);
  for(let i=0;i<5&&!followups(f).some(r=>r.status==='completed');i++){await f.drive(8);f.advance(120001);}assert.equal(f.calls.identity,3);assert.equal(f.calls.dossier,0);assert.equal(followups(f).length,1);assert.equal(followups(f)[0].p.identityOutcome,'unavailable');assert.deepEqual(f.service.research.get(before.id),before);await f.refreshUnrelated();await f.drive(10);assert.equal(f.calls.identity,3);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('attachment withdrawal during identity refresh automatically produces an updated missing-evidence dossier',async()=>{
 const f=make({attachments:true,prices:true});try{await initial(f,{attachments:true});f.recover();await f.until(()=>followups(f).some(r=>r.kind==='identity'&&r.status==='queued'));
  const n=f.store.news().find(n=>n.url===annex);f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE news_id=?").run(n.id);
  await f.until(()=>{const t=event(f);return t?.companies.length===1&&t.documentContext?.entries.every(e=>e.status==='unread')&&t.dossier.basedOnResearchVersion===t.version;});
  assert.equal(event(f).researchPrices.length,2);assert.equal(event(f).evidence.some(e=>e.documentRole==='linked-attachment'),false);assert(followups(f).some(r=>r.kind==='dossier'&&r.status==='observing'&&r.p.documentScopeChanged));assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(event(f).id)),true);
 }finally{await f.close();}
});

test('a rejection arriving after the new generation was queued still wins',async()=>{
 const f=make();try{await initial(f);f.recover();await f.until(()=>followups(f).some(r=>r.status==='queued'));const t=event(f),old=rows(f).find(r=>r.kind==='identity');f.service.companyEntities.decide(t.id,old.run_id,{action:'reject',mentionIndex:0,version:0,topicVersion:t.version,symbol:'',note:'Personal rejection after scheduling'});await f.drive(12);assert.equal(f.calls.identity,1);assert.equal(followups(f)[0].status,'invalidated');assert.equal(event(f).companies.length,0);}finally{await f.close();}
});

test('legacy one-identity index upgrades without rewriting old jobs and permits recovery after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'identity-migration-')),path=join(dir,'test.sqlite');let f=make({path});
 try{await initial(f);const before=rows(f);f.store.db.exec("DROP INDEX pipeline_identity_generation; CREATE UNIQUE INDEX pipeline_identity_child ON research_pipeline_event_jobs(topic_id) WHERE kind='identity';");await f.close();f=make({path});assert.deepEqual(rows(f),before);assert.equal(f.store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='pipeline_identity_child'").get().n,0);f.recover();await f.until(()=>completed(f));assert.equal(followups(f).length,2);}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed dossier insertion preserves attachments after durable identity linking and resumes without another identity call',async()=>{
 const f=make({attachments:true});try{await initial(f,{attachments:true});f.store.db.exec("CREATE TRIGGER reject_identity_dossier BEFORE INSERT ON research_pipeline_event_jobs WHEN NEW.kind='dossier' AND json_type(NEW.payload,'$.identityFollowup')='object' BEGIN SELECT RAISE(ABORT,'Synthetic insertion failure'); END;");f.recover();let failed=false;
  for(let i=0;i<20;i++){const r=await f.step();if(r.error){failed=true;break;}}assert(failed);assert.equal(event(f).companies.length,1);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(event(f).id)),true);assert.equal(f.calls.identity,3);
  f.store.db.exec('DROP TRIGGER reject_identity_dossier');await f.until(()=>completed(f));assert.equal(f.calls.identity,3);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(event(f).id)),true);
 }finally{await f.close();}
});
