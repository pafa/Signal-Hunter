import {openExecutionInputs} from './execution-inputs.mjs';
import {openPriceCollection} from './price-collection.mjs';
import {openStorageMonitor} from './storage-monitor.mjs';
import {openForwardWindows} from './forward-windows.mjs';
import {openForwardReviews} from './forward-reviews.mjs';
import {openForwardEvaluations} from './forward-evaluations.mjs';
import {openResearchPipeline} from './research-pipeline.mjs';
import {openReferenceFx} from './reference-fx.mjs';
import {openSecurityDirectory} from './security-directory.mjs';
import {openCompanyEntityRuns} from './company-entity-runs.mjs';
import {openMaterialEventRuns} from './material-event-runs.mjs';
import {processMarketAccounts} from './market-execution.mjs';
import {openEvaluationReview} from './evaluation-review.mjs';
import {openEventPrices} from './event-prices.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {openMarketSimulation} from './market-simulation.mjs';
import {openSemanticEvents} from './semantic-events.mjs';
import {openSemanticBatches} from './semantic-batches.mjs';
import {openEventClusters} from './event-clusters.mjs';
import {marketFailure} from './market-diagnostics.mjs';
import {openObservationInbox} from './observation-inbox.mjs';
import {demoResearchSeeds,initializeDemoData} from './demo.mjs';
import {fetchMinutes} from './providers.mjs';
import {openHistoricalComparisons} from './historical-comparisons.mjs';
import {openHistoricalRecall} from './historical-recall.mjs';
import {openContinuity} from './event-continuity.mjs';
import {openNewsIntake,newsQueries} from './news-intake.mjs';
import {officialQueries,newsWindow} from './news-sources.mjs';
import {openResearch} from './research.mjs';
import {openPaper} from './paper.mjs';
import {assessTopic,syncResearchWatches} from './workflow.mjs';
import {fetchDaily} from './daily.mjs';
import {pool} from './scheduler.mjs';
import {createPersistentScheduler} from './persistent-scheduler.mjs';
import {createProviderGate} from './provider-gate.mjs';
import {dataCapabilities} from './data-capabilities.mjs';
import {dailyHealth} from '../shared/market-clock.mjs';
import {openModelResearchRuns} from './model-research-runs.mjs';
export function createService(store,{fetcher=fetch,newsCooldown=600000,quoteCooldown=60000,now=()=>Date.now(),mode='legacy',instance=null,backupTask=null,storageConfig=null,modelConfig=null,modelRunner,sourceReader,semanticRunner,materialEventRunner,companyEntityRunner,marketInputs,executionConfig=null}={}){
  const storageMonitor=storageConfig?openStorageMonitor(store.db,{...storageConfig,now}):null;
  const offline=mode==='demo';
  const denyNetwork=()=>{throw new Error('离线演示不访问外部数据；请另行启动空白研究模式');};
  const clock=()=>new Date(now()).toISOString();
  const restorePending=()=>store.db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1';
  const semanticEvents=openSemanticEvents(store,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(semanticRunner?{runner:semanticRunner}:{}),now});
  const semanticBatches=openSemanticBatches(store,semanticEvents,{enabled:!offline&&!!modelConfig,config:modelConfig||{},now});
  const eventClusters=openEventClusters(store,semanticBatches,semanticEvents,{now});
  const referenceFx=openReferenceFx(store,{enabled:!offline,fetcher,now});
  const securityDirectory=openSecurityDirectory(store,{enabled:!offline,fetcher,now});
  const research=openResearch(store,{clock,semanticEvents,eventClusters,securityDirectory,seed:mode!=='research'&&!restorePending(),...(offline?{seeds:demoResearchSeeds,sourceReader:denyNetwork}:sourceReader?{sourceReader}:{})});
  const paper=openPaper(store,research,{clock,seed:mode!=='research'&&!restorePending()});
  const evaluations=openEvaluationReview(store,{clock});
  const eventPrices=openEventPrices(store,evaluations,{enabled:mode==='research',now});
  const priceCollection=openPriceCollection(store,{enabled:mode==='research',now,rulesHash:research.screenings.rulesHash,isPaused:()=>!!scheduler.snapshot().pricecollection?.paused,fetchQuote:(symbol,context)=>refreshQuoteForLane(symbol,context,'pricecollection')});
  if(marketInputs&&executionConfig)throw Error('测试执行输入与正式来源配置不能并用');
  const executionInputs=openExecutionInputs(store,{config:executionConfig,now,enabled:mode==='research'});
  const marketSimulations=Object.fromEntries(Object.entries(strategyProfiles).map(([accountId,profile])=>[accountId,openMarketSimulation(store,research,{accountId,profile,enabled:!offline,clock,getInputs:()=>marketInputs?marketInputs(accountId):executionInputs.inputs()})]));
  const marketSimulation=marketSimulations.aggressive;
  const forwardEvaluations=openForwardEvaluations(store,research,eventClusters,{enabled:mode==='research'&&!!modelConfig,config:modelConfig||{},now});
  const forwardReviews=openForwardReviews(store,research,forwardEvaluations,{enabled:mode==='research',now});
  const forwardWindows=openForwardWindows(store,forwardEvaluations,forwardReviews,{enabled:mode==='research',now});
  const modelResearch=openModelResearchRuns(store,research,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(modelRunner?{runner:modelRunner}:{}),now,onStart:run=>forwardEvaluations.capture(run)});
  const materialEvents=openMaterialEventRuns(store,research,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(materialEventRunner?{runner:materialEventRunner}:{}),now});
  const researchPipeline=openResearchPipeline(store,research,modelResearch,{enabled:!offline&&!!modelConfig,config:modelConfig||{},now,materialEvents,batches:semanticBatches,clusters:eventClusters,semantic:semanticEvents,recall:newsId=>{continuity.process(research.list());return continuity.recall(newsId);}});
  const companyEntities=openCompanyEntityRuns(store,research,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(companyEntityRunner?{runner:companyEntityRunner}:{}),now});
  const intake=openNewsIntake(store,{clock});
  const continuity=openContinuity(store,{clock}),historicalRecall=openHistoricalRecall(store,{now,mode});
  const observations=openObservationInbox(store,{clock,getTopic:id=>research.get(id),offline,clustersForTopic:topic=>eventClusters.forResearch(topic),getMarketSnapshots:at=>offline?[]:Object.values(marketSimulations).map(m=>m.observationSnapshot(at))});
  let newsJob=null;const quoteJobs=new Map();let lastNewsAttempt=0;const quoteAttempts=new Map();
  const dailyJobs=new Map(),dailyAttempts=new Map();
  const active=(name,context)=>{if(restorePending())throw new Error('恢复副本需先完成核对确认');context?.assertActive?.();if(scheduler.snapshot()[name]?.paused)throw new Error('任务已暂停，请先在运行控制中恢复');};
  const startedAt=clock();
  const errorText=error=>error.name==='TimeoutError'?'上游请求超时':error.message==='fetch failed'?'上游连接失败':String(error.message).slice(0,160);
  let autoWatch=restorePending()?{added:[],deferred:[],restoreReviewRequired:true}:syncResearchWatches(store,research.list());
  if(offline&&!restorePending())initializeDemoData(store);
  const service={
    mode,instance,
    research,researchPipeline,executionInputs,paper,observations,referenceFx,securityDirectory,modelResearch,materialEvents,companyEntities,semanticEvents,semanticBatches,eventClusters,evaluations,eventPrices,priceCollection,forwardEvaluations,forwardReviews,forwardWindows,marketSimulation,marketSimulations,
    processEvents(){try{const changed=continuity.process(research.list());if(changed||store.checks().events?.state==='error')store.status('events',{state:'ok',receivedAt:clock()});return {ok:true,changed};}catch(error){store.status('events',{state:'error',attemptedAt:clock(),error:errorText(error)});return {error:errorText(error)};}},
    eventContinuity(params={}){return {...continuity.snapshot({...params,positions:paper.snapshot().positions,watchlist:store.watchlist()}),health:store.checks().events||{state:'pending'}};},
    historicalRecall,historicalComparisons:openHistoricalComparisons(store,historicalRecall,semanticEvents,{now}),
    eventDetail(id){return continuity.detail(id);},
    decideEvent(id,data){continuity.process(research.list());return continuity.decide(id,data);},
    health(){store.db.prepare('SELECT 1').get();return {ok:true,mode,offline,instance,startedAt,uptimeSeconds:Math.max(0,Math.floor((now()-Date.parse(startedAt))/1000)),restoreReviewRequired:store.db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1'};},
    operations(){return {tasks:scheduler.snapshot(),history:scheduler.history()};},
    controlOperation(name,action){if(name==='pricecollection'&&action==='resume')priceCollection.activate();return scheduler.control(name,action);},
    acknowledgeRestore(){
      if(!service.health().restoreReviewRequired)return;
      if(!Object.values(scheduler.snapshot()).every(t=>t.paused))throw new Error('Pause all tasks before acknowledging restore');
      store.db.exec('BEGIN IMMEDIATE');
      try{store.db.prepare("UPDATE settings SET value='0' WHERE key='restore_review_required'").run();store.db.prepare("INSERT INTO operation_audit(name,action,at) VALUES('restore','acknowledge',?)").run(clock());store.db.exec('COMMIT');}
      catch(error){store.db.exec('ROLLBACK');throw error;}
    },
    runOperation(name,input=null){if(offline&&!['backup','observations','storage'].includes(name))denyNetwork();active(name);return scheduler.run(name,{force:true,input});},
    newsCoverageReport(input){return intake.report(input);},
    newsIntakeDetail(id){return intake.detail(id);},
    async backfillNews(input){
      if(offline)denyNetwork();active('news');
      const window=newsWindow(input,clock());
      if(!store.getSettings().newsHkmaEnabled)throw new Error('请先启用香港金管局来源');
      if(scheduler.snapshot().news.running||newsJob)throw new Error('新闻采集正在进行，请完成后再补采');
      const last=store.db.prepare("SELECT started_at FROM news_intake_runs WHERE query_id='hkma' ORDER BY started_at DESC,rowid DESC LIMIT 1").get();
      if(last&&now()-Date.parse(last.started_at)<60000)throw new Error('金管局最近已请求，请至少间隔一分钟后补采');
      const result=await scheduler.run('news',{force:true,input:{kind:'backfill',...window}});
      if(result?.skipped)throw new Error('本次补采未取得任务，请稍后重试');
      return result;
    },
    close(){return Promise.all([scheduler.stop(),referenceFx.close(),securityDirectory.close(),modelResearch.close(),materialEvents.close(),companyEntities.close(),semanticEvents.close()]);},
    syncWatches(){if(!restorePending())autoWatch=syncResearchWatches(store,research.list());return autoWatch;},
    snapshot(){const topics=research.list(),news=store.news(),watchlist=store.watchlist(),book=paper.snapshot();const queue=continuity.queue({positions:book.positions,watchlist}),priorities=new Map(queue.map((n,i)=>[n.id,{priority:n.priority,rank:i}])),researchView=research.snapshot({topics,news});researchView.inbox=researchView.inbox.map(n=>({...n,researchPriority:priorities.get(n.id)?.priority})).sort((a,b)=>(priorities.get(a.id)?.rank??Infinity)-(priorities.get(b.id)?.rank??Infinity));return {executionData:executionInputs.status(),priceCollection:priceCollection.snapshot(),storageMonitor:storageMonitor?.snapshot()??null,researchPipeline:researchPipeline.snapshot(),observationInbox:observations.summary(),eventContinuity:{...continuity.summary(),health:store.checks().events||{state:'pending'}},runtime:{mode,offline,instance},paper:book,workflow:topics.map(t=>assessTopic(t,{book})),operations:scheduler.snapshot(),operationHistory:scheduler.history(),dataCapabilities:dataCapabilities(store,clock(),{offline}),serviceHealth:service.health(),newsIntake:intake.snapshot(),autoWatch,settings:store.getSettings(),news,watchlist:watchlist.map(w=>({...w,quote:store.quote(w.symbol),daily:store.daily(w.symbol)})),checks:store.checks(),serverTime:clock(),newsIntervalSeconds:newsCooldown/1000,quoteIntervalSeconds:quoteCooldown/1000,research:researchView};},
    async refreshDaily(symbol,force=false,context){
      if(offline)denyNetwork();active('daily',context);
      if(!store.watchlist().some(w=>w.symbol===symbol))throw new Error('仅获取关注标的日线');
      if(dailyJobs.has(symbol))return dailyJobs.get(symbol);
      const cached=store.daily(symbol),at=now(),last=dailyAttempts.get(symbol)||(store.checks()['daily:'+symbol]?.attemptedAt?{at:Date.parse(store.checks()['daily:'+symbol].attemptedAt)}:null),health=dailyHealth(symbol,cached,new Date(at).toISOString());
      const age=last?at-last.at:Infinity,newSession=!!health.expectedDate&&health.expectedDate!==last?.expectedDate;
      if(age<60000||(!force&&(!newSession&&age<900000||cached&&health.status==='aligned'&&store.checks()['daily:'+symbol]?.state!=='error'&&at-Date.parse(cached.receivedAt)<21600000)))return {skipped:'cooldown'};
      dailyAttempts.set(symbol,{at,expectedDate:health.expectedDate});const attemptedAt=new Date(at).toISOString();
      const job=(async()=>{try{const quote=await fetchDaily(symbol,scopedFetcher(context),clock);active('daily',context);
        if(cached?.lastDate&&quote.lastDate<cached.lastDate){
          store.saveDaily(quote,{activate:false});
          const error=new Error(`来源有效日线退至 ${quote.lastDate}；已留档并保留 ${cached.lastDate} 缓存`);error.kind='daily-regression';throw error;
        }
        store.saveDaily(quote);store.status('daily:'+symbol,{state:'ok',attemptedAt,receivedAt:quote.receivedAt,noNewBar:!!cached&&cached.lastDate===quote.lastDate});return {ok:true};}
      catch(error){active('daily',context);store.status('daily:'+symbol,{state:'error',attemptedAt,error:errorText(error),failure:marketFailure(error)});return {error:errorText(error)};}finally{dailyJobs.delete(symbol);}})();
      dailyJobs.set(symbol,job);return job;
    },
    async refreshNews(context){
      if(offline)denyNetwork();active('news',context);
      if(newsJob)return newsJob;
      const input=context?.input,backfill=input?.kind==='backfill';
      if(!backfill&&now()-Math.max(lastNewsAttempt,Date.parse(store.checks().news?.attemptedAt)||0)<newsCooldown)return {skipped:'cooldown'};
      const window=backfill?newsWindow({sourceId:input.sourceId,from:input.from,to:input.to},clock()):null;
      const queries=(backfill?officialQueries(store.getSettings(),clock(),window):newsQueries(store.getSettings(),clock())).filter(q=>q.enabled);
      if(!queries.length){store.status(backfill?'news-backfill':'news',{state:'disabled'});return {skipped:'all-queries-disabled'};}
      if(!backfill)lastNewsAttempt=now();const attemptedAt=clock();const keywords=store.getSettings().keywords;
      newsJob=(async()=>{try{
        const results=[];
        for(const query of queries){active('news',context);results.push(await intake.run(query,scopedFetcher(context),context));}
        active('news',context);research.process();service.processEvents();
        const success=results.filter(r=>r.state==='ok'||r.state==='partial'),errors=results.filter(r=>r.error).map(r=>errorText(new Error(r.error)));
        store.status(backfill?'news-backfill':'news',{state:errors.length?(success.length?'partial':'error'):'ok',attemptedAt,...(success.length?{receivedAt:clock()}:{}),count:success.reduce((n,r)=>n+r.acceptedCount,0),added:success.reduce((n,r)=>n+r.added,0),updated:success.reduce((n,r)=>n+r.updated,0),keywords,...(errors.length?{error:errors.join('；')}:{}),queryCount:queries.length});return results.flatMap(r=>r.state==='partial'?[{ok:true},r]:[r]);
      }catch(error){active('news',context);store.status(backfill?'news-backfill':'news',{state:'error',attemptedAt,error:errorText(error),keywords});return {error:errorText(error)};}finally{newsJob=null;}})();
      return newsJob;
    },
    refreshQuote(symbol,context){return refreshQuoteForLane(symbol,context,'minutes');},
    tick(){if(restorePending())return Promise.resolve([{skipped:'restore-review-required'}]);research.process();service.processEvents();service.syncWatches();paper.expire();return scheduler.runAll();},
  };
  const providerFetch=createProviderGate(store,{fetcher,now});
  const scopedFetcher=context=>(url,options={})=>providerFetch(url,{...options,signal:context?.signal?AbortSignal.any([context.signal,...(options.signal?[options.signal]:[])]):options.signal},context);
  async function refreshQuoteForLane(symbol,context,lane){
      if(offline)denyNetwork();active(lane,context);
      if(lane==='minutes'&&!store.watchlist().some(w=>w.symbol===symbol))return {skipped:'not-watched'};
      if(quoteJobs.has(symbol))return lane==='minutes'?quoteJobs.get(symbol):{skipped:'symbol-busy'};
      if(now()-Math.max(quoteAttempts.get(symbol)||0,Date.parse(store.checks()[symbol]?.attemptedAt)||0)<quoteCooldown)return {skipped:'cooldown'};
      quoteAttempts.set(symbol,now());const attemptedAt=clock();
      const job=(async()=>{try{
        const quote=await fetchMinutes(symbol,scopedFetcher(context));active(lane,context);const receivedAt=clock(),saved=store.saveQuote(quote,receivedAt);
        if(!saved.activated){const message={'minute-regression':'分钟行情时间倒退','minute-future':'分钟行情含未来时间','minute-time-incomparable':'分钟行情来源时间无法比较'}[saved.reason]||'分钟行情未启用';const error=new Error(`${message}；已留档并保留原缓存`);error.kind=saved.reason;throw error;}
        store.status(symbol,{state:'ok',attemptedAt,receivedAt,noNewBar:saved.noNewBar??false,snapshotHash:saved.snapshotHash});return {ok:true};
      }catch(error){active(lane,context);store.status(symbol,{state:'error',attemptedAt,error:errorText(error),failure:marketFailure(error)});return {error:errorText(error)};}finally{quoteJobs.delete(symbol);}})();quoteJobs.set(symbol,job);return job;
    }
  const scheduler=createPersistentScheduler(store.db,{pricecollection:context=>mode==='research'?priceCollection.step(context):{skipped:'offline-or-legacy'},discovery:context=>offline?{skipped:'offline'}:researchPipeline.step(context),semantic:context=>offline?{skipped:'offline'}:semanticBatches.step(context),execution:context=>{if(offline)return {skipped:'offline'};executionInputs.refresh(context);return processMarketAccounts(marketSimulations,context);},observations:context=>{context.assertActive();return observations.process(research.list(),paper.snapshot());},news:context=>offline?{skipped:'offline'}:service.refreshNews(context),daily:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),3,w=>service.refreshDaily(w.symbol,!!context.input?.manual,context)),minutes:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),2,w=>service.refreshQuote(w.symbol,context)),...(backupTask?{backup:backupTask}:{}),...(storageMonitor?{storage:context=>storageMonitor.check(context)}:{})},{now,initiallyPaused:['pricecollection','execution','semantic','discovery','storage'],intervals:{pricecollection:10000,discovery:10000,semantic:10000,execution:10000,observations:10000,news:newsCooldown,daily:60000,minutes:quoteCooldown,backup:3600000,storage:3600000}});
  return service;
}
