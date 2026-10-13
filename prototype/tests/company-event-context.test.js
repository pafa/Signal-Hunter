import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_IDENTITY_CONTEXT_VERSION,CONTEXT_ENTITIES_VERSION,eventIdentityContext} from '../server/company-event-context.mjs';
import {companyEntitiesPacket,companyEntitiesPrompt,companyEntitiesSchema,validateCompanyEntities} from '../server/company-entities.mjs';
import {automaticIdentityDecision} from '../server/pipeline-event-automation.mjs';
import {digest} from '../server/codex-research.mjs';
import {fixture,output,config} from './automatic-research-fixture.mjs';
const quote='We are introducing an open stack for isolation and monitoring.',lead='NVIDIA announced a synthetic secure runtime. ',paragraph=lead+quote;
const body='Microsoft describes an unrelated historic project.\n\n'+paragraph+'\n\n'+('Unrelated synthetic context, not investment evidence. '.repeat(25));
const event={title:'Synthetic NVIDIA announcement',actor:'NVIDIA',action:'announces',object:'open stack',stage:'announced',eventTime:'未知',quote,quoteField:'body',boundaryReason:'Single synthetic announcement',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'};
const resolution=p=>({mentions:p.input.identityEventContext?[{name:'NVIDIA',quote:lead.trim(),quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'Synthetic same-paragraph subject',eventConnection:{relation:'direct',anchorQuote:quote,reason:'Synthetic sentence names actor of this same announcement'}}]:[],scopeNote:'Synthetic contextual identity check',missingEvidence:['Independent legal and business validation']});
const jobs=f=>f.store.db.prepare('SELECT * FROM research_pipeline_event_jobs ORDER BY rowid').all();
const topic=f=>f.service.research.list().find(t=>t.eventExtraction);
function make(){return fixture({sourceReader:async url=>({url,title:'Synthetic announcement',sourceName:'Synthetic',body,scope:'extracted-text'}),extractionRunner:p=>output(p,'decomposition',{events:[event],scopeNote:'Synthetic',missingEvidence:[]}),identityRunner:p=>output(p,'resolution',resolution(p))});}
async function legacy(f){
 f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='identity'&&j.status==='queued'));
 const row=jobs(f).find(j=>j.kind==='identity'),p=JSON.parse(row.payload);delete p.request.identityContextVersion;p.packet=companyEntitiesPacket(f.store,f.service.research,row.topic_id,p.request);
 const configHash=digest({model:config.model,binary:config.binary,effort:'high',timeoutMs:config.timeoutMs});
 p.executionHash=digest({kind:'identity',packet:p.packet,prompt:companyEntitiesPrompt(p.packet),schema:companyEntitiesSchema(p.packet),configHash});
 f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);
 f.queue.configure({...f.queue.snapshot().settings,dailyCalls:100});
 await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='completed'));
 assert.equal(f.calls.identity,1);assert.equal(topic(f).companies.length,0);
 return jobs(f).map(j=>({id:j.id,payload:j.payload}));
}

test('event identity paragraph is literal, unique, bounded, and cannot borrow another paragraph or an already explicit actor',()=>{
 const material={body};const c=eventIdentityContext(material,event);assert.equal(c.quote,paragraph);assert.equal(body.slice(c.start,c.end),paragraph);
 for(const [m,e] of [[{body:lead+'\n\n'+quote},event],[{body:paragraph+'\n\n'+paragraph},event],[{body:lead+'x'.repeat(2400)+quote},event],[material,{...event,quote:paragraph}],[material,{...event,quoteField:'title'}],[material,{...event,actor:'未知'}],[material,{...event,actor:'Microsoft'}]])assert.equal(eventIdentityContext(m,e),null);
 assert.equal(eventIdentityContext({body:'X\r\n\r\n'+paragraph+'\r\n\r\nY'},event).quote,paragraph);
});

test('automatic same-paragraph identity links a company with provenance without changing the event or account',async()=>{
 const f=make();try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='completed'));
 const t=topic(f);assert.deepEqual(t.companies.map(c=>c.symbol),['NVDA.US']);assert.equal(t.eventExtraction.event.quote,quote);assert.equal(t.companies[0].entityResolution.eventIdentityContext.quote,paragraph);assert.equal(t.companies[0].relationStatus,'pending');assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.calls.identity,1);assert.equal(f.calls.dossier,1);
 }finally{await f.close();}
});

test('contextual quotes require direct event relations; old requests and unrelated references stay constrained',async()=>{
 const f=make();try{f.queue.configure({...f.queue.snapshot().settings,dailyCalls:1});f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='identity'&&j.status==='queued'));const row=jobs(f).find(j=>j.kind==='identity'),p=JSON.parse(row.payload).packet;
 assert.equal(p.schema,CONTEXT_ENTITIES_VERSION);const out=resolution(p);assert.deepEqual(validateCompanyEntities(out,p),out);
 for(const mutate of [o=>o.mentions[0].eventConnection.anchorQuote='invented',o=>o.mentions[0].quote='Microsoft describes an unrelated historic project.',o=>delete o.mentions[0].eventConnection]){const o=structuredClone(out);mutate(o);assert.throws(()=>validateCompanyEntities(o,p));}
 const corrupt=structuredClone(p);corrupt.input.identityEventContext.quote+=' fabricated';assert.throws(()=>validateCompanyEntities(out,corrupt));
 const contextOnly=structuredClone(out);contextOnly.mentions[0].eventConnection.relation='context';assert.equal(validateCompanyEntities(contextOnly,p).mentions.length,1);assert.equal(automaticIdentityDecision(contextOnly.mentions[0],p.input.directory).symbol,null);
 const request=JSON.parse(row.payload).request;delete request.identityContextVersion;const old=companyEntitiesPacket(f.store,f.service.research,row.topic_id,request);assert.equal(old.schema,'company-entities-3');assert.equal(old.input.identityEventContext,undefined);const mention=structuredClone(out.mentions[0]);delete mention.eventConnection;assert.throws(()=>validateCompanyEntities({...out,mentions:[mention]},old));
 }finally{await f.close();}
});

test('an old unresolved quote receives one context followup, preserving old inputs and calls without a directory refresh',async()=>{
 const f=make();try{const old=await legacy(f),paper=f.service.paper.snapshot(),oldRuns=f.store.db.prepare('SELECT * FROM company_entity_runs').all();
 await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='completed'&&JSON.parse(j.payload).identityFollowup));assert.equal(topic(f).companies[0].symbol,'NVDA.US');assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);
 for(const j of old)assert.equal(jobs(f).find(x=>x.id===j.id).payload,j.payload);for(const r of oldRuns)assert.deepEqual({...f.store.db.prepare('SELECT * FROM company_entity_runs WHERE id=?').get(r.id)},{...r});
 await f.drive(15);assert.equal(f.calls.identity,2);assert.equal(f.calls.dossier,2);assert.deepEqual(f.service.paper.snapshot(),paper);
 }finally{await f.close();}
});

test('a personal edit still stops automatic contextual recovery of old research',async()=>{
 const f=make();try{await legacy(f);const t=topic(f);f.service.research.update(t.id,{version:t.version,nextEvidence:'Personal judgement must be preserved'});await f.drive(15);assert.equal(f.calls.identity,1);assert.equal(topic(f).companies.length,0);assert.equal(topic(f).nextEvidence,'Personal judgement must be preserved');}finally{await f.close();}
});
