import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {factFixture,factClaim} from './helpers/business-facts-fixture.mjs';
import {watchReady} from './helpers/watch-review-fixture.mjs';
import {BUSINESS_FACT_CONTRACT} from '../shared/business-facts.mjs';

test('business facts reuse folded company source controls and show review on home and recorded holding without inventing prices',async()=>{
 const f=factFixture(),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
  const topic=await watchReady(f);await f.service.runOperation('observations');
  const data=f.service.snapshot(),row=data.observationInbox.researchActions[0],a=topic.dossier.companyAssessment.assessments[0];
  const {default:Brief}=await vite.ssrLoadModule('/src/integrated/ResearchJudgmentBrief.jsx'),{default:Company}=await vite.ssrLoadModule('/src/major/CompanyAssessment.jsx');
  const home=renderToStaticMarkup(React.createElement(Brief,{rows:[row],selected:row.symbol,decisions:[]}));assert(home.includes('业务事实复核'));assert(home.includes('后台接续证据'));
  const detail=renderToStaticMarkup(React.createElement(Company,{assessment:a,evidence:topic.evidence,topicId:topic.id,onEvidence:()=>{},conditionChecks:data.observationInbox.researchChecks}));
  assert(detail.includes(factClaim));assert(detail.includes('仍待核对'));assert(detail.includes('查看业务事实依据'));assert(detail.includes('查看本版材料'));assert(detail.includes('未完成独立事实核验'));assert(!detail.includes('<details open'));
  const h=f.service.actualHoldings,p=h.preview({rows:[{account:'Synthetic business monitor',symbol:'NVDA.US',quantity:'10',unitCost:'100.1',price:'',feeBasis:'included',asOf:'2026-10-08T00:00:00Z',source:'Synthetic snapshot',topicId:topic.id,topicVersion:topic.version}]});assert(p.canApply);h.apply({id:p.id,hash:p.hash});
  const holding=f.service.snapshot().overview.accounts.find(a=>a.kind==='actual').positions[0];assert.equal(holding.actualResearch.reviewPolicy,BUSINESS_FACT_CONTRACT);assert.equal(holding.actualResearch.exitAdvice.executable,false);assert.equal(holding.price,null);assert.equal(holding.qty,'10');assert.equal(f.service.snapshot().overview.decisions.length,0);
 }finally{await vite.close();await f.close();}
});
