import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,quote,dossier,extraction,output,comparison} from './automatic-research-fixture.mjs';
import {extractArticle} from '../server/source-reader.mjs';
import {sourceRequestAvailable,validateSourceRequests} from '../server/source-links.mjs';
import {digest} from '../server/codex-research.mjs';
import {currentDocumentResearch,linkedDocumentContext} from '../server/research-document-context.mjs';
import {documentResearchOrigin} from '../server/system-document-revisions.mjs';
const root='https://example.com/synthetic-1',annex=i=>`https://example.com/annex-${i}.html`;
const parsed=(f,table,where='1')=>f.store.db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all().map(r=>({...r,p:JSON.parse(r.payload)}));
const followups=f=>parsed(f,'research_pipeline_event_jobs',"kind='dossier' AND json_type(payload,'$.documentFollowup')='object'");
const primary=f=>f.service.research.list().find(t=>t.origin==='material-event-system');
function make({count=4,researchRunner,...options}={}){
 const requests=[],packets=[];
 const normal=p=>{packets.push(p);const d=dossier(p),selected=p.input.evidence.flatMap(e=>(e.material?.sourceLinks?.links||[]).filter(l=>sourceRequestAvailable(p,e.id,l.url)).map(l=>({evidenceId:e.id,url:l.url,reason:'读取明确附件以核查本事项'}))).slice(0,3),markers=p.input.evidence.flatMap(e=>e.material?.body.match(/ANNEX-SIGNAL-\d+/g)||[]);
  const v={sections:d.sections.map(s=>s.id==='facts'?{...s,paragraphs:[('实际提供的附件标识 '+[...new Set(markers)].join(',')).trim()],sourceIds:p.input.evidence.filter(e=>e.material?.body.includes('ANNEX-SIGNAL-')).map(e=>e.id)}:s),missingEvidence:d.missingEvidence,sourceRequests:selected},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};};
 const f=fixture({...options,semanticRunner:p=>comparison(p,'uncertain'),extractionRunner:p=>p.input.material.url===root?extraction(p):output(p,'decomposition',{events:[],scopeNote:'附件不制造另一个独立事项',missingEvidence:['与父通知合读']}),sourceReader:async url=>{requests.push(url);const links=url===root?Array.from({length:count},(_,i)=>`<p><a href="${annex(i+1)}">附件${i+1}</a></p>`).join(''):'';return {url,...extractArticle(`<html><head><title>合成事项</title></head><body><article><h1>合成事项</h1><p>${quote.repeat(25)}${url===root?'':'ANNEX-SIGNAL-'+url.match(/annex-(\d+)/)[1]}</p>${links}</article></body></html>`,url)};},researchRunner:p=>researchRunner?researchRunner(p,normal):normal(p)});
 return Object.assign(f,{requests,packets});
}
async function settled(f,count=4){await f.until(()=>{const t=primary(f);return t?.documentContext?.entries.filter(e=>e.status==='available').length===count&&t.dossier.basedOnResearchVersion===t.version&&followups(f).every(r=>r.status==='completed'||r.status==='observing'&&r.p.documentScopeChanged);});}

test('a standalone event reanalyses actual attachments and requests the fourth without a cluster or intermediate decision',async()=>{
 const f=make();try{const book=f.service.paper.snapshot();f.add(1);await settled(f);const t=primary(f),jobs=followups(f),first=parsed(f,'research_pipeline_event_jobs',"kind='dossier'")[0],original=f.service.research.historyDetail(t.id,first.p.adoptedVersion).topic;
 assert.equal(f.service.eventClusters.list().items.length,0);assert.equal(t.documentContext.entries.length,4);assert(t.dossier.sections[0].paragraphs[0].includes('ANNEX-SIGNAL-4'));assert.equal(t.evidence.filter(e=>e.documentRole==='linked-attachment').length,4);assert(jobs.length>=1);assert.equal(f.packets[0].input.documentContext,undefined);assert.equal(f.packets[1].input.documentContext.schema,'document-research/1');
 assert.equal(f.requests.length,5);assert.equal(new Set(f.requests).size,5);assert(f.packets.some(p=>p.input.documentContext?.entries.some(e=>e.url===annex(4)&&!e.requested&&e.status==='unread')));assert.equal(t.dossier.sourceRequests.length,0);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(t.id)),true);
 assert.deepEqual(documentResearchOrigin(f.store.db,f.service.research.get(t.id),original.version,first.run_id),original);assert.equal(original.documentContext,undefined);assert.equal(original.evidence.length,1);assert.deepEqual(f.service.paper.snapshot(),book);
 const version=t.version,calls=f.calls.dossier;await f.drive(12);assert.equal(primary(f).version,version);assert.equal(f.calls.dossier,calls);assert.equal(f.requests.length,5);assert(f.queue.snapshot().evidence.items.filter(p=>p.policy==='linked-public-source/2').every(p=>p.status!=='invalidated'));
 }finally{await f.close();}
});

test('user edit between document preparation and inference wins and stops the old pending generation',async()=>{
 const f=make({count:1});try{f.add(1);await f.until(()=>followups(f).some(r=>r.status==='queued'));const t=primary(f),beforeCalls=f.calls.dossier,job=followups(f)[0];f.service.research.update(t.id,{version:t.version,nextEvidence:'本人编辑必须保留'});await f.drive(15);assert.equal(primary(f).nextEvidence,'本人编辑必须保留');assert.equal(f.calls.dossier,beforeCalls);assert.equal(followups(f).find(r=>r.id===job.id).status,'invalidated');assert.throws(()=>documentResearchOrigin(f.store.db,primary(f),job.p.documentFollowup.baseVersion,job.p.documentFollowup.baseRunId));
 }finally{await f.close();}
});

test('available attachments are prepared before a saved synthesis turn without consuming another model call',async()=>{
 const f=make({count:1});try{f.add(1);await f.until(()=>{const topic=primary(f);return topic?.dossier&&linkedDocumentContext(f.store,f.service.research,[{topic,packet:f.service.research.packet(topic.id)}])?.documents.length===1;});assert.equal(primary(f).documentContext,undefined);const calls={...f.calls},synthesis=f.synthesisCalls;
 f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('research_pipeline_next_lane','synthesis')").run();const step=await f.step();assert.equal(followups(f).length,1,JSON.stringify({step,items:parsed(f,'research_pipeline_items').map(x=>({id:x.id,status:x.status})),jobs:parsed(f,'research_pipeline_event_jobs').map(x=>({kind:x.kind,status:x.status,prep:x.p.documentPreparation}))}));assert.equal(followups(f)[0].status,'queued');assert.equal(primary(f).documentContext.entries[0].status,'available');assert.deepEqual(f.calls,calls);assert.equal(f.synthesisCalls,synthesis);assert.equal(f.store.db.prepare("SELECT value FROM settings WHERE key='research_pipeline_next_lane'").get().value,'synthesis');
 }finally{await f.close();}
});

test('cancelled document inference is retained and is not automatically restarted',async()=>{
 let release,started;const began=new Promise(r=>started=r);const f=make({count:1,researchRunner:async(p,normal)=>{if(!p.input.documentContext)return normal(p);started();return new Promise(r=>release=()=>r(normal(p)));}});
 try{f.add(1);await f.until(()=>followups(f).some(r=>r.status==='queued'));const tick=(async()=>{for(let i=0;i<100&&!release;i++)await f.step();})();await began;const row=followups(f).find(r=>r.status==='running');f.service.modelResearch.cancel(row.topic_id,row.run_id);release();await tick;await f.drive(10);assert.equal(followups(f)[0].status,'cancelled');assert.equal(followups(f).length,1);assert.equal(f.calls.dossier,2);assert.notEqual(primary(f).dossier.basedOnResearchVersion,primary(f).version);
 }finally{release?.();await f.close();}
});

test('failed document inference resumes after restart with shared retry policy and immutable old judgment',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'document-followup-')),path=join(dir,'research.sqlite');let failed=false,f=make({path,count:1,researchRunner:(p,normal)=>{if(p.input.documentContext&&!failed){failed=true;throw Error('synthetic transient');}return normal(p);}});
 try{f.add(1);await f.until(()=>followups(f).some(r=>r.status==='queued'&&r.p.previousRunId));const old=followups(f)[0],versions=parsed(f,'research_versions').map(r=>r.payload);assert.equal(old.p.retryAt,Date.parse('2026-10-08T00:01:00Z'));await f.close();f=make({path,count:1});f.advance(60001);await settled(f,1);assert.equal(followups(f).length,1);assert.equal(followups(f)[0].status,'completed');assert.equal(f.requests.length,0);for(const payload of versions)assert(parsed(f,'research_versions').some(r=>r.payload===payload));assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(old.id).n,2);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('withdrawn attachment stops current conclusions and creates a missing-evidence judgment without rereading cancelled input',async()=>{
 const f=make({count:1});try{f.add(1);await settled(f,1);const before=f.service.research.get(primary(f).id),old=JSON.stringify(f.service.research.historyDetail(before.id,before.version).topic);const n=f.store.news().find(n=>n.url===annex(1));f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE news_id=?").run(n.id);
 assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(before.id)),false);await f.until(()=>{const t=primary(f);return t.version>before.version&&t.documentContext.entries.every(e=>e.status==='unread')&&t.dossier.basedOnResearchVersion===t.version;});const t=primary(f);assert.equal(t.evidence.some(e=>e.url===annex(1)),false);assert.equal(t.dossier.sourceRequests.length,0);assert.equal(f.requests.length,2);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(t.id)),true);assert.equal(JSON.stringify(f.service.research.historyDetail(before.id,before.version).topic),old);
 }finally{await f.close();}
});

test('document preparation and queue insertion roll back together, with bounded backoff for storage failures',async()=>{
 const f=make({count:1});try{f.store.db.exec("CREATE TRIGGER reject_document_job BEFORE INSERT ON research_pipeline_event_jobs WHEN json_type(NEW.payload,'$.documentFollowup')='object' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");f.add(1);await f.until(()=>parsed(f,'research_pipeline_event_jobs',"kind='dossier'").some(r=>r.p.documentPreparation));let r=parsed(f,'research_pipeline_event_jobs',"kind='dossier'")[0],t=primary(f);assert.equal(t.version,r.p.adoptedVersion);assert.equal(t.documentContext,undefined);assert.equal(followups(f).length,0);assert.equal(r.p.documentPreparation.attempts,1);await f.drive(5);assert.equal(parsed(f,'research_pipeline_event_jobs',"kind='dossier'")[0].p.documentPreparation.attempts,1);f.advance(60001);await f.drive(5);f.advance(120001);await f.drive(5);r=parsed(f,'research_pipeline_event_jobs',"kind='dossier'")[0];assert.equal(r.p.documentPreparation.attempts,3);assert.equal(primary(f).version,t.version);const calls=f.calls.dossier;await f.drive(10);assert.equal(f.calls.dossier,calls);assert.equal(followups(f).length,0);
 }finally{await f.close();}
});

test('current requests cannot repeat provided or previously requested links; immutable legacy packets keep their contract',()=>{
 const link={url:annex(1),label:'附件',context:'附件'},evidence=[{id:'m',material:{sourceLinks:{schema:'article-source-links/4',scope:'extracted-html-links',links:[link],inspected:1,omitted:0,truncated:false}}}],request=[{evidenceId:'m',url:annex(1),reason:'test'}],legacy={input:{evidence}};assert.deepEqual(validateSourceRequests(request,legacy),request);for(const status of ['available','unread']){const packet={input:{evidence,documentContext:{entries:[{parentEvidenceId:'m',url:annex(1),status,requested:status==='unread'}]}}};assert.throws(()=>validateSourceRequests(request,packet));}
});

test('shared quota and restore review prevent new document preparation and model calls',async()=>{
 for(const gate of ['quota','restore']){const f=make({count:1});try{f.add(1);await f.until(()=>{const t=primary(f);return t?.dossier&&f.requests.includes(annex(1));});const version=primary(f).version,calls=f.calls.dossier;
  if(gate==='quota'){const s=f.queue.snapshot();f.queue.configure({version:s.settings.version,dailyCalls:s.callsInLast24Hours,includeClues:false});}else f.store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();
  if(gate==='restore')await assert.rejects(()=>f.step(),/恢复/);else await f.drive(6);assert.equal(primary(f).version,version);assert.equal(followups(f).length,0);assert.equal(f.calls.dossier,calls);
 }finally{await f.close();}}
});

test('forged document generation provenance cannot keep a past source request current',async()=>{
 const f=make({count:1});try{f.add(1);await settled(f,1);const row=followups(f)[0],p=row.p,initial=parsed(f,'research_pipeline_event_jobs',"kind='dossier'")[0];p.documentFollowup.sourceJobId='forged-parent';f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);assert.throws(()=>documentResearchOrigin(f.store.db,f.service.research.get(primary(f).id),initial.p.adoptedVersion,initial.run_id));assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(primary(f).id)),false);
 }finally{await f.close();}
});

test('legacy one-dossier index upgrades on restart without changing old research or preventing later generations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'document-upgrade-')),path=join(dir,'research.sqlite');let f=make({path,count:1});try{f.add(1);await f.until(()=>!!primary(f)?.dossier);const before=parsed(f,'research_versions').map(r=>r.payload);f.store.db.exec("DROP INDEX pipeline_event_generation; CREATE UNIQUE INDEX pipeline_event_child ON research_pipeline_event_jobs(topic_id) WHERE kind='dossier';");await f.close();f=make({path,count:1});assert(!f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='pipeline_event_child'").get());assert(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='pipeline_event_generation'").get());for(const p of before)assert(parsed(f,'research_versions').some(r=>r.payload===p));await settled(f,1);assert(followups(f).length>0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('attachment change while a document generation is queued replaces the stale input automatically, without adopting it',async()=>{
 const f=make({count:1});try{f.add(1);await f.until(()=>followups(f).some(r=>r.status==='queued'));const old=followups(f)[0],n=f.store.news().find(n=>n.url===annex(1));f.store.db.prepare("UPDATE research_pipeline_items SET status='cancelled' WHERE news_id=?").run(n.id);await f.until(()=>{const t=primary(f);return followups(f).length===2&&t.dossier.basedOnResearchVersion===t.version;});const jobs=followups(f);assert.equal(jobs[0].id,old.id);assert.equal(jobs[0].status,'observing');assert.equal(jobs[0].run_id,null);assert.equal(jobs[1].status,'completed');assert.equal(primary(f).documentContext.entries[0].status,'unread');assert.equal(primary(f).evidence.length,1);assert.equal(f.requests.length,2);assert.equal(f.calls.dossier,2);assert.equal(currentDocumentResearch(f.store,f.service.research,f.service.research.get(primary(f).id)),true);
 }finally{await f.close();}
});
