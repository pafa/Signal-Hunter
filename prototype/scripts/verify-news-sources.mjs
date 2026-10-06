import {mkdirSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {newsWindow,NEWS_ADAPTER_VERSION} from '../server/news-sources.mjs';

let store,service;
try{
 const [output,...args]=process.argv.slice(2);
 if(!output||args.length&&!(args.length===4&&args[0]==='--from'&&args[2]==='--to'))throw new Error('用法：npm run news:verify -- <全新输出目录> [--from YYYY-MM-DD --to YYYY-MM-DD]');
 const input=args.length?newsWindow({sourceId:'hkma',from:args[1],to:args[3]},new Date().toISOString()):null;
 const directory=resolve(output);mkdirSync(directory,{mode:0o700});
 store=openStore(join(directory,'research.sqlite'));chmodSync(join(directory,'research.sqlite'),0o600);assertDatabaseMode(store,'research');
 store.setSettings({newsDiscoveryEnabled:false,newsTrackingEnabled:false,newsFedEnabled:!input,newsHkmaEnabled:true,newsCsrcEnabled:!input,newsNvidiaEnabled:!input});
 service=createService(store,{mode:'research'});
 const result=input?await service.backfillNews(input):await service.runOperation('news');
 const snapshot=service.snapshot();
 const report={at:new Date().toISOString(),adapterVersion:NEWS_ADAPTER_VERSION,input,result,newsIntake:snapshot.newsIntake,counts:{news:store.db.prepare('SELECT COUNT(*) n FROM news').get().n,revisions:store.db.prepare('SELECT COUNT(*) n FROM revisions').get().n,responses:store.db.prepare('SELECT COUNT(*) n FROM news_source_responses').get().n,research:snapshot.research.topics.length,scenarioFills:snapshot.paper.fills.length},scope:'实际公开来源的有界收取；不证明新闻全集、分钟时效、事实核验或可交易性'};
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({directory,counts:report.counts,outcome:result.outcome,report:join(directory,'report.json')},null,2));
 if(['error','partial'].includes(result.outcome))process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(service)await service.close();if(store)store.close();}
