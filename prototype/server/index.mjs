import {safeErrorText,safeDiagnosticPayload} from '../shared/safe-errors.mjs';
import {runtimeConfig,assertDatabaseMode,checkDatabaseFile} from './runtime.mjs';
import http from 'node:http';
import {createStaticHandler} from './static-site.mjs';
import {createBackup} from './backup.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {openStore} from './store.mjs';
import {createService} from './service.mjs';
import {planExit} from './risk-rules.mjs';

export function createHandler(store,service,{apiPort=4179,frontendPort=4178,staticHandler=null}={}){
 for(const port of [apiPort,frontendPort])if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('本地端口无效');
 const hosts=new Set([`127.0.0.1:${apiPort}`,`127.0.0.1:${frontendPort}`,`localhost:${frontendPort}`]);
 const origins=new Set([...hosts].map(host=>`http://${host}`));
 return async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(code<400?safeDiagnosticPayload(body):body));};
  if(!hosts.has(req.headers.host)||req.headers.origin&&!origins.has(req.headers.origin)){reply(403,{error:'仅允许本机工作台访问'});return;}
  try{
    const url=new URL(req.url,'http://127.0.0.1:4179');
    if(!url.pathname.startsWith('/api/')&&staticHandler){staticHandler(req,res);return;}
    if(service.instance?.id&&(req.headers['x-signal-instance']||['POST','PATCH','DELETE'].includes(req.method))&&req.headers['x-signal-instance']!==service.instance.id){reply(409,{error:'数据集已切换或尚未核对，请刷新页面后再继续'});return;}
    if(req.method==='GET'&&url.pathname==='/api/evaluations'){reply(200,service.evaluations.list());return;}
    const evaluationMatch=/^\/api\/evaluations\/([-a-f0-9]{36})(?:\/(report|export))?$/.exec(url.pathname);
    if(req.method==='GET'&&evaluationMatch){reply(200,service.evaluations[evaluationMatch[2]||'detail'](evaluationMatch[1]));return;}
    const marketAccount=url.searchParams.get('account')||'aggressive',market=Object.hasOwn(service.marketSimulations||{},marketAccount)?service.marketSimulations[marketAccount]:null;
    if(url.pathname.startsWith('/api/market-simulation')&&!market)throw new Error('市场模拟参数无效，请填写全部风险与费用参数');
    if(req.method==='GET'&&url.pathname==='/api/market-simulation'){reply(200,market.snapshot());return;}
    if(req.method==='GET'&&url.pathname==='/api/market-simulation/history'){reply(200,market.history());return;}
    if(req.method==='GET'&&/^\/api\/market-simulation\/history\/\d+$/.test(url.pathname)){reply(200,market.event(Number(url.pathname.split('/')[4])));return;}
    if(req.method==='GET'&&/^\/api\/market-simulation\/orders\/[-a-z0-9]{36}\/review$/.test(url.pathname)){reply(200,market.review(url.pathname.split('/')[4]));return;}
    if(req.method==='GET'&&url.pathname==='/api/semantic-events/events'){reply(200,service.semanticEvents.events(Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&url.pathname==='/api/semantic-events/materials'){reply(200,service.semanticEvents.materials(Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&url.pathname==='/api/event-clusters'){reply(200,service.eventClusters.list(Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&/^\/api\/event-clusters\/[-a-z0-9]{36}$/.test(url.pathname)){reply(200,service.eventClusters.get(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/semantic-batches\/[-a-z0-9]{36}\/clusters$/.test(url.pathname)){reply(200,service.eventClusters.preview(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/semantic-batches'){reply(200,{...service.semanticBatches.list(),task:service.operations().tasks.semantic});return;}
    if(req.method==='GET'&&/^\/api\/semantic-batches\/[-a-z0-9]{36}$/.test(url.pathname)){reply(200,service.semanticBatches.get(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/semantic-events'){reply(200,service.semanticEvents.list());return;}
    if(req.method==='GET'&&/^\/api\/semantic-events\/[-a-z0-9]{36}$/.test(url.pathname)){reply(200,service.semanticEvents.get(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/events'){const params=Object.fromEntries(url.searchParams);for(const key of ['offset','limit'])if(key in params)params[key]=Number(params[key]);reply(200,service.eventContinuity(params));return;}
    if(req.method==='GET'&&/^\/api\/events\/[a-f0-9]{64}$/.test(url.pathname)){reply(200,service.eventDetail(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/observations\/[a-f0-9]{64}\/receipts$/.test(url.pathname)){reply(200,service.observations.receipts(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/observation-rules\/[-a-zA-Z0-9]{8,80}\/history$/.test(url.pathname)){reply(200,service.observations.rules.history(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/operations'){reply(200,service.operations());return;}
    if(req.method==='GET'&&/^\/api\/news\/intake\/[-a-f0-9]{36}$/.test(url.pathname)){reply(200,service.newsIntakeDetail(url.pathname.split('/')[4]));return;}
    if(req.method==='GET'&&url.pathname==='/api/health'){reply(200,service.health());return;}
    if(req.method==='GET'&&url.pathname==='/api/paper/history'){reply(200,service.paper.history());return;}
    if(req.method==='GET'&&url.pathname==='/api/bars'){const symbol=url.searchParams.get('symbol');if(!store.watchlist().some(w=>w.symbol===symbol))throw new Error('仅查看关注标的');const quote=store.quote(symbol);const rows=quote?store.db.prepare('SELECT provider_time AS time,close FROM quote_bars WHERE symbol=? AND provider=? AND timezone=? ORDER BY provider_time DESC LIMIT 6000').all(symbol,quote.provider||'legacy',quote.providerTimezone||'unverified'):[];reply(200,rows.reverse());return;}
    if(req.method==='GET'&&url.pathname==='/api/data'){reply(200,service.snapshot());return;}
    if(req.method==='GET'&&/^\/api\/news\/[a-f0-9]{64}\/screening$/.test(url.pathname)){reply(200,service.research.screenings.packet(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/news\/[a-f0-9]{64}$/.test(url.pathname)){reply(200,service.research.newsItem(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/news/search'){reply(200,service.research.newsPage(Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/material-events(?:\/[-a-z0-9]{36})?$/.test(url.pathname)){const p=url.pathname.split('/');reply(200,p[5]?service.materialEvents.get(p[3],p[5]):service.materialEvents.list(p[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/company-entities(?:\/[-a-z0-9]{36})?$/.test(url.pathname)){const p=url.pathname.split('/');reply(200,p[5]?service.companyEntities.get(p[3],p[5]):service.companyEntities.list(p[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/materials$/.test(url.pathname)){reply(200,service.research.materialList(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/packet$/.test(url.pathname)){reply(200,service.research.packet(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/model-runs$/.test(url.pathname)){reply(200,{...service.modelResearch.status(),runs:service.modelResearch.list(url.pathname.split('/')[3])});return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/model-runs\/[^/]+$/.test(url.pathname)){reply(200,service.modelResearch.get(url.pathname.split('/')[3],url.pathname.split('/')[5]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/related$/.test(url.pathname)){reply(200,service.research.related(url.pathname.split('/')[3],Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/history$/.test(url.pathname)){reply(200,service.research.history(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/news\/[a-f0-9]{64}\/revisions$/.test(url.pathname)){reply(200,store.revisions(url.pathname.split('/')[3]));return;}
    if(!['POST','PATCH','DELETE'].includes(req.method)){reply(404,{error:'接口不存在'});return;}
    if(service.health().restoreReviewRequired&&!/^\/api\/operations\/(?:restore-review|[a-z]+)$/.test(url.pathname)){reply(409,{error:'恢复副本需先完成核对确认，暂不接受业务修改'});return;}
    if(req.headers['content-type']!=='application/json'){reply(415,{error:'需要 JSON 请求'});return;}
    const maxBody=/^\/api\/research\/[^/]+\/(materials|dossier)$/.test(url.pathname)?300000:/^\/api\/research\/[^/]+\/companies$/.test(url.pathname)?64000:16384;
    const chunks=[];let bytes=0;for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>maxBody){reply(413,{error:'请求过大'});return;}chunks.push(buffer);}const body=Buffer.concat(chunks).toString('utf8');
    const updatedSnapshot=()=>{service.syncWatches();return service.snapshot();};
    const data=JSON.parse(body||'{}');
    if(data===null||Array.isArray(data)||typeof data!=='object')throw new Error('JSON 对象无效');
    if(req.method==='POST'&&url.pathname.startsWith('/api/evaluations')){
      const m=/^\/api\/evaluations(?:\/([-a-f0-9]{36})\/(annotate|seal))?$/.exec(url.pathname);
      if(!m)throw new Error('评估批次参数无效');
      const allowed=m[2]==='annotate'?['requestId','version','label']:m[2]==='seal'?['requestId','version','confirm']:['requestId','version','title','start','end','rulesHash'];
      if(Object.keys(data).some(k=>!allowed.includes(k)))throw new Error('评估批次参数无效');
      reply(200,m[1]?service.evaluations[m[2]](m[1],data):service.evaluations.create(data));return;
    }
    if(req.method==='POST'&&url.pathname.startsWith('/api/market-simulation/')){
      const part=url.pathname.slice('/api/market-simulation/'.length),m=market;
      const allowed={initialize:['requestId','version','initialUSD','config','confirmSimulation'],configure:['requestId','version','config','note'],orders:['requestId','version','order'],resume:['requestId','version','note'],process:[]};
      const orderMatch=/^orders\/([-a-z0-9]{36})$/.exec(part),keys=orderMatch?['requestId','version','action','note','fingerprint','confirmSimulation']:Object.hasOwn(allowed,part)?allowed[part]:null;
      if(!keys||Object.keys(data).some(k=>!keys.includes(k)))throw new Error('市场模拟执行数据必须由服务端适配器提供');
      if(orderMatch)reply(200,m.decide(orderMatch[1],data));
      else if(part==='orders')reply(200,m.propose(data));
      else if(part==='process')reply(200,m.process());
      else reply(200,m[part](data));return;
    }
    if(req.method==='POST'&&/^\/api\/research\/[^/]+\/material-events(?:\/[-a-z0-9]{36}\/(?:cancel|decision))?$/.test(url.pathname)){
      const p=url.pathname.split('/');
      if(!p[5])reply(202,service.materialEvents.start(p[3],data));
      else if(p[6]==='cancel'){if(Object.keys(data).length)throw new Error('取消参数无效');reply(200,service.materialEvents.cancel(p[3],p[5]));}
      else {const run=service.materialEvents.decide(p[3],p[5],data);reply(200,{...updatedSnapshot(),materialEventRun:run});}return;
    }
    if(req.method==='POST'&&/^\/api\/research\/[^/]+\/company-entities(?:\/[-a-z0-9]{36}\/(?:cancel|decision))?$/.test(url.pathname)){
      const p=url.pathname.split('/');
      if(!p[5])reply(202,service.companyEntities.start(p[3],data));
      else if(p[6]==='cancel'){if(Object.keys(data).length)throw new Error('取消参数无效');reply(200,service.companyEntities.cancel(p[3],p[5]));}
      else {const run=service.companyEntities.decide(p[3],p[5],data);reply(200,{...updatedSnapshot(),companyEntityRun:run});}return;
    }
    if(req.method==='POST'&&url.pathname==='/api/semantic-events'){reply(202,service.semanticEvents.start(data));return;}
    if(req.method==='POST'&&/^\/api\/event-clusters\/[-a-z0-9]{36}\/replacement-preview$/.test(url.pathname)){reply(200,service.eventClusters.replacementPreview(url.pathname.split('/')[3],data));return;}
    if(req.method==='POST'&&/^\/api\/event-clusters\/[-a-z0-9]{36}\/replace$/.test(url.pathname)){reply(200,service.eventClusters.replace(url.pathname.split('/')[3],data));return;}
    if(req.method==='POST'&&url.pathname==='/api/event-clusters'){reply(201,service.eventClusters.save(data));return;}
    if(req.method==='POST'&&/^\/api\/event-clusters\/[-a-z0-9]{36}\/archive$/.test(url.pathname)){reply(200,service.eventClusters.archive(url.pathname.split('/')[3],data));return;}
    if(req.method==='POST'&&url.pathname==='/api/semantic-batches/preview'){reply(200,service.semanticBatches.preview(data));return;}
    if(req.method==='POST'&&url.pathname==='/api/semantic-batches'){reply(201,service.semanticBatches.create(data));return;}
    if(req.method==='POST'&&/^\/api\/semantic-batches\/[-a-z0-9]{36}\/control$/.test(url.pathname)){reply(200,service.semanticBatches.control(url.pathname.split('/')[3],data));return;}
    if(req.method==='POST'&&/^\/api\/semantic-events\/[-a-z0-9]{36}\/(cancel|decision)$/.test(url.pathname)){
      const parts=url.pathname.split('/');
      if(parts[4]==='cancel'){if(Object.keys(data).length)throw new Error('语义比较参数无效');reply(200,service.semanticEvents.cancel(parts[3]));}
      else reply(200,service.semanticEvents.decide(parts[3],data));return;
    }
    if(req.method==='POST'&&/^\/api\/research\/[^/]+\/model-runs$/.test(url.pathname)){
      if(Object.keys(data).some(k=>k!=='version'))throw new Error('模型调用仅接受研究版本；模型配置由本机服务管理');
      reply(202,service.modelResearch.start(url.pathname.split('/')[3],data));return;
    }
    if(req.method==='POST'&&/^\/api\/research\/[^/]+\/model-runs\/[^/]+\/(cancel|adopt)$/.test(url.pathname)){
      if(Object.keys(data).some(k=>k!=='version'))throw new Error('模型候选操作参数无效');
      const parts=url.pathname.split('/');
      if(parts[6]==='cancel'){reply(200,service.modelResearch.cancel(parts[3],parts[5]));return;}
      service.modelResearch.adopt(parts[3],parts[5],data);reply(200,updatedSnapshot());return;
    }
    if(req.method==='POST'&&/^\/api\/research\/[^/]+\/observation-rules$/.test(url.pathname)){service.observations.rules.create(url.pathname.split('/')[3],data);reply(200,service.snapshot());return;}
    if(req.method==='PATCH'&&/^\/api\/observation-rules\/[-a-zA-Z0-9]{8,80}$/.test(url.pathname)){service.observations.rules.update(url.pathname.split('/')[3],data);reply(200,service.snapshot());return;}
    if(req.method==='POST'&&/^\/api\/events\/[a-f0-9]{64}$/.test(url.pathname)){service.decideEvent(url.pathname.split('/')[3],data);reply(200,service.snapshot());return;}
    if(req.method==='POST'&&/^\/api\/observations\/[a-f0-9]{64}$/.test(url.pathname)){service.observations.respond(url.pathname.split('/')[3],data);reply(200,service.snapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/operations/restore-review'){if(data.confirm!==true)throw new Error('需要确认已核对恢复数据');service.acknowledgeRestore();reply(200,service.snapshot());return;}
    if(req.method==='POST'&&/^\/api\/operations\/[a-z]+$/.test(url.pathname)){service.controlOperation(url.pathname.split('/')[3],data.action);if(['retry','resume'].includes(data.action))void service.tick().catch(error=>console.error(safeErrorText(error)));reply(200,service.snapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/daily/refresh'){
      if(!Array.isArray(data.symbols)||!data.symbols.length||data.symbols.length>6||data.symbols.some(s=>typeof s!=='string'||!store.watchlist().some(w=>w.symbol===s)))throw new Error('每次刷新 1–6 个关注标的');
      await service.runOperation('daily',{symbols:[...new Set(data.symbols)],manual:true});reply(200,updatedSnapshot());return;
    }
    if(req.method==='POST'&&url.pathname==='/api/paper/proposals'){service.paper.propose(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&/^\/api\/paper\/orders\/[^/]+$/.test(url.pathname)){service.paper.decide(url.pathname.split('/')[4],data);reply(200,updatedSnapshot());return;}
    if(req.method==='PATCH'&&url.pathname==='/api/paper/params'){service.paper.updateParams(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/paper/review'){service.paper.review(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/research/exit-preview'){reply(200,planExit(data));return;}
    if(req.method==='POST'&&url.pathname==='/api/research/from-news'){const created=service.research.createFromNews(data);reply(200,{...updatedSnapshot(),createdTopicId:created.id});return;}
    if(req.method==='POST'&&url.pathname==='/api/research'){const created=service.research.create(data);reply(200,{...updatedSnapshot(),createdTopicId:created.id});return;}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/dossier$/.test(url.pathname)){service.research.update(url.pathname.split('/')[3],data);}
    else if(req.method==='PATCH'&&/^\/api\/research\/[^/]+$/.test(url.pathname)){service.research.update(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/evidence$/.test(url.pathname)){service.research.addEvidence(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/claims$/.test(url.pathname)){service.research.saveClaim(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&url.pathname==='/api/news/screening-review'){service.research.screenings.review(data);}
    else if(req.method==='DELETE'&&/^\/api\/research\/[^/]+\/companies$/.test(url.pathname)){service.research.removeCompany(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/companies$/.test(url.pathname)){service.research.addCompany(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/verification$/.test(url.pathname)){service.research.verifyEvidence(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/materials$/.test(url.pathname)){service.research.saveMaterial(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/read-source$/.test(url.pathname)){await service.research.readMaterial(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&/^\/api\/research\/[^/]+\/related$/.test(url.pathname)){service.research.linkTopic(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&url.pathname==='/api/news/refresh'){await service.runOperation('news',{manual:true});}
    else if(req.method==='POST'&&url.pathname==='/api/news/backfill'){await service.backfillNews(data);}
    else if(req.method==='PATCH'&&url.pathname==='/api/settings'){store.setSettings(data);}
    else if(req.method==='PATCH'&&/^\/api\/news\/[a-f0-9]{64}$/.test(url.pathname)){store.editNews(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&url.pathname==='/api/watchlist'){const symbol=store.addWatch(data.symbol);if(service.mode!=='demo'&&!service.operations().tasks.minutes?.paused)await service.runOperation('minutes',{symbols:[symbol],manual:true});}
    else if(req.method==='DELETE'&&url.pathname==='/api/watchlist'){store.removeWatch(String(data.symbol));}
    else if(req.method==='POST'&&url.pathname==='/api/quotes/refresh'){await service.runOperation('minutes',{manual:true});}
    else{reply(404,{error:'接口不存在'});return;}
    reply(200,updatedSnapshot());
  }catch(error){reply(400,{error:error instanceof SyntaxError?'JSON 格式无效':safeErrorText(error)});}
};}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=runtimeConfig();
  checkDatabaseFile(config);
  const store=openStore(config.dbPath);
  try{assertDatabaseMode(store,config.mode);}catch(error){store.close();throw error;}
  const staticHandler=config.production?createStaticHandler(fileURLToPath(new URL('../dist',import.meta.url))):null;
  const modelConfig=process.env.SIGNAL_CODEX_BIN&&process.env.SIGNAL_CODEX_MODEL?{binary:process.env.SIGNAL_CODEX_BIN,model:process.env.SIGNAL_CODEX_MODEL,effort:process.env.SIGNAL_CODEX_EFFORT||'high',timeoutMs:Number(process.env.SIGNAL_CODEX_TIMEOUT_MS||180000)}:null;
  const service=createService(store,{mode:config.mode,instance:config.instance,modelConfig,backupTask:async()=>{
    const result=await createBackup(config.dbPath,resolve(dirname(config.dbPath),'backups'));
    store.status('backup',{state:'ok',receivedAt:result.createdAt,directory:result.directory,sha256:result.sha256});return {ok:true};
  }}),server=http.createServer(createHandler(store,service,{...config,staticHandler}));
  server.on('error',error=>{console.error(safeErrorText(error));store.close();process.exit(1);});
  const port=config.production?config.frontendPort:config.apiPort;
  const tick=()=>service.tick().catch(error=>console.error('后台任务异常：',safeErrorText(error)));
  server.listen(port,'127.0.0.1',()=>{console.log(`Signal Hunter: http://127.0.0.1:${port} (${config.mode}, ${config.production?'production':'API'}, loopback only)`);void tick();});
  const interval=setInterval(()=>void tick(),10000);interval.unref();
  let closing=false;
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{
    if(closing)return;closing=true;clearInterval(interval);
    const timeout=setTimeout(()=>process.exit(1),8000);timeout.unref();
    await Promise.all([new Promise(resolve=>server.close(resolve)),service.close()]);
    store.close();clearTimeout(timeout);process.exit(0);
  });
}
