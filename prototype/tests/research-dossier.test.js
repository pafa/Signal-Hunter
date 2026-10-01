import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('dossier renders RSS research without attachment and preserves attachment provenance',async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{
  const {default:ResearchDossier}=await server.ssrLoadModule('/src/major/ResearchDossier.jsx');
  const topic={version:1,firstSeen:'2026-10-01T12:00:00Z',evidence:[{id:'source',url:'https://example.org/statement',sourceName:'Company statement'}],dossier:{preparedBy:'Research assistant',preparedAt:'2026-10-01T12:00:00Z',basedOnResearchVersion:1,sections:[{id:'analysis',title:'Conditional analysis',paragraphs:['Observe only'],sourceIds:['source','missing']}]},analysisProvenance:{sourceWindow:{from:'2026-09-24T12:00:00Z',to:'2026-10-01T12:00:00Z'}}};
  const render=t=>renderToStaticMarkup(React.createElement(ResearchDossier,{topic:t}));
  const rss=render(topic);assert.match(rss,/新闻窗口/);assert.match(rss,/Observe only/);assert.match(rss,/https:\/\/example.org\/statement/);assert.match(rss,/来源记录缺失/);assert.doesNotMatch(rss,/原附件/);
  const attached=render({...topic,attachment:{fileName:'sample.txt',sha256:'a'.repeat(64),windowStart:'2026-09-24T12:00:00Z',windowEnd:'2026-09-25T12:00:00Z'}});assert.match(attached,/附件窗口/);assert.match(attached,/sample.txt/);assert.match(attached,new RegExp('a'.repeat(64)));
  const legacy=render({...topic,analysisProvenance:undefined,dossier:{...topic.dossier,sections:[{id:'old',title:'Old analysis',paragraphs:['Legacy content']}]}});assert.match(legacy,/材料窗口未记录/);assert.match(legacy,/Legacy content/);
 }finally{await server.close();}
});
