import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {semanticRunLabel} from '../shared/semantic-labels.mjs';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('semantic review displays source scope, unknown event time, stale input and separate decisions',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{
  assert.equal(semanticRunLabel({id:'r',status:'candidate',decision:{runId:'r',action:'accept'}}),'已采纳');
  assert.equal(semanticRunLabel({id:'r',status:'candidate',stale:true,decision:{runId:'r',action:'accept'}}),'采纳已过期');
  const {ComparisonResult}=await vite.ssrLoadModule('/src/integrated/SemanticEvents.jsx');
  const n={revision:1,title:'合成标题',publishedAt:'2026-10-02T06:00:00Z'},e={actor:'甲公司',action:'否认',object:'乙公司收购',eventTime:'未知',stage:'传闻否认',quote:'合成标题'};
  const html=renderToStaticMarkup(React.createElement(ComparisonResult,{run:{id:'run',status:'candidate',createdAt:n.publishedAt,stale:true,packet:{input:{left:n,right:n},inputHash:'frozen'},model:'configured-model',candidate:{comparison:{left:e,right:e,relation:'uncertain',reason:'对象未明确',missingEvidence:['核对全文']},trace:{}},decisionVersion:2,decision:{runId:'other',action:'accept'},history:[]}}));
  for(const text of ['仅标题','新闻已修订，旧候选不可采纳','事件时间','未知','无法判断','针对另一份比较结果','没有读取正文','不自动归并新闻'])assert.ok(html.includes(text),text);
 }finally{await vite.close();}
});
