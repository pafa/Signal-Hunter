import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('existing identity detail distinguishes attachment quote from original event and preserves escaped reasoning',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {EntityReview}=await vite.ssrLoadModule('/src/major/CompanyEntities.jsx'),mention={name:'Synthetic',quote:'附件中的主体原文',quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'冻结目录',eventConnection:{relation:'direct',anchorQuote:'原事项引用',reason:'<script>文本应转义</script>'}},render=()=>renderToStaticMarkup(React.createElement(EntityReview,{mention,index:0,history:[{action:'link',symbol:'NVDA.US',version:1}],directory:[],disabled:false}));
  let html=render();assert(html.includes('直接关联候选'));assert(html.includes('原事项引用'));assert(html.includes('附件中的主体原文'));assert(html.includes('已关联 NVDA.US'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('批准'));assert(!html.includes('<details open'));
  mention.eventConnection.relation='unrelated';html=render();assert(html.includes('其他事项'));delete mention.eventConnection;html=render();assert(!html.includes('与原事项的关系'));
 }finally{await vite.close();}
});

test('existing folded identity detail labels indirect parent and separately shows direct subject and cited relationship',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {EntityReview}=await vite.ssrLoadModule('/src/major/CompanyEntities.jsx');const {parentMention}=await import('./helpers/parent-identity-fixture.mjs');const m=parentMention();m.eventConnection.ownership.ownershipQuote+='<script>not executable</script>';const html=renderToStaticMarkup(React.createElement(EntityReview,{mention:m,index:0,history:[{action:'link',symbol:'NVDA.US',version:1}],directory:[],disabled:false}));assert(html.includes('控股母公司候选 · 间接影响'));assert(html.includes('直接涉事主体：'));assert(html.includes('Synthetic Subsidiary One'));assert(html.includes('直接主体的事项动作'));assert(html.includes('母子公司控股关系'));assert(html.includes('不能等同直接涉事主体'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('<details open'));assert(!html.includes('批准'));
 }finally{await vite.close();}
});
