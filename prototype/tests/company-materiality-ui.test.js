import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {normalizeMateriality} from '../shared/company-materiality.mjs';

test('company materiality renders assumptions, unknown ratios, timing limits and escaped source text',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {CompanyMaterialityView}=await vite.ssrLoadModule('/src/major/CompanyMateriality.jsx');
  const value=normalizeMateriality([{id:'test',label:'Synthetic <script>bad()</script>',scope:'Consolidated',period:'FY2026',unit:'million USD',basis:'Hypothesis only',comparable:true,baseline:{value:0,kind:'assumption',evidenceIds:[]},observed:{value:20,kind:'assumption',evidenceIds:[]}}],{evidence:[]},'2026-10-03T00:00:00Z');
  const html=renderToStaticMarkup(React.createElement(CompanyMaterialityView,{value}));assert.match(html,/无法计算/);assert.match(html,/人工假设/);assert.match(html,/事前可用时间未证实/);assert.match(html,/不证明价格尚未反映/);assert.match(html,/20 million USD/);assert.doesNotMatch(html,/<script>/);
  assert.match(renderToStaticMarkup(React.createElement(CompanyMaterialityView,{value:null})),/尚无结构化量级计算/);
 }finally{await vite.close();}
});
