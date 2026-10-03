import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';
test('reading scope renders unread attachments, cleanup counts, limits and escaped labels without implying completeness',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});try{
 const {default:View}=await vite.ssrLoadModule('/src/major/ArticleReadingScope.jsx'),render=p=>renderToStaticMarkup(React.createElement(View,p));assert.equal(render({}),'');assert.match(render({showMissing:true}),/旧材料未记录附件范围/);
 const evidence={removedControls:{fontSize:1,share:1},attachments:[{label:'<script>附件</script>',url:'https://news.acme.com/a.pdf',formatHint:'pdf',status:'unread'}],truncated:true,omittedAttachmentLinks:2},html=render({evidence});for(const t of ['1 个附件入口尚未读取','附件未下载或读取','1 处字号控件','1 处分享控件','2 个附件入口','本列表不完整','&lt;script&gt;','PDF 链接','rel="noreferrer"'])assert.ok(html.includes(t),t);assert.doesNotMatch(html,/<script>/);
 const empty=render({evidence:{...evidence,removedControls:{fontSize:0,share:0},attachments:[],truncated:false,omittedAttachmentLinks:0}});assert.match(empty,/没有列出附件也不表示原文没有附件/);assert.doesNotMatch(empty,/已移除|本列表不完整/);
 }finally{await vite.close();}
});
