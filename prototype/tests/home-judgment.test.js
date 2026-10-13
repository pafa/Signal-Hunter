import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
import {groupEventResearch} from '../shared/workbench-events.mjs';
import {researchActionLabel} from '../shared/research-action.mjs';
async function withUI(fn,options){
 const f=await marketResearchFixture(options),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{const {default:Brief}=await vite.ssrLoadModule('/src/integrated/EventBrief.jsx'),{default:Composite}=await vite.ssrLoadModule('/src/integrated/EventSynthesisBrief.jsx'),{default:Judgment}=await vite.ssrLoadModule('/src/integrated/ResearchJudgmentBrief.jsx');await fn({f,Brief,Composite,Judgment,vite});}finally{await vite.close();await f.close();}
}
const render=(View,props)=>renderToStaticMarkup(React.createElement(View,props));
const props=data=>({compact:true,topic:data.research.topics[0],researchActions:data.observationInbox.researchActions,decisions:data.overview.decisions,selected:'NVDA.US'});
const text=html=>new JSDOM(html).window.document;

test('home, current company and account plan share the saved binding; original manual hypothesis is retained in disclosure',()=>withUI(async({f,Brief})=>{
 f.enable();const data=f.service.snapshot(),p=props(data),changes=f.store.db.prepare('SELECT total_changes() n').get().n,d=text(render(Brief,p)),j=d.querySelector('[aria-label="当前系统逐公司判断"]');
 assert.equal(p.topic.hypothesis.action,'observe');assert.match(j.textContent,/NVDA.US · 考虑买入/);assert.match(j.textContent,/1 份账户方案待本人最后决定/);assert.equal(j.querySelector('.dashboard-logic').textContent,'系统依据 '+p.researchActions[0].judgment.reason);assert.doesNotMatch(j.textContent,/人工行动假设|尚未形成买点/);assert.match(d.querySelector('details').textContent,/原行动假设.*继续观察/);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);
}));

test('research intent survives an unconfigured account, while paused checks make readiness wait and remove actionable plans',()=>withUI(async({f,Brief})=>{
 let d=text(render(Brief,props(f.service.snapshot())));assert.match(d.querySelector('.v8-verdict').textContent,/考虑买入/);assert.match(d.body.textContent,/本版暂无自动账户方案待决定/);
 f.enable();f.service.controlOperation('observations','pause');const data=f.service.snapshot();assert.equal(data.overview.decisions.length,0);d=text(render(Brief,props(data)));assert.match(d.querySelector('.v8-verdict').textContent,/考虑买入 · 等待研究条件/);assert.doesNotMatch(d.body.textContent,/1 份账户方案待本人最后决定/);
}));

test('expired recommendation is historical in both home and the original holding, with original costs and research preserved',()=>withUI(async({f,Brief})=>{
 f.enable();f.decide(f.candidate());f.tick();f.quote();f.sim.process();const original=f.sim.snapshot().lots[0];assert(original);
 f.tick(5*3600000);const data=f.service.snapshot(),d=text(render(Brief,props(data))),position=data.overview.accounts.find(a=>a.id==='steady').positions[0];
 assert.match(d.querySelector('.v8-verdict').textContent,/原判断待更新 · 仅供历史参考/);assert.match(position.judgement,/仅供历史参考/);assert(position.risks.some(r=>r.includes('复核期限')));assert.equal(data.overview.decisions.length,0);assert.deepEqual(f.sim.snapshot().lots[0],original);
}));

test('a changed run or security cannot lend its buy recommendation or account readiness to the selected subject',()=>withUI(async({f,Brief,Judgment})=>{
 f.enable();const data=f.service.snapshot(),p=props(data),bad=structuredClone(p.researchActions);bad[0].subject.runId='another-run';let d=text(render(Brief,{...p,researchActions:bad}));assert.match(d.querySelector('.v8-verdict').textContent,/系统判断当前无法核对/);assert.doesNotMatch(d.querySelector('[aria-label="当前系统逐公司判断"]').textContent,/考虑买入|份账户方案/);
 d=text(render(Judgment,{rows:p.researchActions,selected:'09988.HK',decisions:p.decisions}));assert.match(d.querySelector('.v8-verdict').textContent,/09988.HK · 系统判断当前无法核对/);assert(d.querySelector('button').disabled);assert.doesNotMatch(d.body.textContent,/考虑买入|份账户方案/);
 const foreign=p.decisions.map(r=>({...r,researchBinding:{...r.researchBinding,version:r.researchBinding.version+1}}));d=text(render(Brief,{...p,decisions:foreign}));assert.match(d.body.textContent,/本版暂无自动账户方案待决定/);
}));

test('composite is authoritative for account plans, keeps its event-wide explanation and does not repeat member plans',()=>withUI(async({f,Brief,Composite})=>{
 f.enable();const data=f.service.snapshot(),group=groupEventResearch(data.research.topics,data.overview).find(g=>g.cluster);assert(group);const common={researchActions:data.observationInbox.researchActions,decisions:data.overview.decisions,selected:'NVDA.US'},d=text(render(Composite,{...common,group}));assert.match(d.querySelector('.v8-verdict').textContent,/考虑买入/);assert.match(d.body.textContent,/1 份账户方案待本人最后决定/);assert.match(d.querySelector('details').textContent,/事件整体判断/);assert(d.querySelector('details').textContent.includes(group.cluster.research.judgment));
 const member=text(render(Brief,{...common,compact:true,topic:group.topics[0],eventGroup:group}));assert.match(member.body.textContent,/本篇为事件成员，当前方案以事件综合为准/);assert.doesNotMatch(member.body.textContent,/份账户方案待本人最后决定/);
 const old=text(render(Composite,{...common,group:{...group,cluster:{...group.cluster,research:{...group.cluster.research,current:false,status:'stale'}}}}));assert.match(old.querySelector('.v8-verdict').textContent,/仅供历史参考/);assert.doesNotMatch(old.body.textContent,/份账户方案待本人最后决定/);
},{composite:true}));

test('company selection and drilldown use the selected security while original research is only an explicit secondary action',()=>withUI(async({f,Judgment,Brief})=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),names=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const rows=f.service.snapshot().observationInbox.researchActions,other={...structuredClone(rows[0]),symbol:'09988.HK',action:'watch',state:'observing'},opened=[];
 function Harness(){const [selected,onSelect]=useState('NVDA.US');return React.createElement(Judgment,{rows:[rows[0],other],selected,onSelect,onCompany:s=>opened.push(s)});}
 await act(()=>root.render(React.createElement(Harness)));const select=document.querySelector('select');await act(()=>{select.value='09988.HK';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.match(document.querySelector('.v8-verdict').textContent,/09988.HK · 继续观察/);await act(()=>document.querySelector('button').click());assert.deepEqual(opened,['09988.HK']);
 const tabs=[];await act(()=>root.render(React.createElement(Brief,{...props(f.service.snapshot()),onDetail:s=>tabs.push(s),onCompany:s=>opened.push(s)})));await act(()=>document.querySelector('details').setAttribute('open',''));await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='查看原行动假设').click());assert.deepEqual(tabs,['hypothesis']);
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();}
}));

test('legacy research remains explicitly labeled, and unknown readiness cannot display a valid buy label',()=>withUI(async({f,Brief})=>{
 const p=props(f.service.snapshot()),topic=structuredClone(p.topic);delete topic.dossier.companyAssessment;const d=text(render(Brief,{...p,topic,researchActions:[]}));assert.match(d.querySelector('.v8-verdict').textContent,/人工行动假设：继续观察/);assert.equal(researchActionLabel({action:'buy',state:'unknown'}),'尚不能形成行动倾向');assert.equal(researchActionLabel(null),'当前判断待更新');
}));
