import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('semantic research basis preserves original direction, scope, warning and escaped citations',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/major/SemanticResearchBasis.jsx'),record={title:'<script>合成标题</script>',revision:2,contentScope:'excerpt'},basis={sourceSide:'right',source:record,target:{...record,contentScope:'headline-only'},relation:'followup',decisionVersion:3,model:'test-model',comparison:{left:{quote:'标题引用'},right:{quote:'<script>正文引用</script>',quoteField:'body'},reason:'左右顺序须核对',missingEvidence:['还需来源']},decisionNote:'核对',decisionAt:'2026-10-03T01:00:00Z',runId:'run',inputHash:'input-hash',hash:'basis-hash'};
 const html=renderToStaticMarkup(React.createElement(View,{basis,status:{current:false,message:'比较依据已变化'}}));for(const text of ['本研究对应右侧','目标研究对应左侧','左侧相对于右侧','摘录','仅标题','比较依据已变化','引用来自正文','引用来自标题','basis-hash','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.ok(!html.includes('<script>'));
 }finally{await vite.close();}
});
