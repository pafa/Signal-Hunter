import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('original dossier discloses prepared versus analysed document scope without adding an intermediate action',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/major/DocumentResearchScope.jsx'),topic={version:4,dossier:{basedOnResearchVersion:2},documentContext:{entries:[{parentEvidenceId:'m',url:'https://example.com/a',label:'<script>附件一</script>',status:'available',reason:'已保存正文'},{parentEvidenceId:'m',url:'https://example.com/b',label:'附件二',status:'unread',reason:'未读缺口',requested:true}]}},render=()=>renderToStaticMarkup(React.createElement(View,{topic,onMaterials:()=>{}}));let html=render();assert(html.includes('材料已准备 1 / 2'));assert(html.includes('旧研判尚未覆盖'));assert(html.includes('查看已归档的通知与附件'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));topic.dossier.basedOnResearchVersion=4;html=render();assert(html.includes('本版研判已纳入 1 / 2'));assert(!html.includes('旧研判尚未覆盖'));assert(html.includes('原请求与未读原因保留'));assert(!html.includes('批准'));
 }finally{await vite.close();}
});
