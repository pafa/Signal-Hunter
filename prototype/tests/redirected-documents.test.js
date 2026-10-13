import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,quote,dossier,extraction,output,comparison} from './automatic-research-fixture.mjs';
import {readPublicArticle} from '../server/source-reader.mjs';
import {digest} from '../server/codex-research.mjs';
import {linkedDocumentContext,currentDocumentResearch} from '../server/research-document-context.mjs';
const root='https://example.com/synthetic-1',requested='https://example.com/annex.html',final='https://files.acme.com/published-annex.html';
const context=f=>{const t=f.service.research.list().find(t=>t.origin==='material-event-system');return t&&linkedDocumentContext(f.store,f.service.research,[{topic:t,packet:f.service.research.packet(t.id)}]);};
const primary=f=>f.service.research.list().find(t=>t.origin==='material-event-system');
function make(){
 const reads=[];
 const f=fixture({sourceReader:url=>readPublicArticle(url,{resolver:async()=>[{address:'93.184.216.34'}],request:async u=>{reads.push(u.href);return u.href===requested?{status:308,headers:{location:final}}:{status:200,headers:{},body:`<html><head><title>合成公开附件</title></head><body><article><h1>合成公开附件</h1><p>${quote.repeat(25)}</p>${u.href===root?`<p><a href="${requested}">附件一</a></p>`:'<p>REDIRECTED-ANNEX</p>'}</article></body></html>`};}}),extractionRunner:p=>p.input.material.url===root?extraction(p):output(p,'decomposition',{events:[],scopeNote:'附件只提供原事项上下文',missingEvidence:['核对原通知']}),semanticRunner:p=>comparison(p,'uncertain'),researchRunner:p=>{
  const d=dossier(p),e=p.input.evidence.find(e=>e.material?.url===root),v={sections:d.sections,missingEvidence:d.missingEvidence,sourceRequests:p.input.documentContext?[]:[{evidenceId:e.id,url:requested,reason:'核对明确附件的条款'}]},rawOutput=JSON.stringify(v);return {...d,...v,rawOutput,trace:{...d.trace,outputHash:digest(rawOutput)}};
 }});return Object.assign(f,{reads});
}

test('a safely redirected attachment returns to its original event without another human decision',async()=>{
 const f=make();try{f.add(1);await f.drive(50);const c=context(f),t=primary(f);
 assert.equal(c.documents.length,1,JSON.stringify(c.entries));assert.equal(c.entries[0].url,requested);assert.equal(c.documents[0].material.url,final);assert.equal(t.documentContext.entries[0].status,'available');assert.equal(t.dossier.basedOnResearchVersion,t.version);assert.equal(currentDocumentResearch(f.store,f.service.research,t),true);assert.equal(f.service.eventClusters.list().items.length,0);assert.deepEqual(f.reads,[root,requested,final]);
 const source=f.store.db.prepare("SELECT * FROM research_pipeline_items WHERE news_id=(SELECT id FROM news WHERE json_extract(payload,'$.url')=?)").get(requested),attempt=f.store.db.prepare("SELECT payload FROM research_source_attempts WHERE topic_id=? AND json_extract(payload,'$.state')='saved'").get(source.topic_id);assert(attempt);const saved=JSON.parse(attempt.payload);assert.equal(saved.readReceipt.schema,'public-source-read/1');assert.equal(saved.readReceipt.requestedUrl,requested);assert.equal(saved.readReceipt.finalUrl,final);assert.equal(saved.readReceipt.materialRevision,c.documents[0].material.revision);
 const before=t.version;await f.drive(5);assert.equal(primary(f).version,before);assert.deepEqual(f.reads,[root,requested,final]);
 }finally{await f.close();}
});

test('missing, mismatched or failed read receipts cannot turn a redirected attachment into available context',async()=>{
 const f=make();try{f.add(1);await f.drive(50);assert.equal(context(f).documents.length,1);
 const db=f.store.db,row=db.prepare("SELECT * FROM research_source_attempts WHERE json_extract(payload,'$.readReceipt.requestedUrl')=?").get(requested),old=JSON.parse(row.payload),prior=JSON.stringify(primary(f).dossier);
 for(const mutate of [p=>delete p.readReceipt,p=>p.state='failed',p=>p.method='manual',p=>p.readReceipt.schema='unknown',p=>p.readReceipt.requestedUrl=root,p=>p.readReceipt.finalUrl=root,p=>p.readReceipt.materialId='wrong',p=>p.readReceipt.materialRevision++,p=>p.at='invalid']){
  const p=structuredClone(old);mutate(p);db.prepare('UPDATE research_source_attempts SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);assert.equal(context(f).documents.length,0);assert.equal(currentDocumentResearch(f.store,f.service.research,primary(f)),false);assert.equal(JSON.stringify(primary(f).dossier),prior);db.prepare('UPDATE research_source_attempts SET payload=? WHERE id=?').run(row.payload,row.id);
 }
 db.prepare('UPDATE research_source_attempts SET topic_id=? WHERE id=?').run('unrelated-topic',row.id);assert.equal(context(f).documents.length,0);db.prepare('UPDATE research_source_attempts SET topic_id=? WHERE id=?').run(row.topic_id,row.id);assert.equal(currentDocumentResearch(f.store,f.service.research,primary(f)),true);
 }finally{await f.close();}
});
