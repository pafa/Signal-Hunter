import MarketSourceStatus from './MarketSourceStatus';
import {securityIdentity} from '../../shared/securities.mjs';
import {dailyHealth,marketClock,CALENDAR_VERSION} from '../../shared/market-clock.mjs';
import React from 'react';
import {Modal,Button} from '../major/Primitives';
import {time} from '../major/api';
import {dataHealth} from './decision-model';
import NewsCoverage from './NewsCoverage';
export function HealthStrip({data,onOpen}){
 if(data?.runtime?.offline)return <div className="v7-health" aria-label="数据与研究状态"><span>离线演示 · 外部采集已关闭</span><button onClick={onOpen}>合成日线 {data.watchlist.length} 只 · 不评估交易日新鲜度 <b>查看状态 ↗</b></button></div>;
 const h=dataHealth(data),priority=(data?.workflow||[]).filter(w=>w.priorityRank<=4),expired=data?.paper?.orders.filter(o=>o.status==='expired').length||0;
 return <div className="v7-health" aria-label="数据与研究状态"><span><i className={h.issue?'warning':''}/>{priority.length} 项优先复核</span><span className="v7-mode">{[['600825.SH','A股'],['00293.HK','港股'],['AAPL.US','美股']].map(([s,n])=>`${n} ${marketClock(s).label}`).join(' · ')}</span><button onClick={onOpen}>Reuters {h.rssState} · 日线缓存 {h.dailyCount}/{h.total} · {h.laggingCount||0} 落后交易日{h.failedCount?` · ${h.failedCount} 获取失败`:h.oldCount?` · ${h.oldCount} 旧缓存`:''} <b>查看状态 ↗</b></button>{expired>0&&<span>{expired} 笔申请到期 · 已释放</span>}</div>;
}
function SourceDetails({data}){
 if(data?.runtime?.offline)return <div><p className="m-note">事件、新闻和走势由本地原创示例生成，不是 Reuters 新闻或 Yahoo 行情。未模拟交易所节假日、复权或供应商延迟，不适用行情新鲜度判断。</p><p className="m-note">演示模式禁止服务端外部采集及正文读取。已有演示修改和模拟决定会保留；研究自己的事件请另行启动空白研究模式。</p></div>;
 const h=dataHealth(data);
 return <div><p className="m-note">采集成功只表示获取到了数据，不代表实时、完整或已核验。日线接收时间和交易所收盘日分别显示；行情不进入场景净值。</p><h3>Reuters 标题</h3><p>{h.rssState} · 最后成功 {time(h.rssAt)} · 最近尝试 {time(data.checks.news?.attemptedAt)}</p>{data.checks.news?.error&&<p className="m-warning">{data.checks.news.error} · 保留原有新闻</p>}<p className="m-note">日历 {CALENDAR_VERSION}：覆盖2026年普通股票，含常规休市与半日市；不判断个股停牌、临时休市或互联互通资格。证券按交易所及代码区分；A/H/ADR 的发行人关系只采用已有手工表，美股交易所和未映射关系仍待核验，不按名称合并。收盘后30分钟是本地研究缓冲，不能保证上游已给最终价。</p><h3>重点股票日线 · {h.dailyCount}/{h.total}</h3><table className="i-table"><thead><tr><th>证券</th><th>最近收盘日</th><th>接收时间</th><th>市场状态 / 应有收盘日</th><th>状态</th></tr></thead><tbody>{data.watchlist.map(w=><tr key={w.symbol}><td>{w.symbol}<small className="v8-security-id">{securityIdentity(w.symbol).currency} · {securityIdentity(w.symbol).venue}<br/>{securityIdentity(w.symbol).listing} · {securityIdentity(w.symbol).relationStatus}</small></td><td>{w.daily?.lastDate||'—'}</td><td>{time(w.daily?.receivedAt)}</td><td>{marketClock(w.symbol).label} · {dailyHealth(w.symbol,w.daily).expectedDate||'日历待补'}</td><td>{data.checks['daily:'+w.symbol]?.state==='error'?'更新失败，保留缓存':`${dailyHealth(w.symbol,w.daily).label}；供应商延迟未核验`}</td></tr>)}</tbody></table><p className="m-note">新闻、日线与分钟独立调度，同一任务未结束时不重复启动。无行情时不补造曲线；本地连接正常不等于上游数据正常。</p></div>;
}

export function Operations({data,onClose,onControl,busy}){
 const labels={news:'新闻采集',daily:'日线采集',minutes:'分钟采集',observations:'观察与持仓检查',backup:'本地备份'};
 const stateText=s=>s.paused?'已暂停':s.recovering?'等待恢复':s.running?'执行中':s.blocked?'失败待处理':s.outcome==='partial'?'部分失败':s.outcome==='error'?'等待重试':s.outcome==='ok'?'已完成':s.outcome==='skipped'?'无需更新':'等待运行';
 return <Modal title="运行控制与数据状态" onClose={onClose}>
 <p className="m-note">{data.runtime.mode} · 服务启动 {time(data.serviceHealth?.startedAt)} · 任务与控制状态保存到本机。暂停可中断采集，已保存的数据保留；这里不会批准或执行交易。</p>
 {data.serviceHealth?.restoreReviewRequired&&<div className="m-warning"><p>这是恢复的副本。请先核对研究、持仓和申请，再确认恢复；确认不会自动恢复任务。</p><Button disabled={busy} onClick={()=>onControl('restore-review',{confirm:true})}>已核对恢复数据</Button></div>}
 <div className="v7-lanes ops-lanes">{Object.entries(data.operations||{}).map(([name,s])=><section className="ops-task" key={name} aria-label={labels[name]||name}>
 <b>{labels[name]||name}</b><strong>{stateText(s)}</strong>
 <small>最近完成 {time(s.completedAt)}</small><small>最近成功 {time(s.lastSuccessAt)}</small>
 <small>{s.paused?'恢复后继续':s.blocked?'连续失败达到上限，请检查后重试':s.running?'完成后安排下次检查':s.nextRunAt?`下次检查 ${time(s.nextRunAt)}`:'等待调度'}</small>
 {s.error&&<small className="m-warning">{s.error}</small>}
 <div className="ops-buttons"><Button disabled={busy} onClick={()=>onControl(name,{action:s.paused?'resume':'pause'})}>{s.paused?'恢复':'暂停'}</Button><Button disabled={busy||s.paused||s.running||data.runtime.offline&&name!=='backup'} onClick={()=>onControl(name,{action:'retry'})}>重新检查</Button></div>
 </section>)}</div>
 <p className="m-note">采集任务有限重试；全部失败达到上限后等待处理。离线演示始终禁止外部采集。定时检查与数据实时性是不同状态。</p>
 <NewsCoverage data={data}/>
 <h3>上游来源</h3><div className="ops-scroll"><table className="i-table"><thead><tr><th>来源</th><th>状态</th><th>最近尝试</th><th>冷却至</th></tr></thead><tbody>{Object.entries(data.checks||{}).filter(([key])=>key.startsWith('source:')).map(([key,c])=><tr key={key}><td>{key.slice(7)}</td><td>{c.state==='ok'?'最近请求成功':'来源不可用'}<small>{c.error||''}</small></td><td>{time(c.attemptedAt)}</td><td>{c.retryAt?time(c.retryAt):'—'}</td></tr>)}</tbody></table>{!Object.keys(data.checks||{}).some(k=>k.startsWith('source:'))&&<p className="m-note">尚无外部来源请求记录；离线演示不会采集。</p>}</div>
 <MarketSourceStatus capabilities={data.dataCapabilities||[]}/>
 <details><summary>查看最近任务记录</summary><div className="ops-scroll"><table className="i-table"><thead><tr><th>任务</th><th>开始</th><th>结束</th><th>结果</th></tr></thead><tbody>{(data.operationHistory||[]).map((r,i)=><tr key={i}><td>{labels[r.name]||r.name}</td><td>{time(r.startedAt)}</td><td>{time(r.completedAt)}</td><td>{r.outcome}<small>{r.summary?.error||''}</small></td></tr>)}</tbody></table></div></details>
 <details><summary>来源与市场日历说明</summary><SourceDetails data={data}/></details>
 </Modal>;
}
