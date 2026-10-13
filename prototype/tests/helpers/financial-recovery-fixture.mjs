import {openFinancialSources} from '../../server/financial-sources.mjs';
import assert from 'node:assert/strict';
import {fixture,output,dossier} from '../automatic-research-fixture.mjs';
import {SEC_TICKERS_URL,secFactsUrl} from '../../server/financial-source-material.mjs';
import {secSubmissionsUrl} from '../../server/financial-filing-material.mjs';
import {filingMap,filingIndex,quarterlyUrl,syntheticFilingHtml} from './financial-filing-fixture.mjs';
export const legacyNameError='SEC发行人名称不一致；仅接受相同主体名称的CORP/CORPORATION后缀差异';
export const legacyTableError='网页表格结构无效或超过读取上限，请核对原表并补充必要摘录';
const largeHtml=syntheticFilingHtml.replace('</body>','<table>'+Array.from({length:750},(_,i)=>'<tr>'+Array.from({length:20},(_,j)=>`<td>${i===749&&j===19?'Cash flow USD 987':''}</td>`).join('')+'</tr>').join('')+'</table></body>');
export const facts={cik:1045810,entityName:'Nvidia Corp',facts:{'us-gaap':{Revenues:{units:{USD:[{val:200,end:'2026-07-26',start:'2026-01-26',filed:'2026-08-26',form:'10-Q',accn:'0001045810-26-000075',fy:2027,fp:'Q2'}]}}}}};
export const jobs=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='dossier' ORDER BY rowid").all().map(r=>({...r,p:JSON.parse(r.payload)}));
export const event=f=>f.service.research.list().find(t=>t.eventExtraction);
export const recoveries=f=>jobs(f).filter(x=>x.p.financialFollowup);
export function make({path,mode='legacy',capability='name',fetcher,researchRunner=dossier,sourceReader,extractionRunner,...options}={}){
 // The original client archives responses; a test adapter then emits the old
 // decoder error. Actual old-parser provenance is separately replayed from real records.
 let state=mode;const requests=[],packets=[],quote='NVIDIA 拟回购普通股，授权规模不等于实际执行金额。';
 const f=fixture({path,...options,financialSourceFactory:(store,opts)=>{const source=openFinancialSources(store,opts);return {...source,async read(...args){if(state==='fail')throw Error('synthetic temporary network error');const result=await source.read(...args);if(state==='legacy'){if(capability==='name')throw Error(legacyNameError);if(!args[2]?.allowFilingGaps)throw Error(legacyTableError);return {...result,filingMaterials:[],filingCoverage:result.filingCoverage.map(x=>({...x,status:'unavailable',reason:legacyTableError}))};}return result;}};},fetcher:async(url,opts)=>{
  requests.push(url);if(fetcher)return fetcher(url,opts,state);
  if(url===quarterlyUrl)return new Response(capability==='cells'?largeHtml:syntheticFilingHtml,{headers:{'content-type':'text/html'}});
  return new Response(JSON.stringify(url===SEC_TICKERS_URL?filingMap:url===secFactsUrl('0001045810')?{...facts,entityName:capability==='cells'?'NVIDIA CORP':'Nvidia Corp'}:{...filingIndex(),name:capability==='cells'?'NVIDIA CORP':'Nvidia Corp'}));
 },sourceReader:sourceReader||(async url=>({url,title:'合成财务恢复公告',sourceName:'合成',body:quote+'财务恢复流程的合成证据。'.repeat(45),scope:'extracted-text'})),extractionRunner:extractionRunner||(p=>output(p,'decomposition',{events:[{title:'合成回购事项',actor:'NVIDIA',action:'拟回购',object:'普通股',stage:'授权未执行',eventTime:'未知',quote,quoteField:'body',boundaryReason:'单一事项',timeEvidence:{basis:'unknown',quote:'',quoteField:'none'},timeRole:'unknown'}],scopeNote:'合成',missingEvidence:['财务背景']})),identityRunner:p=>output(p,'resolution',{mentions:[{name:'NVIDIA',quote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'测试目录',...(p.input.identityAttachment?{eventConnection:{relation:'direct',anchorQuote:p.input.eventFocus.quote,reason:'合成附件直接复述原回购事项'}}:{})}],scopeNote:'合成',missingEvidence:['历史身份']}),researchRunner:p=>{packets.push(p);return researchRunner(p);}});
 f.queue.configure({...f.queue.snapshot().settings,financialSources:true});
 return Object.assign(f,{requests,packets,capability,setMode:m=>state=m});
}
export async function legacy(f){
 f.add(1);await f.until(()=>jobs(f).some(j=>j.p.financial?.attempts.some(a=>a.state==='failed'&&a.attempt===1)));f.advance(60001);
 await f.until(()=>jobs(f).some(j=>j.p.financial?.attempts.some(a=>a.state==='failed'&&a.attempt===2)));f.advance(120001);
 await f.until(()=>!!event(f)?.dossier);assert.equal(event(f).financialSources[0].status,f.capability==='cells'?'saved':'unavailable');assert.equal(jobs(f)[0].p.financial.attempts.filter(x=>x.state==='started').length,3);assert.equal(recoveries(f).length,0);
}
