import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFees} from '../server/market-fees.mjs';
const at='2026-10-06T14:00:00Z';
const component=(extra={})=>({id:'commission',source:'synthetic-fee-contract',side:'both',basis:'notional-bps',rate:'10',aggregation:'per-order',rounding:'nearest',quantum:'0.01',minimum:'1',maximum:'3',...extra});
function quote(components=[component()],extra={}){return {currency:'USD',executionFeed:true,fx:{usdPerUnit:'1'},fees:{schema:'execution-fees/1',id:'fixture-only',version:'1',source:'synthetic-fee-contract',currency:'USD',verified:true,complete:true,validFrom:'2026-01-01T00:00:00Z',validUntil:'2026-12-31T23:59:59Z',components},...extra};}
const charge=(q,qty,extra={})=>executionFees(q,{qty,price:'100',side:'buy',at,feeBps:999,...extra});
test('partial executions accrue a per-order minimum and cap once; original accrual remains immutable',()=>{
 const q=quote(),first=charge(q,2);assert.equal(first.totalCents,100);const frozen=JSON.stringify(first);
 const second=charge(q,3,{accrual:first.accrual});assert.equal(second.totalCents,0);
 const third=charge(q,10,{accrual:second.accrual});assert.equal(third.totalCents,50);
 const last=charge(q,100,{accrual:third.accrual});assert.equal(last.totalCents,150);
 assert.equal(first.totalCents+second.totalCents+third.totalCents+last.totalCents,300);assert.equal(JSON.stringify(first),frozen);
 assert.equal(last.accrual.qty,115);assert.equal(last.components[0].nativeAmount,'1.500000');
});
test('fees respect side, native rounding, FX and separate per-fill versus per-order scopes',()=>{
 const q=quote([component({minimum:'0',maximum:'100',rate:'0'}),component({id:'sell-tax',side:'sell',rate:'10',minimum:'0',maximum:'100',rounding:'ceil',quantum:'1',aggregation:'per-fill'}),component({id:'flat',basis:'fixed',rate:'0.01',minimum:'0',maximum:'100',aggregation:'per-fill'})],{currency:'HKD',fx:{usdPerUnit:'0.128205'}});q.fees.currency='HKD';
 const buy=charge(q,1);assert.equal(buy.totalCents,0);assert.equal(buy.components.length,2);
 const sell=charge(q,1,{side:'sell'});assert.equal(sell.totalCents,13);assert.equal(sell.components[1].nativeAmount,'1.000000');
 const q2=quote([component({basis:'per-share',rate:'0.01',minimum:'0',maximum:'1'})]);
 assert.equal(charge(q2,60).totalCents,60);assert.equal(charge(q2,60,{accrual:charge(q2,60).accrual}).totalCents,40);
});
test('ceil preserves sub-micro-unit charges and a non-aligned cap is never exceeded',()=>{
 const tiny=quote([component({rate:'0.000001',minimum:'0',maximum:'10',rounding:'ceil'})]);
 assert.equal(charge(tiny,1,{price:'0.000001'}).totalCents,1);
 const capped=quote([component({rate:'1000',minimum:'0',maximum:'0.015',rounding:'ceil'})]);
 assert.equal(charge(capped,1).components[0].nativeAmount,'0.015000');
 const minimum=quote([component({rate:'0',minimum:'0.014',maximum:'10'})]);assert.equal(charge(minimum,1).components[0].nativeAmount,'0.014000');
});
test('incomplete, expired or changed fee contracts fail instead of silently falling back to configured bps',()=>{
 const q=quote(),first=charge(q,2);assert.throws(()=>charge({...q,fees:null},1));
 for(const change of [p=>p.complete=false,p=>p.currency='CNY',p=>p.validUntil=at,p=>p.components[0].id='__proto__',p=>p.components.push({...p.components[0]}),p=>p.components[0].rate='-1']){
  const bad=structuredClone(q);change(bad.fees);assert.throws(()=>charge(bad,1,{at:'2026-10-06T14:00:01Z'}));
 }
 const changed=structuredClone(q);changed.fees.version='2';assert.throws(()=>charge(changed,1,{accrual:first.accrual}));
 assert.equal(charge({currency:'USD',fx:{usdPerUnit:'1'}},1,{feeBps:10}).totalCents,10);
});
