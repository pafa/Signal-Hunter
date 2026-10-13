import {AUTOMATIC_RESEARCH_WORKFLOW} from '../server/research-output-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {researchPriceMaterial,researchPriceUrls} from '../server/research-price-material.mjs';
import {openResearchPriceSources} from '../server/research-price-sources.mjs';
import {immutableMaterialSnapshot,openMaterials} from '../server/research-materials.mjs';
import {parseDaily} from '../server/daily.mjs';
import {openStore} from '../server/store.mjs';
import {instrument,yahooSymbol,hash} from '../server/providers.mjs';
import {fixture,output,dossier} from './automatic-research-fixture.mjs';
const receivedAt='2026-10-08T00:00:00.000Z',stamp=d=>Date.parse(d)/1000;
function payload(interval='1d',symbol='NVDA.US'){
 const spec=instrument(symbol);return {chart:{result:[{meta:{symbol:yahooSymbol(spec),currency:spec.currency,exchangeTimezoneName:spec.marketTimezone,dataGranularity:interval},timestamp:interval==='1d'?[stamp('2026-10-06T13:30Z'),stamp('2026-10-07T13:30Z')]:[stamp('2026-10-07T19:58Z'),stamp('2026-10-07T19:59Z')],indicators:{quote:[{close:[100,101],volume:[1000,null]}]}}]}};
}
const document=(interval='1d',p=payload(interval),at=receivedAt,symbol='NVDA.US')=>({url:researchPriceUrls(symbol,interval).at(-1),receivedAt:at,body:Buffer.from(JSON.stringify(p))});
const quote='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。';
function make({fetcher,path}={}){
 const requests=[],packets=[],syntheses=[];
 const f=fixture({path,fetcher:async(url,options)=>{requests.push(url);assert.equal(options.redirect,'error');return fetcher?fetcher(url,options):url.includes('eastmoney.com')?Response.json({data:null}):Response.json(payload(new URL(url).searchParams.get('interval')));},
 sourceReader:async url=>({url,title:'合成回购公告',sourceName:'合成',body:quote+'仅测试自动价量准备。'.repeat(40),scope:'extracted-text'}),
 extractionRunner:p=>output(p,'decomposition',{events:[{title:'合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote,quoteField:'body',boundaryReason:'具体回购事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['价格背景']}),
 identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'合成目录身份'}],scopeNote:'合成',missingEvidence:['历史身份']}),
 researchRunner:p=>{packets.push(p);return dossier(p);},synthesisRunner:p=>{syntheses.push(p);return dossier(p);}});
 if(!f.queue.snapshot().settings.researchPrices)f.queue.configure({...f.queue.snapshot().settings,researchPrices:true});
 return {...f,requests,packets,syntheses};
}
const event=f=>f.service.research.list().find(t=>t.eventExtraction);
const ready=async f=>{f.add(1);await f.until(()=>f.queue.snapshot().events.items.some(j=>j.kind==='dossier'&&j.status==='queued'));};

test('price materials retain clock, close/volume gaps and source bytes, exclude unfinished bars and label stale input',()=>{
 const d=researchPriceMaterial('NVDA.US','1d',document());assert.equal(d.marketSource.source.receivedAt,receivedAt);assert.equal(d.publishedAt,null);assert.match(d.body,/101 \| 未知/);assert.match(d.body,/每股市场价格/);assert.equal(d.marketSource.diagnostics.executable,false);
 const m=researchPriceMaterial('NVDA.US','1m',document('1m',payload('1m'),'2026-10-07T19:59:30.000Z'));assert.equal(m.marketSource.coverage.selectedRows,1);assert.equal(m.marketSource.coverage.unfinishedRows,1);assert.equal(m.marketSource.diagnostics.dataAt,'2026-10-07T19:58:00.000Z');assert.doesNotMatch(m.body,/19:59 \| 101/);
 const stale=researchPriceMaterial('NVDA.US','1m',document('1m',payload('1m'),'2026-10-09T18:00:00.000Z'));assert.equal(stale.marketSource.diagnostics.dataState,'stale');
 const store=openStore(':memory:');try{const api=openMaterials(store.db,{clock:()=>receivedAt}),saved=api.prepare('test',{...d,marketDocuments:[document()]},'public-market');saved.persist();assert.equal(immutableMaterialSnapshot(store.db,saved.material).body,d.body);store.db.prepare('UPDATE research_source_documents SET body=?').run(Buffer.from('{}'));assert.throws(()=>immutableMaterialSnapshot(store.db,saved.material),/原始响应校验失败/);}finally{store.close();}
});
test('wrong security, currency, granularity, future or duplicate minute times cannot become citeable price input',()=>{
 for(const [key,value] of [['symbol','AAPL'],['currency','HKD'],['dataGranularity','5m'],['exchangeTimezoneName','UTC']]){const p=payload('1m');p.chart.result[0].meta[key]=value;assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',p)));}
 const p=payload('1m');p.chart.result[0].timestamp[1]=p.chart.result[0].timestamp[0];assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',p)),/时间序列/);
 assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',payload('1m'),'2026-10-07T19:58:00.000Z')),/晚于/);
 const east={url:researchPriceUrls('NVDA.US','1m')[0],receivedAt,body:Buffer.from(JSON.stringify({data:{code:'NVDA',trends:['2026-10-07 15:59,1,101']}}))};assert.throws(()=>researchPriceMaterial('NVDA.US','1m',east),/时区未核实/);
 const store=openStore(':memory:');try{const api=openMaterials(store.db,{clock:()=>receivedAt}),d=researchPriceMaterial('NVDA.US','1d',document());d.body=d.body.replace('100 | 1000','999 | 1000');assert.throws(()=>api.prepare('t',{...d,marketDocuments:[document()]},'public-market'),/原始响应不一致/);}finally{store.close();}
});
test('automatic dossier and composite receive exact frozen prices; later charts cannot rewrite history or change accounts',async()=>{
 const f=make();try{const paper=f.service.paper.snapshot();f.add(1);await f.until(()=>!!event(f)?.dossier);const t=event(f),p=f.packets[0];assert.equal(p.researchWorkflow,AUTOMATIC_RESEARCH_WORKFLOW);assert.equal(t.researchPrices.length,2);assert(t.researchPrices.every(x=>x.status==='saved'));assert.equal(p.input.researchPrices.length,2);assert.equal(p.input.evidence.filter(e=>e.material?.marketSource).length,2);const m=p.input.evidence.find(e=>e.material?.marketSource).material;assert.equal(m.method,'public-market');assert.equal(immutableMaterialSnapshot(f.store.db,m).body,m.body);assert.equal(t.dossier.sourceModelRun.inputHash,p.inputHash);
  assert.equal(p.input.researchPrices[0].volumeComparison,undefined);assert.equal(p.input.researchPrices[1].volumeComparison.status,'unknown');assert.equal(p.input.researchPrices[1].volumeComparison.days[0].observedMinutes,2);assert.equal(p.input.evidence.filter(e=>e.material?.marketSource&&e.interpretation.includes('成交量核对')).length,1);
  const before=f.service.research.packet(t.id).inputHash;f.store.saveDaily(parseDaily(payload(),'NVDA.US','2026-10-09T21:00:00Z'));assert.equal(f.service.research.packet(t.id).inputHash,before);f.add(2);await f.drive(60);assert.equal(f.calls.dossier,2);assert.equal(f.syntheses.length,1,JSON.stringify(f.queue.snapshot()));assert.equal(f.syntheses[0].input.evidence.filter(e=>e.material?.marketSource).length,4);assert(f.syntheses[0].input.eventSynthesis.members.every(m=>m.researchPrices.length===2&&m.researchPrices[1].volumeComparison.status==='unknown'));assert.deepEqual(f.service.paper.snapshot(),paper);assert.equal(f.service.actualHoldings.snapshot().records.length,0);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);
 }finally{await f.close();}
});
test('HTTP and malformed responses remain archived; bounded retries continue as gaps without manual work',async()=>{
 const f=make({fetcher:()=>new Response('Restricted',{status:403})});try{await ready(f);for(let i=0;i<8&&!event(f)?.dossier;i++){await f.drive(8);f.advance(120001);}assert(event(f).dossier);assert.equal(f.packets[0].input.researchPrices.length,2);assert(f.packets[0].input.researchPrices.every(r=>r.status==='unavailable'));assert.equal(f.calls.dossier,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_price_responses').get().n,2);assert(f.store.db.prepare('SELECT http_status FROM research_price_responses').all().every(r=>r.http_status===403));assert.equal(f.queue.snapshot().events.items.find(j=>j.kind==='dossier').prices.attempts.filter(a=>a.state==='started').length,6);assert.equal(f.service.workbenchQueue({kind:'model'}).total,0);}finally{await f.close();}
 const store=openStore(':memory:');try{openMaterials(store.db);const sources=openResearchPriceSources(store,{enabled:true,fetcher:async()=>new Response('{malformed'),now:()=>Date.parse(receivedAt)});await assert.rejects(sources.read('NVDA.US','1d'),/JSON/);const raw=store.db.prepare('SELECT body FROM research_source_documents').get();assert.equal(Buffer.from(raw.body).toString(),'{malformed');}finally{store.close();}
});
test('pause during price fetch rejects late writes, preserves attempt and resumes automatically',async()=>{
 let entered,release,first=true;const enteredP=new Promise(r=>entered=r);
 const f=make({fetcher:async url=>{if(first){first=false;entered();await new Promise(r=>release=r);}return url.includes('eastmoney.com')?Response.json({data:null}):Response.json(payload(new URL(url).searchParams.get('interval')));}});
 try{await ready(f);const running=(async()=>{for(let i=0;i<5;i++){try{await f.service.runOperation('discovery');}catch(e){if(!/任务已暂停/.test(e.message))throw e;break;}await f.finish();}})();await enteredP;f.service.controlOperation('discovery','pause');release();await running;assert.equal(event(f).researchPrices,undefined);assert.equal(f.store.db.prepare('SELECT count(*) n FROM research_price_responses').get().n,0);assert.equal(f.calls.dossier,0);await f.until(()=>!!event(f)?.dossier);assert.equal(event(f).researchPrices.length,2);}finally{release?.();await f.close();}
});
test('price material, topic revision and queued packet commit atomically; restart keeps completed inputs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-prices-')),path=join(dir,'test.sqlite');let f=make({path});
 try{await ready(f);const before=event(f);f.store.db.exec(`CREATE TRIGGER fail_price BEFORE UPDATE ON research_pipeline_event_jobs WHEN json_extract(NEW.payload,'$.prices.results[0].status')='saved' BEGIN SELECT RAISE(ABORT,'price atomic fixture'); END`);let failed=false;for(let i=0;i<6;i++){const r=await f.step();if(r.error){failed=true;break;}}assert(failed);assert.deepEqual(event(f),before);assert.equal(f.store.db.prepare("SELECT count(*) n FROM research_materials WHERE json_extract(payload,'$.method')='public-market'").get().n,0);assert.equal(f.calls.dossier,0);f.store.db.exec('DROP TRIGGER fail_price');await f.until(()=>!!event(f)?.dossier);const p=f.service.research.packet(event(f).id);await f.close();f=make({path,fetcher:()=>{throw Error('restart should not refetch');}});await f.drive(10);assert.equal(f.service.research.packet(event(f).id).inputHash,p.inputHash);assert.equal(f.requests.length,0);assert.equal(f.calls.dossier,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('price capture works for explicit CN/HK minute timezone and rejects manual impersonation',()=>{
 for(const [symbol,time]of[['600519.SH','2026-09-30 14:59'],['00700.HK','2026-10-07 15:59']]){const spec=instrument(symbol),doc={url:researchPriceUrls(symbol,'1m')[0],receivedAt,body:Buffer.from(JSON.stringify({data:{code:spec.code,name:'synthetic',trends:[`${time},1,100`]}}))},m=researchPriceMaterial(symbol,'1m',doc);assert.equal(m.marketSource.currency,spec.currency);assert.equal(m.marketSource.coverage.missingVolumeRows,1);assert.match(m.body,/当前解析器未提供成交量/);const store=openStore(':memory:');try{const api=openMaterials(store.db,{clock:()=>receivedAt});assert.throws(()=>api.prepare('t',{...m,marketDocuments:[doc]},'manual'),/读取器/);}finally{store.close();}}
});
test('one-time price setting is preserved when omitted; disabling a pending preparation keeps the dossier running',async()=>{
 const f=make();try{await ready(f);const settings=f.queue.snapshot().settings;f.queue.configure({...settings,researchPrices:false});f.queue.configure({version:settings.version+1,dailyCalls:100,includeClues:false});assert.equal(f.queue.snapshot().settings.researchPrices,false);await f.until(()=>!!event(f)?.dossier);assert.equal(f.requests.length,0);assert.equal(event(f).researchPrices,undefined);assert.throws(()=>f.queue.configure({...f.queue.snapshot().settings,researchPrices:'yes'}),/配置无效/);}finally{await f.close();}
});
test('shared price and financial context does not hide independent stories; the same originating article remains excluded',async()=>{
 const {recallOccurrence}=await import('../server/event-continuity.mjs');
 const topic=id=>({id,status:'active',evidence:[{materialId:id},{materialId:'prices'},{materialId:'facts'},{materialId:'filing'}],researchPrices:[{materialId:'prices'}],financialSources:[{materialId:'facts',filings:[{materialId:'filing'}]}],eventExtraction:{sourceTopicId:id,event:{title:'NVIDIA 特别收购项目',actor:'NVIDIA',action:'收购',object:'特殊芯片项目',quote:'NVIDIA 拟收购特殊芯片项目'}}});
 const a=topic('a'),b=topic('b');assert.equal(recallOccurrence(a,[b]).items.length,1);b.evidence[0].materialId='a';assert.equal(recallOccurrence(a,[b]).items.length,0);b.evidence[0].materialId='b';b.eventExtraction.sourceTopicId='a';assert.equal(recallOccurrence(a,[b]).items.length,0);
});
test('incomplete Yahoo trailing tick and explicit null stay excluded without discarding completed minute history',()=>{
 const p=payload('1m'),data=p.chart.result[0];data.timestamp.push(stamp('2026-10-07T20:00:00Z'),stamp('2026-10-07T20:00:23Z'));data.indicators.quote[0].close.push(null,102);data.indicators.quote[0].volume.push(null,0);
 const m=researchPriceMaterial('NVDA.US','1m',document('1m',p,'2026-10-07T20:00:30.000Z'));assert.equal(m.marketSource.coverage.selectedRows,2);assert.equal(m.marketSource.coverage.unfinishedRows,1);assert.equal(m.marketSource.coverage.missingCloseRows,1);assert.doesNotMatch(m.body,/20:00 \| 102/);
 assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',p,'2026-10-07T20:01:30.000Z')),/非整分钟/);data.timestamp[0]+=1;assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',p,'2026-10-07T20:00:30.000Z')),/非整分钟/);
});
test('a late Yahoo latest-trade instant is excluded only with matching explicit provider metadata',()=>{
 const p=payload('1m'),data=p.chart.result[0];data.timestamp.push(stamp('2026-10-07T20:00:00Z'),stamp('2026-10-07T20:00:42Z'));data.indicators.quote[0].close.push(null,102);data.indicators.quote[0].volume.push(null,0);data.meta.regularMarketTime=data.timestamp.at(-1);
 const at='2026-10-07T20:01:00.383Z',doc=document('1m',p,at),m=researchPriceMaterial('NVDA.US','1m',doc);
 assert.equal(m.marketSource.coverage.selectedRows,2);assert.equal(m.marketSource.coverage.unfinishedRows,0);assert.equal(m.marketSource.coverage.delayedInstantRows,1);assert.equal(m.marketSource.coverage.missingCloseRows,1);assert.equal(m.marketSource.diagnostics.dataAt,'2026-10-07T19:59:00.000Z');assert.doesNotMatch(m.body,/20:00 \| 102/);assert.match(m.body,/跨分钟收到的即时成交仍不是完整分钟柱/);
 const store=openStore(':memory:');try{const api=openMaterials(store.db,{clock:()=>at}),saved=api.prepare('late-tick',{...m,marketDocuments:[doc]},'public-market');saved.persist();assert.deepEqual(immutableMaterialSnapshot(store.db,saved.material).marketSource,m.marketSource);}finally{store.close();}
 for(const mutation of [x=>delete x.meta.regularMarketTime,x=>x.meta.regularMarketTime--,x=>x.timestamp[0]++,x=>x.indicators.quote[0].close[2]=103]){const bad=structuredClone(p);mutation(bad.chart.result[0]);assert.throws(()=>researchPriceMaterial('NVDA.US','1m',document('1m',bad,at)),/非整分钟|时间序列/);}
});
test('recognizing a latest-trade instant does not change previously accepted material bytes',()=>{
 const p=payload('1m'),data=p.chart.result[0];data.timestamp.push(stamp('2026-10-07T20:00:23Z'));data.indicators.quote[0].close.push(102);data.indicators.quote[0].volume.push(0);const at='2026-10-07T20:00:30.000Z';
 const old=researchPriceMaterial('NVDA.US','1m',document('1m',p,at));data.meta.regularMarketTime=data.timestamp.at(-1);const current=researchPriceMaterial('NVDA.US','1m',document('1m',p,at));
 assert.equal(current.body,old.body);assert.deepEqual(current.marketSource.coverage,old.marketSource.coverage);assert.equal(current.marketSource.coverage.delayedInstantRows,undefined);
});
