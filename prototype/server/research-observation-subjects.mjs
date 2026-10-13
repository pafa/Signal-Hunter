import {financialResearchBasis} from './research-financial-current.mjs';
import {currentDocumentResearch} from './research-document-context.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {materialComparisonSnapshot} from './semantic-materials.mjs';

// Only saved, validated research can enroll. Model candidates never enroll.
export function researchObservationSubjects(store,research,models,topics){
 // A monitor transaction can share a verified immutable reference between its
 // subjects. Keep only metadata, and never reuse it beyond this call or outside
 // a transaction where another connection could change the original bytes.
 const verified=new Map(),financial=new Map(),cacheReads=store.db.isTransaction;
 const financialBasis=ref=>{const key=JSON.stringify(ref);if(cacheReads&&financial.has(key))return financial.get(key);const value=financialResearchBasis(store.db,ref);if(cacheReads)financial.set(key,value);return value;};
 const frozen=ref=>{
  const key=JSON.stringify(ref);if(cacheReads&&verified.has(key))return verified.get(key);
  const {id,documentId,revision,method}=materialComparisonSnapshot(store.db,ref,{historical:true}),value={id,documentId,revision,method};
  if(cacheReads)verified.set(key,value);return value;
 };
 return topics.flatMap(topic=>{
  const saved=topic.dossier?.companyAssessment;
  if(!['company-assessment/2','company-assessment/3','company-assessment/4'].includes(saved?.version))return [];
  const subject={kind:'research',id:topic.id,title:topic.title,version:saved.savedInResearchVersion,preparedAt:saved.preparedAt,runId:saved.sourceModelRunId,assessments:saved.assessments,baseline:null,current:topic,ready:false,fresh:false,changed:topic.version!==saved.savedInResearchVersion,reason:'保存的研究或模型依据无法核对'};
  try{
   const baseline=research.historyDetail(topic.id,saved.savedInResearchVersion).topic,run=models.get(topic.id,saved.sourceModelRunId);
   if(run.status!=='adopted'||digest(baseline.dossier?.companyAssessment)!==digest(saved)||saved.inputHash!==run.packet.inputHash||saved.inputTopicVersion!==run.packet.input.topicVersion||saved.savedInResearchVersion!==saved.inputTopicVersion+1||digest(saved.assessments)!==digest(run.candidate.companyAssessments))throw Error('Invalid saved binding');
   validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
   // Validate the exact saved bytes before deciding whether sources changed.
   // Missing/corrupt history is unknown, not evidence of a research change.
   const materials=new Map(baseline.evidence.filter(e=>e.materialId).map(e=>[e.materialId,frozen({id:e.materialId,revision:e.materialRevision})]));
   // All retained versions above are verified. Older financial evidence is
   // historical once this very dossier includes a newer version of that URL;
   // compare the newest included version to the source archive, not each old
   // revision independently. Unseen later revisions must still expire it.
   const includedFinancial=new Map();
   for(const m of materials.values())if(['public-financial','public-filing'].includes(m.method))includedFinancial.set(m.documentId,Math.max(includedFinancial.get(m.documentId)||0,m.revision));
   const frozenPrices=new Set([...(baseline.researchPrices||[]),...(baseline.monitoringReview?.priorPrices||[])].filter(p=>p.status==='saved').map(p=>p.materialId));
   if(run.packet.businessFactContract)subject.businessFactContract=run.packet.businessFactContract;
   subject.automaticReview=run.actor?.kind==='system'&&run.actor?.policy==='automatic-research/1'&&!!store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND status='completed' AND run_id=? AND json_extract(payload,'$.automatic')=1 AND json_extract(payload,'$.adoptedVersion')=?").get(topic.id,run.id,saved.savedInResearchVersion);
   subject.baseline=baseline;subject.ready=true;
   let sourceCurrent=true;
   try{
    for(const e of baseline.evidence){
     // Another topic may fetch the same market URL again. Its newer price
     // snapshot does not revise this topic's research; live price conditions
     // use the independent monitored quote and its freshness checks.
     if(e.materialId){
      const m=materials.get(e.materialId),latest=store.db.prepare('SELECT id,revision FROM research_materials WHERE document_id=? ORDER BY revision DESC LIMIT 1').get(m.documentId);
      const historicalFinancial=['public-financial','public-filing'].includes(m.method)&&m.revision<includedFinancial.get(m.documentId);
      if(!historicalFinancial&&!(frozenPrices.has(e.materialId)&&m.method==='public-market')&&latest?.revision!==m.revision){
       if(['public-financial','public-filing'].includes(m.method)){
        try{if(financialBasis({id:m.id,revision:m.revision})!==financialBasis(latest))sourceCurrent=false;}
        catch{subject.ready=false;subject.reason='较新财务来源无法核对；保留旧依据与提醒，当前条件未知';return [subject];}
       }else sourceCurrent=false;
      }
     }
     if(e.newsId&&store.newsById(e.newsId)?.revision!==e.newsRevision)sourceCurrent=false;
    }
    let source=topic;
    if(topic.eventExtraction){eventComparisonSnapshot(store.db,{id:topic.id,revision:1});source=research.get(topic.eventExtraction.sourceTopicId);}
    if(source.sourceNewsId&&store.newsById(source.sourceNewsId)?.revision!==source.sourceNewsRevision)sourceCurrent=false;
   }catch{sourceCurrent=false;}
   subject.changed ||= !sourceCurrent||!currentDocumentResearch(store,research,topic);
   subject.fresh=topic.status==='active'&&!subject.changed;
   subject.reason=subject.fresh?'与已保存研究版本及来源一致':topic.status!=='active'?'研究已归档；旧条件只保留历史':'研究或来源已有变化；旧价格与期限条件停止判断';
  }catch{}
  return [subject];
 });
}
