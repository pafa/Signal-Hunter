import {documentResearchOrigin} from './system-document-revisions.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {validateSourceRequests} from './source-links.mjs';

export const LINKED_EVIDENCE_POLICY='linked-public-source/2';
export const LINKED_EVIDENCE_HASH=digest({policy:LINKED_EVIDENCE_POLICY,maximumCandidates:3,maximumDepth:2,scope:'frozen-article-and-publisher-attachment-links'});

// This planner never performs network or model calls. Leads enter the existing
// reader and research queue atomically with their frozen provenance.
export function openLinkedEvidence(store,research,{anchors,validAnchor,executionHash,executionCompatible=key=>key===executionHash(),enqueueLinked,audit,guard,now=Date.now}){
 const db=store.db,parse=row=>JSON.parse(row.payload),at=()=>new Date(now()).toISOString();
 function requestBasis(anchor){
  const job=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(anchor.id);
  if(!job||job.kind!=='dossier'||job.status!=='completed'||!parse(job).automatic)throw Error('原系统研判任务不可用');
  const owner=db.prepare('SELECT payload FROM research_pipeline_items WHERE id=?').get(job.item_id);
  if(!owner||!parse(owner).configuration.automatic||!executionCompatible(parse(owner).executionHash))throw Error('原研判运行配置已变化');
  const topic=documentResearchOrigin(db,research.get(anchor.topicId),anchor.topicVersion,job.run_id),row=db.prepare('SELECT * FROM model_research_runs WHERE id=?').get(job.run_id),run=row&&parse(row);
  if(!run||run.status!=='adopted'||run.topicId!==topic.id||run.acceptedVersion!==anchor.topicVersion||topic.dossier?.sourceModelRun?.id!==run.id)throw Error('原系统研判或模型依据已变化');
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
  const requests=validateSourceRequests(topic.dossier.sourceRequests,run.packet)||[];
  if(digest(requests)!==digest(run.candidate.sourceRequests||[])||requests.length&&!run.candidate.missingEvidence.length)throw Error('补充来源请求与冻结模型结果不符');
  return {runId:run.id,inputHash:run.packet.inputHash,requests:requests.map(r=>({...r,link:run.packet.input.evidence.find(e=>e.id===r.evidenceId).material.sourceLinks.links.find(a=>a.url===r.url)}))};
 }
 function lineage(anchor){
  const news=store.newsById(anchor.newsId);
  if(!news||news.revision!==anchor.newsRevision)throw Error('补读来源版本已变化');
  const current={newsId:news.id,revision:news.revision,url:news.url};
  if(news.provider!=='linked-public-source')return [current];
  const ref=news.linkedReference;
  if(ref?.schema!==LINKED_EVIDENCE_POLICY||![1,2].includes(ref.depth)||!Array.isArray(ref.lineage)||ref.lineage.length!==ref.depth)throw Error('补读层级或来源链不可用，保留旧记录');
  const row=db.prepare('SELECT * FROM research_evidence_searches WHERE id=?').get(ref.searchId),parent=row&&parse(row);
  if(!parent||parent.policy!==LINKED_EVIDENCE_POLICY||parent.coverage.depth!==ref.depth||digest(parent.lineage)!==digest(ref.lineage)||parent.anchor.newsId!==ref.sourceNewsId||parent.anchor.newsRevision!==ref.sourceNewsRevision||!parent.candidates.some(c=>c.newsId===news.id&&c.revision===news.revision&&c.requestedUrl===news.url&&c.evidenceId===ref.evidenceId))throw Error('补读来源链与原计划不符');
  const parentNews=store.newsById(parent.anchor.newsId);
  if(ref.depth===1?parentNews?.provider==='linked-public-source':parentNews?.provider!=='linked-public-source'||parentNews.linkedReference?.schema!==LINKED_EVIDENCE_POLICY||parentNews.linkedReference.depth!==ref.depth-1)throw Error('补读父层级不连续');
  // Depth must strictly decrease at each parent, even for damaged stored data.
  if(parent.lineage.some(n=>n.newsId===news.id||n.url===news.url))throw Error('补读来源链存在回环');
  validAnchor(parent);
  return [...parent.lineage,current];
 }
 function valid(p){
  const current=requestBasis(p.anchor);
  if(digest(current)!==digest(p.sourceBasis))throw Error('补充来源请求依据已变化，旧计划保留');
  if(digest(lineage(p.anchor))!==digest(p.lineage))throw Error('补读来源链已变化，旧计划保留');
 }
 function scan(context){
  const last=new Map(db.prepare("SELECT anchor_id,max(rowid) latest FROM research_evidence_searches WHERE json_extract(payload,'$.policy')=? GROUP BY anchor_id").all(LINKED_EVIDENCE_POLICY).map(r=>[r.anchor_id,r.latest]));
  const sources=anchors().filter(a=>a.kind==='event').sort((a,b)=>(last.get(a.id)||0)-(last.get(b.id)||0)||a.id.localeCompare(b.id));
  for(const anchor of sources){
   if(!research.get(anchor.topicId).dossier?.sourceRequests?.length)continue;
   let basis,chain;try{basis=requestBasis(anchor);chain=lineage(anchor);}catch{continue;} // Invalid output cannot authorize a request.
   const frozen={...anchor,news:undefined,event:undefined},id=digest({policy:LINKED_EVIDENCE_POLICY,anchor:frozen,basis});
   if(db.prepare('SELECT 1 FROM research_evidence_searches WHERE id=?').get(id))continue;
   const depth=chain.length,excluded=basis.requests.filter(r=>depth>2||chain.some(n=>n.url===r.url)).map(r=>({...r,reason:depth>2?'达到两层补读上限，保留未读缺口':'链接返回已在来源链中的材料，不重复读取'}));
   const resolved=basis.requests.filter(r=>!excluded.some(e=>e.url===r.url)).map(r=>{
    const existing=db.prepare("SELECT id FROM news WHERE json_extract(payload,'$.url')=? ORDER BY rowid LIMIT 1").get(r.url);
    return {...r,existing:!!existing,newsId:existing?.id||digest({source:LINKED_EVIDENCE_POLICY,url:r.url})};
   });
   const leads=resolved.filter(r=>!r.existing).map(r=>({id:r.newsId,title:('网页引用：'+r.link.label).slice(0,200),url:r.url,publisher:new URL(r.url).hostname,publishedAt:null,datePrecision:'unknown',provider:'linked-public-source',contentScope:'linked-reference',linkedReference:{schema:LINKED_EVIDENCE_POLICY,searchId:id,sourceNewsId:anchor.newsId,sourceNewsRevision:anchor.newsRevision,evidenceId:r.evidenceId,label:r.link.label,context:r.link.context,reason:r.reason,depth,lineage:chain}}));
   const p={anchor:frozen,automatic:true,policy:LINKED_EVIDENCE_POLICY,rulesHash:LINKED_EVIDENCE_HASH,executionHash:executionHash(),createdAt:at(),updatedAt:at(),sourceBasis:basis,lineage:chain,excluded,coverage:{scope:'frozen-article-and-publisher-attachment-links',requested:basis.requests.length,selected:resolved.length,excluded:excluded.length,depth,maximumCandidates:3,maximumDepth:2,newLeads:leads.length,reusedNews:resolved.length-leads.length},candidates:[],reason:resolved.length?'沿冻结材料的明确网页或附件链接补充研究；链接及读取成功均不证明内容成立或来源独立':'所选链接达到补读层级或返回已有上游材料，保留范围与缺口'};
   store.ingest(leads,at(),()=>{
    context.assertActive();guard();validAnchor(p);valid(p);
    for(const r of resolved){
     const n=store.newsById(r.newsId),queued=enqueueLinked(n,{searchId:id,anchor:p.anchor,request:r,context});
     p.candidates.push({newsId:n.id,revision:n.revision,pipelineId:queued.id,title:n.title,activated:queued.activated,created:!r.existing,initialStatus:queued.initialStatus,status:'pending',pairIds:[],reasons:[r.reason],requestedUrl:r.url,evidenceId:r.evidenceId,link:r.link,reason:'等待沿原队列读取、独立研究并比较'});
    }
    db.prepare('INSERT INTO research_evidence_searches VALUES(?,?,?,?)').run(id,anchor.id,resolved.length?'pending':'observing',JSON.stringify(p));
    audit(anchor.id,'linked-evidence-planned',{searchId:id,anchor:p.anchor,coverage:p.coverage,sourceRunId:basis.runId,candidates:p.candidates.map(c=>({newsId:c.newsId,revision:c.revision,created:c.created,activated:c.activated}))});
   });
   return;
  }
 }
 return {scan,valid};
}
