import {monitoringPreparation} from './system-monitoring-revisions.mjs';
import {useStoredResearchWorkflow} from './research-output-contract.mjs';
import {financialPreparation} from './system-financial-revisions.mjs';
import {SYSTEM_RESEARCH_ACTOR} from './research-actor.mjs';
import {FINANCIAL_RECOVERY_VERSION} from './financial-recovery.mjs';
import {identityPreparation} from './system-identity-revisions.mjs';
// One issuer per scheduler step; all attempts remain visible and other lanes run.
// Topic evidence, coverage and the queued dossier's new packet commit together.
export async function prepareEventFinancials({db,research,sources,row,p,context,now,guard,settings,read,valid,transaction,audit,fingerprint,beforePrepare}){
 const topic=research.get(row.topic_id),done=new Set((p.financial?.results||[]).map(x=>x.symbol));
 const recovery=p.financialFollowup,company=topic.companies.find(c=>!done.has(c.symbol)&&(!recovery||c.symbol===recovery.proof.symbol));if(!company)return null;
 if(beforePrepare&&!beforePrepare())return {ok:true,eventPreparationYield:row.id};
 const at=()=>new Date(now()).toISOString();let current=row;
 const check=()=>{context.assertActive();guard();if(!settings().financialSources)throw Error('官方财务补证已暂停');const latest=read(row.id);if(latest.status!=='queued'||latest.payload!==current.payload||latest.run_id)throw Error('财务补证任务已变化');valid(latest);};
 const localContext={...context,assertActive:check};
 const state=p.financial||{attempts:[],results:[]},previous=state.attempts.filter(x=>x.symbol===company.symbol&&x.state==='started'&&(!recovery||x.generation===recovery.proof.scopeHash)).length,exhausted=previous>=3,generationAttempt=Math.min(previous+1,3),attempt=(recovery?3:0)+generationAttempt,generation=recovery?{generation:recovery.proof.scopeHash,generationAttempt}:{};
 const started=exhausted?state:{...state,attempts:[...state.attempts,{symbol:company.symbol,state:'started',attempt,...generation,at:at()}]};
 if(!exhausted)transaction(()=>{check();db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify({...p,financial:started,reason:`正在补充 ${company.symbol} 官方财务依据`}),row.id);audit(row.item_id,'financial-source-started',{jobId:row.id,symbol:company.symbol,attempt,...generation});});
 current=read(row.id);
 function finish(result,material){
  const final={...result,attempt,...generation,at:at()},financial={results:[...started.results,final],attempts:[...started.attempts,{...final,state:result.status}]};
  research.recordFinancialSource(row.topic_id,{version:p.topicVersion},final,material,check,next=>{
   const packet=useStoredResearchWorkflow(research.packet(next.id),JSON.parse(current.payload).packet),payload={...JSON.parse(current.payload),...identityPreparation(JSON.parse(current.payload),topic,next,'financial'),...monitoringPreparation(JSON.parse(current.payload),topic,next,'financial'),...financialPreparation(JSON.parse(current.payload),topic,next),topicVersion:next.version,packet,executionHash:fingerprint('dossier',packet),financial,retryAt:null,reason:result.status==='saved'?'官方财务依据已保存，继续研判':result.reason};
   db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(payload),row.id);
   audit(row.item_id,'financial-source-'+result.status,{jobId:row.id,symbol:company.symbol,attempt,...generation,topicVersion:next.version,reason:result.reason||null});
  },recovery?{actor:SYSTEM_RESEARCH_ACTOR,schema:FINANCIAL_RECOVERY_VERSION,scopeHash:recovery.proof.scopeHash,previousResultHash:recovery.proof.priorResultHash,sourceJobId:recovery.sourceJobId,attempt:generationAttempt}:null);
  return {ok:true,financialSource:result.status,symbol:company.symbol,eventJobId:row.id};
 }
 if(exhausted)return finish({symbol:company.symbol,status:'unavailable',reason:'官方财务补证已尝试三次，含中断；保留缺口，继续研究'},null);
 if(!company.symbol.endsWith('.US'))return finish({symbol:company.symbol,status:'unsupported',reason:'SEC财务补证目前仅覆盖美国证券；本市场保留缺口，继续研究'},null);
 let material,error;
 try{material=await sources.read(company.symbol,localContext,{allowFilingGaps:generationAttempt>=3,...(recovery?{frozenSources:recovery.proof.sources}:{})});}catch(e){error=e;}
 check();
 if(!error)return finish({symbol:company.symbol,status:'saved',source:'SEC EDGAR',...(material.filingCoverage?{filings:material.filingCoverage}:{})},material);
 const reason=String(error.message||error).slice(0,240);
 if(generationAttempt>=3)return finish({symbol:company.symbol,status:'unavailable',reason:'官方财务补证三次未完成：'+reason+'；保留缺口，继续研究'},null);
 transaction(()=>{check();db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(current.payload),financial:{...started,attempts:[...started.attempts,{symbol:company.symbol,state:'failed',attempt,...generation,reason,at:at()}]},retryAt:now()+60000*generationAttempt,reason:'官方财务补证等待重试：'+reason}),row.id);audit(row.item_id,'financial-source-retry',{jobId:row.id,symbol:company.symbol,attempt,...generation,reason});});
 return {ok:true,financialSource:'retry',symbol:company.symbol,eventJobId:row.id};
}
