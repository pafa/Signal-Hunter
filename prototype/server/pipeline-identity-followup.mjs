import {OWNERSHIP_CONNECTION_VERSION} from './company-ownership.mjs';
import {digest} from './codex-research.mjs';
import {EVENT_IDENTITY_CONTEXT_VERSION,eventIdentityContext} from './company-event-context.mjs';
import {companyEntitiesPacket} from './company-entities.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {validateCandidate} from './model-research-runs.mjs';

const parse=row=>row&&JSON.parse(row.payload);
const normalizedName=value=>value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
// Snapshot receipt times and unrelated listings are not new identity evidence.
export function identityDirectoryScope(packet,{ignoreParser=false}={}){
 const input=packet.input,quote=(input.identityAttachment?input.material.title+'\n'+input.material.body:input.identityEventContext?.quote||input.eventFocus?.quote||input.material.title+'\n'+input.material.body).normalize('NFKC').toLocaleLowerCase('en-US');
 const keys=['symbol','name','issuerKey','market','currency','venue','identityStatus','identitySource',...(!ignoreParser?['directoryVersion']:[]),'sourceSymbol','isin','reportedListingDate','financialStatus','listingValidity'];
 const directory=input.directory.filter(c=>[c.name,...(c.aliases||[]),c.symbol].some(n=>n&&quote.includes(n.normalize('NFKC').toLocaleLowerCase('en-US')))).map(c=>({...Object.fromEntries(keys.filter(k=>c[k]!==undefined).map(k=>[k,ignoreParser&&k==='name'?normalizedName(c[k]):c[k]])),aliases:ignoreParser?[...new Set([c.name,...(c.aliases||[])].map(normalizedName))].sort():[...(c.aliases||[])].sort()})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 return digest({...(input.identityConnectionVersion?{identityConnectionVersion:input.identityConnectionVersion}:{}),materialId:input.material.id,revision:input.material.revision,eventFocus:input.eventFocus,...(input.identityEventContext?{identityEventContext:input.identityEventContext}:{}),...(input.identityAttachment?{identityAttachment:input.identityAttachment}:{}),directory,coveredMarkets:[...(input.directoryCoverage?.coveredMarkets||[])].sort()});
}

export function openIdentityFollowup(store,research,{entities,directories,now,guard,transaction,audit,settings,used,configHash,fingerprint,insert,valid}){
 const db=store.db;
 return {
  discardRedundant(context){
   if(!entities||!directories||!settings().automatic)return null;
   const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j WHERE j.kind='identity' AND j.status='queued' AND j.run_id IS NULL AND json_extract(j.payload,'$.automatic')=1 AND json_extract(j.payload,'$.identityFollowup.schema')='identity-research/1' AND json_extract(j.payload,'$.identityFollowup.trigger') IS NULL AND NOT EXISTS(SELECT 1 FROM research_pipeline_attempts a WHERE a.item_id=j.id) ORDER BY j.rowid").all();
   for(const row of rows){
    const p=parse(row);let redundant=false;
    try{
     const scope=identityDirectoryScope(p.packet,{ignoreParser:true});
     const earlier=db.prepare("SELECT payload FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='identity' AND rowid<(SELECT rowid FROM research_pipeline_event_jobs WHERE id=?)").all(row.topic_id,row.id);
     redundant=earlier.some(r=>{const h=parse(r);return h.packet&&identityDirectoryScope(h.packet,{ignoreParser:true})===scope;});
    }catch{continue;}
    if(!redundant)continue;
    transaction(()=>{context.assertActive();guard();if(!settings().automatic||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload)throw Error('身份接续队列已变化');db.prepare("UPDATE research_pipeline_event_jobs SET status='invalidated',payload=? WHERE id=? AND status='queued' AND run_id IS NULL").run(JSON.stringify({...p,identityScopeUnchanged:true,reason:'名称依据与历史核对范围相同，跳过重复身份任务；原输入和结果保留'}),row.id);audit(row.item_id,'identity-research-redundant',{jobId:row.id});});
    return {ok:true,redundantIdentityJobId:row.id};
   }
   return null;
  },step(context){
  if(!entities||!directories||!settings().automatic||used()>=settings().dailyCalls)return null;
  const basis=directories.freezeBasis();
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j WHERE j.kind='identity' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1 AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs n WHERE n.topic_id=j.topic_id AND n.kind='identity' AND json_extract(n.payload,'$.request.materialId')=json_extract(j.payload,'$.request.materialId') AND coalesce(json_extract(n.payload,'$.identityScopeUnchanged'),0)!=1 AND n.rowid>j.rowid) ORDER BY j.rowid").all();
  for(const old of rows){
   const prior=parse(old);let topic,source,base,request,packet,scopeHash,connectionUpgrade=false;
   const legacyConnection=['company-attachment-entities-1','company-event-context-1'].includes(prior.packet?.schema);
   const sameBasis=prior.request?.directoryBasis?.schema===basis.schema&&digest(prior.request?.directoryBasis?.snapshotIds||[])===digest(basis.snapshotIds)&&prior.request?.directoryBasis?.asOf?.slice(0,10)===basis.asOf.slice(0,10)&&(prior.packet?.input?.identityAttachment||prior.request?.identityContextVersion===EVENT_IDENTITY_CONTEXT_VERSION||!eventIdentityContext(prior.packet?.input?.material,prior.packet?.input?.eventFocus));
   if(sameBasis&&!legacyConnection)continue;
   try{
    topic=research.get(old.topic_id);
    if(topic.status!=='active'||prior.configHash!==configHash()||store.newsById(prior.newsId)?.revision!==prior.newsRevision)continue;
    if(!['unresolved','unavailable'].includes(prior.identityOutcome)&&topic.companies.length)continue;
    if(!['completed','observing'].includes(db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(old.item_id)?.status))continue;
    if(db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE topic_id=? AND status IN ('queued','running')").get(topic.id))continue;
    const decisions=db.prepare('SELECT d.payload FROM company_entity_decisions d JOIN company_entity_runs r ON r.id=d.run_id WHERE r.topic_id=?').all(topic.id).map(parse);
    if(decisions.some(d=>d.actor?.kind!==SYSTEM_RESEARCH_ACTOR.kind||d.actor?.policy!==SYSTEM_RESEARCH_ACTOR.policy))continue;
    const previous=entities.get(topic.id,old.run_id);if(previous.stale||!['candidate','failed','interrupted'].includes(previous.status))continue;
    connectionUpgrade=legacyConnection&&previous.status==='candidate'&&previous.candidate.resolution.mentions.some(m=>m.eventConnection?.relation==='context'&&m.entityType==='company'&&m.resolution==='candidate'&&m.symbols.length===1&&!topic.companies.some(c=>c.symbol===m.symbols[0]));
    if(sameBasis&&!connectionUpgrade)continue;
    source=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND status='completed' AND run_id=?").get(topic.id,topic.dossier?.sourceModelRun?.id||'');base=parse(source);
    if(!base?.automatic||base.adoptedVersion!==topic.version||base.configHash!==configHash())continue;
    const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(source.run_id));
    if(run?.status!=='adopted'||run.actor?.policy!==SYSTEM_RESEARCH_ACTOR.policy||run.acceptedVersion!==topic.version)continue;
    validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
    request={...prior.request,version:topic.version,directoryBasis:basis,identityContextVersion:EVENT_IDENTITY_CONTEXT_VERSION};packet=companyEntitiesPacket(store,research,topic.id,request);scopeHash=identityDirectoryScope(packet);
    if(scopeHash===identityDirectoryScope(prior.packet)||identityDirectoryScope(packet,{ignoreParser:true})===identityDirectoryScope(prior.packet,{ignoreParser:true}))continue;
    // Returning to a previously exhausted basis does not buy a fresh retry budget.
    const history=db.prepare("SELECT payload FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='identity'").all(topic.id).map(parse);
    const semanticScope=identityDirectoryScope(packet,{ignoreParser:true});
    if(history.some(p=>p.packet&&(identityDirectoryScope(p.packet)===scopeHash||identityDirectoryScope(p.packet,{ignoreParser:true})===semanticScope)))continue;
   }catch{continue;}
   const id=digest({kind:'identity-research/1',topicId:topic.id,scopeHash}),payload={researchPrices:!!base.researchPrices,financialSources:!!base.financialSources,automatic:true,newsId:prior.newsId,newsRevision:prior.newsRevision,title:topic.title,topicVersion:topic.version,parentJobId:old.id,request,packet,configHash:configHash(),executionHash:fingerprint('identity',packet),createdAt:new Date(now()).toISOString(),reason:connectionUpgrade?'原背景提及按新版控股关系协议重新核对一次；旧判断保留，不直接改为母公司':'目录或有界原文上下文出现新的身份依据，后台继续核对；旧判断保留',identityFollowup:{schema:'identity-research/1',...(connectionUpgrade?{trigger:'ownership-contract',connectionVersion:OWNERSHIP_CONNECTION_VERSION}:{}),scopeHash,previousIdentityJobId:old.id,sourceJobId:source.id,baseVersion:topic.version,baseRunId:source.run_id,baseHash:digest(topic)}};
   const row={id,item_id:old.item_id,topic_id:topic.id,kind:'identity',status:'queued'};
   transaction(()=>{context.assertActive();guard();if(!settings().automatic||used()>=settings().dailyCalls||db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(old.id)?.payload!==old.payload||digest(research.get(topic.id))!==payload.identityFollowup.baseHash)throw Error('身份接续依据已变化');valid({...row,payload:JSON.stringify(payload)});insert(row,payload);audit(old.item_id,'identity-research-prepared',{jobId:id,sourceJobId:source.id,previousIdentityJobId:old.id,topicId:topic.id,scopeHash});});
   return {ok:true,identityResearchJobId:id};
  }
  return null;
 }};
}
