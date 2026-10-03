import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('observation cards show exact threshold, uncertainty and frozen research baseline without suggesting a trade',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{
  const {default:Rules,ObservationResults}=await vite.ssrLoadModule('/src/integrated/ObservationRules.jsx');
  const rule={id:'test-rule',topicId:'t',version:2,active:true,binding:{topicVersion:3},definition:{label:'Synthetic price check',join:'all',conditions:[{type:'price',symbol:'00700.HK',currency:'HKD',interval:'1d',operator:'gte',value:100}]},check:{state:'unknown',checkedAt:'2026-10-02T06:00:00Z',results:[{state:'unknown',reason:'行情缺失',input:{symbol:'00700.HK',currency:'HKD',operator:'gte',threshold:100}}]}};
  const html=renderToStaticMarkup(React.createElement(Rules,{data:{runtime:{offline:false},research:{topics:[{id:'t',title:'Synthetic topic',status:'active',version:4,companies:[]}]},observationInbox:{rules:[rule]}},initialTopicId:'t'}));
  assert.match(html,/00700.HK 日线收盘 ≥ 100 HKD/);assert.match(html,/无法判断/);assert.match(html,/研究基线 v3/);assert.match(html,/不改变研究、风险限额或订单/);assert.doesNotMatch(html,/已生成待办/);
  const hit=renderToStaticMarkup(React.createElement(ObservationResults,{results:[{state:'true',reason:'缓存收盘价与阈值比较',input:{symbol:'00700.HK',currency:'HKD',price:105,operator:'gte',threshold:100,provider:'fixture',synthetic:true}}]}));assert.match(hit,/合成演示/);assert.match(hit,/105/);assert.match(hit,/100/);
  const temporal=renderToStaticMarkup(React.createElement(ObservationResults,{results:[{state:'true',reason:'有效采样持续满足已设时长',input:{symbol:'00700.HK',currency:'HKD',price:105,operator:'gte',threshold:100,temporal:{mode:'held',sampleCount:3,maxGapSeconds:180,observedSeconds:120,holdSeconds:120,samples:[{dataAt:'2026-10-02T06:00:00Z',price:101,receivedAt:'2026-10-02T06:00:01Z',provider:'fixture',quoteHash:'fixture-quote-hash'}]}}}]}));assert.match(temporal,/已观察 120 \/ 120 秒/);assert.match(temporal,/查看命中采样依据/);assert.match(temporal,/fixture-quote-hash/);assert.match(temporal,/2026-10-02T06:00:00Z/);
 }finally{await vite.close();}
});
