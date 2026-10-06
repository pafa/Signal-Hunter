import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './codex-research.mjs';
import {historyStatusLabels} from '../shared/historical-recall.mjs';
import {comparisonSources,readComparisonArtifact as read,writeComparisonArtifact as write,sealComparisonArtifact as seal,checkComparisonArtifact as check,encodeComparisonArtifact as encode} from './model-comparison.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),format='recall-evaluation/1';
const fail=()=>{throw Error('历史召回评估的报告、完整标注或指纹不一致');};
const text=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const ratio=(n,d)=>d?n/d:null;
function sourceCheck(sources,hash){
 if(!sources||Array.isArray(sources)||!Object.keys(sources).length||digest(sources)!==hash)fail();
 for(const s of Object.values(sources))if(!s||typeof s.text!=='string'||digest(s.text)!==s.sha256)fail();
}
// Validate the saved retrieval, without running today's matcher against old inputs.
function reportCheck(p){
 check(p);encode(p);
 if(!['historical-recall/1','historical-recall-body/1'].includes(p.version)||p.forwardEligible!==false||!time(p.frozenAt)||!Array.isArray(p.inputs)||!p.inputs.length||p.inputs.length>22000||!Array.isArray(p.rows)||p.rows.length!==p.inputs.length||!Array.isArray(p.candidateIds)||p.inputHash!==digest(p.inputs))fail();
 sourceCheck(p.sources,p.sourceHash);
 if(!p.sources['prototype/server/historical-recall.mjs']||!p.sources['prototype/server/historical-mechanisms.mjs']||p.version==='historical-recall-body/1'&&!p.sources['prototype/server/historical-body.mjs'])fail();
 const inputs=new Map();
 for(const i of p.inputs){if(!i||!text(i.id,200)||!Number.isSafeInteger(i.revision)||i.revision<1||inputs.has(i.id))fail();inputs.set(i.id,i);}
 if(!p.anchor||!inputs.has(p.anchor.id)||digest(inputs.get(p.anchor.id))!==digest(p.anchor))fail();
 const seen=new Set(),candidates=new Set(),counts={candidate:0};
 for(const r of p.rows){
  if(!r||!inputs.has(r.newsId)||inputs.get(r.newsId).revision!==r.newsRevision||seen.has(r.newsId)||!Object.hasOwn(historyStatusLabels,r.status)||(r.status==='anchor')!==(r.newsId===p.anchor.id))fail();
  seen.add(r.newsId);counts[r.status]=(counts[r.status]||0)+1;
  if(r.status==='candidate'){if(!Number.isFinite(r.rank))fail();candidates.add(r.newsId);}
 }
 if(!p.summary||Object.keys(p.summary).length!==Object.keys(counts).length||Object.entries(counts).some(([k,v])=>p.summary[k]!==v)||new Set(p.candidateIds).size!==p.candidateIds.length||p.candidateIds.length!==candidates.size||p.candidateIds.some(id=>!candidates.has(id)))fail();
 const c=p.coverage,materials=p.inputs.filter(i=>i.kind==='material').length;
 if(!c||c.total!==p.inputs.length||c.scanned!==p.inputs.length||c.materials!==materials||c.news!==p.inputs.length-materials||c.news>20000||materials>2000||p.version==='historical-recall/1'&&materials)fail();
 return p;
}
export function recallLabelTemplate(report){
 reportCheck(report);
 return {title:'',reportHash:report.hash,reviewer:'',reviewedAt:'',origin:'developer',resultsSeen:null,labels:report.inputs.filter(i=>i.id!==report.anchor.id).map(i=>({newsId:i.id,newsRevision:i.revision,relevance:null,reason:''}))};
}
function labelCheck(report,spec,frozenAt){
 if(!keys(spec,'title,reportHash,reviewer,reviewedAt,origin,resultsSeen,labels')||!text(spec.title,100)||spec.reportHash!==report.hash||!text(spec.reviewer,200)||!time(spec.reviewedAt)||Date.parse(spec.reviewedAt)>Date.parse(frozenAt)||!['developer','external-review'].includes(spec.origin)||typeof spec.resultsSeen!=='boolean'||!Array.isArray(spec.labels)||spec.labels.length!==report.inputs.length-1)fail();
 const remaining=new Map(report.inputs.filter(i=>i.id!==report.anchor.id).map(i=>[i.id,i.revision]));
 for(const l of spec.labels){if(!keys(l,'newsId,newsRevision,relevance,reason')||!remaining.has(l.newsId)||remaining.get(l.newsId)!==l.newsRevision||!['relevant','not-relevant','unknown'].includes(l.relevance)||!text(l.reason))fail();remaining.delete(l.newsId);}
 if(remaining.size)fail();
}
function metrics(report,spec){
 const references=new Map(spec.labels.map(l=>[l.newsId,l])),rank=new Map(report.candidateIds.map((id,index)=>[id,index+1]));
 const rows=report.rows.filter(r=>r.status!=='anchor').map(r=>({newsId:r.newsId,newsRevision:r.newsRevision,status:r.status,rank:rank.get(r.newsId)||null,...{relevance:references.get(r.newsId).relevance,reason:references.get(r.newsId).reason}}));
 const relevant=rows.filter(r=>r.relevance==='relevant'),missed=relevant.filter(r=>r.rank===null),missedByStatus={};
 for(const r of missed)missedByStatus[r.status]=(missedByStatus[r.status]||0)+1;
 const selection=k=>{const selected=rows.filter(r=>r.rank!==null&&r.rank<=k),tp=selected.filter(r=>r.relevance==='relevant').length,fp=selected.filter(r=>r.relevance==='not-relevant').length;return {selected:selected.length,truePositives:tp,falsePositives:fp,unknownSelected:selected.length-tp-fp,falseNegatives:relevant.length-tp,knownLabelPrecision:ratio(tp,tp+fp),recallOfAllReferences:ratio(tp,relevant.length)};};
 const mechanismMisses=missed.filter(r=>['no_mechanism','no_context'].includes(r.status)).length;
 return {rows,summary:{inputs:report.inputs.length,anchors:1,evaluated:rows.length,relevant:relevant.length,notRelevant:rows.filter(r=>r.relevance==='not-relevant').length,unknown:rows.filter(r=>r.relevance==='unknown').length,...selection(Infinity),missedByStatus,mechanismOrContextMisses:mechanismMisses,excludedRelevant:missed.length-mechanismMisses},topK:[5,10,25].map(k=>({k,...selection(k)}))};
}
export function freezeRecallEvaluation(report,spec,{now=Date.now}={}){
 reportCheck(report);const frozenAt=new Date(now()).toISOString();
 if(Date.parse(report.frozenAt)>Date.parse(frozenAt))fail();labelCheck(report,spec,frozenAt);
 const path='prototype/scripts/evaluate-recall.mjs',source=readFileSync(join(root,path),'utf8'),sources={...comparisonSources(),[path]:{text:source,sha256:digest(source)}};
 return seal({format,frozenAt,report:structuredClone(report),reference:structuredClone(spec),...metrics(report,spec),sources,sourceHash:digest(sources),forwardEligible:false,scope:'retrospective-complete-supplied-corpus',limitations:['完整分母仅限所提供冻结报告的输入，不证明全市场覆盖或参考标签独立','未知标签不计为负例；精确率仅以已知标签为分母，召回率保留所有相关参考','时间、重复和来源门禁排除的相关项单列；不能为提高召回率放宽门禁','resultsSeen与标注来源为提供者声明，不证明盲审、前向预测或策略收益']});
}
function evaluationCheck(value){
 const p=check(value);if(p.format!==format||p.forwardEligible!==false||p.scope!=='retrospective-complete-supplied-corpus'||!time(p.frozenAt))fail();
 reportCheck(p.report);if(Date.parse(p.report.frozenAt)>Date.parse(p.frozenAt))fail();labelCheck(p.report,p.reference,p.frozenAt);sourceCheck(p.sources,p.sourceHash);
 if(!p.sources['prototype/server/recall-evaluation.mjs']||!p.sources['prototype/scripts/evaluate-recall.mjs'])fail();
 const expected=metrics(p.report,p.reference);for(const key of ['rows','summary','topK'])if(digest(p[key])!==digest(expected[key]))fail();return p;
}
export function saveRecallEvaluation(directory,evaluation){evaluationCheck(evaluation);encode(evaluation);mkdirSync(directory,{mode:0o700});write(join(directory,'evaluation.json'),evaluation);return evaluation.hash;}
export function readRecallEvaluation(directory){return evaluationCheck(read(join(directory,'evaluation.json')));}
