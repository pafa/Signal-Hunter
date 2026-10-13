import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('document context distinguishes included bodies from unread and historical page scope without claiming event identity',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/integrated/EventDocumentContext.jsx'),render=context=>renderToStaticMarkup(React.createElement(View,{context,disclosure:()=>({open:true}),onEvidence:()=>{}}));assert.equal(render(null),'');
 const html=render({entries:[{parentEvidenceId:'parent',url:'https://example.com/a',label:'<script>附件一</script>',status:'available',evidenceId:'one',materialRevision:2,reason:'URL与归档对应'},{parentEvidenceId:'parent',url:'https://example.com/b',label:'附件二',status:'unread',reason:'尚未读到'}]});
 for(const s of ['本版纳入 1 / 2','已纳入本版','未纳入本版','查看父通知','查看附件正文','材料 v2','不表示全文完整','不因文档关联而自动成为同一事件成员','保留当时范围','&lt;script&gt;'])assert(html.includes(s),s);assert.doesNotMatch(html,/<script>/);assert.equal((html.match(/查看附件正文/g)||[]).length,1);
 }finally{await vite.close();}
});
