import React,{useEffect,useRef,useState} from 'react';
import {byId,eventFor,money,pct,gain,holdText} from './data';
import {stockStatus} from './state';
import {Icon,Button,Market,Badge,TrendChart,Segmented} from './components';

function Drawer({title,subtitle,children,onClose}) {
 const ref=useRef(null);
 useEffect(()=>{const dialog=ref.current;const previous=document.activeElement;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;previous?.focus?.();};},[]);
 return <dialog ref={ref} className="detail-drawer" aria-labelledby="drawer-title" onCancel={e=>{e.preventDefault();onClose();}}><div className="drawer-header"><div><p>{subtitle}</p><h2 id="drawer-title">{title}</h2></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}><Icon name="close" size={20}/></button></div>{children}</dialog>;
}

export function ApplicationDrawer({application:app,state,onClose,onDecide}){
 const stock=byId[app.stockId],event=eventFor(stock.id);const isSell=app.type==='sell';const processed=app.status!=='pending';
 const [price,setPrice]=useState(String(app.price)),[qty,setQty]=useState(String(app.qty)),[note,setNote]=useState(app.note||'');
 const held=state.positions.find(p=>p.stockId===stock.id);
 const valid=Number.isFinite(Number(price))&&Number(price)>0&&Number.isSafeInteger(Number(qty))&&Number(qty)>0&&Number.isFinite(Number(price)*Number(qty))&&(!isSell||Number(qty)<=(held?.qty||0));
 return <Drawer title={isSell?'模拟卖出申请':'模拟买入申请'} subtitle={`${app.id} · ${app.created}`} onClose={onClose}>
  <form className="drawer-form" onSubmit={e=>{e.preventDefault();if(valid&&!processed)onDecide(app.id,'approved',Number(price),Number(qty),note);}}>
   <div className="drawer-content"><div className="drawer-stock"><Market market={stock.market}/><div><h3>{stock.name}<span>{stock.symbol}</span></h3><p>{stock.sector}</p></div><Badge>{app.status==='pending'?'待审批':app.status==='approved'?'已同意':'已拒绝'}</Badge></div>
    <div className="mini-event"><Icon name="file"/><div><small>关联示例事件</small><h3>{stock.event}</h3><p>{event?.thesis||'根据持仓计划，重新评估经营线索与当前走势。'}</p></div></div>
    <section className="drawer-section"><h3>{isSell?'本次退出计划':'这笔申请的计划'}</h3><dl className="key-value"><div><dt>{isSell?'本次动作':'关注买入区间'}</dt><dd>{isSell?'卖出指定数量的模拟持仓':`${money(stock.range[0],stock.currency)}–${stock.range[1]}`}</dd></div><div><dt>预期持有</dt><dd>{holdText(stock)}</dd></div><div><dt>目标观察区间</dt><dd>{money(stock.target[0],stock.currency)}–{stock.target[1]}</dd></div></dl><p className="field-hint">所有价位均为演示假设，目标区间不代表收益承诺。</p></section>
    <section className="drawer-section"><h3>{isSell?'模拟卖出参数':'模拟买入参数'}</h3><div className="form-grid"><label>参考价格 <span>{stock.currency}</span><input type="number" min="0.01" step="0.01" required disabled={processed} aria-label="参考价格" value={price} onChange={e=>setPrice(e.target.value)}/></label><label>演示数量 <span>股</span><input type="number" min="1" step="1" max={isSell?held?.qty:undefined} required disabled={processed} aria-label="演示数量" value={qty} onChange={e=>setQty(e.target.value)}/></label></div><div className="estimated"><span>参考金额</span><strong>{valid||processed?money(Number(price)*Number(qty),stock.currency):'—'}</strong></div><p className="field-hint">数量仅用于体验流程；尚未设置资金、费用及市场成交规则。</p></section>
    <section className="drawer-section"><h3>退出与失效条件</h3><div className="risk-note"><Icon name="shield" size={17}/><p>{stock.risk}</p></div></section>
    <label className="note-field">我的判断 <span>选填</span><textarea aria-label="我的判断" value={note} disabled={processed} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="记录同意或拒绝的理由，方便未来复盘…" rows={3}/></label>
   </div>
   <footer className="drawer-actions">{processed?<><p><Icon name={app.status==='approved'?'check':'info'}/>{app.status==='approved'?'已按你的决定更新模拟持仓':'申请已拒绝，未执行模拟交易'}</p><Button onClick={onClose} type="button" className="full-width">完成</Button></>:<><p><Icon name="user"/>只有你确认后，才会执行本次模拟{isSell?'卖出':'买入'}。</p><div><Button type="button" onClick={()=>onDecide(app.id,'rejected',app.price,app.qty,note)}>暂不{isSell?'卖出':'买入'}</Button><Button variant="primary" type="submit" icon="check" disabled={!valid}>同意 · 模拟{isSell?'卖出':'买入'}</Button></div></>}</footer>
  </form>
 </Drawer>;
}

export function StockDrawer({stockId,state,onClose,onSubmit,onApplication}){
 const stock=byId[stockId],position=state.positions.find(p=>p.stockId===stockId),pending=state.applications.find(a=>a.stockId===stockId&&a.status==='pending');
 const [period,setPeriod]=useState('1月');const event=eventFor(stockId);
 const curve=period==='1周'?stock.trend.slice(-5):period==='3月'?[...stock.trend.map(v=>v-2),...stock.trend]:stock.trend;
 return <Drawer title={stock.name} subtitle={`${stock.symbol} · ${stock.market} · 演示数据`} onClose={onClose}><div className="drawer-content stock-detail"><div className="stock-detail-price"><div><small>当前示例价</small><strong>{money(stock.price,stock.currency)}</strong></div><Badge>{stockStatus(stockId,state)}</Badge></div>{position&&<div className="position-details"><div><small>持仓模拟收益</small><strong className={gain(position)>=0?'positive':'negative'}>{pct(gain(position))}</strong></div><div><small>模拟买入成本</small><strong>{money(position.price,stock.currency)}</strong></div><div><small>持有数量</small><strong>{position.qty.toLocaleString()} 股</strong></div></div>}<div className="detail-chart-top"><h3>阶段趋势</h3><Segmented items={['1周','1月','3月']} value={period} onChange={setPeriod} label="股票趋势区间"/></div><TrendChart data={curve} period={period} height={200} annotation={!!position}/><p className="chart-footnote">示例价格变化曲线 · 非实时行情</p><section className="drawer-section"><h3>当前研究假设</h3><p>{event?.thesis||stock.event}</p><div className="holding-summary"><Icon name="clock"/><div><b>计划持有 {holdText(stock)}</b><span>{position?`已持有 ${position.days} 个交易日`:'尚未建立模拟持仓'}</span></div></div></section><section className="drawer-section"><h3>需要继续观察</h3><p>{event?.review||'在预期持有窗口内复核经营变化与初始交易假设。'}</p><div className="risk-note"><Icon name="shield" size={17}/><p>{stock.risk}</p></div></section><section className="drawer-section"><h3>跟踪时间线</h3><div className="compact-timeline"><div><i/><span>建立关注</span><p>{stock.event}</p></div><div><i/><span>形成分析</span><p>买入条件、持有周期和退出条件已记录</p></div><div><i className={position?'filled':''}/><span>{position?'人工确认 · 已模拟买入':pending?'申请已提交 · 等待你确认':'观察中 · 尚未提交申请'}</span>{position&&<p>{position.date} · {position.qty} 股 · {money(position.price,stock.currency)}</p>}</div></div></section></div><footer className="drawer-actions"><p><Icon name="info"/>本地原型中的价格与跟踪记录均为样例。</p>{pending?<Button className="full-width" variant="primary" onClick={()=>onApplication(pending.id)}>查看待审批申请</Button>:<Button className="full-width" variant={position?'secondary':'primary'} onClick={()=>onSubmit(stockId,position?'sell':'buy')}>{position?'提交模拟卖出申请':'提交模拟买入申请'}</Button>}</footer></Drawer>;
}
