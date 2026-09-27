import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reducer} from '../src/state.js';

const submit=(state,stockId,side)=>reducer(state,{type:'submit',stockId,side});
const decide=(state,id,price,qty,decision='approved')=>reducer(state,{type:'decide',id,price,qty,decision,note:'test'});
test('申请本身不改变持仓，并防止同一标的重复申请',()=>{
 const original=initialState(),next=submit(original,'msft','buy');
 assert.equal(next.positions,original.positions);
 assert.equal(next.applications.length,original.applications.length+1);
 assert.equal(submit(next,'msft','sell'),next);
});
test('增仓合并股数，按成交金额加权成本，保留持仓起点',()=>{
 const state=submit(initialState(),'msft','buy'),app=state.applications[0],next=decide(state,app.id,450,10),position=next.positions.find(p=>p.stockId==='msft');
 assert.equal(position.qty,30);assert.equal(position.price,430);assert.equal(position.date,'09-10');assert.equal(position.days,11);
 assert.equal(next.records[0].beforeQty,20);assert.equal(next.records[0].afterQty,30);
});
test('减仓保留单位成本并记录已实现亏损，清仓移除持仓',()=>{
 const state=submit(initialState(),'xiaomi','sell');
 const next=decide(state,state.applications[0].id,33.84,200),p=next.positions.find(p=>p.stockId==='xiaomi');
 assert.equal(p.qty,300);assert.equal(p.price,34.9);assert.ok(Math.abs(next.records[0].realized+212)<1e-9);
 const close=submit(next,'xiaomi','sell'),closed=decide(close,close.applications[0].id,33,300);
 assert.equal(closed.positions.some(p=>p.stockId==='xiaomi'),false);
});
test('拒绝申请不改变持仓，同时保留拒绝记录',()=>{
 const state=submit(initialState(),'msft','buy'),next=decide(state,state.applications[0].id,450,10,'rejected');
 assert.equal(next.positions,state.positions);assert.equal(next.records[0].decision,'rejected');assert.equal(next.records[0].afterQty,20);
});
test('已完成申请不能再次执行',()=>{
 const state=initialState(),next=decide(state,'REQ-001',130,20);
 assert.equal(decide(next,'REQ-001',130,20),next);
});
test('空仓不能卖出；未知方向与决策不能改变状态',()=>{
 const state=initialState();assert.equal(submit(state,'baba','sell'),state);assert.equal(submit(state,'baba','short'),state);assert.equal(decide(state,'REQ-001',130,20,'other'),state);
});
for(const [price,qty] of [[0,20],[-1,20],[NaN,20],[Infinity,20],[130,0],[130,-1],[130,1.5],[130,Number.MAX_SAFE_INTEGER+1],[Number.MAX_VALUE,20]])test(`拒绝无效参数 price=${price} qty=${qty}`,()=>{const state=initialState();assert.equal(decide(state,'REQ-001',price,qty),state);});
test('禁止减仓超过实际持仓',()=>{
 const state=submit(initialState(),'xiaomi','sell');assert.equal(decide(state,state.applications[0].id,34,501),state);
});
test('新建持仓数量、成本与确认参数一致',()=>{
 const next=decide(initialState(),'REQ-001',128,30);assert.equal(next.positions[0].stockId,'nvda');assert.equal(next.positions[0].qty,30);assert.equal(next.positions[0].price,128);
});
test('无效股票与无效申请 ID 不产生变动',()=>{
 const state=initialState();assert.equal(submit(state,'invalid','buy'),state);assert.equal(decide(state,'invalid',10,10),state);
});
