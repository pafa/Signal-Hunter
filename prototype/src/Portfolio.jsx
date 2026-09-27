import React,{useState} from 'react';
import {stocks,byId,holdText,pct,gain,eventFor} from './data';
import {Button,Icon,Market,Panel,Empty,Segmented,TrendChart,Badge} from './components';
import {SummaryStrip,StockTable} from './Dashboard';

export function Portfolio({state,onStock,onSubmit,navigate}){
 const [market,setMarket]=useState('全部'),[focus,setFocus]=useState('msft'),[period,setPeriod]=useState('1月');
 const held=state.positions.map(p=>byId[p.stockId]);const items=held.filter(s=>market==='全部'||s.market===market);
 const selected=items.find(s=>s.id===focus)||items[0];const p=selected&&state.positions.find(p=>p.stockId===selected.id);
 const review=state.positions.filter(p=>p.days>=byId[p.stockId].hold[1]-3);
 const curve=selected?(period==='1周'?selected.trend.slice(-5):period==='3月'?[...selected.trend.map(v=>v-3),...selected.trend]:selected.trend):[];
 const waiting=selected&&state.applications.some(a=>a.stockId===selected.id&&a.status==='pending');
 return <><div className="page-title"><div><h1>模拟持仓</h1><p>跟踪买入之后的变化，持续检查最初的判断。</p></div><Button icon="book" onClick={()=>navigate('records')}>查看决策记录</Button></div><SummaryStrip items={[{label:'当前持仓',value:held.length,note:'经过人工确认的模拟买入'},{label:'临近复盘',value:review.length,note:'接近预期持有窗口',accent:true},{label:'待审批卖出',value:state.applications.filter(a=>a.type==='sell'&&a.status==='pending').length,note:'确认后才改变模拟持仓'}]}/>
 <Panel title="买入清单" subtitle="各股票按原币种展示 · 收益未计费用与滑点" action={<Segmented items={['全部','A股','港股','美股']} value={market} onChange={setMarket} label="持仓市场"/>}>{items.length?<StockTable items={items} state={state} onStock={onStock} portfolio/>:<Empty title="这个市场还没有模拟持仓" text="只有经过你确认的买入申请，才会出现在这里。" action={<Button onClick={()=>navigate('applications')}>查看交易申请</Button>}/>}</Panel>
 {selected&&<div className="position-review"><Panel title="持仓跟踪" action={<select aria-label="选择跟踪持仓" value={selected.id} onChange={e=>setFocus(e.target.value)}>{items.map(s=><option key={s.id} value={s.id}>{s.name} · {s.symbol}</option>)}</select>}><div className="position-chart-heading"><div className="position-identity"><Market market={selected.market}/><div><h3>{selected.name}<span>{selected.symbol}</span></h3><p>已持有 {p.days} 个交易日 · 计划 {holdText(selected)}</p></div></div><strong className={`position-return ${gain(p)>=0?'positive':'negative'}`}>{pct(gain(p))}<small>当前持仓模拟收益</small></strong></div><div className="right-aligned"><Segmented items={['1周','1月','3月']} value={period} onChange={setPeriod} label="持仓趋势区间"/></div><TrendChart data={curve} period={period} annotation label={`${selected.name}示例价格走势`}/><p className="chart-footnote">历史走势为独立示例，持仓收益按当前演示买入价计算。</p></Panel>
 <Panel title="这笔交易的研究计划" className="research-plan"><Badge tone={p.days>=selected.hold[1]-3?'amber':'green'}>{p.days>=selected.hold[1]-3?'临近复盘':'持续跟踪'}</Badge><h3>{selected.event}</h3><div className="plan-step"><span>01</span><div><b>为什么买入</b><p>{eventFor(selected.id)?.thesis||'观察经营线索能否持续，并通过模拟持仓检验初始判断。'}</p></div></div><div className="plan-step"><span>02</span><div><b>什么时候复盘</b><p>{eventFor(selected.id)?.review||'临近预期持有窗口时，重新评估是否继续持有。'}</p></div></div><div className="plan-step"><span>03</span><div><b>什么情况退出</b><p>{selected.risk}</p></div></div><Button className="full-width" disabled={waiting} onClick={()=>onSubmit(selected.id,'sell')}>{waiting?'已有申请等待审批':'提交模拟卖出申请'}</Button></Panel></div>}
 </>;
}
