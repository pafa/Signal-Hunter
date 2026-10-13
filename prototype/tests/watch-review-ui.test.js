import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {watchFixture,watchReady} from './helpers/watch-review-fixture.mjs';

test('existing home and folded action detail show system observation cadence without an actionable order or invented holding window',async()=>{
 const f=watchFixture(),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});try{await watchReady(f);const data=f.service.snapshot(),row=data.observationInbox.researchActions[0];assert.equal(row.state,'observing');const {default:Brief}=await vite.ssrLoadModule('/src/integrated/ResearchJudgmentBrief.jsx'),{default:Action}=await vite.ssrLoadModule('/src/major/ResearchAction.jsx');const home=renderToStaticMarkup(React.createElement(Brief,{rows:[row],selected:row.symbol,decisions:[]}));assert(home.includes('后台观察复核'));assert(home.includes('每日按队列与额度接续'));assert(home.includes('买卖期限未知'));assert(home.includes('本版暂无自动账户方案待决定'));const value=data.research.topics.find(t=>t.id===row.subject.id).dossier.companyAssessment.assessments[0].recommendation;const detail=renderToStaticMarkup(React.createElement(Action,{value,state:row,fold:()=>({}),renderCitations:()=>null}));assert(detail.includes('保存后每24小时'));assert(detail.includes('买卖有效期与预计卖出日仍未知'));assert(!detail.includes('<details open'));assert.equal(data.overview.decisions.length,0);
 }finally{await vite.close();await f.close();}
});
