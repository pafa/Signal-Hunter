import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {exitFixture} from './helpers/market-exit-fixture.mjs';
test('existing account view shows an optional final exit decision, frozen source details and explicit blocked reasons',async()=>{
 const f=exitFixture(),vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/integrated/MarketExitCandidates.jsx');f.buy();f.tick();f.quote('85');let c=f.candidate();
  let html=renderToStaticMarkup(React.createElement(View,{candidates:[c],selected:`exit:${c.id}`,enabled:true}));assert.match(html,/本人批准此模拟退出/);assert.match(html,/拟卖 100 股/);assert.match(html,/84.950000 USD/);assert.match(html,/<details open=""/);assert.match(html,/合成|synthetic-exit-fixture-only/);assert.doesNotMatch(html,/<input|<textarea|<form/);
  f.decide(c,'reject');c=f.candidate();html=renderToStaticMarkup(React.createElement(View,{candidates:[c],enabled:true}));assert.match(html,/本人暂不退出/);assert.match(html,/暂不退出不会解除风险/);
  f.quotes()['AAPL.US'].halted=true;c=f.candidate();html=renderToStaticMarkup(React.createElement(View,{candidates:[c],enabled:true}));assert.match(html,/暂不能形成可批准方案/);assert.match(html,/停牌/);assert.match(html,/disabled=""[^>]*>本人批准此模拟退出/);
 }finally{await vite.close();await f.close();}
});
