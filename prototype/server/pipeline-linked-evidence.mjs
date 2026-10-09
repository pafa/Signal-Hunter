import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {validateSourceRequests} from './source-links.mjs';

export const LINKED_EVIDENCE_POLICY='linked-public-source/1';
export const LINKED_EVIDENCE_HASH=digest({policy:LINKED_EVIDENCE_POLICY,maximumCandidates:3,maximumDepth:1,scope:'frozen-extracted-html-links'});

// This planner never performs network or model calls. Leads enter the existing
// reader and research queue atomically with their frozen provenance.
export function openLinkedEvidence(store,research,{anchors,validAnchor,executionHash,enqueueLinked,audit,guard,now=Date.now}){
 const db=store.db,parse=row=>JSON.parse(row.payload),at=()=>new Date(now()).toISOString();
 function requestBasis(anchor){
  const job=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(anchor.id);
  if(!job||job.kind!=='dossier'||job.status!=='completed'||!parse(job).automatic)throw Error('原系统研判任务不可用');
  const owner=db.prepare('SELECT payload FROM research_pipeline_items WHERE id=?').get(job.item_id);
  if(!owner||parse(owner).executionHash!==executionHash())throw Error('原研判运行配置已变化');
  const topic=research.get(anchor.topicId),row=db.prepare('SELECT * FROM model_research_runs WHERE id=?').get(job.run_id),run=row&&parse(row);
  if(!run||run.status!=='adopted'||run.topicId!==topic.id||run.acceptedVersion!==anchor.topicVersion||topic.dossier?.sourceModelRun?.id!==run.id)throw Error('原系统研判或模型依据已变化');
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
  const requests=validateSourceRequests(topic.dossier.sourceRequests,run.packet)||[];
  if(digest(requests)!==digest(run.candidate.sourceRequests||[])||requests.length&&!run.candidate.missingEvidence.length)throw Error('补充来源请求与冻结模型结果不符');
  return {runId:run.id,inputHash:run.packet.inputHash,requests:requests.map(r=>({...r,link:run.packet.input.evidence.find(e=>e.id===r.evidenceId).material.sourceLinks.links.find(a=>a.url===r.url)}))};
 }
 function valid(p){
  const current=requestBasis(p.anchor);
  if(digest(current)!==digest(p.sourceBasis))throw Error('补充来源请求依据已变化，旧计划保留');
 }
 function scan(context){
  const last=new Map(db.prepare("SELECT anchor_id,max(rowid) latest FROM research_evidence_searches WHERE json_extract(payload,'$.policy')=? GROUP BY anchor_id").all(LINKED_EVIDENCE_POLICY).map(r=>[r.anchor_id,r.latest]));
  const sources=anchors().filter(a=>a.kind==='event'&&a.news.provider!=='linked-public-source').sort((a,b)=>(last.get(a.id)||0)-(last.get(b.id)||0)||a.id.localeCompare(b.id));
  for(const anchor of sources){
   if(!research.get(anchor.topicId).dossier?.sourceRequests?.length)continue;
   let basis;try{basis=requestBasis(anchor);}catch{continue;} // Invalid output cannot authorize a request.
   const frozen={...anchor,news:undefined,event:undefined},id=digest({policy:LINKED_EVIDENCE_POLICY,anchor:frozen,basis});
   if(db.prepare('SELECT 1 FROM research_evidence_searches WHERE id=?').get(id))continue;
   const resolved=basis.requests.map(r=>{
    const existing=db.prepare("SELECT id FROM news WHERE json_extract(payload,'$.url')=? ORDER BY rowid LIMIT 1").get(r.url);
    return {...r,existing:!!existing,newsId:existing?.id||digest({source:LINKED_EVIDENCE_POLICY,url:r.url})};
   });
   const leads=resolved.filter(r=>!r.existing).map(r=>({id:r.newsId,title:('网页引用：'+r.link.label).slice(0,200),url:r.url,publisher:new URL(r.url).hostname,publishedAt:null,datePrecision:'unknown',provider:'linked-public-source',contentScope:'linked-reference',linkedReference:{schema:LINKED_EVIDENCE_POLICY,searchId:id,sourceNewsId:anchor.newsId,sourceNewsRevision:anchor.newsRevision,evidenceId:r.evidenceId,label:r.link.label,context:r.link.context,reason:r.reason,depth:1}}));
   const p={anchor:frozen,automatic:true,policy:LINKED_EVIDENCE_POLICY,rulesHash:LINKED_EVIDENCE_HASH,executionHash:executionHash(),createdAt:at(),updatedAt:at(),sourceBasis:basis,coverage:{scope:'frozen-extracted-html-links',selected:resolved.length,maximumCandidates:3,maximumDepth:1,newLeads:leads.length,reusedNews:resolved.length-leads.length},candidates:[],reason:'沿已读原文的明确链接补充研究；链接及读取成功均不证明内容成立或来源独立'};
   store.ingest(leads,at(),()=>{
    context.assertActive();guard();validAnchor(p);valid(p);
    for(const r of resolved){
     const n=store.newsById(r.newsId),queued=enqueueLinked(n,{searchId:id,anchor:p.anchor,request:r,context});
     p.candidates.push({newsId:n.id,revision:n.revision,pipelineId:queued.id,title:n.title,activated:queued.activated,created:!r.existing,initialStatus:queued.initialStatus,status:'pending',pairIds:[],reasons:[r.reason],requestedUrl:r.url,evidenceId:r.evidenceId,link:r.link,reason:'等待沿原队列读取、独立研究并比较'});
    }
    db.prepare('INSERT INTO research_evidence_searches VALUES(?,?,?,?)').run(id,anchor.id,'pending',JSON.stringify(p));
    audit(anchor.id,'linked-evidence-planned',{searchId:id,anchor:p.anchor,coverage:p.coverage,sourceRunId:basis.runId,candidates:p.candidates.map(c=>({newsId:c.newsId,revision:c.revision,created:c.created,activated:c.activated}))});
   });
   return;
  }
 }
 return {scan,valid};
}
