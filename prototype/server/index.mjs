import {runtimeConfig,assertDatabaseMode,checkDatabaseFile} from './runtime.mjs';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {openStore} from './store.mjs';
import {createService} from './service.mjs';
import {planExit} from './risk-rules.mjs';

export function createHandler(store,service,{apiPort=4179,frontendPort=4178}={}){
 for(const port of [apiPort,frontendPort])if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('本地端口无效');
 const hosts=new Set([`127.0.0.1:${apiPort}`,`127.0.0.1:${frontendPort}`,`localhost:${frontendPort}`]);
 const origins=new Set([...hosts].map(host=>`http://${host}`));
 return async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  if(!hosts.has(req.headers.host)||req.headers.origin&&!origins.has(req.headers.origin)){reply(403,{error:'仅允许本机工作台访问'});return;}
  try{
    const url=new URL(req.url,'http://127.0.0.1:4179');
    if(req.method==='GET'&&url.pathname==='/api/health'){reply(200,{ok:true,mode:service.mode||'legacy'});return;}
    if(req.method==='GET'&&url.pathname==='/api/paper/history'){reply(200,service.paper.history());return;}
    if(req.method==='GET'&&url.pathname==='/api/bars'){const symbol=url.searchParams.get('symbol');if(!store.watchlist().some(w=>w.symbol===symbol))throw new Error('仅查看关注标的');const quote=store.quote(symbol);const rows=quote?store.db.prepare('SELECT provider_time AS time,close FROM quote_bars WHERE symbol=? AND provider=? AND timezone=? ORDER BY provider_time DESC LIMIT 6000').all(symbol,quote.provider||'legacy',quote.providerTimezone||'unverified'):[];reply(200,rows.reverse());return;}
    if(req.method==='GET'&&url.pathname==='/api/data'){reply(200,service.snapshot());return;}
    if(req.method==='GET'&&/^\/api\/news\/[a-f0-9]{64}\/screening$/.test(url.pathname)){reply(200,service.research.screenings.packet(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&url.pathname==='/api/news/search'){reply(200,service.research.newsPage(Object.fromEntries(url.searchParams)));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/materials$/.test(url.pathname)){reply(200,service.research.materialList(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/packet$/.test(url.pathname)){reply(200,service.research.packet(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/related$/.test(url.pathname)){reply(200,service.research.related(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/research\/[^/]+\/history$/.test(url.pathname)){reply(200,service.research.history(url.pathname.split('/')[3]));return;}
    if(req.method==='GET'&&/^\/api\/news\/[a-f0-9]{64}\/revisions$/.test(url.pathname)){reply(200,store.revisions(url.pathname.split('/')[3]));return;}
    if(!['POST','PATCH','DELETE'].includes(req.method)){reply(404,{error:'接口不存在'});return;}
    if(req.headers['content-type']!=='application/json'){reply(415,{error:'需要 JSON 请求'});return;}
    const maxBody=/^\/api\/research\/[^/]+\/materials$/.test(url.pathname)?300000:16384;
    const chunks=[];let bytes=0;for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>maxBody){reply(413,{error:'请求过大'});return;}chunks.push(buffer);}const body=Buffer.concat(chunks).toString('utf8');
    const updatedSnapshot=()=>{service.syncWatches();return service.snapshot();};
    const data=JSON.parse(body||'{}');
    if(data===null||Array.isArray(data)||typeof data!=='object')throw new Error('JSON 对象无效');
    if(req.method==='POST'&&url.pathname==='/api/daily/refresh'){
      if(!Array.isArray(data.symbols)||!data.symbols.length||data.symbols.length>6||data.symbols.some(s=>typeof s!=='string'||!store.watchlist().some(w=>w.symbol===s)))throw new Error('每次刷新 1–6 个关注标的');
      await Promise.all([...new Set(data.symbols)].map(s=>service.refreshDaily(s,true)));reply(200,updatedSnapshot());return;
    }
    if(req.method==='POST'&&url.pathname==='/api/paper/proposals'){service.paper.propose(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&/^\/api\/paper\/orders\/[^/]+$/.test(url.pathname)){service.paper.decide(url.pathname.split('/')[4],data);reply(200,updatedSnapshot());return;}
    if(req.method==='PATCH'&&url.pathname==='/api/paper/params'){service.paper.updateParams(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/paper/review'){service.paper.review(data);reply(200,updatedSnapshot());return;}
    if(req.method==='POST'&&url.pathname==='/api/research/exit-preview'){reply(200,planExit(data));return;}
    if(req.method==='POST'&&url.pathname==='/api/research/from-news'){const created=service.research.createFromNews(data);reply(200,{...updatedSnapshot(),createdTopicId:created.id});return;}
    if(req.method==='POST'&&url.pathname==='/api/research'){const created=service.research.create(data);reply(200,{...updatedSnapshot(),createdTopicId:created.id});return;}
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
    else if(req.method==='POST'&&url.pathname==='/api/news/refresh'){await service.refreshNews();}
    else if(req.method==='PATCH'&&url.pathname==='/api/settings'){store.setSettings(data);}
    else if(req.method==='PATCH'&&/^\/api\/news\/[a-f0-9]{64}$/.test(url.pathname)){store.editNews(url.pathname.split('/')[3],data);}
    else if(req.method==='POST'&&url.pathname==='/api/watchlist'){const symbol=store.addWatch(data.symbol);await service.refreshQuote(symbol);}
    else if(req.method==='DELETE'&&url.pathname==='/api/watchlist'){store.removeWatch(String(data.symbol));}
    else if(req.method==='POST'&&url.pathname==='/api/quotes/refresh'){for(const w of store.watchlist())await service.refreshQuote(w.symbol);}
    else{reply(404,{error:'接口不存在'});return;}
    reply(200,updatedSnapshot());
  }catch(error){reply(400,{error:error instanceof SyntaxError?'JSON 格式无效':error.message.slice(0,160)});}
};}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=runtimeConfig();
  checkDatabaseFile(config);
  const store=openStore(config.dbPath);
  try{assertDatabaseMode(store,config.mode);}catch(error){store.close();throw error;}
  const service=createService(store,{mode:config.mode}),server=http.createServer(createHandler(store,service,config));
  server.on('error',error=>{console.error(error.message);store.close();process.exit(1);});
  server.listen(config.apiPort,'127.0.0.1',()=>{console.log(`Data service: http://127.0.0.1:${config.apiPort} (${config.mode}, local only)`);void service.tick();});
  const interval=setInterval(()=>void service.tick(),60000);interval.unref();
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{clearInterval(interval);server.close(()=>process.exit(0));});
}
