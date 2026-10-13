import {monitoringPreparation} from './system-monitoring-revisions.mjs';
import {useStoredResearchWorkflow} from './research-output-contract.mjs';
import {identityPreparation} from './system-identity-revisions.mjs';
// One security/interval per scheduler step; all attempts remain visible and other lanes run.
// Topic evidence, coverage and the queued dossier's new packet commit together.
export async function prepareEventPrices({db,research,sources,row,p,context,now,guard,settings,read,valid,transaction,audit,fingerprint,beforePrepare}){
 const topic=research.get(row.topic_id),done=new Set((p.prices?.results||[]).map(x=>x.symbol+':'+x.interval));
 const target=topic.companies.flatMap(c=>['1d','1m'].map(interval=>({company:c,interval}))).find(t=>!done.has(t.company.symbol+':'+t.interval));if(!target)return null;
 if(beforePrepare&&!beforePrepare())return {ok:true,eventPreparationYield:row.id};
 const {company,interval}=target;
 const at=()=>new Date(now()).toISOString();let current=row;
 const check=()=>{context.assertActive();guard();if(!settings().researchPrices)throw Error('研究价量补充已暂停');const latest=read(row.id);if(latest.status!=='queued'||latest.payload!==current.payload||latest.run_id)throw Error('研究价量任务已变化');valid(latest);};
 const localContext={...context,assertActive:check};
 const state=p.prices||{attempts:[],results:[]},previous=state.attempts.filter(x=>x.symbol===company.symbol&&x.interval===interval&&x.state==='started').length,exhausted=previous>=3,attempt=Math.min(previous+1,3);
 const started=exhausted?state:{...state,attempts:[...state.attempts,{symbol:company.symbol,interval,state:'started',attempt,at:at()}]};
 if(!exhausted)transaction(()=>{check();db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify({...p,prices:started,reason:`正在补充 ${company.symbol} ${interval} 研究价量依据`}),row.id);audit(row.item_id,'research-price-started',{jobId:row.id,symbol:company.symbol,interval,attempt});});
 current=read(row.id);
 function finish(result,material){
  const final={...result,attempt,at:at()},prices={results:[...started.results,final],attempts:[...started.attempts,{...final,state:result.status}]};
  research.recordPriceSource(row.topic_id,{version:p.topicVersion},final,material,check,next=>{
   const packet=useStoredResearchWorkflow(research.packet(next.id),JSON.parse(current.payload).packet),payload={...JSON.parse(current.payload),...identityPreparation(JSON.parse(current.payload),topic,next,'prices'),...monitoringPreparation(JSON.parse(current.payload),topic,next,'prices'),topicVersion:next.version,packet,executionHash:fingerprint('dossier',packet),prices,retryAt:null,reason:result.status==='saved'?'研究价量依据已保存，继续研判':result.reason};
   db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(payload),row.id);
   audit(row.item_id,'research-price-'+result.status,{jobId:row.id,symbol:company.symbol,interval,attempt,topicVersion:next.version,reason:result.reason||null});
  });
  return {ok:true,researchPrice:result.status,symbol:company.symbol,interval,eventJobId:row.id};
 }
 if(exhausted)return finish({symbol:company.symbol,interval,status:'unavailable',reason:'研究价量补充已尝试三次，含中断；保留缺口，继续研究'},null);
 let material,error;
 try{material=await sources.read(company.symbol,interval,localContext);}catch(e){error=e;}
 check();
 if(!error)return finish({symbol:company.symbol,interval,status:'saved',source:material.marketSource.provider,dataAt:material.marketSource.diagnostics.dataAt,receivedAt:material.marketSource.source.receivedAt,dataState:material.marketSource.diagnostics.dataState},material);
 const reason=String(error.message||error).slice(0,240);
 if(attempt>=3)return finish({symbol:company.symbol,interval,status:'unavailable',reason:'研究价量补充三次未完成：'+reason+'；保留缺口，继续研究'},null);
 transaction(()=>{check();db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(current.payload),prices:{...started,attempts:[...started.attempts,{symbol:company.symbol,interval,state:'failed',attempt,reason,at:at()}]},retryAt:now()+60000*attempt,reason:'研究价量补充等待重试：'+reason}),row.id);audit(row.item_id,'research-price-retry',{jobId:row.id,symbol:company.symbol,interval,attempt,reason});});
 return {ok:true,researchPrice:'retry',symbol:company.symbol,interval,eventJobId:row.id};
}
