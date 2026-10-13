import {validateMonitoringFollowup} from './system-monitoring-revisions.mjs';
import {validateFinancialFollowup} from './system-financial-revisions.mjs';
import {identityResearchOrigin} from './system-identity-revisions.mjs';
import {documentResearchOrigin} from './system-document-revisions.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {DOCUMENT_CONTEXT_VERSION} from '../shared/research-document-context.mjs';
import {hasPublicReadReceipt} from './public-read-receipt.mjs';
const parse=row=>row&&JSON.parse(row.payload);

// A document link is independent of semantic event membership. Recheck the
// saved request and all parents without changing old judgments or queue state.
function selectedPlan(store,research,row,seen=new Set()){
 const db=store.db,p=parse(row);
 if(!row||seen.has(row.id)||seen.size>=2||!['pending','completed','observing'].includes(row.status))throw Error('附件补读计划不可用');
 seen.add(row.id);
 const n=store.newsById(p.anchor.newsId),job=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(p.anchor.id);
 const t=documentResearchOrigin(db,research.get(p.anchor.topicId),p.anchor.topicVersion,job?.run_id);
 const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(p.sourceBasis.runId));
 if(!p.automatic||p.anchor.kind!=='event'||t.status!=='active'||t.version!==p.anchor.topicVersion||!n||n.revision!==p.anchor.newsRevision||digest(eventComparisonSnapshot(db,{id:t.id,revision:1}))!==p.anchor.eventBasisHash||!job||job.kind!=='dossier'||job.status!=='completed'||!parse(job).automatic||job.run_id!==run?.id||t.dossier?.sourceModelRun?.id!==run?.id||run.status!=='adopted'||run.actor?.kind!=='system'||run.topicId!==t.id||run.acceptedVersion!==t.version||run.packet.inputHash!==p.sourceBasis.inputHash)throw Error('原通知研究或请求依据已变化');
 validateCandidate(run.candidate,run.packet,{model:run.model,topicId:t.id});
 const requests=run.candidate.sourceRequests||[];
 if(digest(t.dossier.sourceRequests||[])!==digest(requests)||!run.candidate.missingEvidence.length)throw Error('原通知附件请求与保存研究不符');
 const frozenRequests=requests.map(r=>({...r,link:run.packet.input.evidence.find(e=>e.id===r.evidenceId).material.sourceLinks.links.find(l=>l.url===r.url)}));
 if(digest(frozenRequests)!==digest(p.sourceBasis.requests))throw Error('附件补读请求已变化');
 if(p.policy==='linked-public-source/2'){
  let chain=[];
  if(n.provider==='linked-public-source'){
   const ref=n.linkedReference;
   if(ref?.schema!==p.policy||ref.depth!==1||!Array.isArray(ref.lineage)||ref.lineage.length!==1)throw Error('附件来源链层级不连续');
   const parentRow=db.prepare('SELECT * FROM research_evidence_searches WHERE id=?').get(ref.searchId);
   const parent=selectedPlan(store,research,parentRow,seen).plan;
   if(parent.policy!==p.policy||parent.coverage.depth!==ref.depth||parent.anchor.newsId!==ref.sourceNewsId||parent.anchor.newsRevision!==ref.sourceNewsRevision||digest(parent.lineage)!==digest(ref.lineage)||!parent.candidates.some(c=>c.newsId===n.id&&c.revision===n.revision&&c.requestedUrl===n.url&&c.evidenceId===ref.evidenceId))throw Error('附件上游来源链与请求不符');
   chain=parent.lineage;
  }
  chain=[...chain,{newsId:n.id,revision:n.revision,url:n.url}];
  if(p.coverage.depth!==chain.length||digest(p.lineage)!==digest(chain))throw Error('附件来源链与原计划不符');
 }else if(p.policy!=='linked-public-source/1')throw Error('附件来源协议不可用');
 return {plan:p,run};
}

export function documentGenerationChanged(store,research,row,configHash){
 try{const p=parse(row),t=research.get(row.topic_id);return !!(p.documentFollowup||p.identityFollowup||p.financialFollowup||p.monitoringFollowup)&&t.version===p.topicVersion&&(p.documentFollowup?digest(t)===p.documentFollowup.preparedHash:p.monitoringFollowup?!!validateMonitoringFollowup(store.db,t,row):p.financialFollowup?!!validateFinancialFollowup(store.db,t,row):!!identityResearchOrigin(store.db,t))&&p.configHash===configHash&&store.newsById(p.newsId)?.revision===p.newsRevision&&!currentDocumentResearch(store,research,t);}catch{return false;}
}
export function documentScope(context){return (context?.entries||[]).map(e=>({parentEvidenceId:e.parentEvidenceId,url:e.url,status:e.status,...(e.status==='available'?{materialId:e.materialId,materialRevision:e.materialRevision,newsId:e.newsId,newsRevision:e.newsRevision,sourceTopicId:e.sourceTopicId,sourceTopicVersion:e.sourceTopicVersion}:{})}));}
export function currentDocumentResearch(store,research,topic){
 if(!topic.documentContext)return true;
 return digest(documentScope(linkedDocumentContext(store,research,[{topic,packet:research.packet(topic.id)}])))===digest(documentScope(topic.documentContext));
}
export function linkedDocumentContext(store,research,members){
 const db=store.db,entries=[],documents=new Map();
 for(const {topic,packet} of members){
  const parents=packet.input.evidence.filter(e=>e.material?.extractionEvidence?.attachments?.length);
  if(!parents.length)continue;
  const plans=db.prepare("SELECT * FROM research_evidence_searches WHERE json_extract(payload,'$.anchor.topicId')=? AND json_extract(payload,'$.policy') IN ('linked-public-source/1','linked-public-source/2') ORDER BY rowid DESC").all(topic.id);
  for(const e of parents){
   const parent=immutableMaterialSnapshot(db,e.material);
   if(parent.method!=='public-web')continue;
   for(const attachment of parent.extractionEvidence.attachments){
    const link=parent.sourceLinks?.links.find(l=>l.url===attachment.url);
    const entry={parentTopicId:topic.id,parentEvidenceId:e.id,parentMaterialId:parent.id,parentMaterialRevision:parent.revision,url:attachment.url,label:attachment.label,status:'unread',reason:link?'尚无可用的自动归档附件，保留阅读缺口':'此格式或链接未进入自动补读范围'};
    entries.push(entry);if(!link)continue;
    try{
     const found=plans.find(row=>{const p=parse(row);return p.candidates?.some(c=>c.requestedUrl===link.url&&c.evidenceId===e.id);});
     if(!found)continue;
     const {plan:p,run}=selectedPlan(store,research,found),c=p.candidates.find(c=>c.requestedUrl===link.url&&c.evidenceId===e.id);
     entry.requested=true;entry.searchId=found.id;
     const frozen=run.packet.input.evidence.find(x=>x.id===e.id)?.material,request=run.candidate.sourceRequests?.find(x=>x.url===link.url&&x.evidenceId===e.id);
     if(!request||frozen?.id!==parent.id||frozen.revision!==parent.revision||!frozen.extractionEvidence?.attachments.some(a=>digest(a)===digest(attachment))||digest(frozen.sourceLinks.links.find(l=>l.url===link.url))!==digest(link)||digest(c.link)!==digest(link))throw Error('附件入口与冻结原文不符');
     const source=db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(c.pipelineId),news=store.newsById(c.newsId),payload=parse(source);
     if(!source||!payload.configuration?.automatic||source.news_id!==c.newsId||source.revision!==c.revision||news?.revision!==c.revision||news.url!==link.url)throw Error('附件新闻或队列版本已变化');
     if(['cancelled','invalidated'].includes(source.status))throw Error('附件任务已取消或失效');
     if(c.created){
      const ref=news.linkedReference;
      if(news.provider!=='linked-public-source'||ref?.searchId!==found.id||ref.sourceNewsId!==p.anchor.newsId||ref.sourceNewsRevision!==p.anchor.newsRevision||ref.evidenceId!==e.id||ref.schema!==p.policy)throw Error('附件来源链不符');
      if(p.policy==='linked-public-source/1'?ref.depth!==1:(![1,2].includes(ref.depth)||ref.depth!==p.coverage.depth||digest(ref.lineage)!==digest(p.lineage)))throw Error('附件来源链层级不符');
     }
     if(!source.topic_id)continue;
     const raw=research.get(source.topic_id);
     if(raw.status!=='active'||raw.sourceNewsId!==c.newsId||raw.sourceNewsRevision!==c.revision||raw.version!==payload.preparedTopicVersion)throw Error('附件来源研究已修改或归档');
     const matches=raw.evidence.filter(x=>x.materialId&&(x.url===link.url||hasPublicReadReceipt(db,{topicId:raw.id,intakeId:source.id,requestedUrl:link.url,materialId:x.materialId,materialRevision:x.materialRevision,finalUrl:x.url})));if(matches.length!==1)continue;
     const ref=matches[0],material=immutableMaterialSnapshot(db,{id:ref.materialId,revision:ref.materialRevision}),latest=db.prepare('SELECT MAX(revision) revision FROM research_materials WHERE document_id=?').get(material.documentId);
     if(material.method!=='public-web'||material.url!==ref.url||material.revision!==latest.revision)throw Error('附件归档版本已变化或不是公开读取结果');
     Object.assign(entry,{status:'available',reason:'原通知明确附件入口与已归档URL/版本对应；文档关联，事实仍待核实',materialId:material.id,materialRevision:material.revision,sourceTopicId:raw.id,sourceTopicVersion:raw.version,newsId:news.id,newsRevision:news.revision,searchId:found.id,sourceRunId:run.id});
     documents.set(material.id,{material,sourceTopicId:raw.id,originalEvidenceId:ref.id});
    }catch(error){entry.reason=error.message;}
   }
  }
 }
 return entries.length?{schema:DOCUMENT_CONTEXT_VERSION,entries,documents:[...documents.values()]}:null;
}
