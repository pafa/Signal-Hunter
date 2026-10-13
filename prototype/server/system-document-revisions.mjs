import {monitoringResearchOrigin} from './system-monitoring-revisions.mjs';
import {financialResearchOrigin} from './system-financial-revisions.mjs';
import {identityResearchOrigin} from './system-identity-revisions.mjs';
import {digest} from './codex-research.mjs';
import {validateCandidate} from './model-research-runs.mjs';
const parse=row=>row&&JSON.parse(row.payload);
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));

// Only our exact append-only material preparation + model adoption can bridge
// an old request to today's topic. An intervening human edit breaks the chain.
export function documentResearchOrigin(db,topic,version,runId){
 let current=topic;
 const history=v=>{const t=parse(db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(topic.id,v));if(!t)throw Error('附件接续历史缺失');return t;};
 if(digest(history(current.version))!==digest(current))throw Error('当前研究与历史不符');
 while(current.version>version){
  const monitoringBase=monitoringResearchOrigin(db,current);if(monitoringBase){current=monitoringBase;continue;}
  const financialBase=financialResearchOrigin(db,current);if(financialBase){current=financialBase;continue;}
  const identityBase=identityResearchOrigin(db,current);if(identityBase){current=identityBase;continue;}
  const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND json_type(payload,'$.documentFollowup')='object' ORDER BY rowid DESC").all(topic.id);
  const row=rows.find(row=>{const p=parse(row);return p.topicVersion===current.version||p.topicVersion+1===current.version;});
  if(!row||!['queued','running','completed','observing'].includes(row.status))throw Error('原研究已修改或附件接续已停止');
  const p=parse(row),f=p.documentFollowup,prepared=history(p.topicVersion),before=history(f.baseVersion),parent=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(f.sourceJobId);
  const parentData=parse(parent),completedParent=parent?.status==='completed',changedParent=parent?.status==='observing'&&parentData.documentScopeChanged===true;
  if(!parent||parent.kind!=='dossier'||!completedParent&&!changedParent||parent.topic_id!==topic.id||(completedParent?parent.run_id:(parentData.documentFollowup||parentData.identityFollowup||parentData.financialFollowup||parentData.monitoringFollowup)?.baseRunId)!==f.baseRunId||!parentData.automatic||(completedParent?parentData.adoptedVersion:parentData.topicVersion)!==f.baseVersion)throw Error('原系统研判任务与接续不符');
  if(!p.automatic||f.schema!=='document-research/1'||p.topicVersion!==f.baseVersion+1||digest(before)!==f.baseHash||digest(prepared)!==f.preparedHash||before.dossier?.sourceModelRun?.id!==f.baseRunId||prepared.documentContext?.baseRunId!==f.baseRunId||prepared.documentContext?.sourceJobId!==f.sourceJobId)throw Error('附件接续版本不连续');
  if(digest(without(before,['version','updatedAt','evidence','documentContext']))!==digest(without(prepared,['version','updatedAt','evidence','documentContext']))||digest(prepared.evidence.filter(e=>e.documentRole!=='linked-attachment'))!==digest(before.evidence.filter(e=>e.documentRole!=='linked-attachment')))throw Error('附件准备改变了原研究');
  if(prepared.evidence.filter(e=>e.documentRole==='linked-attachment').some(e=>!prepared.documentContext.entries.some(c=>c.status==='available'&&c.evidenceId===e.id&&c.materialId===e.materialId&&c.materialRevision===e.materialRevision)))throw Error('附件准备含未声明材料');
  const run=row.run_id&&parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));
  if(run?.status==='cancelled')throw Error('附件研判已取消');
  if(current.version===p.topicVersion){if(digest(current)!==f.preparedHash)throw Error('附件准备后研究已编辑');}
  else{
   if(!run||run.status!=='adopted'||run.actor?.kind!=='system'||run.acceptedVersion!==current.version||run.packet.input.topicVersion!==p.topicVersion||run.topicId!==topic.id||current.dossier?.sourceModelRun?.id!==run.id||current.dossier?.actor?.kind!=='system')throw Error('附件研判没有系统保存依据');
   validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
   if(digest(without(current,['version','updatedAt','dossier','researchUpdatedAt']))!==digest(without(prepared,['version','updatedAt','dossier','researchUpdatedAt'])))throw Error('附件研判后研究已编辑');
   if(digest(current.dossier.sections)!==digest(run.candidate.sections)||digest(current.dossier.sourceRequests||[])!==digest(run.candidate.sourceRequests||[])||digest(current.dossier.missingEvidence)!==digest(run.candidate.missingEvidence))throw Error('附件研判与原输出不符');
  }
  current=before;
 }
 if(current.version!==version||current.status!=='active'||current.dossier?.sourceModelRun?.id!==runId)throw Error('原请求研判与当前系统接续不符');
 return current;
}
