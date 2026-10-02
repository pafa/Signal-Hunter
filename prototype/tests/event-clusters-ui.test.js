import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('cluster review displays conflicts, source scopes, stable identity, historical quotes and escaped input',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {ClusterCandidate,ClusterRecord}=await vite.ssrLoadModule('/src/integrated/EventClusters.jsx');
 const members=[{id:'a',title:'<script>甲</script>',revision:1,contentScope:'excerpt'},{id:'b',title:'乙',revision:2,contentScope:'headline-only'}],comparison={relation:'related',left:{quote:'甲原文'},right:{quote:'乙原文'},reason:'对象不同',missingEvidence:['仍需原始来源']},basis={runId:'run',model:'configured',decisionVersion:0,comparison};
 const group={id:'group',hash:'hash',indices:[0,1],members,pairs:[{ordinal:0,left:0,right:1,status:'different',relation:'related',basis}],state:'conflict',overlaps:[],missing:[],canSave:false};const conflict=renderToStaticMarkup(React.createElement(ClusterCandidate,{group,batchId:'batch'}));
 for(const text of ['存在冲突','不可确认','关系链不足以证明','&lt;script&gt;','仅标题','摘录','尚非同一事件'])assert.ok(conflict.includes(text),text);assert.ok(!conflict.includes('<script>'));assert.ok(!conflict.includes('确认建立事件簇'));
 const record={id:'stable-id',version:2,status:'active',health:{current:false,reason:'输入修订，需复核'},title:'事件簇',note:'保留旧判断',confirmedAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',members,pairs:[{left:members[0],right:members[1],basis}],history:[{version:1,status:'active',title:'旧名称',note:'旧说明',updatedAt:'2026-10-02T00:00:00Z',members,pairs:[],snapshotHash:'frozen-hash'}]};const html=renderToStaticMarkup(React.createElement(ClusterRecord,{record}));for(const text of ['stable-id','依据需复核','甲原文','乙原文','旧说明','frozen-hash','事件簇历史'])assert.ok(html.includes(text),text);
 }finally{await vite.close();}
});
