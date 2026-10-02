import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('batch detail distinguishes attempts, frozen direction, failure, cancellation and explicit extra calls',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {BatchDetail}=await vite.ssrLoadModule('/src/integrated/SemanticBatches.jsx');const batch={state:'paused',createdAt:'2026-10-03T00:00:00Z',inputCount:2,pairCount:1,model:'configured',planHash:'frozen-plan',counts:{failed:1},inputs:[{title:'<script>甲</script>'},{title:'乙'}],items:[{ordinal:0,left:0,right:1,status:'failed',failure:'合成失败',runId:'b',attempts:['a','b']}],audit:[{action:'retry',at:'2026-10-03T00:00:00Z',payload:{ordinal:0}}]};const render=b=>renderToStaticMarkup(React.createElement(BatchDetail,{batch:b})),html=render(batch);
 for(const text of ['已暂停后续调用','左、右顺序','再调用一次','合成失败','历次调用','不会中止已经开始','明确重试','frozen-plan','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.ok(!html.includes('<script>'));assert.ok(!render({...batch,state:'cancelled'}).includes('再调用一次'));
 }finally{await vite.close();}
});
