import {demoResearchSeeds,initializeDemoData} from './demo.mjs';
import {fetchMinutes} from './providers.mjs';
import {openContinuity} from './event-continuity.mjs';
import {openNewsIntake,newsQueries} from './news-intake.mjs';
import {openResearch} from './research.mjs';
import {openPaper} from './paper.mjs';
import {assessTopic,syncResearchWatches} from './workflow.mjs';
import {fetchDaily} from './daily.mjs';
import {pool} from './scheduler.mjs';
import {createPersistentScheduler} from './persistent-scheduler.mjs';
import {createProviderGate} from './provider-gate.mjs';
import {dataCapabilities} from './data-capabilities.mjs';
import {dailyHealth} from '../shared/market-clock.mjs';
export function createService(store,{fetcher=fetch,newsCooldown=600000,quoteCooldown=60000,now=()=>Date.now(),mode='legacy',backupTask=null}={}){
  const offline=mode==='demo';
  const denyNetwork=()=>{throw new Error('离线演示不访问外部数据；请另行启动空白研究模式');};
  const clock=()=>new Date(now()).toISOString();
  const research=openResearch(store,{clock,seed:mode!=='research',...(offline?{seeds:demoResearchSeeds,sourceReader:denyNetwork}:{})});
  const paper=openPaper(store,research,{clock,seed:mode!=='research'});
  const intake=openNewsIntake(store,{clock});
  const continuity=openContinuity(store,{clock});
  let newsJob=null;const quoteJobs=new Map();let lastNewsAttempt=0;const quoteAttempts=new Map();
  const dailyJobs=new Map(),dailyAttempts=new Map();
  const active=(name,context)=>{context?.assertActive?.();if(scheduler.snapshot()[name]?.paused)throw new Error('任务已暂停，请先在运行控制中恢复');};
  const startedAt=clock();
  const errorText=error=>error.name==='TimeoutError'?'上游请求超时':error.message==='fetch failed'?'上游连接失败':String(error.message).slice(0,160);
  let autoWatch=syncResearchWatches(store,research.list());
  if(offline)initializeDemoData(store);
  const service={
    mode,
    research,paper,
    processEvents(){try{const changed=continuity.process(research.list());if(changed||store.checks().events?.state==='error')store.status('events',{state:'ok',receivedAt:clock()});return {ok:true,changed};}catch(error){store.status('events',{state:'error',attemptedAt:clock(),error:errorText(error)});return {error:errorText(error)};}},
    eventContinuity(params={}){return {...continuity.snapshot({...params,positions:paper.snapshot().positions,watchlist:store.watchlist()}),health:store.checks().events||{state:'pending'}};},
    eventDetail(id){return continuity.detail(id);},
    decideEvent(id,data){continuity.process(research.list());return continuity.decide(id,data);},
    health(){store.db.prepare('SELECT 1').get();return {ok:true,mode,offline,startedAt,uptimeSeconds:Math.max(0,Math.floor((now()-Date.parse(startedAt))/1000)),restoreReviewRequired:store.db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1'};},
    operations(){return {tasks:scheduler.snapshot(),history:scheduler.history()};},
    controlOperation(name,action){return scheduler.control(name,action);},
    acknowledgeRestore(){
      if(!service.health().restoreReviewRequired)return;
      if(!Object.values(scheduler.snapshot()).every(t=>t.paused))throw new Error('Pause all tasks before acknowledging restore');
      store.db.exec('BEGIN IMMEDIATE');
      try{store.db.prepare("UPDATE settings SET value='0' WHERE key='restore_review_required'").run();store.db.prepare("INSERT INTO operation_audit(name,action,at) VALUES('restore','acknowledge',?)").run(clock());store.db.exec('COMMIT');}
      catch(error){store.db.exec('ROLLBACK');throw error;}
    },
    runOperation(name,input=null){if(offline&&name!=='backup')denyNetwork();active(name);return scheduler.run(name,{force:true,input});},
    close(){return scheduler.stop();},
    syncWatches(){autoWatch=syncResearchWatches(store,research.list());return autoWatch;},
    snapshot(){const topics=research.list(),book=paper.snapshot();const queue=continuity.queue({positions:book.positions,watchlist:store.watchlist()}),priorities=new Map(queue.map((n,i)=>[n.id,{priority:n.priority,rank:i}])),researchView=research.snapshot();researchView.inbox=researchView.inbox.map(n=>({...n,researchPriority:priorities.get(n.id)?.priority})).sort((a,b)=>(priorities.get(a.id)?.rank??Infinity)-(priorities.get(b.id)?.rank??Infinity));return {eventContinuity:{...continuity.summary(),health:store.checks().events||{state:'pending'}},runtime:{mode,offline},paper:book,workflow:topics.map(t=>assessTopic(t,{book})),operations:scheduler.snapshot(),operationHistory:scheduler.history(),dataCapabilities:dataCapabilities(store,clock(),{offline}),serviceHealth:service.health(),newsIntake:intake.snapshot(),autoWatch,settings:store.getSettings(),news:store.news(),watchlist:store.watchlist().map(w=>({...w,quote:store.quote(w.symbol),daily:store.daily(w.symbol)})),checks:store.checks(),serverTime:clock(),newsIntervalSeconds:newsCooldown/1000,quoteIntervalSeconds:quoteCooldown/1000,research:researchView};},
    async refreshDaily(symbol,force=false,context){
      if(offline)denyNetwork();active('daily',context);
      if(!store.watchlist().some(w=>w.symbol===symbol))throw new Error('仅获取关注标的日线');
      if(dailyJobs.has(symbol))return dailyJobs.get(symbol);
      const cached=store.daily(symbol),at=now(),last=dailyAttempts.get(symbol)||(store.checks()['daily:'+symbol]?.attemptedAt?{at:Date.parse(store.checks()['daily:'+symbol].attemptedAt)}:null),health=dailyHealth(symbol,cached,new Date(at).toISOString());
      const age=last?at-last.at:Infinity,newSession=!!health.expectedDate&&health.expectedDate!==last?.expectedDate;
      if(age<60000||(!force&&(!newSession&&age<900000||cached&&health.status==='aligned'&&at-Date.parse(cached.receivedAt)<21600000)))return {skipped:'cooldown'};
      dailyAttempts.set(symbol,{at,expectedDate:health.expectedDate});const attemptedAt=new Date(at).toISOString();
      const job=(async()=>{try{const quote=await fetchDaily(symbol,scopedFetcher(context));active('daily',context);store.saveDaily(quote);store.status('daily:'+symbol,{state:'ok',attemptedAt,receivedAt:quote.receivedAt});return {ok:true};}
      catch(error){active('daily',context);store.status('daily:'+symbol,{state:'error',attemptedAt,error:errorText(error)});return {error:errorText(error)};}finally{dailyJobs.delete(symbol);}})();
      dailyJobs.set(symbol,job);return job;
    },
    async refreshNews(context){
      if(offline)denyNetwork();active('news',context);
      if(newsJob)return newsJob;
      if(now()-Math.max(lastNewsAttempt,Date.parse(store.checks().news?.attemptedAt)||0)<newsCooldown)return {skipped:'cooldown'};
      const queries=newsQueries(store.getSettings()).filter(q=>q.enabled);
      if(!queries.length){store.status('news',{state:'disabled'});return {skipped:'all-queries-disabled'};}
      lastNewsAttempt=now();const attemptedAt=clock();const keywords=store.getSettings().keywords;
      newsJob=(async()=>{try{
        const results=[];
        for(const query of queries){active('news',context);results.push(await intake.run(query,scopedFetcher(context),context));}
        active('news',context);research.process();service.processEvents();
        const success=results.filter(r=>r.state==='ok'),errors=results.filter(r=>r.error).map(r=>errorText(new Error(r.error)));
        store.status('news',{state:errors.length?(success.length?'partial':'error'):'ok',attemptedAt,...(success.length?{receivedAt:clock()}:{}),count:success.reduce((n,r)=>n+r.acceptedCount,0),added:success.reduce((n,r)=>n+r.added,0),updated:success.reduce((n,r)=>n+r.updated,0),keywords,...(errors.length?{error:errors.join('；')}:{}),queryCount:queries.length});return results;
      }catch(error){active('news',context);store.status('news',{state:'error',attemptedAt,error:errorText(error),keywords});return {error:errorText(error)};}finally{newsJob=null;}})();
      return newsJob;
    },
    async refreshQuote(symbol,context){
      if(offline)denyNetwork();active('minutes',context);
      if(!store.watchlist().some(w=>w.symbol===symbol))return {skipped:'not-watched'};
      if(quoteJobs.has(symbol))return quoteJobs.get(symbol);
      if(now()-Math.max(quoteAttempts.get(symbol)||0,Date.parse(store.checks()[symbol]?.attemptedAt)||0)<quoteCooldown)return {skipped:'cooldown'};
      quoteAttempts.set(symbol,now());const attemptedAt=clock();
      const job=(async()=>{try{
        const quote=await fetchMinutes(symbol,scopedFetcher(context));active('minutes',context);store.saveQuote(quote,clock());store.status(symbol,{state:'ok',attemptedAt,receivedAt:clock()});return {ok:true};
      }catch(error){active('minutes',context);store.status(symbol,{state:'error',attemptedAt,error:errorText(error)});return {error:errorText(error)};}finally{quoteJobs.delete(symbol);}})();quoteJobs.set(symbol,job);return job;
    },
    tick(){research.process();service.processEvents();service.syncWatches();paper.expire();return scheduler.runAll();},
  };
  const providerFetch=createProviderGate(store,{fetcher,now});
  const scopedFetcher=context=>(url,options={})=>providerFetch(url,{...options,signal:context?.signal?AbortSignal.any([context.signal,...(options.signal?[options.signal]:[])]):options.signal},context);
  const scheduler=createPersistentScheduler(store.db,{news:context=>offline?{skipped:'offline'}:service.refreshNews(context),daily:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),3,w=>service.refreshDaily(w.symbol,!!context.input?.manual,context)),minutes:context=>offline?{skipped:'offline'}:pool(context.input?.symbols?context.input.symbols.map(symbol=>({symbol})):store.watchlist(),2,w=>service.refreshQuote(w.symbol,context)),...(backupTask?{backup:backupTask}:{})},{now,intervals:{news:newsCooldown,daily:60000,minutes:quoteCooldown,backup:3600000}});
  return service;
}
