import {unknownCompanyAssessments} from './helpers/company-assessment-fixture.mjs';
import {groupedComparisonFixture} from './helpers/grouped-comparison-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {assertDatabaseMode} from '../server/runtime.mjs';
import {digest} from '../server/codex-research.mjs';
import {SYSTEM_RESEARCH_ACTOR} from '../server/research-actor.mjs';
const config={binary:'/test/codex',model:'test-model',timeoutMs:1000},at='2026-10-08T00:00:00Z';
const quote='虚构甲公司拟收购虚构乙公司，仍需批准。';
function output(packet,key,value){const rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',[key]:value,rawOutput,trace:{model:config.model,inputHash:packet.inputHash,outputHash:digest(rawOutput)}};}
function extraction(p){return output(p,'decomposition',{events:[{title:'虚构甲收购事项',actor:'虚构甲',action:'拟收购',object:'虚构乙',stage:'待核',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一具体事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成材料',missingEvidence:['核验公告']});}
function identity(p){return output(p,'resolution',{mentions:[],scopeNote:'未有确定证券身份',missingEvidence:['上市公司身份']});}
function dossier(p){const value={...(p.input.companyAssessment?.targets.length?{companyAssessments:unknownCompanyAssessments(p)}:{}),sections:['facts','materiality','companies','scenarios','conditions'].map(id=>({id,title:id,paragraphs:['冻结的合成流程测试材料；未核实事实'],sourceIds:[]})),missingEvidence:['独立事实核验']},rawOutput=JSON.stringify(value);return {status:'candidate',reviewStatus:'unreviewed',...value,rawOutput,trace:{model:config.model,inputHash:p.inputHash,topicId:p.input.topicId,topicVersion:p.input.topicVersion,outputHash:digest(rawOutput)}};}
function comparison(p,relation='followup'){const event=side=>({actor:p.input[side].eventFocus.actor,action:p.input[side].eventFocus.action,object:p.input[side].eventFocus.object,eventTime:'未知',stage:p.input[side].eventFocus.stage,quote:p.input[side].eventFocus.quote,quoteField:'body',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'}});return output(p,'comparison',{relation,left:event('left'),right:event('right'),reason:'仅为引擎流程测试，两侧均引用冻结事项；不证明模型质量',missingEvidence:['真实公告与事实']});}
function fixture({path=':memory:',semanticRunner=p=>comparison(p),extractionRunner=extraction,synthesisRunner=dossier,researchRunner=dossier,identityRunner=identity,sourceReader=null}={}){
 let clock=Date.parse(at),synthesisCalls=0;const store=openStore(path);assertDatabaseMode(store,'research');const calls={extract:0,identity:0,dossier:0,semantic:0,semanticInvocations:0};
 const service=createService(store,{mode:'research',modelConfig:config,now:()=>clock,sourceReader:sourceReader||(async url=>({url,title:'合成公告',sourceName:'合成',body:quote+'虚构甲取消项目。'+'这些文字是合成测试材料，不证明事实与投资表现。'.repeat(30)+'材料版本 '+(store.newsById(digest('automatic-cluster-'+url.split('-').at(-1)))?.revision||1),scope:'extracted-text'})),materialEventRunner:async p=>{calls.extract++;return extractionRunner(p);},companyEntityRunner:async p=>{calls.identity++;return identityRunner(p);},modelRunner:async p=>{if(p.input.eventSynthesis){synthesisCalls++;return synthesisRunner(p);}calls.dossier++;return researchRunner(p);},semanticRunner:async (p,c)=>{calls.semanticInvocations++;return groupedComparisonFixture(async (pair,config)=>{calls.semantic++;return semanticRunner(pair,config);})(p,c);}});
 const queue=service.researchPipeline;if(queue.snapshot().settings.version===1)queue.configure({version:1,dailyCalls:100,includeClues:false,extractEvents:true,automatic:true});
 const news=i=>({id:digest('automatic-cluster-'+i),title:`Synthetic acquisition bankruptcy report ${i}`,url:`https://example.com/synthetic-${i}`,publisher:'合成',publishedAt:at});
 const add=i=>{store.ingest([news(i)],new Date(clock).toISOString());service.research.process();};
 const finish=async()=>{for(const row of store.db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE run_id IS NOT NULL').all())await (row.kind==='extract'?service.materialEvents:row.kind==='identity'?service.companyEntities:service.modelResearch).wait(row.run_id);for(const row of store.db.prepare("SELECT id FROM model_research_runs WHERE json_extract(payload,'$.subject')='event-cluster'").all())await service.modelResearch.wait(row.id);for(const row of store.db.prepare('SELECT id FROM semantic_runs').all())await service.semanticEvents.wait(row.id);};
 const step=async()=>{service.controlOperation('discovery','resume');const result=await service.runOperation('discovery');await finish();return result;};
 const drive=async(n=24)=>{for(let i=0;i<n;i++)await step();return queue.snapshot();};
 const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;const result=await step();if(result.error)assert.fail(JSON.stringify(result));}assert.fail('automatic pipeline did not reach expected state');};
 return {store,service,queue,calls,get synthesisCalls(){return synthesisCalls;},news,add,step,drive,finish,until,revise(i){const n=store.newsById(news(i).id);store.ingest([{...news(i),title:n.title+' revised'}],new Date(clock).toISOString());service.research.process();},advance(ms){clock+=ms;},async close(){await service.close();store.close();}};
}
const allClusters=f=>f.service.eventClusters.list().items;
const cluster=f=>f.service.eventClusters.get(allClusters(f)[0].id);
const relationRows=f=>f.queue.snapshot().relations.items;
const candidateRelation=f=>relationRows(f).find(r=>r.status==='candidate');
async function two(f){f.add(1);await f.drive();f.add(2);await f.drive();return cluster(f);}

export {config,at,quote,output,extraction,identity,dossier,comparison,fixture,allClusters,cluster,relationRows,candidateRelation,two};
