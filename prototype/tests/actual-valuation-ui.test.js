import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
test('actual holding details separate current estimates from safely rendered original records, including unavailable current prices',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
  const {default:View}=await vite.ssrLoadModule('/src/integrated/ActualValuationDetails.jsx');
  const p={recordVersion:2,currency:'HKD',recordedAsOf:'2026-10-06T13:59:00Z',recordValuation:{price:'80',valueCents:8000,unrealizedCents:-1000,priceSource:'Synthetic <script>unsafe</script>',feeBasis:'included'},referenceValuation:{state:'unavailable',issues:['行情过期'],quantityAsOf:'2026-10-06T13:59:00Z',basis:'Fixture reference basis',provenance:null}};
  let html=renderToStaticMarkup(React.createElement(View,{position:p}));assert.match(html,/当前无法估值/);assert.match(html,/原记录价格与盈亏 · v2/);assert.match(html,/原记录价 80 HKD/);assert.match(html,/行情过期/);assert.doesNotMatch(html,/<script>|展开行情来源与时点|details open/);
  p.referenceValuation={...p.referenceValuation,state:'available',provenance:{source:'Synthetic qualified frame',frameHash:'fixture-frame',quoteHash:'fixture-quote',priceBasis:'mark',issuerId:'fixture-issuer'},issues:[]};html=renderToStaticMarkup(React.createElement(View,{position:p}));assert.match(html,/行情可用于参考估算/);assert.match(html,/fixture-frame/);assert.match(html,/未提供发行人核对记录/);assert.match(html,/原记录价 80 HKD/);
 }finally{await vite.close();}
});
