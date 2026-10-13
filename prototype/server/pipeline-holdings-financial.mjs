import {digest} from './codex-research.mjs';
import {automaticResearchPacket} from './research-output-contract.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {validateCandidate} from './model-research-runs.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {openMaterials} from './research-materials.mjs';
import {financialPreparation} from './system-financial-revisions.mjs';
import {HOLDINGS_FINANCIAL_VERSION,HOLDINGS_FINANCIAL_INTERVAL,holdingsFinancialBasis,storedHoldingsFinancialBasis,holdingsFinancialProof} from './holdings-financial-basis.mjs';
const parse=r=>r&&JSON.parse(r.payload);

// The daily discovery scheduler owns this lane. Account names, quantities and
// costs never enter its public-source request or the research model packet.
export function openHoldingsFinancial(store,research,{sources,holdingSymbols,now,guard,transaction,audit,settings,configHash,fingerprint,insert,valid}){
 const db=store.db,at=()=>new Date(now()).toISOString(),materials=openMaterials(db,{clock:at});
 db.exec('CREATE TABLE IF NOT EXISTS holdings_financial_checks(topic_id TEXT NOT NULL,symbol TEXT NOT NULL,next_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(topic_id,symbol))');
 const enabled=()=>sources?.enabled&&settings().automatic&&settings().financialSources;
 const save=(topic,symbol,state)=>db.prepare('INSERT INTO holdings_financial_checks VALUES(?,?,?,?) ON CONFLICT(topic_id,symbol) DO UPDATE SET next_at=excluded.next_at,payload=excluded.payload').run(topic.id,symbol,state.nextAt,JSON.stringify(state));
 function eligible(row,symbol){
  const p=parse(row),topic=research.get(row.topic_id);
  if(!holdingSymbols().includes(symbol)||topic.status!=='active'||!topic.companies.some(c=>c.symbol===symbol)||topic.version!==p.adoptedVersion||topic.dossier?.sourceModelRun?.id!==row.run_id||p.configHash!==configHash()||store.newsById(p.newsId)?.revision!==p.newsRevision||!['completed','observing'].includes(db.prepare('SELECT status FROM research_pipeline_items WHERE id=?').get(row.item_id)?.status))throw Error('持仓或财务研究依据已变化');
  const run=parse(db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id));
  if(run?.status!=='adopted'||run.actor?.kind!==SYSTEM_RESEARCH_ACTOR.kind||run.actor.policy!==SYSTEM_RESEARCH_ACTOR.policy||run.acceptedVersion!==topic.version)throw Error('持仓财务更新仅接续已保存的系统研判');
  validateCandidate(run.candidate,run.packet,{model:run.model,topicId:topic.id});
  return topic;
 }
 return {snapshot(){
  const lane=db.prepare("SELECT token,lease_until,paused FROM operation_tasks WHERE name='discovery'").get();
  return db.prepare('SELECT topic_id,symbol,payload FROM holdings_financial_checks ORDER BY rowid DESC LIMIT 30').all().map(r=>{const {token,...state}=parse(r);const job=state.jobId?db.prepare('SELECT status FROM research_pipeline_event_jobs WHERE id=?').get(state.jobId):null;return {topicId:r.topic_id,symbol:r.symbol,...state,...(job?{status:job.status}:{}),...(state.status==='reading'&&(!lane||lane.paused||lane.token!==token||lane.lease_until<=now())?{status:'interrupted'}:{})};});
 },async step(context){
  if(!enabled())return null;
  const held=new Set(holdingSymbols());if(!held.size)return null;
  const rows=db.prepare("SELECT j.* FROM research_pipeline_event_jobs j JOIN research_topics t ON t.id=j.topic_id WHERE j.kind='dossier' AND j.status='completed' AND json_extract(j.payload,'$.automatic')=1 AND json_extract(j.payload,'$.financialSources')=1 AND json_extract(t.payload,'$.version')=json_extract(j.payload,'$.adoptedVersion') AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs n WHERE n.topic_id=j.topic_id AND n.status IN ('queued','running')) ORDER BY j.rowid").all();
  for(const row of rows){
   const p=parse(row),base=research.get(row.topic_id);
   for(const previous of base.financialSources||[]){
    const symbol=previous.symbol;if(!held.has(symbol)||!symbol.endsWith('.US'))continue;
    const checkRow=db.prepare('SELECT * FROM holdings_financial_checks WHERE topic_id=? AND symbol=?').get(base.id,symbol),old=parse(checkRow);
    if((checkRow?.next_at??(Date.parse(previous.at)+HOLDINGS_FINANCIAL_INTERVAL))>now())continue;
    let topic;try{topic=eligible(row,symbol);}catch{continue;}
    const generation=digest({jobId:row.id,baseHash:digest(topic)}),attempt=old?.generation===generation&&old.status==='retry'&&old.attempt<3?old.attempt+1:1;
    const state={generation,attempt,status:'reading',token:context.token,startedAt:at(),nextAt:now()+HOLDINGS_FINANCIAL_INTERVAL};
    // Reserve before I/O. A restart cannot reset retries or hammer the source.
    const check=()=>{context.assertActive();guard();if(!enabled())throw Error('持仓财务检查已暂停');if(db.prepare('SELECT payload FROM research_pipeline_event_jobs WHERE id=?').get(row.id)?.payload!==row.payload||digest(eligible(row,symbol))!==digest(topic))throw Error('持仓财务检查依据已变化');};
    transaction(()=>{check();save(topic,symbol,state);audit(row.item_id,'holdings-financial-started',{symbol,topicId:topic.id,attempt});});
    try{
     const material=await sources.read(symbol,{...context,assertActive:check},{allowFilingGaps:attempt>=3});check();
     // Reuse the source parsers and raw-document verification before comparing.
     const prepared=[materials.prepare(topic.id,material,'public-financial'),...(material.filingMaterials||[]).map(m=>materials.prepare(topic.id,m,'public-filing'))];
     const nextBasis=holdingsFinancialBasis(prepared.map(x=>x.material)),previousBasis=storedHoldingsFinancialBasis(db,previous);
     if(nextBasis===previousBasis){
      transaction(()=>{check();save(topic,symbol,{...state,status:'unchanged',finishedAt:at()});audit(row.item_id,'holdings-financial-unchanged',{symbol,topicId:topic.id,nextAt:state.nextAt});});
      return {ok:true,holdingsFinancial:'unchanged',symbol};
     }
     const proof=holdingsFinancialProof(topic,symbol,nextBasis),id=digest({kind:HOLDINGS_FINANCIAL_VERSION,scopeHash:proof.scopeHash});
     const followup={schema:HOLDINGS_FINANCIAL_VERSION,sourceJobId:row.id,baseVersion:topic.version,baseRunId:row.run_id,baseHash:digest(topic),proof,preparations:[]};
     const result={symbol,status:'saved',source:'SEC EDGAR',filings:material.filingCoverage||[]};
     research.recordFinancialSource(topic.id,{version:topic.version},result,material,check,next=>{
      const packet=automaticResearchPacket(research.packet(next.id)),payload={...p,...financialPreparation({financialFollowup:followup},topic,next),topicVersion:next.version,packet,eventHash:digest(eventComparisonSnapshot(db,{id:topic.id,revision:1})),executionHash:fingerprint('dossier',packet),createdAt:at(),retryAt:null,previousRunId:null,reason:`持仓 ${symbol} 官方财务依据已变化，后台更新研判`,financial:{attempts:p.financial?.attempts||[],results:next.financialSources}};
      for(const key of ['monitoringFollowup','identityFollowup','documentFollowup','documentScopeChanged','documentPreparation','adoptedVersion','finishedAt','relationCoverage'])delete payload[key];
      const job={id,item_id:row.item_id,topic_id:topic.id,kind:'dossier',status:'queued'};
      insert(job,payload);valid({...job,payload:JSON.stringify(payload)});
      save(topic,symbol,{...state,status:'queued',finishedAt:at(),jobId:id,nextBasis});
      audit(row.item_id,'holdings-financial-updated',{symbol,topicId:topic.id,topicVersion:next.version,jobId:id,scopeHash:proof.scopeHash});
     },{actor:SYSTEM_RESEARCH_ACTOR,schema:HOLDINGS_FINANCIAL_VERSION,scopeHash:proof.scopeHash,previousResultHash:proof.priorResultHash,sourceJobId:row.id,attempt});
     return {ok:true,holdingsFinancial:'queued',symbol,eventJobId:id};
    }catch(error){
     // Pause, restore lock, sold holdings and user edits propagate cancellation;
     // they do not count as a source failure or overwrite the changed research.
     check();const reason=String(error.message||error).slice(0,240),retry=attempt<3;
     transaction(()=>{check();save(topic,symbol,{...state,status:retry?'retry':'unavailable',finishedAt:at(),reason,nextAt:retry?now()+60000*attempt:state.nextAt});audit(row.item_id,'holdings-financial-failed',{symbol,topicId:topic.id,attempt,reason,retry});});
     return {ok:true,holdingsFinancial:retry?'retry':'unavailable',symbol};
    }
   }
  }
  return null;
 }};
}
