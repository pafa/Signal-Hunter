import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {safeDiagnosticPayload,safeErrorText} from '../shared/safe-errors.mjs';
import {createHandler} from '../server/index.mjs';
const secret='FIXTURE_PRIVATE';
const errors=[`https://fixture.invalid/path?token=${secret}`,`Authorization: Bearer ${secret}`,`password=${secret}`,{kind:'all-sources-failed',message:secret,attempts:[{kind:'timeout',message:secret,cause:{message:secret}}]}];
test('diagnostic projection hides old nested errors without changing original records',()=>{
 const input={checks:{news:{error:errors[0]}},operations:{news:{error:errors[1]}},operationHistory:[{summary:{error:errors[2]}}],failure:errors[3],title:'research title',url:'https://public.invalid/article'};
 const output=safeDiagnosticPayload(input);assert.doesNotMatch(JSON.stringify(output),/FIXTURE_PRIVATE|fixture.invalid|Bearer|password=/);assert.equal(output.title,input.title);assert.equal(output.url,input.url);assert.equal(input.checks.news.error,errors[0]);assert.equal(safeErrorText(errors[3]),'主源与备用源均失败');assert.equal(safeErrorText({kind:'constructor',message:secret}),'任务失败，请检查来源或运行配置');assert.doesNotMatch(JSON.stringify(safeDiagnosticPayload({fallbackReason:errors[0]})),/FIXTURE_PRIVATE/);
});
test('real handler projects data, operation, health and mutation responses',async()=>{
 const payload={checks:{news:{error:errors[0]}},operations:{news:{error:errors[1]}},operationHistory:[{summary:{error:errors[3]}}]};
 const service={snapshot:()=>payload,operations:()=>payload,health:()=>payload,syncWatches:()=>{},controlOperation:()=>{}};
 const handler=createHandler({},service);for(const [method,url] of [['GET','/api/data'],['GET','/api/operations'],['GET','/api/health'],['POST','/api/operations/news']]){
 let output;const req={method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from('{"action":"pause"}');}};
 await handler(req,{writeHead:()=>{},end:text=>{output=text;}});assert.doesNotMatch(output,/FIXTURE_PRIVATE|fixture.invalid|Bearer/);assert.match(output,/任务失败/);
 }
});
test('operations hides source, task, news and history errors even with an unsanitized legacy response',async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {Operations}=await server.ssrLoadModule('/src/integrated/Operations.jsx');const data={runtime:{mode:'research'},watchlist:[],checks:{news:{error:errors[0]},'source:https://fixture.invalid?token=FIXTURE_PRIVATE':{error:errors[1]}},operations:{news:{error:errors[2]}},operationHistory:[{name:'news',summary:{error:errors[3]}}],newsIntake:{recent:[{id:'fixture',error:errors[0]}]}};
 const html=renderToStaticMarkup(React.createElement(Operations,{data}));assert.doesNotMatch(html,/FIXTURE_PRIVATE|fixture.invalid|Bearer|password=/);assert.match(html,/任务失败/);
 }finally{await server.close();}
});

test('unexpected handler failures return a category instead of exception text',async()=>{
 const handler=createHandler({},{snapshot:()=>{throw new Error(errors[1]);}});let output;await handler({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179'}},{writeHead:()=>{},end:text=>{output=text;}});assert.doesNotMatch(output,/FIXTURE_PRIVATE|Bearer/);assert.match(output,/任务失败/);
});

test('HTTP projection followed by real Operations rendering preserves every safe category',async()=>{
 const cases=[['timeout','上游请求超时'],['network','上游连接失败'],['http','上游 HTTP 请求失败'],['format','响应格式异常'],['no-data','未返回有效数据'],['all-sources-failed','主源与备用源均失败']];
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {Operations}=await server.ssrLoadModule('/src/integrated/Operations.jsx');
 for(const [kind,label] of cases){
 const error={kind,message:errors[0],attempts:[{kind:'timeout',message:errors[1]}]};
 const data={runtime:{mode:'research'},watchlist:[],checks:{news:{error},'source:news.google.com':{error}},operations:{news:{error}},operationHistory:[{name:'news',summary:{error}}],newsIntake:{queries:[{id:'discovery',label:'广泛发现',last:{error}}],recent:[{id:'fixture',error}]}};
 let body;await createHandler({},{snapshot:()=>data})({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179'}},{writeHead:()=>{},end:text=>{body=text;}});
 const projected=JSON.parse(body);assert.equal(projected.operations.news.error,label);assert.equal(safeErrorText(safeErrorText(error)),label);
 const html=renderToStaticMarkup(React.createElement(Operations,{data:projected}));assert.equal(html.split(label).length-1,6);assert.doesNotMatch(html,/FIXTURE_PRIVATE|fixture.invalid|Bearer|password=/);
 // A safe label with appended raw details is never accepted verbatim.
 assert.notEqual(safeErrorText(label+' '+errors[0]),label+' '+errors[0]);
 }
 }finally{await server.close();}
});

test('forward archive errors expose exact owned labels but not appended private diagnostics',()=>{
 const label='前向档案指纹不符';assert.equal(safeErrorText(new Error(label)),label);
 assert.equal(safeErrorText(new Error(label+' FIXTURE_PRIVATE')),'任务失败，请检查来源或运行配置');
});
