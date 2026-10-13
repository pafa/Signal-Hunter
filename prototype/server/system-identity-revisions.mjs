import {digest} from './codex-research.mjs';
import {validateSavedCandidate} from './company-entity-runs.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
const parse=row=>row&&JSON.parse(row.payload);
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
const same=(a,b)=>digest(a)===digest(b);
const system=value=>value?.actor?.kind===SYSTEM_RESEARCH_ACTOR.kind&&value.actor.policy===SYSTEM_RESEARCH_ACTOR.policy;

export function identityPreparation(payload,before,after,kind){
 if(!payload.identityFollowup)return {};
 return {identityFollowup:{...payload.identityFollowup,preparations:[...(payload.identityFollowup.preparations||[]),{kind,beforeVersion:before.version,version:after.version,beforeHash:digest(before),hash:digest(after)}]}};
}

// Reconstruct only an authenticated system link/preparation/adoption chain.
// This keeps existing document requests usable without tolerating human edits.
export function identityResearchOrigin(db,topic){
 const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND json_type(payload,'$.identityFollowup')='object' ORDER BY rowid DESC").all(topic.id);
 let row=rows.find(r=>{const p=parse(r);return p.topicVersion===topic.version||p.topicVersion+1===topic.version&&r.run_id&&topic.dossier?.sourceModelRun?.id===r.run_id;});
 if(!row){
  // Linking is durable per company. A restart or failed child insertion must
  // not invalidate attachments while this same identity job is still settling.
  const pending=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='identity' AND status='running' AND json_type(payload,'$.identityFollowup')='object' AND json_extract(payload,'$.topicVersion')<? ORDER BY rowid DESC LIMIT 1").get(topic.id,topic.version);
  if(pending){const ip=parse(pending);row={...pending,run_id:null,payload:JSON.stringify({automatic:ip.automatic,topicVersion:topic.version,identityFollowup:{...ip.identityFollowup,identityJobId:pending.id,linkedVersion:topic.version,linkedHash:digest(topic),preparations:[]}})};}
 }
 if(!row)return null;
 const fail=()=>{throw Error('身份接续版本或系统依据不连续');};
 if(!['queued','running','completed','observing'].includes(row.status))fail();
 const p=parse(row),f=p.identityFollowup,history=v=>parse(db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(topic.id,v));
 const before=history(f.baseVersion),prepared=history(p.topicVersion),identity=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(f.identityJobId),ip=parse(identity),parent=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE id=?').get(f.sourceJobId),parentData=parse(parent);
 if(!before||!prepared||!same(history(topic.version),topic)||!p.automatic||f.schema!=='identity-research/1'||digest(before)!==f.baseHash||parent?.status!=='completed'||parent.kind!=='dossier'||parent.topic_id!==topic.id||parent.run_id!==f.baseRunId||!parentData.automatic||parentData.adoptedVersion!==f.baseVersion||before.dossier?.sourceModelRun?.id!==f.baseRunId||identity?.kind!=='identity'||identity.topic_id!==topic.id||!['running','completed'].includes(identity.status)||!ip.automatic||ip.topicVersion!==f.baseVersion||!same(ip.identityFollowup,without(f,['identityJobId','linkedVersion','linkedHash','preparations'])))fail();
 const run=parse(db.prepare('SELECT payload FROM company_entity_runs WHERE id=?').get(identity.run_id));
 if(!run||run.status!=='candidate'||run.packet.inputHash!==ip.packet.inputHash)fail();validateSavedCandidate(run);
 const decisions=db.prepare('SELECT * FROM company_entity_decisions WHERE run_id=? ORDER BY json_extract(payload,\'$.researchVersion\')').all(run.id);
 let current=before;
 for(const drow of decisions){
  const d=parse(drow),next=history(current.version+1),mention=run.candidate.resolution.mentions[drow.mention_index];
  if(!system(d)||d.action!=='link'||d.researchVersion!==current.version+1||!next||!same(without(current,['version','updatedAt','companies']),without(next,['version','updatedAt','companies']))||next.companies.length!==current.companies.length+1||current.companies.some(c=>!next.companies.some(n=>same(c,n))))fail();
  const c=next.companies.find(c=>!current.companies.some(old=>old.symbol===c.symbol)),basis=c?.entityResolution;
  if(!c||c.symbol!==d.symbol||!system(basis)||basis.runId!==run.id||basis.mentionIndex!==drow.mention_index||basis.inputHash!==run.packet.inputHash||!same(basis.mention,mention)||!same(basis.identity,run.packet.input.directory.find(x=>x.symbol===c.symbol))||!same(basis.trace,run.candidate.trace)||run.packet.input.identityAttachment&&!same(basis.attachmentContext,run.packet.input.identityAttachment))fail();
  current=next;
 }
 if(current.version!==f.linkedVersion||current.version<=f.baseVersion||digest(current)!==f.linkedHash)fail();
 for(const receipt of f.preparations||[]){
  const next=history(receipt.version),key=receipt.kind==='prices'?'researchPrices':receipt.kind==='financial'?'financialSources':null,method=key==='researchPrices'?'system-public-market':'system-official-financial';
  if(!key||receipt.beforeVersion!==current.version||receipt.version!==current.version+1||digest(current)!==receipt.beforeHash||!next||digest(next)!==receipt.hash||!same(without(current,['version','updatedAt','evidence',key]),without(next,['version','updatedAt','evidence',key])))fail();
  const old=current[key]||[],added=next[key]?.at(-1);
  if(!added||next[key].length!==old.length+1||!same(next[key].slice(0,-1),old)||added.method!==method||!next.companies.some(c=>c.symbol===added.symbol)||!same(next.evidence.slice(0,current.evidence.length),current.evidence))fail();
  for(const e of next.evidence.slice(current.evidence.length)){const material=immutableMaterialSnapshot(db,{id:e.materialId,revision:e.materialRevision});if(!(key==='researchPrices'?['public-market']:['public-financial','public-filing']).includes(material.method))fail();}
  current=next;
 }
 if(current.version!==p.topicVersion||!same(current,prepared))fail();
 if(topic.version===p.topicVersion){if(!same(topic,current))fail();}
 else{
  const adopted=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));
  if(!adopted||adopted.status!=='adopted'||!system(adopted)||adopted.acceptedVersion!==topic.version||adopted.topicId!==topic.id||adopted.packet.input.topicVersion!==p.topicVersion||!system(topic.dossier)||topic.dossier.sourceModelRun?.id!==adopted.id||!same(without(topic,['version','updatedAt','dossier','researchUpdatedAt']),without(current,['version','updatedAt','dossier','researchUpdatedAt'])))fail();
  validateCandidate(adopted.candidate,adopted.packet,{model:adopted.model,topicId:topic.id});
  for(const key of ['sections','sourceRequests','missingEvidence'])if(!same(topic.dossier[key]||[],adopted.candidate[key]||[]))fail();
  if(!same(topic.dossier.companyAssessment?.assessments||[],adopted.candidate.companyAssessments||[]))fail();
 }
 return before;
}
