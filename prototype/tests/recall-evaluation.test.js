import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openStore} from '../server/store.mjs';
import {openMaterials} from '../server/research-materials.mjs';
import {hash} from '../server/providers.mjs';
import {digest} from '../server/codex-research.mjs';
import {openHistoricalRecall} from '../server/historical-recall.mjs';
import {recallLabelTemplate,freezeRecallEvaluation,saveRecallEvaluation,readRecallEvaluation} from '../server/recall-evaluation.mjs';

const at='2026-10-04T00:00:00Z',now=()=>Date.parse(at),clone=structuredClone;
const seal=p=>{const {hash:unused,...body}=p;return {...body,hash:digest(body)};};
const news=(id,title,publishedAt='2020-01-01T00:00:00Z')=>({id:hash(id),title,publishedAt,url:`https://example.invalid/${id}`,publisher:'Synthetic recall diagnostic'});
function fixture(){
 const store=openStore(':memory:');
 try{
  const anchor=news('anchor','FDA approves Eli Lilly obesity drug','2026-10-03T00:00:00Z');
  const records=[anchor,...Array.from({length:7},(_,i)=>news('candidate-'+i,`FDA approves obesity drug candidate ${i}`)),news('miss','A treatment receives a green light'),news('gate','FDA approves obesity treatment with missing date',null),news('irrelevant','The weather is sunny')];
  store.ingest(records,at);
  const report=openHistoricalRecall(store,{now}).freeze(anchor.id,{revision:1,requestId:randomUUID()});
  assert.equal(report.candidateIds.length,7);
  const spec=labels(report),expected=['relevant','relevant','relevant','not-relevant','unknown','relevant','not-relevant'];
  for(const l of spec.labels){const index=report.candidateIds.indexOf(l.newsId);l.relevance=index>=0?expected[index]:[hash('miss'),hash('gate')].includes(l.newsId)?'relevant':'not-relevant';}
  return {report,spec};
 }finally{store.close();}
}
function labels(report){return {...recallLabelTemplate(report),title:'Synthetic complete corpus diagnostic',reviewer:'Developer fixture',reviewedAt:at,origin:'developer',resultsSeen:true,labels:report.inputs.filter(i=>i.id!==report.anchor.id).map(i=>({newsId:i.id,newsRevision:i.revision,relevance:'unknown',reason:'Synthetic reference for metric validation only.'}))};}
const baseline=fixture();
test('complete saved corpus includes missed references, excluded cases, false positives and unknowns',()=>{
 const {report,spec}=baseline,p=freezeRecallEvaluation(report,spec,{now}),s=p.summary;
 assert.deepEqual(s,{inputs:11,anchors:1,evaluated:10,relevant:6,notRelevant:3,unknown:1,selected:7,unknownSelected:1,truePositives:4,falsePositives:2,falseNegatives:2,knownLabelPrecision:4/6,recallOfAllReferences:4/6,missedByStatus:{no_mechanism:1,invalid_time:1},mechanismOrContextMisses:1,excludedRelevant:1});
 assert.deepEqual(p.topK[0],{k:5,selected:5,truePositives:3,falsePositives:1,unknownSelected:1,falseNegatives:3,knownLabelPrecision:3/4,recallOfAllReferences:3/6});
 assert.equal(p.topK[1].selected,7);assert.equal(p.topK[2].recallOfAllReferences,4/6);
 assert.equal(p.rows.length,10);assert.equal(p.rows.find(r=>r.newsId===hash('miss')).rank,null);
 assert.equal(p.forwardEligible,false);assert.equal(p.reference.resultsSeen,true);
 assert.deepEqual(p.report,report);spec.labels.reverse();assert.deepEqual(freezeRecallEvaluation(report,spec,{now}).summary,s);spec.labels.reverse();
});
test('template cannot be silently accepted and every input requires one versioned explicit reference',()=>{
 const {report,spec}=baseline,template=recallLabelTemplate(report);assert.equal(template.labels.length,10);assert(template.labels.every(l=>l.relevance===null));assert.equal(template.resultsSeen,null);
 assert.throws(()=>freezeRecallEvaluation(report,template,{now}));
 const changes=[s=>s.labels.pop(),s=>s.labels.push(s.labels[0]),s=>s.labels[0]=s.labels[1],s=>s.labels[0].newsId=report.anchor.id,s=>s.labels[0].newsId='missing',s=>s.labels[0].newsRevision++,s=>s.labels[0].reason='',s=>s.labels[0].relevance=null,s=>s.reportHash='wrong',s=>s.resultsSeen=null,s=>s.reviewedAt='2099-01-01',s=>s.reviewedAt=0,s=>s.origin='independent',s=>s.reviewer='',s=>s.labels[0].extra=true];
 for(const change of changes){const s=clone(spec);change(s);assert.throws(()=>freezeRecallEvaluation(report,s,{now}));}
 const external={...spec,origin:'external-review',resultsSeen:false};assert.equal(freezeRecallEvaluation(report,external,{now}).forwardEligible,false);
});
test('nested inconsistencies are rejected even when the outer report is resealed',()=>{
 const changes=[r=>r.rows.pop(),r=>r.rows[0]=r.rows[1],r=>r.inputs.push(r.inputs[0]),r=>r.anchor.title='changed',r=>r.rows[0].newsRevision++,r=>r.rows[0].status='unsupported',r=>r.rows[0].status='candidate',r=>r.candidateIds.pop(),r=>r.candidateIds[0]=r.candidateIds[1],r=>r.summary.candidate++,r=>r.coverage.scanned--,r=>r.coverage.total--,r=>r.coverage.materials++,r=>r.forwardEligible=true,r=>r.inputs[0].title='changed',r=>r.sources['prototype/server/historical-recall.mjs'].text+='\nchanged',r=>r.rows.find(x=>x.status==='candidate').rank=null];
 for(const change of changes){const r=clone(baseline.report);change(r);assert.throws(()=>recallLabelTemplate(seal(r)));}
 const r=clone(baseline.report);r.candidateIds=[];assert.throws(()=>recallLabelTemplate(r));
 assert.throws(()=>freezeRecallEvaluation(baseline.report,baseline.spec,{now:()=>Date.parse('2020-01-01')}));
});
test('unknown labels and empty denominators stay visible and never become negatives or zero scores',()=>{
 const report=baseline.report,p=freezeRecallEvaluation(report,labels(report),{now});
 assert.equal(p.summary.unknown,10);assert.equal(p.summary.unknownSelected,7);assert.equal(p.summary.relevant,0);assert.equal(p.summary.notRelevant,0);assert.equal(p.summary.knownLabelPrecision,null);assert.equal(p.summary.recallOfAllReferences,null);
 const store=openStore(':memory:');try{
  const anchor=news('alone','Unmatched anchor','2026-10-03T00:00:00Z');store.ingest([anchor],at);const r=openHistoricalRecall(store,{now}).freeze(anchor.id,{revision:1,requestId:randomUUID()}),empty=freezeRecallEvaluation(r,labels(r),{now});
  assert.equal(empty.summary.evaluated,0);assert.equal(empty.summary.selected,0);assert(empty.topK.every(k=>k.recallOfAllReferences===null&&k.knownLabelPrecision===null));
 }finally{store.close();}
});
test('body report retains exact saved material versions and evaluates news and material rows together',()=>{
 const store=openStore(':memory:');try{
  const materials=openMaterials(store.db,{clock:()=>at}),save=(id,body,date)=>{const p=materials.prepare('fixture',{title:'公告更新',body,publishedAt:date,sourceName:'合成来源',scope:'excerpt',url:`https://example.invalid/${id}`},'manual');p.persist();return p.material;};
  const old=save('old','诺和诺德治疗肥胖的药物获批。','2020-01-01'),anchor=save('new','FDA approves Eli Lilly obesity drug.','2026-10-01');
  store.ingest([news('headline','FDA approves a new obesity drug')],at);
  const r=openHistoricalRecall(store,{now}).freeze('material:'+anchor.id,{revision:1,requestId:randomUUID()}),s=labels(r);s.labels.forEach(l=>l.relevance='relevant');
  const p=freezeRecallEvaluation(r,s,{now});assert.equal(p.summary.truePositives,2);assert.equal(p.summary.recallOfAllReferences,1);assert.equal(p.report.inputs.find(i=>i.id==='material:'+old.id).body,old.body);
 }finally{store.close();}
});
test('immutable archives survive copy without source database and reject altered or rehashed metrics',()=>{
 const dir=mkdtempSync(join(tmpdir(),'recall-eval-'));try{
  const original=join(dir,'original'),copy=join(dir,'copy'),p=freezeRecallEvaluation(baseline.report,baseline.spec,{now});saveRecallEvaluation(original,p);assert.throws(()=>saveRecallEvaluation(original,p));cpSync(original,copy,{recursive:true});rmSync(original,{recursive:true});assert.deepEqual(readRecallEvaluation(copy),p);
  for(const change of [p=>p.summary.truePositives++,p=>p.topK[0].falseNegatives--,p=>p.rows.pop(),p=>p.sources['prototype/server/recall-evaluation.mjs'].text+='modified']){const tampered=clone(p);change(tampered);writeFileSync(join(copy,'evaluation.json'),JSON.stringify(seal(tampered)));assert.throws(()=>readRecallEvaluation(copy));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI requires completed labels, refuses overwrite and reports all frozen rows without running a model',()=>{
 const dir=mkdtempSync(join(tmpdir(),'recall-cli-')),run=(...args)=>spawnSync(process.execPath,['scripts/evaluate-recall.mjs',...args],{encoding:'utf8',timeout:30000});try{
  const report=join(dir,'report.json'),refs=join(dir,'refs.json'),out=join(dir,'frozen');writeFileSync(report,JSON.stringify(baseline.report));
  const template=run('template',report,refs);assert.equal(template.status,0,template.stderr);assert.equal(JSON.parse(template.stdout).labels,10);const original=readFileSync(refs,'utf8');assert.equal(run('template',report,refs).status,1);assert.equal(readFileSync(refs,'utf8'),original);assert.equal(run('freeze',report,refs,out).status,1);
  writeFileSync(refs,JSON.stringify(baseline.spec));const frozen=run('freeze',report,refs,out);assert.equal(frozen.status,0,frozen.stderr);assert.equal(run('freeze',report,refs,out).status,1);
  rmSync(report);rmSync(refs);const result=run('report',out);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).rows.length,10);assert.equal(JSON.parse(result.stdout).summary.falseNegatives,2);assert.equal(run('run',out).status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
