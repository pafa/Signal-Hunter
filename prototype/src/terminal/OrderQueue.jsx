import React,{useState} from 'react';
import {byId,money} from '../data';
import {actionLabel,researchFor} from './fixtures';
import {Pane,Urgency,TButton} from './Primitives';

function OrderEditor({app,held,onDecide}){
 const stock=byId[app.stockId];const [qty,setQty]=useState(String(app.qty)),[price,setPrice]=useState(String(app.price)),[note,setNote]=useState(app.note||'');
 const q=Number(qty),p=Number(price),before=held?.qty||0,after=before+(app.type==='buy'?q:-q);
 const valid=Number.isSafeInteger(q)&&q>0&&Number.isFinite(p)&&p>0&&Number.isFinite(p*q)&&Number.isSafeInteger(after)&&after>=0;
 const action=actionLabel(app,held,q);
 return <form className="order-editor" onSubmit={e=>{e.preventDefault();if(valid)onDecide(app,'approved',p,q,note);}}>
  <div className="editor-title"><strong>{stock.name} · {action}申请</strong><span>{app.id}</span></div>
  <div className="position-delta"><span><small>当前持仓</small><b className="num">{before.toLocaleString()}<em>股</em></b></span><span className={app.type==='sell'?'loss':'profit'} aria-hidden="true">→</span><span><small>确认后</small><b className={`num ${app.type==='sell'?'loss':'profit'}`}>{valid?after.toLocaleString():'—'}<em>股</em></b></span></div>
  <div className="order-inputs"><label>参考价格 · {stock.currency}<input aria-label="申请参考价格" type="number" min="0.01" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} required/></label><label>{app.type==='sell'?'卖出':'买入'}数量 · 股<input aria-label="申请数量" type="number" min="1" step="1" max={app.type==='sell'?before:undefined} value={qty} onChange={e=>setQty(e.target.value)} required/></label></div>
  <div className="order-amount"><span>参考金额</span><b className="num">{valid?money(p*q,stock.currency):'参数无效'}</b></div>
  <label className="decision-note"><span className="sr-only">决策备注</span><input aria-label="决策备注" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="记录同意或拒绝的理由"/></label>
  {!valid&&<p className="order-error" role="alert">价格和数量须为正数，减仓数量不能超过持仓。</p>}
  <div className="order-buttons"><TButton type="button" onClick={()=>onDecide(app,'rejected',app.price,app.qty,note)}>拒绝</TButton><TButton type="submit" tone={app.type==='sell'?'danger':'accent'} disabled={!valid}>确认模拟{action}</TButton></div>
  <p className="order-disclaimer">仅本地模拟 · 确认前不改变持仓</p>
 </form>;
}
export default function OrderQueue({state,selected,onSelect,onDecide,onRecords}){
 const pending=state.applications.filter(a=>a.status==='pending');const rank={urgent:0,watch:1,normal:2};pending.sort((a,b)=>rank[researchFor(a.stockId).urgency]-rank[researchFor(b.stockId).urgency]);
 const app=pending.find(a=>a.stockId===selected);
 return <Pane title="增减仓队列" meta={`${pending.length} 待确认`} className="queue-pane" tools={<button className="text-control" onClick={onRecords}>决策记录</button>}><div className="queue-priority"><span className="urgency urgent">紧急 {pending.filter(a=>researchFor(a.stockId).urgency==='urgent').length}</span><span>先复核持仓风险，再看新增机会</span></div><div className="queue-list pane-scroll">{pending.length?pending.map(a=>{const s=byId[a.stockId],held=state.positions.find(p=>p.stockId===a.stockId),before=held?.qty||0;return <button key={a.id} className={`queue-row ${selected===a.stockId?'selected':''}`} aria-label={`处理 ${s.name}申请`} onClick={()=>onSelect(a.stockId)}><Urgency level={researchFor(a.stockId).urgency}/><span><b>{s.name} <em className={a.type==='sell'?'loss':'profit'}>{actionLabel(a,held)}</em></b><small>{s.symbol}</small></span><span className="queue-delta num">{before} → {before+(a.type==='buy'?a.qty:-a.qty)}<small>股</small></span></button>;}):<div className="terminal-empty">全部申请已处理</div>}</div>{app?<OrderEditor key={app.id} app={app} held={state.positions.find(p=>p.stockId===app.stockId)} onDecide={onDecide}/>:<div className="queue-idle"><span className="idle-symbol">✓</span><strong>{byId[selected].name}暂无待确认申请</strong><p>可在研判区提交申请，或选择队列中的其他股票。</p></div>}</Pane>;
}
