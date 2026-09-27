import React, {useState} from 'react';
import {stocks,byId,portfolioCurves,holdText,pct,gain} from './data';
import {stockStatus} from './state';
import {Icon,Button,Market,Badge,Segmented,Panel,Empty,Sparkline,TrendChart} from './components';

export function SummaryStrip({items}) {return <div className="summary-strip">{items.map(item=><div className="summary-item" key={item.label}><span>{item.label}</span><strong className={item.accent?'accent':''}>{String(item.value).padStart(2,'0')}</strong><small>{item.note}</small></div>)}</div>;}

export function StockTable({items,state,onStock,portfolio=false}) {
 return <div className="table-scroll"><table className={portfolio?'stock-table portfolio-table':'stock-table'}><thead><tr><th>股票</th><th>{portfolio?'模拟买入':'关联事件'}</th><th>{portfolio?'当前示例价':'当前状态'}</th><th>模拟收益</th><th>{portfolio?'持有进度':'预期持有'}</th><th>近 30 日</th><th><span className="sr-only">详情</span></th></tr></thead><tbody>{items.map(s=>{
  const p=state.positions.find(p=>p.stockId===s.id); const returns=p?gain(p):null;
  return <tr key={s.id}><td><button className="stock-name" onClick={()=>onStock(s.id)}><Market market={s.market}/><span><b>{s.symbol}</b><small>{s.name}</small></span></button></td>
   <td>{portfolio?<><span className="number">{p.qty.toLocaleString()} 股 · {p.date}</span><small className="cell-sub">成本 {({CNY:'¥',HKD:'HK$',USD:'US$'})[s.currency]} {p.price.toFixed(2)}</small></>:<span>{s.event}</span>}</td>
   <td>{portfolio?<span className="number">{s.price.toFixed(2)} <small>{s.currency}</small></span>:<Badge>{stockStatus(s.id,state)}</Badge>}</td>
   <td><strong className={`number ${returns===null?'muted':returns>=0?'positive':'negative'}`}>{returns===null?'—':pct(returns)}</strong>{portfolio&&<small className="cell-sub">未计费用</small>}</td>
   <td>{portfolio?<div className="holding-progress"><span>{p.days} / {s.hold[1]} 个交易日</span><div><i style={{width:`${Math.min(100,p.days/s.hold[1]*100)}%`}}/></div></div>:<span className="number">{s.hold[0]}–{s.hold[1]} 日</span>}</td>
   <td><Sparkline data={s.trend}/></td><td><button className="icon-button subtle" aria-label={`查看${s.name}详情`} onClick={()=>onStock(s.id)}><Icon name="arrow" size={16}/></button></td></tr>;
 })}</tbody></table>{items.length===0&&<Empty/>}</div>;
}

export function Dashboard({state,navigate,onApplication,onStock}){
 const [period,setPeriod]=useState('1月'),[market,setMarket]=useState('全部');
 const pending=state.applications.filter(a=>a.status==='pending');const data=portfolioCurves[period];
 return <>
  <div className="page-title"><div><h1>我的研究概览</h1><p>从重要事件出发，让每一笔模拟交易都有依据。</p></div><Button icon="list" onClick={()=>navigate('watchlist')}>查看关注列表</Button></div>
  <SummaryStrip items={[{label:'重点关注',value:stocks.length,note:'仅跟踪已选标的'},{label:'等待你决策',value:pending.length,note:'分析完成，尚未执行',accent:true},{label:'模拟持仓',value:state.positions.length,note:'持续跟踪投资假设'}]}/>
  <div className="dashboard-grid">
   <Panel title="模拟组合走势" subtitle={`独立示例组合 · ${{'1周':'近 7 日','1月':'近 30 日','3月':'近 90 日','全部':'全部区间'}[period]}`} className="portfolio-chart-panel">
    <div className="chart-toolbar"><div><strong className="big-return positive">{pct(data.at(-1)-data[0])}</strong><span className="return-caption">区间示例收益</span></div><Segmented items={['1周','1月','3月','全部']} value={period} onChange={setPeriod} label="组合趋势区间"/></div>
    <TrendChart data={data} period={period} height={210} benchmark annotation/>
    <div className="chart-legend"><span><i/>模拟组合</span><span><i className="dashed"/>参考基线</span></div>
    <p className="chart-footnote">此曲线为独立样例，与下方持仓分别展示。</p>
   </Panel>
   <Panel title={<span>待你决策 <em>{String(pending.length).padStart(2,'0')}</em></span>} action={<button className="text-button" onClick={()=>navigate('applications')}>全部<Icon name="arrow" size={14}/></button>} className="pending-panel">
    {pending.length?pending.slice(0,3).map(a=>{const s=byId[a.stockId];return <button className="pending-item" key={a.id} onClick={()=>onApplication(a.id)}><Market market={s.market}/><div className="pending-copy"><div><b>{s.symbol}</b><span>{s.name}</span></div><p>{a.type==='sell'?'模拟卖出申请':s.event}</p><small>预计持有 {holdText(s)}</small></div><span className="pending-arrow"><Icon name="arrow" size={17}/></span></button>;}):<Empty title="暂时没有待决策申请" text="新的申请会在这里等你确认。" action={<Button onClick={()=>navigate('research')}>查看事件分析</Button>}/>}
   </Panel>
  </div>
  <Panel title="重点跟踪" action={<Segmented items={['全部','A股','港股','美股']} value={market} onChange={setMarket} label="重点跟踪市场"/>} className="tracking-panel"><StockTable items={(market==='全部'?stocks.slice(0,4):stocks.filter(s=>s.market===market))} state={state} onStock={onStock}/><div className="table-footer"><span>价格与事件均为演示样例</span><button className="text-button" onClick={()=>navigate('watchlist')}>查看全部 {stocks.length} 个标的<Icon name="arrow" size={14}/></button></div></Panel>
 </>;
}

export function Watchlist({state,onStock}) {
 const [market,setMarket]=useState('全部'),[query,setQuery]=useState(''),[status,setStatus]=useState('全部状态');
 const items=stocks.filter(s=>(market==='全部'||s.market===market)&&(status==='全部状态'||stockStatus(s.id,state)===status)&&`${s.name} ${s.symbol} ${s.event}`.toLowerCase().includes(query.toLowerCase()));
 return <><div className="page-title"><div><h1>我的关注列表</h1><p>只看与你的研究和决策相关的股票。</p></div><span className="quiet-label">已关注 {stocks.length} 个标的</span></div><Panel className="watch-panel"><div className="table-toolbar"><Segmented items={['全部','A股','港股','美股']} value={market} onChange={setMarket} label="关注市场"/><div className="filter-controls"><label className="search-input"><Icon name="search"/><input aria-label="搜索关注股票" placeholder="搜索股票、代码或事件" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="关注状态" value={status} onChange={e=>setStatus(e.target.value)}>{['全部状态','观察中','待审批','持仓中'].map(v=><option key={v}>{v}</option>)}</select></div></div><StockTable items={items} state={state} onStock={onStock}/><div className="table-footer">显示 {items.length} / {stocks.length} 个已关注标的 · 预设样例，未连接全市场行情</div></Panel></>;
}
