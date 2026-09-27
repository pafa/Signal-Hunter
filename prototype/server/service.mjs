import {demoResearchSeeds,initializeDemoData} from './demo.mjs';
import {fetchText,parseReutersFeed,newsUrl,fetchMinutes} from './providers.mjs';
import {openResearch} from './research.mjs';
import {openPaper} from './paper.mjs';
import {assessTopic,syncResearchWatches} from './workflow.mjs';
import {fetchDaily} from './daily.mjs';
import {createScheduler,pool} from './scheduler.mjs';
import {dailyHealth} from '../shared/market-clock.mjs';
export function createService(store,{fetcher=fetch,newsCooldown=600000,quoteCooldown=60000,now=()=>Date.now(),mode='legacy'}={}){
  const offline=mode==='demo';
  const denyNetwork=()=>{throw new Error('离线演示不访问外部数据；请另行启动空白研究模式');};
  const clock=()=>new Date(now()).toISOString();
  const research=openResearch(store,{clock,seed:mode!=='research',...(offline?{seeds:demoResearchSeeds,sourceReader:denyNetwork}:{})});
  const paper=openPaper(store,research,{clock,seed:mode!=='research'});
  let newsJob=null;const quoteJobs=new Map();let lastNewsAttempt=0;const quoteAttempts=new Map();
  const dailyJobs=new Map(),dailyAttempts=new Map();
  const errorText=error=>error.name==='TimeoutError'?'上游请求超时':error.message==='fetch failed'?'上游连接失败':String(error.message).slice(0,160);
  let autoWatch=syncResearchWatches(store,research.list());
  if(offline)initializeDemoData(store);
  const service={
    mode,
    research,paper,
    syncWatches(){autoWatch=syncResearchWatches(store,research.list());return autoWatch;},
    snapshot(){const topics=research.list(),book=paper.snapshot();return {runtime:{mode,offline},paper:book,workflow:topics.map(t=>assessTopic(t,{book})),operations:scheduler.snapshot(),autoWatch,settings:store.getSettings(),news:store.news(),watchlist:store.watchlist().map(w=>({...w,quote:store.quote(w.symbol),daily:store.daily(w.symbol)})),checks:store.checks(),serverTime:new Date().toISOString(),newsIntervalSeconds:newsCooldown/1000,quoteIntervalSeconds:quoteCooldown/1000,research:research.snapshot()};},
    async refreshDaily(symbol,force=false){
      if(offline)denyNetwork();
      if(!store.watchlist().some(w=>w.symbol===symbol))throw new Error('仅获取关注标的日线');
      if(dailyJobs.has(symbol))return dailyJobs.get(symbol);
      const cached=store.daily(symbol),at=now(),last=dailyAttempts.get(symbol),health=dailyHealth(symbol,cached,new Date(at).toISOString());
      const age=last?at-last.at:Infinity,newSession=!!health.expectedDate&&health.expectedDate!==last?.expectedDate;
      if(age<60000||(!force&&(!newSession&&age<900000||cached&&health.status==='aligned'&&at-Date.parse(cached.receivedAt)<21600000)))return {skipped:'cooldown'};
      dailyAttempts.set(symbol,{at,expectedDate:health.expectedDate});const attemptedAt=new Date(at).toISOString();
      const job=(async()=>{try{const quote=await fetchDaily(symbol,fetcher);store.saveDaily(quote);store.status('daily:'+symbol,{state:'ok',attemptedAt,receivedAt:quote.receivedAt});return {ok:true};}
      catch(error){store.status('daily:'+symbol,{state:'error',attemptedAt,error:errorText(error)});return {error:errorText(error)};}finally{dailyJobs.delete(symbol);}})();
      dailyJobs.set(symbol,job);return job;
    },
    async refreshNews(){
      if(offline)denyNetwork();
      if(newsJob)return newsJob;
      if(Date.now()-lastNewsAttempt<newsCooldown)return {skipped:'cooldown'};
      lastNewsAttempt=Date.now();const attemptedAt=new Date().toISOString();const keywords=store.getSettings().keywords;
      newsJob=(async()=>{try{
        const xml=await fetchText(newsUrl(keywords),fetcher),items=parseReutersFeed(xml);const result=store.ingest(items);research.process();
        store.status('news',{state:'ok',attemptedAt,receivedAt:new Date().toISOString(),count:items.length,keywords,...result});return result;
      }catch(error){store.status('news',{state:'error',attemptedAt,error:errorText(error),keywords});return {error:errorText(error)};}finally{newsJob=null;}})();
      return newsJob;
    },
    async refreshQuote(symbol){
      if(offline)denyNetwork();
      if(!store.watchlist().some(w=>w.symbol===symbol))return {skipped:'not-watched'};
      if(quoteJobs.has(symbol))return quoteJobs.get(symbol);
      if(Date.now()-(quoteAttempts.get(symbol)||0)<quoteCooldown)return {skipped:'cooldown'};
      quoteAttempts.set(symbol,Date.now());const attemptedAt=new Date().toISOString();
      const job=(async()=>{try{
        const quote=await fetchMinutes(symbol,fetcher);store.saveQuote(quote);store.status(symbol,{state:'ok',attemptedAt,receivedAt:new Date().toISOString()});return {ok:true};
      }catch(error){store.status(symbol,{state:'error',attemptedAt,error:errorText(error)});return {error:errorText(error)};}finally{quoteJobs.delete(symbol);}})();quoteJobs.set(symbol,job);return job;
    },
    tick(){research.process();service.syncWatches();paper.expire();return offline?Promise.resolve({offline:true}):scheduler.run();},
  };
  const scheduler=createScheduler({news:()=>service.refreshNews(),daily:()=>pool(store.watchlist(),3,w=>service.refreshDaily(w.symbol)),minutes:()=>pool(store.watchlist(),2,w=>service.refreshQuote(w.symbol))});
  return service;
}
