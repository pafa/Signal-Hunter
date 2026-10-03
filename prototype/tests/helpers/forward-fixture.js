import {randomUUID} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {assertDatabaseMode} from '../../server/runtime.mjs';
import {digest,codexPrompt,CODEX_PROMPT_VERSION,CODEX_DRAFT_SCHEMA} from '../../server/codex-research.mjs';
const config={binary:'/test/codex',model:'fixture',effort:'high',timeoutMs:5000};
function output(p){const d={sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['合成输入，未知事项待核对。'],sourceIds:p.input.evidence.map(e=>e.id)})),missingEvidence:['完整事实与结局']},rawOutput=JSON.stringify(d);return {status:'candidate',reviewStatus:'unreviewed',...d,rawOutput,trace:{model:config.model,effort:'high',inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,promptVersion:CODEX_PROMPT_VERSION,promptHash:digest(codexPrompt(p)),schemaHash:digest(CODEX_DRAFT_SCHEMA),outputHash:digest(rawOutput)}};}
function fixture({path=':memory:',mode='research',modelConfig=config,runner=async p=>output(p)}={}){
 let now=Date.parse('2026-10-03T00:00:00Z'),calls=0;
 const store=openStore(path);assertDatabaseMode(store,mode);const service=createService(store,{mode,fetcher:()=>{throw Error('fixture forbids external data');},sourceReader:()=>{throw Error('fixture forbids external data');},now:()=>now,modelConfig,modelRunner:async(...args)=>{calls++;return runner(...args);},semanticRunner:async p=>{const f=s=>({actor:'合成',action:'拟收购',object:'合成标的',eventTime:'未知',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},stage:'待核',quote:p.input[s].title}),comparison={relation:'followup',left:f('left'),right:f('right'),reason:'合成比较',missingEvidence:['原文']},rawOutput=JSON.stringify(comparison);return {status:'candidate',reviewStatus:'unreviewed',comparison,rawOutput,trace:{model:config.model,inputHash:p.inputHash,outputHash:digest(rawOutput)}};}});
 const prepare=async()=>{
  now+=3600000;const at=new Date(now).toISOString(),news=[0,1].map(i=>({id:randomUUID(),title:'合成新闻'+i,url:'https://example.com/'+randomUUID(),publisher:'合成',publishedAt:at}));store.ingest(news,at);
  const topic=service.research.createFromNews({newsId:news[0].id,newsRevision:1}),inputs=news.map(n=>({id:n.id,revision:1}));
  const p=service.semanticBatches.preview({inputs}),b=service.semanticBatches.create({inputs,planHash:p.planHash,requestId:randomUUID()});service.semanticBatches.step({assertActive(){}});await service.semanticEvents.wait(service.semanticBatches.get(b.id).items[0].runId);now+=1000;
  const g=service.eventClusters.preview(b.id).groups[0],cluster=service.eventClusters.save({batchId:b.id,groupId:g.id,previewHash:g.hash,clusterId:'',version:0,title:'合成簇',note:'开发测试，非独立真值',requestId:randomUUID()});now+=1000;return {topic,cluster,news,batchId:b.id};
 };
 return {store,service,prepare,get calls(){return calls;},tick(){now+=1000;return new Date(now).toISOString();},time(){return new Date(now).toISOString();},async close(){await service.close();store.close();}};
}
const freeze=f=>f.service.forwardEvaluations.freeze({requestId:randomUUID(),title:'合成前向输入基线'});
const start=(f,t)=>f.service.modelResearch.start(t.id,{version:t.version});

export {fixture,freeze,start,config,output};
