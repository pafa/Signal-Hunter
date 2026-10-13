import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('source-link details and follow-up distinguish unread references, bounded research and received-news scope',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});try{
 const {default:Links}=await vite.ssrLoadModule('/src/major/ArticleSourceLinks.jsx'),{default:Tasks}=await vite.ssrLoadModule('/src/integrated/EvidenceFollowupTasks.jsx');
 const link={url:'https://ir.acme.com/a',label:'<script>原文</script>',originalUrl:'http://ir.acme.com/a',context:'公告中引用的声明'},markup=renderToStaticMarkup(React.createElement(Links,{links:{links:[link],truncated:true}}));
 for(const t of ['目标网页是否已读取','最多选择 3 个','最多沿明确链接延伸两层','原链接：','http://ir.acme.com/a','本列表不完整','&lt;script&gt;','rel="noreferrer"'])assert.ok(markup.includes(t),t);assert.doesNotMatch(markup,/<script>/);
 const s={id:'linked',policy:'linked-public-source/1',anchor:{title:'合成事项',kind:'event',topicId:'one',topicVersion:4,missing:['核验声明']},status:'pending',coverage:{selected:1,maximumCandidates:3,newLeads:1,reusedNews:0,maximumDepth:1},candidates:[{pipelineId:'p',newsId:'n',title:'网页引用',revision:1,current:true,created:true,status:'pending',reasons:['核对批准'],link,requestedUrl:link.url,pairs:[]}]};
 const html=renderToStaticMarkup(React.createElement(Tasks,{evidence:{total:1,items:[s]},initialExpanded:{root:true,linked:true}}));
 for(const t of ['沿原文网页链接补读','最多延伸 1 层','原文链接新增入口','引用附近原文','补读','核验声明'])assert.ok(html.includes(t),t);assert.doesNotMatch(html,/本次索引|undefined|<script>/);
 const deeper=renderToStaticMarkup(React.createElement(Tasks,{evidence:{total:1,items:[{...s,policy:'linked-public-source/2',coverage:{...s.coverage,maximumDepth:2},excluded:[{url:'https://ir.acme.com/old',link:{label:'上游材料'},reason:'链接返回来源链'}]}]},initialExpanded:{root:true,linked:true}}));for(const text of ['最多延伸 2 层','未继续读取','上游材料','链接返回来源链','原链接：'])assert.ok(deeper.includes(text),text);assert.doesNotMatch(deeper,/本次索引|undefined/);
 const received=renderToStaticMarkup(React.createElement(Tasks,{evidence:{total:1,items:[{...s,policy:'received-news-followup/1',coverage:{newsIndexed:10,newsTotal:20,automaticRevisions:8,windowDays:90,matches:2,selected:2,maximumCandidates:3},candidates:[]}]}}));assert.match(received,/本次索引 10 \/ 20/);assert.doesNotMatch(received,/最多延伸/);
 }finally{await vite.close();}
});
