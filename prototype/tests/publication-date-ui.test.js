import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('publication UI distinguishes legacy, missing and conflicting dates and escapes source fields',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {default:View}=await vite.ssrLoadModule('/src/major/PublicationDateEvidence.jsx'),render=props=>renderToStaticMarkup(React.createElement(View,props));
 assert.equal(render({}), '');assert.match(render({showMissing:true}),/历史日期未改写/);
 const evidence={schema:'publication-date-1',status:'known',candidates:[{source:'meta:article:published_time',raw:'2026-10-02T23:30:00-07:00'}],truncated:false};
 const html=render({evidence});for(const t of ['已读取','文章元数据','2026-10-02T23:30:00-07:00','不是事件发生时间','多个独立来源'])assert.ok(html.includes(t),t);
 for(const [status,label] of [['missing','没有找到明确发布日期'],['invalid','格式或时区无法确认'],['conflict','来源日期互相冲突'],['overflow','日期字段过多或过长']])assert.ok(render({evidence:{...evidence,status}}).includes(label));
 const escaped=render({evidence:{...evidence,truncated:true,candidates:[{source:'jsonld:datePublished',raw:'<script>fixture</script>'}]}});assert.match(escaped,/&lt;script&gt;/);assert.doesNotMatch(escaped,/<script>/);assert.match(escaped,/未据此选择发布日期/);
 }finally{await vite.close();}
});
