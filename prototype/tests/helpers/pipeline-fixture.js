import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {collectEvaluationSources} from '../../server/evaluation-baseline.mjs';
import {newsUrl} from '../../server/providers.mjs';
import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
import {invokeComparisonWorker} from '../../server/source-comparison.mjs';
import {freezePipelineComparison,savePipelineComparison} from '../../server/pipeline-comparison.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),worker=join(root,'prototype/scripts/pipeline-comparison-worker.mjs'),cli=join(root,'prototype/scripts/compare-pipeline.mjs');
const at='2026-10-02T14:00:00.000Z',next='2026-10-02T14:00:01.000Z';
const ref=($ref,...path)=>({$ref,path}),topic=ref('topic','createdTopicId'),topicPath=tail=>['/api/research/',topic,tail];
function setup(){
 const directory=mkdtempSync(join(tmpdir(),'pipeline-pair-')),sources=collectEvaluationSources(root),roots={};
 for(const role of ['baseline','candidate']){roots[role]=join(directory,role);for(const [file,v] of Object.entries(sources)){mkdirSync(dirname(join(roots[role],file)),{recursive:true});writeFileSync(join(roots[role],file),v.text);}symlinkSync(join(root,'prototype/node_modules'),join(roots[role],'prototype/node_modules'),'dir');}
 const changed=join(roots.candidate,'prototype/server/market-simulation.mjs');writeFileSync(changed,readFileSync(changed,'utf8').replace('fee(gross,b.config.feeBps)','fee(gross,b.config.feeBps+1)'));
 const binary=join(directory,'fake-codex.mjs');writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(args.includes('--version')){console.log('codex-cli 0.160.0-fixture');process.exit(0);}
let prompt='';for await(const b of process.stdin)prompt+=b;
const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['全流程合成测试，未知事项待核对。'],sourceIds:[]})),missingEvidence:['独立事实与结局'],materialityReviews:[]};
fs.writeFileSync(value('--output-last-message'),JSON.stringify(d));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`);chmodSync(binary,0o700);
 const request=(id,path,body={},method='POST',time=at)=>({id,at:time,kind:'request',method,path,body});
 const market=(time,availableBuy=100,mark='100')=>({quotes:{'AAPL.US':{id:'synthetic:'+time,symbol:'AAPL.US',kind:'market-simulation-input',verified:true,source:'synthetic-only',rulesVersion:'fixture-1',issuerId:'AAPL.US',currency:'USD',asOf:time,receivedAt:time,validUntil:'2026-10-02T20:00:00.000Z',bid:'99.99',ask:'100',mark,fx:{id:'synthetic-fx',source:'synthetic-only',usdPerUnit:'1',asOf:time,receivedAt:time,validUntil:'2026-10-02T20:00:00.000Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-02T13:30:00.000Z',sessionClose:'2026-10-02T20:00:00.000Z',sellableAt:time,settlesAt:time,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy,availableSell:100}}});
 const html='<html><head><title>Synthetic bankruptcy announcement</title></head><body><article><h1>Synthetic bankruptcy announcement</h1><p>'+('A synthetic company files for bankruptcy. Full source and contrary facts remain unverified. '.repeat(20))+'</p></article></body></html>';
 const recipe={version:'pipeline-replay/1',seed:'synthetic-full-stream',startedAt:at,model:{mode:'live-codex',config:{binary,model:'fixture',effort:'low',timeoutMs:10000},records:[]},responses:[{id:'rss',at,url:newsUrl(''),status:200,headers:{'content-type':'application/xml'},body:'<rss><channel><item><title>Synthetic company files for bankruptcy</title><link>https://www.reuters.com/synthetic-one</link><pubDate>Fri, 02 Oct 2026 13:59:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item><item><title>Routine daily update</title><link>https://www.reuters.com/synthetic-quiet</link><pubDate>Fri, 02 Oct 2026 13:58:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>'},{id:'article',at,url:'https://www.reuters.com/synthetic-one',status:200,headers:{'content-type':'text/html; charset=utf-8'},body:html}],steps:[
  {id:'intake',at,kind:'task',name:'news',action:'run',input:null},
  {id:'screen',at,kind:'screen'},request('news','/api/data',{},'GET'),
  request('topic','/api/research/from-news',{newsId:ref('news','news',0,'id'),newsRevision:1}),
  request('material',topicPath('/read-source'),{version:1,url:'https://www.reuters.com/synthetic-one',stance:'unverified',family:'other',step:'fact',interpretation:'冻结合成输入，待核对'}),
  request('packet',topicPath('/packet'),{},'GET'),request('model',topicPath('/model-runs'),{version:2}),
  {id:'wait',at,kind:'wait',lane:'research',runId:ref('model','id')},request('adopt',['/api/research/',topic,'/model-runs/',ref('model','id'),'/adopt'],{version:2}),
  request('company',topicPath('/companies'),{version:3,symbol:'AAPL.US',note:'Synthetic association'}),
  request('hypothesis',topicPath(''),{version:4,hypothesis:{reviewAt:'2026-10-02',invalidation:'合成反证需复核'}},'PATCH'),
  request('account','/api/market-simulation/initialize?account=steady',{requestId:'11111111-1111-4111-8111-111111111111',version:0,initialUSD:500000,config:strategyProfiles.steady.suggestedConfig,confirmSimulation:true}),
  {id:'market',at,kind:'market',inputs:market(at)},
  request('order','/api/market-simulation/orders?account=steady',{requestId:'22222222-2222-4222-8222-222222222222',version:1,order:{topicId:topic,topicVersion:5,symbol:'AAPL.US',side:'buy',qty:100,limitPrice:'101',budgetUSD:10200,expiresAt:'2026-10-02T14:10:00.000Z',holdUntil:'2026-10-03T14:00:00.000Z',thesis:'Synthetic mechanism',trigger:'Frozen trigger',invalidation:'Frozen counter evidence'}}),
  request('review',['/api/market-simulation/orders/',ref('order','orders',0,'id'),'/review?account=steady'],{},'GET')
 ]};
 return {directory,roots,recipe,market,request,binary,async preview(){const dir=join(directory,'preview');mkdirSync(dir);const r=await invokeComparisonWorker(roots.baseline,'run-pipeline',{recipe,directory:dir},{workerPath:worker,timeoutMs:30000});assert(r.ok,JSON.stringify(r));return r.value;},spec(){return {title:'Synthetic full pipeline comparison',sources:roots,recipe};},save(name='plan'){const p=freezePipelineComparison(this.spec()),dir=join(directory,name);savePipelineComparison(dir,p);return {p,dir};},close(){rmSync(directory,{recursive:true,force:true});}};
}
async function complete(f){
 const v=await f.preview();assert.equal(v.summary.failed,0,JSON.stringify(v.rows.filter(r=>['failed','rejected'].includes(r.status))));assert.equal(v.summary.rejected,0);assert.equal(v.modelCalls.length,1);assert.equal(v.modelCalls[0].status,'candidate',JSON.stringify(v.modelCalls));
 const fingerprint=v.rows.find(r=>r.id==='review').value.fingerprint;assert.equal(v.rows.find(r=>r.id==='review').value.eligible,true);
 f.recipe.steps.push(f.request('approve',['/api/market-simulation/orders/',ref('order','orders',0,'id'),'?account=steady'],{requestId:'33333333-3333-4333-8333-333333333333',version:2,action:'approve',note:'Frozen synthetic review decision; no live orders',fingerprint,confirmSimulation:true}),{id:'market-next',at:next,kind:'market',inputs:f.market(next,40)},f.request('execute','/api/market-simulation/process?account=steady',{},'POST',next),{id:'observe',at:next,kind:'task',name:'observations',action:'run',input:null},f.request('ledger','/api/market-simulation?account=steady',{},'GET',next));return v;
}

export {setup,complete,at,next,ref};
