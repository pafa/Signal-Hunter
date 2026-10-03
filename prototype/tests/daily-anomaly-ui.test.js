import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {evaluateObservation,validateObservationDefinition} from '../server/observation-rules.mjs';
import {anomalyQuote,anomalyAt} from './fixtures/daily-anomaly.mjs';
test('statistical form and results distinguish sample deviations from price thresholds, probabilities and fills',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null},appType:'custom'});
 try{const {StatisticalControls}=await vite.ssrLoadModule('/src/integrated/StatisticalObservation.jsx'),{ObservationResults}=await vite.ssrLoadModule('/src/integrated/ObservationRules.jsx');
 const c={type:'daily-anomaly',symbol:'AAPL.US',metric:'return',windowSize:5,zThreshold:3,direction:'both'},topic={companies:[{symbol:'AAPL.US'}],status:'active'};
 const form=renderToStaticMarkup(React.createElement(StatisticalControls,{condition:c,companies:topic.companies,onChange:()=>{}}));assert.match(form,/历史基线样本数/);assert.match(form,/最新样本不参与基线/);assert.match(form,/倍数不是概率/);
 const rule={definition:validateObservationDefinition({label:'Synthetic',join:'all',conditions:[c]},topic)};
 const result=evaluateObservation(rule,topic,{at:anomalyAt,quote:()=>anomalyQuote(),check:()=>({state:'ok'})});
 const html=renderToStaticMarkup(React.createElement(ObservationResults,{results:result.results}));assert.match(html,/6\.3246 倍标准差/);assert.match(html,/查看统计窗口与原始样本/);assert.match(html,/10\.0000%/);assert.match(html,/不是|不证明/);assert.doesNotMatch(html,/无有效价格/);
 result.results[0].input.statistical.actions=[{date:'2026-10-02',kind:'<script>test</script>'}];assert.match(renderToStaticMarkup(React.createElement(ObservationResults,{results:result.results})),/&lt;script&gt;/);
 }finally{await vite.close();}
});
