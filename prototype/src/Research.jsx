import React,{useState} from 'react';
import {events,byId,holdText,money} from './data';
import {stockStatus} from './state';
import {Icon,Button,Market,Badge,Segmented,Panel,Empty} from './components';

export function AnalysisContent({stock,event}){return <>
 <section className="analysis-section"><div className="section-label"><Icon name="bolt"/><h3>核心判断</h3></div><p className="thesis">{event?.thesis||`${stock.event}可能影响经营预期，需要持续验证。`}</p><ol className="reason-chain">{(event?.chain||['记录初始经营线索。','将判断转化为有条件的模拟买入计划。','持续复核驱动因素是否兑现。']).map((text,i)=><li key={text}><span>0{i+1}</span><p>{text}</p></li>)}</ol></section>
 <section className="analysis-section"><div className="section-label"><Icon name="trend"/><h3>交易假设</h3><span className="muted small">演示参数</span></div><div className="hypothesis-grid"><div><small>关注买入区间</small><strong className="number">{money(stock.range[0],stock.currency)}–{stock.range[1]}</strong></div><div><small>预计持有</small><strong>{holdText(stock)}</strong></div><div><small>目标观察区间</small><strong className="number">{money(stock.target[0],stock.currency)}–{stock.target[1]}</strong></div><div><small>下一次复盘</small><strong>5 个交易日后</strong></div></div></section>
 <section className="analysis-section"><div className="section-label"><Icon name="shield"/><h3>什么情况需要改变判断</h3></div><p>{event?.counter||stock.risk}</p><div className="risk-note"><Icon name="info" size={16}/><span>{stock.risk}</span></div></section>
 </>;}

export function Research({state,onSubmit,onApplication,onStock}){
 const [selected,setSelected]=useState(events[0].id),[market,setMarket]=useState('全部');
 const items=events.filter(e=>market==='全部'||byId[e.stockId].market===market);
 const event=items.find(e=>e.id===selected)||items[0];const stock=event&&byId[event.stockId];
 const app=stock&&state.applications.find(a=>a.stockId===stock.id&&a.status==='pending');const held=stock&&state.positions.some(p=>p.stockId===stock.id);
 return <><div className="page-title"><div><h1>事件分析</h1><p>看清事件、影响路径与交易假设，再决定是否提交申请。</p></div><span className="quiet-label"><Icon name="file"/>6 条示例事件</span></div>
  <div className="research-layout"><section className="event-list panel"><div className="event-list-head"><h2>研究中的事件</h2><Segmented items={['全部','A股','港股','美股']} value={market} onChange={setMarket} label="事件市场"/></div>{items.map(e=>{const s=byId[e.stockId];return <button key={e.id} className={`event-item ${event?.id===e.id?'active':''}`} onClick={()=>setSelected(e.id)}><div className="event-meta"><span>{e.category}</span><time>{e.time}</time></div><h3>{e.title}</h3><div className="event-bottom"><span><Market market={s.market}/>{s.name}</span><Badge>{stockStatus(s.id,state)}</Badge></div></button>;})}</section>
  <Panel className="analysis-panel">{event?<><div className="analysis-header"><div className="event-meta"><span>示例事件 · 预设分析</span><time>{event.time}</time></div><h2>{event.title}</h2><button className="stock-chip" onClick={()=>onStock(stock.id)}><Market market={stock.market}/><b>{stock.name}</b><span>{stock.symbol}</span><Icon name="arrow" size={14}/></button></div><div className="source-excerpt"><span>情景资料摘要</span><p>{event.summary}</p><small>新闻进入方式与重大性标准由你后续指定。</small></div><AnalysisContent stock={stock} event={event}/><div className="analysis-footer"><div><Icon name="user"/><span>提交后，等待你确认是否模拟买入。</span></div>{app?<Button variant="primary" onClick={()=>onApplication(app.id)}>查看待审批申请</Button>:held?<Button onClick={()=>onStock(stock.id)}>查看模拟持仓</Button>:<Button variant="primary" icon="arrow" onClick={()=>onSubmit(stock.id,'buy')}>提交模拟买入申请</Button>}</div></>:<Empty/>}</Panel></div>
 </>;
}
