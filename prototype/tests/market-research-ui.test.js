import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {marketResearchFixture} from './helpers/market-research-fixture.mjs';
test('automatic account UI contains one final decision, explicit budget and source detail without re-entering an order',async()=>{
 const f=await marketResearchFixture(),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/integrated/MarketResearchCandidates.jsx'),{default:Policy}=await vite.ssrLoadModule('/src/integrated/MarketAutoPolicy.jsx');let b=f.sim.snapshot(),html=renderToStaticMarkup(React.createElement(Policy,{book:b,storageKey:'synthetic'}));assert.match(html,/首次使用配置一次/);assert.doesNotMatch(html,/value="5"|checked=""/);f.enable();b=f.sim.snapshot();const c=f.candidate();html=renderToStaticMarkup(React.createElement(View,{book:b,selected:'research:'+c.id,storageKey:'synthetic'}));assert.match(html,/拟买入.*249.*股/);assert.match(html,/预算上限/);assert.match(html,/预计支出/);assert.match(html,/本人批准此模拟方案/);assert.match(html,/基准.*125/);assert.match(html,/synthetic-research-fixture-only/);assert.doesNotMatch(html,/<form|<input|<textarea/);f.decide(c,'reject');html=renderToStaticMarkup(React.createElement(View,{book:f.sim.snapshot(),storageKey:'synthetic'}));assert.match(html,/本人暂不执行/);assert.match(html,/disabled=""[^>]*>本人批准此模拟方案/);
 }finally{await vite.close();await f.close();}
});
