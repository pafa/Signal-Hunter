import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeMateriality,calculateMateriality,materialityInputs,materialityErrors} from '../shared/company-materiality.mjs';
import {safeErrorText} from '../shared/safe-errors.mjs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {hash} from '../server/providers.mjs';
import {companyDraftKey,readCompanyDraft,writeCompanyDraft,clearCompanyDraft} from '../src/major/company-drafts.js';

const at='2026-10-02T12:00:00.000Z';
const topic={evidence:[{id:'e1',claim:'Synthetic guidance',url:'https://example.com/guidance',availableAt:'2026-09-01T09:00:00Z',verification:'unverified',newsId:'news-1',newsRevision:2}]};
const datum=(value,kind='source')=>({value,kind,evidenceIds:kind==='source'?['e1']:[]});
const row=(patch={})=>({id:'revenue',label:'Revenue',scope:'Synthetic consolidated company',period:'FY2026',unit:'million USD',basis:'Synthetic inputs, same-period comparison; not real financial guidance',comparable:true,eventAt:'2026-10-01T08:00:00+08:00',expectationAt:'2026-09-02T08:00:00+08:00',baseline:datum(100),affected:datum(20),expected:datum(110),observed:datum(120),...patch});
const normalized=(patch={},t=topic)=>normalizeMateriality([row(patch)],t,at).rows[0];

test('materiality computes same-metric differences, exposure and expectation gap without probabilities',()=>{
 const r=normalized();assert.equal(r.result.delta,20);assert.equal(r.result.relativeChange,20);assert.equal(r.result.exposure,20);assert.equal(r.result.expectationDelta,10);assert.ok(Math.abs(r.result.expectationGap-100/11)<1e-10);
 assert.equal(r.result.expectationBasis,'pre-event-source-available');assert.equal(r.result.prospectiveValidated,false);assert.equal(r.result.probability,undefined);assert.equal(r.result.return,undefined);
 assert.equal(r.expected.references[0].newsRevision,2);assert.equal(r.eventAt,'2026-10-01T00:00:00.000Z');
});

test('zero, missing and loss baselines never become fabricated percentages or zero inputs',()=>{
 let r=normalized({baseline:datum(0),expected:datum(0),observed:datum(20)}).result;
 assert.equal(r.delta,20);assert.equal(r.relativeChange,null);assert.equal(r.expectationGap,null);assert.equal(r.exposure,null);
 r=normalized({baseline:datum(-100),expected:datum(-100),observed:datum(-50)}).result;assert.equal(r.delta,50);assert.equal(r.relativeChange,50);assert.equal(r.expectationGap,50);assert.equal(r.exposure,null);
 r=normalized({observed:null,expected:null}).result;assert.equal(r.delta,null);assert.equal(r.expectationDelta,null);assert.equal(r.exposure,20);assert.equal(r.expectationBasis,'missing');
 assert.equal(normalized({baseline:datum(1e-308)}).result.relativeChange,null);
});

test('exposure requires a nonnegative subset and cannot silently double-count beyond company baseline',()=>{
 for(const affected of [-1,101])assert.equal(normalized({affected:datum(affected)}).result.exposure,null);
 assert.equal(normalized({affected:datum(0)}).result.exposure,0);assert.equal(normalized({affected:datum(100)}).result.exposure,100);
 assert.equal(calculateMateriality(row({comparable:false})).delta,null);
});

test('timing degrades assumptions, late evidence, unknown availability and event-time expectations',()=>{
 for(const patch of [{expected:datum(110,'assumption')},{expectationAt:null},{eventAt:null},{expectationAt:'2026-10-01T00:00:00Z'},{expectationAt:'2026-11-01T00:00:00Z'}])assert.equal(normalized(patch).result.expectationBasis,'retrospective-or-unverified');
 for(const availableAt of [null,'unknown','2026-10-02T00:00:00Z'])assert.equal(normalized({}, {evidence:[{...topic.evidence[0],availableAt}]}).result.expectationBasis,'retrospective-or-unverified');
 const manual={evidence:[{...topic.evidence[0],newsId:null,availableAt:null,firstSeen:'2026-09-01T09:00:00Z'}]};assert.equal(normalized({},manual).result.expectationBasis,'pre-event-source-available');
});

test('strict input validates bounded numbers, scope confirmation, identifiers and real zoned dates',()=>{
 for(const patch of [{label:''},{unit:''},{period:''},{scope:''},{basis:''},{comparable:false},{comparable:'true'},{id:'<script>'},{result:{delta:999}},{eventAt:'2026-02-30T12:00:00Z'},{eventAt:'2026-10-01 12:00:00'},{eventAt:'2026-10-01T24:00:00Z'}])assert.throws(()=>normalized(patch));
 for(const value of [NaN,Infinity,1e13,'120',false])assert.throws(()=>normalized({observed:datum(value)}));
 assert.throws(()=>normalizeMateriality([row(),row()],topic,at));assert.throws(()=>normalizeMateriality(Array.from({length:9},(_,i)=>row({id:'row-'+i})),topic,at));
 assert.throws(()=>normalizeMateriality(null,topic,at));assert.deepEqual(normalizeMateriality([],topic,at).rows,[]);
});

test('each sourced number has its own frozen evidence and cannot accept forged references',()=>{
 for(const value of [{value:2,kind:'source',evidenceIds:[]},{value:2,kind:'source',evidenceIds:['missing']},{value:2,kind:'source',evidenceIds:['e1','e1']},{...datum(2),references:[]},{...datum(2),kind:'verified'}])assert.throws(()=>normalized({baseline:value}));
 const input=row(),saved=normalizeMateriality([input],topic,at);input.baseline.evidenceIds.length=0;
 assert.deepEqual(saved.rows[0].baseline.evidenceIds,['e1']);assert.equal(saved.rows[0].baseline.references[0].verification,'unverified');
 const editable=materialityInputs(saved);assert.equal(editable[0].result,undefined);assert.equal(editable[0].baseline.references,undefined);assert.deepEqual(normalizeMateriality(editable,topic,at),saved);
});

test('exact materiality errors are readable but appended diagnostic secrets are hidden',()=>{
 for(const message of materialityErrors){assert.equal(safeErrorText(message),message);assert.equal(safeErrorText(message+' /private/secret'),'任务失败，请检查来源或运行配置');}
});

test('research revisions preserve calculations, omit-preserve compatibility and explicit removal without trading',()=>{
 const store=openStore(':memory:'),research=openResearch(store,{seed:false,clock:()=>at});
 try{
  const paper=openPaper(store,research,{seed:false,clock:()=>at}),before=JSON.stringify(paper.snapshot());let t=research.create({title:'Synthetic comparison',summary:'No trading signal'});
  const r=row({baseline:datum(100,'assumption'),affected:datum(20,'assumption'),expected:datum(110,'assumption'),observed:datum(120,'assumption')});
  const relation={symbol:'BA.US',note:'Synthetic business exposure',materiality:[r]};
  t=research.addCompany(t.id,{...relation,version:t.version});const old=JSON.stringify(t.companies[0].materiality);
  t=research.addCompany(t.id,{symbol:'BA.US',note:'Revised relationship only',replace:true,version:t.version});assert.equal(JSON.stringify(t.companies[0].materiality),old);
  assert.throws(()=>research.addCompany(t.id,{...relation,replace:true,version:1}),/更新/);
  t=research.addCompany(t.id,{...relation,materiality:[{...r,observed:datum(130,'assumption')}],replace:true,version:t.version});assert.equal(t.companies[0].materiality.rows[0].result.delta,30);
  assert.equal(JSON.stringify(research.history(t.id)[1].topic.companies[0].materiality),old);
  assert.equal(research.packet(t.id).input.companies[0].materiality.rows[0].result.delta,30);
  t=research.addCompany(t.id,{...relation,materiality:[],replace:true,version:t.version});assert.equal(t.companies[0].materiality.rows.length,0);assert.equal(research.history(t.id)[1].topic.companies[0].materiality.rows[0].result.delta,30);
  assert.equal(JSON.stringify(paper.snapshot()),before);
 }finally{store.close();}
});

test('revisions use actual news availability, and page views cannot rewrite saved comparisons after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-materiality-')),file=join(dir,'test.sqlite');let store=openStore(file);
 try{
  let research=openResearch(store,{seed:false,clock:()=>at});const id=hash('synthetic guidance');store.ingest([{id,title:'Synthetic guidance',publisher:'Fixture',publishedAt:'2026-09-01',url:'https://example.com/guidance'}],at);
  let t=research.createFromNews({newsId:id,newsRevision:1});const e=t.evidence[0].id,values=Object.fromEntries(Object.entries({baseline:100,affected:20,expected:110,observed:120}).map(([k,value])=>[k,{value,kind:'source',evidenceIds:[e]}]));
  t=research.addCompany(t.id,{symbol:'BA.US',note:'Synthetic relation',version:t.version,materiality:[row(values)]});assert.equal(t.companies[0].materiality.rows[0].result.expectationBasis,'retrospective-or-unverified');const saved=JSON.stringify(t.companies[0].materiality);
  store.close();store=openStore(file);research=openResearch(store,{seed:false,clock:()=>at});assert.equal(JSON.stringify(research.get(t.id).companies[0].materiality),saved);
  store.ingest([{id,title:'Corrected synthetic guidance',publisher:'Fixture',publishedAt:'2026-09-01',url:'https://example.com/guidance'}],'2026-10-03T00:00:00Z');assert.equal(JSON.stringify(research.get(t.id).companies[0].materiality),saved);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed research commits do not leak a new calculation or advance the old version',()=>{
 const store=openStore(':memory:'),r=openResearch(store,{seed:false,clock:()=>at});
 try{const t=r.create({title:'Atomic calculation',summary:'Synthetic'});store.db.exec("CREATE TRIGGER block_materiality BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END");
  assert.throws(()=>r.addCompany(t.id,{symbol:'BA.US',note:'Synthetic',version:t.version,materiality:[row({baseline:datum(100,'assumption'),expected:null,observed:datum(120,'assumption'),affected:null})]}),/fixture/);
  assert.equal(r.get(t.id).version,t.version);assert.equal(r.get(t.id).companies.length,0);assert.equal(r.history(t.id).length,1);
 }finally{store.close();}
});

test('company drafts isolate instance, company and research, preserve stale bases and tolerate storage failure',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},t={id:'draft-topic',createdAt:at};
 const a=companyDraftKey(t,'instance-a','BA.US'),b=companyDraftKey(t,'instance-a','AAPL.US'),c=companyDraftKey(t,'instance-b','BA.US');assert.equal(new Set([a,b,c]).size,3);
 const draft={base:3,editing:true,form:{symbol:'BA.US',materiality:[row()],note:'Draft'}};assert.equal(writeCompanyDraft(a,draft,storage),true);assert.deepEqual(readCompanyDraft(a,storage),draft);assert.equal(readCompanyDraft(b,storage),null);
 assert.equal(readCompanyDraft(a,storage).base,3);assert.equal(writeCompanyDraft(b,draft,null),false);assert.deepEqual(readCompanyDraft(b,null),draft);clearCompanyDraft(a,storage);assert.equal(readCompanyDraft(a,storage),null);assert.equal(values.has(a),false);clearCompanyDraft(b,null);
});

test('corrupted browser drafts cannot crash a reopened company editor',()=>{
 for(const [i,value] of ['not json',JSON.stringify({base:2,editing:true,form:{symbol:'BA.US',note:'test',materiality:[null]}}),JSON.stringify({base:2,editing:true,form:{symbol:'BA.US',note:'test',materiality:[{...row(),expected:{value:1,evidenceIds:null}}]}})].entries())assert.equal(readCompanyDraft('malformed-'+i,{getItem:()=>value}),null);
 const draft={base:2,editing:true,form:{symbol:'BA.US',note:'test',materiality:[row()]}};assert.deepEqual(readCompanyDraft('valid-stored',{getItem:()=>JSON.stringify(draft)}),draft);clearCompanyDraft('valid-stored',null);
});
