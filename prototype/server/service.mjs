import {processMarketAccounts} from './market-execution.mjs';
import {openEvaluationReview} from './evaluation-review.mjs';
import {strategyProfiles} from '../shared/strategy-profiles.mjs';
import {openMarketSimulation} from './market-simulation.mjs';
import {openSemanticEvents} from './semantic-events.mjs';
import {marketFailure} from './market-diagnostics.mjs';
import {openObservationInbox} from './observation-inbox.mjs';
import {demoResearchSeeds,initializeDemoData} from './demo.mjs';
import {fetchMinutes} from './providers.mjs';
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
export function createService(store,{fetcher=fetch,newsCooldown=600000,quoteCooldown=60000,now=()=>Date.now(),mode='legacy',instance=null,backupTask=null,modelConfig=null,modelRunner,semanticRunner,marketInputs}={}){
  const offline=mode==='demo';
  const denyNetwork=()=>{throw new Error('离线演示不访问外部数据；请另行启动空白研究模式');};
  const clock=()=>new Date(now()).toISOString();
  const restorePending=()=>store.db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1';
  const semanticEvents=openSemanticEvents(store,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(semanticRunner?{runner:semanticRunner}:{}),now});
  const research=openResearch(store,{clock,semanticEvents,seed:mode!=='research'&&!restorePending(),...(offline?{seeds:demoResearchSeeds,sourceReader:denyNetwork}:{})});
  const paper=openPaper(store,research,{clock,seed:mode!=='research'&&!restorePending()});
  const evaluations=openEvaluationReview(store,{clock});
  const marketSimulations=Object.fromEntries(Object.entries(strategyProfiles).map(([accountId,profile])=>[accountId,openMarketSimulation(store,research,{accountId,profile,enabled:!offline,clock,...(marketInputs?{getInputs:()=>marketInputs(accountId)}:{})})]));
  const marketSimulation=marketSimulations.aggressive;
  const modelResearch=openModelResearchRuns(store,research,{enabled:!offline&&!!modelConfig,config:modelConfig||{},...(modelRunner?{runner:modelRunner}:{}),now});
  const intake=openNewsIntake(store,{clock});
  const continuity=openContinuity(store,{clock});
  const observations=openObservationInbox(store,{clock,getTopic:id=>research.get(id),offline,getMarketSnapshots:at=>offline?[]:Object.values(marketSimulations).map(m=>m.observationSnapshot(at))});
  let newsJob=null;const quoteJobs=new Map();let lastNewsAttempt=0;const quoteAttempts=new Map();
  const dailyJobs=new Map(),dailyAttempts=new Map();
  const active=(name,context)=>{if(restorePending())throw new Error('恢复副本需先完成核对确认');context?.assertActive?.();if(scheduler.snapshot()[name]?.paused)throw new Error('任务已暂停，请先在运行控制中恢复');};
  const startedAt=clock();
  const errorText=error=>error.name==='TimeoutError'?'上游请求超时':error.message==='fetch failed'?'上游连接失败':String(error.message).slice(0,160);
  let autoWatch=restorePending()?{added:[],deferred:[],restoreReviewRequired:true}:syncResearchWatches(store,research.list());
  if(offline&&!restorePending())initializeDemoData(store);
  const service={
    mode,instance,
    research,paper,observations,modelResearch,semanticEvents,evaluations,marketSimulation,marketSimulations,
    processEvents(){try{const changed=continuity.process(research.list());if(changed||store.checks().events?.state==='error')store.status('events',{state:'ok',receivedAt:clock()});return {ok:true,changed};}catch(error){store.status('events',{state:'error',attemptedAt:clock(),error:errorText(error)});return {error:errorText(error)};}},
    eventContinuity(params={}){return {...continuity.snapshot({...params,positions:paper.snapshot().positions,watchlist:store.watchlist()}),health:store.checks().events||{state:'pending'}};},
    eventDetail(id){return continuity.detail(id);},
    decideEvent(id,data){continuity.process(research.list());return continuity.decide(id,data);},
    health(){store.db.prepare('SELECT 1').get();return {ok:true,mode,offline,instance,startedAt,uptimeSeconds:Math.max(0,Math.floor((now()-Date.parse(startedAt))/1000)),restoreReviewRequired:store.db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1'};},
    operations(){return {tasks:scheduler.snapshot(),history:scheduler.history()};},
    controlOperation(name,action){return scheduler.control(name,action);},
    acknowledgeRestore(){
      if(!service.health().restoreReviewRequired)return;
      if(!Object.values(scheduler.snapshot()).every(t=>t.paused))throw new Error('Pause all tasks before acknowledging restore');
      store.db.exec('BEGIN IMMEDIATE');
      try{store.db.prepare("UPDATE settings SET value='0' WHERE key='restore_review_required'").run();store.db.prepare("INSERT INTO operation_audit(name,action,at) VALUES('restore','acknowledge',?)").run(clock());store.db.exec('COMMIT');}
      catch(error){store.db.exec('ROLLBACK');throw error;}
    },
    runOperation(name,input=null){if(offline&&!['backup','observations'].includes(name))denyNetwork();active(name);return scheduler.run(name,{force:true,input});},
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
    close(){return Promise.all([scheduler.stop(),modelResearch.close(),semanticEvents.close()]);},
    syncWatches(){if(!restorePending())autoWatch=syncResearchWatches(store,research.list());return autoWatch;},
    snapshot(){const topics=research.list(),book=paper.snapshot();const queue=continuity.queue({positions:book.positions,watchlist:store.watchlist()}),priorities=new Map(queue.map((n,i)=>[n.id,{priority:n.priority,rank:i}])),researchView=research.snapshot();researchView.inbox=researchView.inbox.map(n=>({...n,researchPriority:priorities.get(n.id)?.priority})).sort((a,b)=>(priorities.get(a.id)?.rank??Infinity)-(priorities.get(b.id)?.rank??Infinity));return {observationInbox:observations.snapshot(),eventContinuity:{...continuity.summary(),health:store.checks().events||{state:'pending'}},runtime:{mode,offline,instance},paper:book,workflow:topics.map(t=>assessTopic(t,{book})),operations:scheduler.snapshot(),operationHistory:scheduler.history(),dataCapabilities:dataCapabilities(store,clock(),{offline}),serviceHealth:service.health(),newsIntake:intake.snapshot(),autoWatch,settings:store.getSettings(),news:store.news(),watchlist:store.watchlist().map(w=>({...w,quote:store.quote(w.symbol),daily:store.daily(w.symbol)})),checks:store.checks(),serverTime:clock(),newsIntervalSeconds:newsCooldown/1000,quoteIntervalSeconds:quoteCooldown/1000,research:researchView};},
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
    async refreshQuote(symbol,context){
      if(offline)denyNetwork();active('minutes',context);
      if(!store.watchlist().some(w=>w.symbol===symbol))return {skipped:'not-watched'};
      if(quoteJobs.has(symbol))return quoteJobs.get(symbol);
      if(now()-Math.max(quoteAttempts.get(symbol)||0,Date.parse(store.checks()[symbol]?.attemptedAt)||0)<quoteCooldown)return {skipped:'cooldown'};
      quoteAttempts.set(symbol,now());const attemptedAt=clock();
      const job=(async()=>{try{
        const previous=store.quote(symbol),quote=await fetchMinutes(symbol,scopedFetcher(context));const noNewBar=!!previous&&previous.provider===quote.provider&&previous.providerTime===quote.providerTime;active('minutes',context);store.saveQuote(quote,clock());store.status(symbol,{state:'ok',attemptedAt,receivedAt:clock(),noNewBar});return {ok:true};
      }catch(error){active('minutes',context);store.status(symbol,{state:'error',attemptedAt,error:errorText(error),failure:marketFailure(error)});return {error:errorText(error)};}finally{quoteJobs.delete(symbol);}})();quoteJobs.set(symbol,job);return job;
    },
    tick(){if(restorePending())return Promise.resolve([{skipped:'restore-review-required'}]);research.process();service.processEvents();service.syncWatches();paper.expire();return scheduler.runAll();},
  };
  const providerFetch=createProviderGate(store,{fetcher,now});
  const scopedFetcher=context=>(url,options={})=>providerFetch(url,{...options,signal:context?.signal?AbortSignal.any([context.signal,...(options.signal?[options.signal]:[])]):options.signal},context);
  const scheduler=createPersistentScheduler(store.db,{execution:context=>offline?{skipped:'offline'}:processMarketAccounts(marketSimulations,context),observations:context=>{context.assertActive();return observations.process(research.list(),paper.snapshot());},news:context=>offline?{skipped:'offline'}:service.refreshNews(context),daily:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),3,w=>service.refreshDaily(w.symbol,!!context.input?.manual,context)),minutes:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),2,w=>service.refreshQuote(w.symbol,context)),...(backupTask?{backup:backupTask}:{})},{now,initiallyPaused:['execution'],intervals:{execution:10000,observations:10000,news:newsCooldown,daily:60000,minutes:quoteCooldown,backup:3600000}});
  return service;
}
