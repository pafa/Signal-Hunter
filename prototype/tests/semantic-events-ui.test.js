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
  for(const text of ['仅标题','新闻已修订，旧候选不可采纳','事件时间','未知','无法判断','针对另一份比较结果','没有读取正文','不自动归并新闻','旧版未记录时间依据'])assert.ok(html.includes(text),text);
  const material={...n,kind:'material',contentScope:'excerpt',body:'<script>不是页面脚本</script>已保存正文',contentHash:'material-hash'},bodyEvent={...e,quoteField:'body',quote:'已保存正文'};
  const bodyHtml=renderToStaticMarkup(React.createElement(ComparisonResult,{run:{id:'body',status:'candidate',createdAt:n.publishedAt,stale:true,packet:{input:{left:material,right:n},inputHash:'body-input'},model:'configured-model',candidate:{comparison:{left:bodyEvent,right:{...e,quoteField:'title'},relation:'related',reason:'仅核对',missingEvidence:[]},trace:{}},history:[]}}));
  for(const text of ['摘录','材料或新闻已修订','原文引用（正文）','原文引用（标题）','查看冻结正文与指纹','material-hash','未重新抓取或独立核实','&lt;script&gt;'])assert.ok(bodyHtml.includes(text),text);
  assert.ok(!bodyHtml.includes('<script>'));
  const {TimeEvidence}=await vite.ssrLoadModule('/src/integrated/SemanticEvents.jsx');
  for(const [basis,quote,expected] of [['relative','Today <script>quoted</script>','具体日历日期待核'],['explicit','2026年10月2日','原文明确日期'],['unknown','','缺少本侧时间依据']]){
   const rendered=renderToStaticMarkup(React.createElement(TimeEvidence,{event:{timeEvidence:{basis,quote}},input:n}));assert.ok(rendered.includes(expected));assert.ok(!rendered.includes('<script>'));if(basis==='relative'){assert.ok(rendered.includes('来源发布日期：2026-10-02 06:00:00 UTC'));assert.ok(rendered.includes('&lt;script&gt;'));}
  }
  for(const [publishedAt,expected] of [[null,'未提供'],['2026-10-02','2026-10-02（仅日期）'],['2026-10-02T23:30:00-07:00','2026-10-02 23:30:00 -07:00']]){
   const html=renderToStaticMarkup(React.createElement(TimeEvidence,{event:{timeEvidence:{basis:'relative',quote:'today'}},input:{publishedAt}}));assert.ok(html.includes(expected));
  }
 }finally{await vite.close();}
});
