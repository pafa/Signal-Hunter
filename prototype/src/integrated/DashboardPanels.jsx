import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {marketClock} from '../../shared/market-clock.mjs';
import {laneNames} from '../../shared/activity-view.mjs';
import {dataHealth} from './decision-model';

export const money=value=>typeof value==='number'&&Number.isFinite(value)?`$${(value/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'未知';
const percentage=value=>typeof value==='number'&&Number.isFinite(value)?`${value.toFixed(2)}%`:'未知';
const price=value=>value==null?'未知':String(value);
const accountName=(overview,id)=>overview?.accounts.find(a=>a.id===id)?.label||id;
const activityNames={offline:'离线演示',paused:'任务已暂停',running:'研究运行中',degraded:'部分任务降级',waiting:'等待下一轮'};

export function DashboardStatus({data,onRuntime}){
 const overview=data?.overview,activity=overview?.activity,h=dataHealth(data,data?.serverTime?Date.parse(data.serverTime):Date.now());
 return <div className="dashboard-status" aria-label="整体状态">
  <span><b>{activityNames[activity?.state]||'读取状态中'}</b> · {data?.runtime?.instance?.label||'当前工作台'}</span>
  <button onClick={onRuntime}>新闻 {data?.runtime?.offline?'合成资料':h.rssState} · 最近输入 {time(activity?.newsAt)}</button>
  <span className={overview?.risks.length?'amber':''}>全局风险 {overview?.risks.length??'—'} · 待决定 {overview?.decisions.length??'—'}</span>
  <span className="dashboard-market-time">{[['600825.SH','A股'],['00293.HK','港股'],['AAPL.US','美股']].map(([symbol,label])=>`${label} ${data?.runtime?.offline?'演示':marketClock(symbol,data?.serverTime).label}`).join(' · ')}</span>
 </div>;
}

export function DecisionSidebar({overview,onDecision,onRisk,onPosition,onAllRisks,onMonitoring,onRuntime}){
 const risks=overview?.risks||[],decisions=overview?.decisions||[],monitoring=overview?.monitoring||[],activity=overview?.activity;
 return <aside className="dashboard-decisions i-panel" aria-label="全局风险与后续监控">
  <div className="i-section-head"><h2>风险与后续监控</h2><small>全部账户</small></div>
  <div className="dashboard-side-scroll">
   <section><h3>持仓风险 <em>{risks.length}</em></h3>
    {risks.slice(0,1).map(r=><button className="dashboard-list-item" key={r.id} onClick={()=>onRisk(r)}><strong>{r.symbol||accountName(overview,r.account)}</strong><span className="amber">{r.message}</span><small>{accountName(overview,r.account)} · 查看依据</small></button>)}
    {!risks.length&&<p className="i-note">{overview?'暂无已识别风险；数据缺口仍须看账户估值状态。':'正在读取风险…'}</p>}
    {risks.length>1&&<Button onClick={()=>onAllRisks('risks')}>全部 {risks.length} 项风险 →</Button>}
   </section>
   <section><h3>买卖待决定 <em>{decisions.length}</em></h3>
    {decisions.slice(0,1).map(d=><button className="dashboard-list-item" key={d.id} onClick={()=>onDecision(d)}><strong>{d.symbol} · {d.side==='sell'?'卖出':'买入'} {d.qty} 股</strong><span>{accountName(overview,d.account)} · {d.label}</span><small>研究 v{d.topicVersion} · 到期 {time(d.expiresAt)}</small></button>)}
    {!decisions.length&&<p className="i-note">当前没有待决定的有效模拟申请。研究结论不等于已获准买卖。</p>}
    {decisions.length>1&&<Button onClick={()=>onAllRisks('decisions')}>全部 {decisions.length} 份方案 →</Button>}
   </section>
   <section><h3>后续监控</h3>{monitoring.slice(0,1).map(m=><button className="dashboard-list-item" key={m.id} onClick={()=>onPosition(m.id)}><strong>{m.symbol}</strong><span>复核 {time(m.reviewAt)}</span><small>{m.holdingHorizon||'持有窗口待评估'}</small></button>)}
    {!monitoring.length&&<p className="i-note">尚无持仓监控对象；研究观察记录可在详情查看。</p>}
    <Button onClick={onMonitoring}>全部监控 →</Button>
   </section>
  </div>
  <details className="dashboard-activity"><summary>后台进展 · {activityNames[activity?.state]||'读取中'}</summary>
   <p>{activity?.running.length?`当前：${activity.running.map(n=>laneNames[n]||n).join(' / ')}`:'当前没有执行中的任务'}</p>
   <p>最近有效动作：{laneNames[activity?.latestTask]||'尚无记录'} · {time(activity?.latestEffectiveAt)}</p>
   <p>下次检查 {time(activity?.nextRunAt)}{activity?.blocked.length?` · ${activity.blocked.length} 类任务降级`:''}</p>
   <Button onClick={onRuntime}>进度与运行详情 →</Button>
  </details>
 </aside>;
}

export function HoldingsSummary({overview,accountId,onAccount,selectedTopic,selectedSymbol,onSelect,onDetail,onPortfolio,expanded,onExpand}){
 const account=overview?.accounts.find(a=>a.id===accountId)||overview?.accounts.find(a=>a.id===overview.defaultAccount);
 const positions=[...(account?.positions||[])].sort((a,b)=>Number(!!b.risks.length)-Number(!!a.risks.length)||(a.reviewAt||'~').localeCompare(b.reviewAt||'~'));
 return <section className="dashboard-holdings i-panel" aria-label="持仓与退出跟踪">
  <div className="i-section-head"><h2>持仓与退出跟踪 <em>{positions.length}</em></h2>
   <select aria-label="持仓账户" value={account?.id||''} onChange={e=>onAccount(e.target.value)}>{overview?.accounts.map(a=><option key={a.id} value={a.id}>{a.label}{!a.configured?' · 未初始化':''}</option>)}</select>
   <small>{account?.kind==='scenario'?'场景价格 + 固定 FX':'USD 基准 · 账户独立核算'}</small><Button onClick={()=>onPortfolio(account?.id)}>全部持仓 →</Button>
  </div>
  <div className="dashboard-metrics">
   <span>净值 <b>{money(account?.navCents)}</b></span>
   <span title={account?.unavailable.dailyPnl}>当日变化 <b>{money(account?.dailyPnlCents)}</b></span>
   <span>持仓浮盈 <b className="up">{money(account?.floatingProfitCents)}</b></span>
   <span>持仓浮亏 <b className="down">{money(account?.floatingLossCents)}</b></span>
   <span>已实现 <b>{money(account?.realizedCents)}</b></span>
   <span title={`${account?.drawdownBasis||''}；${account?.unavailable.maxDrawdown||''}`}>当前 / 最大回撤 <b>{percentage(account?.currentDrawdownPct)} / {percentage(account?.maxDrawdownPct)}</b></span>
  </div>
  <div className="dashboard-holdings-scroll"><table className="i-table"><thead><tr><th>公司 / 数量</th><th>成本 USD / 现价</th><th>浮盈亏 USD / 比例</th><th>当前判断</th><th>退出窗口 / 下次复核</th><th>关键风险</th><th>展开</th></tr></thead><tbody>
   {positions.map(p=><React.Fragment key={p.id}><tr className={p.symbol===selectedSymbol?'selected':p.topicId===selectedTopic?'related':''}>
    <td><button className="dashboard-company" onClick={()=>onSelect(p)}>{p.name}<small>{p.symbol} · {p.qty} 股</small></button></td>
    <td>{money(p.costCents)}<small title={`${p.priceSource||'来源未知'} · ${time(p.priceAt)}`}>{price(p.price)} {p.currency||''} · {p.priceBasis}</small></td>
    <td className={p.unrealizedCents==null?'':p.unrealizedCents<0?'down':'up'}>{money(p.unrealizedCents)}<small>{percentage(p.returnPct)}</small></td>
    <td>{p.judgement}<small>研究 v{p.currentVersion??'未知'}</small></td>
    <td title={p.holdingHorizon||'尚无确定退出窗口'}>{p.holdingHorizon||'退出窗口待评估'}<small>复核 {time(p.reviewAt)}</small></td>
    <td className={p.risks.length?'amber':''} title={p.risks.join('；')||p.invalidation||'失效条件待补'}>{p.risks[0]||p.invalidation||'失效条件待补'}</td>
    <td><Button aria-label={`${expanded===p.id?'收起':'展开'}持仓 ${p.symbol}`} aria-expanded={expanded===p.id} onClick={()=>onExpand(expanded===p.id?null:p.id)}>{expanded===p.id?'▴':'▾'}</Button></td>
   </tr>{expanded===p.id&&<tr className="dashboard-position-expanded"><td colSpan="7"><b>建仓研究 v{p.openingVersion??'未知'} → 当前 v{p.currentVersion??'未知'}</b><span> · {p.trigger||'触发条件待补'}；失效：{p.invalidation||'待补'}</span><span> · 估值时间 {time(p.priceAt)} · {p.priceSource||'来源未知'}</span><Button onClick={()=>onDetail(p.id)}>深入查看持仓 →</Button></td></tr>}</React.Fragment>)}
   {!positions.length&&<tr><td colSpan="7" className="dashboard-empty">{!account?'正在读取持仓…':!account.configured?'账户尚未初始化，净值与盈亏未知。配置和行情就绪后才能开展市场模拟。':'此账户暂无持仓。已有买入不会通过示例数据自动补入。'}</td></tr>}
  </tbody></table></div>
  <div className="dashboard-holdings-foot"><span>{account?.sourceNote||'按有效输入估值；未知不表示零风险'} · 已估值 {account?.valuedPositions??0}/{positions.length}</span><span>选择事件只高亮，不隐藏全局持仓</span></div>
 </section>;
}

export function PositionDetails({position:p,account,onResearch,onAccount}){
 if(!p)return <p className="m-warning">持仓已变化或不在当前快照中；请返回组合核对，旧记录仍在原账本。</p>;
 return <section className="dashboard-position-detail" aria-label="持仓长期档案">
  <p><b>{p.name} · {p.symbol}</b> · {account.label} · {p.qty} 股</p>
  <p>{account.sourceNote||'有效执行输入估值'}；估值 {time(p.priceAt)}，来源 {p.priceSource||'未知'}。</p>
  <div className="dashboard-metrics"><span>成本 USD <b>{money(p.costCents)}</b></span><span>现价 <b>{price(p.price)} {p.currency}</b></span><span>浮盈亏 USD <b>{money(p.unrealizedCents)} / {percentage(p.returnPct)}</b></span></div>
  <h3>原研究与当前判断</h3><p>建仓 {time(p.openedAt)} · 原研究 v{p.openingVersion??'未知'} → 当前 v{p.currentVersion??'未知'}。</p><p>{p.topicTitle} · {p.judgement}</p>
  <h3>退出计划与风险</h3><p>预计窗口：{p.holdingHorizon||'未形成有依据的退出窗口'}。复核：{time(p.reviewAt)}。</p><p>触发：{p.trigger||'未定义'}；失效：{p.invalidation||'未定义'}。</p>
  {p.risks.map((r,i)=><p className="m-warning" key={i}>{r}</p>)}<p className="m-note">复核时间不等于保证卖出日期；阅读本页、标记已读均不批准或执行买卖。</p>
  <div className="detail-section-tools"><Button onClick={()=>onResearch(p)}>查看对应研究</Button><Button onClick={()=>onAccount(p.account)}>账户、订单与成交</Button></div>
 </section>;
}
