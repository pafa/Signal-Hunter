import {byId, initialApplications, initialPositions, nowLabel} from './data.js';

export function initialState() {
 return {applications:structuredClone(initialApplications),positions:structuredClone(initialPositions),nextId:4,records:[...initialPositions].sort((a,b)=>b.date.localeCompare(a.date)).map((p,i)=>({id:`HIST-${i}`,stockId:p.stockId,type:'buy',decision:'approved',time:`${p.date} 10:30`,price:p.price,qty:p.qty,note:'初始演示持仓 · 历史确认记录'}))};
}
export function reducer(state,action) {
 if(action.type==='reset') return initialState();
 if(action.type==='submit') {
   const stock=byId[action.stockId];
   if(!['buy','sell'].includes(action.side) || !stock || state.applications.some(a=>a.stockId===stock.id && a.status==='pending')) return state;
   const position=state.positions.find(p=>p.stockId===stock.id);
   if(action.side==='sell' && !position) return state;
   const application={id:`REQ-${String(state.nextId).padStart(3,'0')}`,stockId:stock.id,type:action.side,status:'pending',price:stock.price,qty:action.side==='sell'?position.qty:100,created:nowLabel(),note:''};
   return {...state,nextId:state.nextId+1,applications:[application,...state.applications]};
 }
 if(action.type==='decide') {
   const app=state.applications.find(a=>a.id===action.id);
   if(!['approved','rejected'].includes(action.decision) || !app || app.status!=='pending') return state;
   const price=Number(action.price),qty=Number(action.qty);
   if(action.decision==='approved' && (!Number.isFinite(price)||price<=0||!Number.isSafeInteger(qty)||qty<=0||!Number.isFinite(price*qty))) return state;
   const existing=state.positions.find(p=>p.stockId===app.stockId);
   if(action.decision==='approved' && (app.type==='sell' && (!existing || qty>existing.qty))) return state;
   const afterQty=(existing?.qty||0)+(app.type==='buy'?qty:-qty);
   const newCost=app.type==='buy'&&existing?(existing.price*existing.qty+price*qty)/afterQty:price;
   if(action.decision==='approved' && (!Number.isSafeInteger(afterQty)||!Number.isFinite(newCost))) return state;
   const record={id:`DEC-${app.id}`,requestId:app.id,stockId:app.stockId,type:app.type,decision:action.decision,time:nowLabel(),price,qty,beforeQty:existing?.qty||0,afterQty:action.decision==='approved'?afterQty:existing?.qty||0,note:action.note?.trim()||''};
   let positions=state.positions;
   if(action.decision==='approved') {
     if(app.type==='buy') positions=existing?positions.map(p=>p.stockId===app.stockId?{...p,qty:afterQty,price:newCost}:p):[{stockId:app.stockId,qty,price,date:'本次演示',days:0},...positions];
     else {
       record.realized=(price-existing.price)*qty;
       positions=positions.flatMap(p=>p.stockId!==app.stockId?[p]:p.qty>qty?[{...p,qty:p.qty-qty}]:[]);
     }
   }
   return {...state,positions,applications:state.applications.map(a=>a.id===app.id?{...a,status:action.decision,price,qty,note:record.note,decided:record.time}:a),records:[record,...state.records]};
 }
 return state;
}
export function stockStatus(stockId,state) {
 if(state.positions.some(p=>p.stockId===stockId)) return '持仓中';
 if(state.applications.some(a=>a.stockId===stockId&&a.status==='pending')) return '待审批';
 return '观察中';
}
