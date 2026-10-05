import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {validateObservationDefinition} from '../server/observation-rules.mjs';
test('minute form uses return-only controls and submits through the existing versioned observation path',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],before=Object.fromEntries(names.map(k=>[k,globalThis[k]]));let root;
 try{
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const topic={id:'t',title:'Synthetic',version:1,status:'active',companies:[{symbol:'AAPL.US',name:'Synthetic company'}]},calls=[];
 sessionStorage.setItem('signal-observation-draft:local:t:new',JSON.stringify({clientId:'minute-ui-fixture',topicVersion:1,version:0,label:'Synthetic minute rule',join:'all',conditions:[{type:'at',at:''}],note:''}));
 const {default:Rules,ObservationResults}=await vite.ssrLoadModule('/src/integrated/ObservationRules.jsx'),{createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));
 const mutate=async(path,method,body)=>{calls.push({path,method,body});validateObservationDefinition({label:body.label,join:body.join,conditions:body.conditions},topic);return {ok:true};};
 await act(async()=>root.render(React.createElement(Rules,{data:{research:{topics:[topic]},observationInbox:{rules:[]}},initialTopicId:'t',busy:false,mutate})));
 const button=t=>[...document.querySelectorAll('button')].find(e=>e.textContent===t),select=t=>[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent===t)?.querySelector('select');
 await act(()=>button('添加观察条件').click());await act(()=>{const el=select('条件类型');el.value='minute-anomaly';el.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await act(()=>{const el=select('关联证券');el.value='AAPL.US';el.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(select('统计指标').options.length,1);assert.match(document.body.textContent,/不支持分钟成交量/);assert.doesNotMatch(document.body.textContent,/只比较已结束日线/);
 await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/research/t/observation-rules');assert.equal(calls[0].body.conditions[0].type,'minute-anomaly');assert.equal(calls[0].body.conditions[0].windowSize,20);assert.equal(sessionStorage.getItem('signal-observation-draft:local:t:new'),null);
 const html=renderToStaticMarkup(React.createElement(ObservationResults,{results:[{state:'unknown',reason:'需刷新来源',input:{symbol:'AAPL.US',statistical:{engine:'minute-anomaly/1',interval:'1m',metric:'return',direction:'both',zThreshold:3,completionBasis:'后续采样'}}}]}));assert.match(html,/分钟价格变化/);assert.doesNotMatch(html,/日涨跌幅|日线|成交量口径未记录/);
 }finally{if(root)await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();await vite.close();}
});
