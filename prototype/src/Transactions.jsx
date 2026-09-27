import React,{useState} from 'react';
import {byId,money,holdText} from './data';
import {Icon,Button,Market,Badge,Segmented,Panel,Empty} from './components';

export function Applications({state,onApplication,navigate}){
 const [tab,setTab]=useState('待审批');
 const items=state.applications.filter(a=>tab==='全部'||(tab==='待审批'?a.status==='pending':a.status!=='pending'));
 const pending=state.applications.filter(a=>a.status==='pending').length;
 return <><div className="page-title"><div><h1>待审批申请</h1><p>分析提供依据，是否买入由你决定。</p></div><span className="quiet-label"><Icon name="user"/>{pending} 项等待你的决定</span></div>
 <div className="approval-banner"><Icon name="shield" size={21}/><p><b>每一笔模拟交易，都先经过你的确认。</b><span>未批准的申请不会进入模拟持仓；拒绝的申请会保留决策记录。</span></p></div>
 <Panel title="交易申请" action={<Segmented items={['待审批','已处理','全部']} value={tab} onChange={setTab} label="申请状态"/>}>
  {items.length?<div className="application-list">{items.map(a=>{const s=byId[a.stockId];return <button key={a.id} className="application-row" onClick={()=>onApplication(a.id)}><div className="application-stock"><Market market={s.market}/><div><strong>{s.name}<span>{s.symbol}</span></strong><small>{a.id} · {a.created}</small></div></div><div className="application-purpose"><b>{a.type==='buy'?'模拟买入':'模拟卖出'}</b><span>{s.event}</span></div><div className="application-plan"><span>{money(a.price,s.currency)}</span><small>{a.type==='buy'?`预计持有 ${holdText(s)}`:`申请卖出 ${a.qty} 股`}</small></div><Badge>{a.status==='pending'?'待审批':a.status==='approved'?'已同意':'已拒绝'}</Badge><Icon name="arrow"/></button>;})}</div>:<Empty title={tab==='待审批'?'所有申请都已处理':'还没有已处理申请'} text={tab==='待审批'?'你可以回到事件分析，继续研究下一笔机会。':'做出决定后，这里会保留你的审批记录。'} action={<Button onClick={()=>navigate('research')}>查看事件分析</Button>}/>}
 </Panel><p className="page-note">此页面展示审批交互样例，价格、数量和成交均为本地演示。</p></>;
}

export function Records({state}){
 const [filter,setFilter]=useState('全部');const items=state.records.filter(r=>filter==='全部'||(filter==='已同意'?r.decision==='approved':r.decision==='rejected'));
 return <><div className="page-title"><div><h1>决策记录</h1><p>保留每次判断，也保留当时选择的理由。</p></div><span className="quiet-label">本次演示 · 刷新后恢复</span></div><Panel title="你的决策时间线" action={<Segmented items={['全部','已同意','已拒绝']} value={filter} onChange={setFilter} label="决策筛选"/>}>{items.length?<div className="decision-timeline">{items.map(r=>{const s=byId[r.stockId];return <article className="decision-entry" key={r.id}><span className={`timeline-dot ${r.decision}`}><Icon name={r.decision==='approved'?'check':'close'} size={15}/></span><div className="decision-body"><div><h3>{r.decision==='approved'?'同意':'拒绝'}{r.type==='buy'?'模拟买入':'模拟卖出'}<span>{s.name} · {s.symbol}</span></h3><time>{r.time}</time></div><p>{r.decision==='approved'?`${r.qty.toLocaleString()} 股 · ${money(r.price,s.currency)}`:'未执行模拟交易，未改变持仓'}{r.realized!==undefined&&<span className={r.realized>=0?'positive':'negative'}> · 已实现模拟盈亏 {money(r.realized,s.currency)}（未计费用）</span>}</p>{r.note&&<blockquote>{r.note}</blockquote>}<small>{r.requestId||'历史演示记录'}</small></div></article>;})}</div>:<Empty title="暂无此类决策" text="处理申请后，决定和备注会出现在这里。"/>}</Panel></>;
}
