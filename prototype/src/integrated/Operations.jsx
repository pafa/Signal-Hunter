import {safeErrorText} from '../../shared/safe-errors.mjs';
import MarketSourceStatus from './MarketSourceStatus';
import {securityIdentity} from '../../shared/securities.mjs';
import {dailyHealth,marketClock,CALENDAR_VERSION} from '../../shared/market-clock.mjs';
import React,{useState} from 'react';
import {semanticKinds,semanticScopeLabels} from '../../shared/semantic-labels.mjs';
import {Modal,Button} from '../major/Primitives';
import {time} from '../major/api';
import {dataHealth} from './decision-model';
import NewsCoverage from './NewsCoverage';
import PipelineEventJobs from './PipelineEventJobs';
export function HealthStrip({data,onOpen}){
 if(data?.runtime?.offline)return <div className="v7-health" aria-label="数据与研究状态"><span>离线演示 · 外部采集已关闭</span><button onClick={onOpen}>合成日线 {data.watchlist.length} 只 · 不评估交易日新鲜度 <b>查看状态 ↗</b></button></div>;
 const h=dataHealth(data),priority=(data?.workflow||[]).filter(w=>w.priorityRank<=4),expired=data?.paper?.orders.filter(o=>o.status==='expired').length||0;
 return <div className="v7-health" aria-label="数据与研究状态"><span><i className={h.issue?'warning':''}/>{priority.length} 项优先复核</span><span className="v7-mode">{[['600825.SH','A股'],['00293.HK','港股'],['AAPL.US','美股']].map(([s,n])=>`${n} ${marketClock(s).label}`).join(' · ')}</span><button onClick={onOpen}>新闻 {h.rssState} · 日线缓存 {h.dailyCount}/{h.total} · {h.laggingCount||0} 落后交易日{h.failedCount?` · ${h.failedCount} 获取失败`:h.oldCount?` · ${h.oldCount} 旧缓存`:''} <b>查看状态 ↗</b></button>{expired>0&&<span>{expired} 笔申请到期 · 已释放</span>}</div>;
}
function SourceDetails({data}){
 if(data?.runtime?.offline)return <div><p className="m-note">事件、新闻和走势由本地原创示例生成，不是 Reuters 新闻或 Yahoo 行情。未模拟交易所节假日、复权或供应商延迟，不适用行情新鲜度判断。</p><p className="m-note">演示模式禁止服务端外部采集及正文读取。已有演示修改和模拟决定会保留；研究自己的事件请另行启动空白研究模式。</p></div>;
 const h=dataHealth(data);
 return <div><p className="m-note">采集成功只表示获取到了数据，不代表实时、完整或已核验。日线接收时间和交易所收盘日分别显示；行情不进入场景净值。</p><h3>新闻标题</h3><p>{h.rssState} · 最后成功 {time(h.rssAt)} · 最近尝试 {time(data.checks.news?.attemptedAt)}</p>{data.checks.news?.error&&<p className="m-warning">{safeErrorText(data.checks.news.error)} · 保留原有新闻</p>}<p className="m-note">日历 {CALENDAR_VERSION}：覆盖2026年普通股票，含常规休市与半日市；不判断个股停牌、临时休市或互联互通资格。证券按交易所及代码区分；A/H/ADR 的发行人关系只采用已有手工表，美股交易所和未映射关系仍待核验，不按名称合并。收盘后30分钟是本地研究缓冲，不能保证上游已给最终价。</p><h3>重点股票日线 · {h.dailyCount}/{h.total}</h3><table className="i-table"><thead><tr><th>证券</th><th>最近收盘日</th><th>接收时间</th><th>市场状态 / 应有收盘日</th><th>状态</th></tr></thead><tbody>{data.watchlist.map(w=><tr key={w.symbol}><td>{w.symbol}<small className="v8-security-id">{securityIdentity(w.symbol).currency} · {securityIdentity(w.symbol).venue}<br/>{securityIdentity(w.symbol).listing} · {securityIdentity(w.symbol).relationStatus}</small></td><td>{w.daily?.lastDate||'—'}</td><td>{time(w.daily?.receivedAt)}</td><td>{marketClock(w.symbol).label} · {dailyHealth(w.symbol,w.daily).expectedDate||'日历待补'}</td><td>{data.checks['daily:'+w.symbol]?.state==='error'?'更新失败，保留缓存':`${dailyHealth(w.symbol,w.daily).label}；供应商延迟未核验`}</td></tr>)}</tbody></table><p className="m-note">新闻、日线与分钟独立调度，同一任务未结束时不重复启动。无行情时不补造曲线；本地连接正常不等于上游数据正常。</p></div>;
}

export function Operations({data,onClose,onControl,onPipeline,busy}){
 const labels={discovery:'自动发现与研判',semantic:'Codex 比较批次',execution:'自动模拟执行',news:'新闻采集',daily:'日线采集',minutes:'分钟采集',observations:'观察与持仓检查',backup:'本地备份'};
 const stateText=s=>s.paused?'已暂停':s.recovering?'等待恢复':s.running?'执行中':s.blocked?'失败待处理':s.outcome==='partial'?'部分失败':s.outcome==='error'?'等待重试':s.outcome==='ok'?'已完成':s.outcome==='skipped'?'无需更新':'等待运行';
 return <Modal title="运行控制与数据状态" onClose={onClose}>
 <p className="m-note">{data.runtime.mode} · 服务启动 {time(data.serviceHealth?.startedAt)} · 任务与控制状态保存到本机。暂停保留已保存结果；此处不能批准订单。自动模拟执行启用后只处理已获本人批准的模拟订单，不连接真实交易。</p>
 {data.serviceHealth?.restoreReviewRequired&&<div className="m-warning"><p>这是恢复的副本。请先核对研究、持仓和申请，再确认恢复；确认不会自动恢复任务。</p><Button disabled={busy} onClick={()=>onControl('restore-review',{confirm:true})}>已核对恢复数据</Button></div>}
 <div className="v7-lanes ops-lanes">{Object.entries(data.operations||{}).map(([name,s])=><section className="ops-task" key={name} aria-label={labels[name]||name}>
 <b>{labels[name]||name}</b><strong>{stateText(s)}</strong>
 <small>最近完成 {time(s.completedAt)}</small><small>最近成功 {time(s.lastSuccessAt)}</small>
 {name==='discovery'&&<small>默认暂停；扫描初筛候选、保存来源正文、调用本机 Codex。失败保留，结果待复核，不自动采纳或创建订单。</small>}
 {name==='execution'&&<small>默认暂停；启用后每10秒检查两个模拟池。仅处理本人已批准订单；暂停只停止自动检查，手动检查仍可用。</small>}
 {name==='semantic'&&<small>默认暂停；只推进本人建立的比较批次，每10秒至多启动一项。暂停停止后续调用，当前模型调用仍保存结果；失败需在批次中显式重试。</small>}
 <small>{s.paused?'恢复后继续':s.blocked?'连续失败达到上限，请检查后重试':s.running?'完成后安排下次检查':s.nextRunAt?`下次检查 ${time(s.nextRunAt)}`:'等待调度'}</small>
 {s.error&&<small className="m-warning">{safeErrorText(s.error)}</small>}
 <div className="ops-buttons"><Button disabled={busy} onClick={()=>onControl(name,{action:s.paused?'resume':'pause'})}>{s.paused?'恢复':'暂停'}</Button><Button disabled={busy||s.paused||s.running||data.runtime.offline&&name!=='backup'} onClick={()=>onControl(name,{action:'retry'})}>重新检查</Button></div>
 </section>)}</div>
 <p className="m-note">采集任务有限重试；全部失败达到上限后等待处理。离线演示始终禁止外部采集。定时检查与数据实时性是不同状态。模拟执行完成一次检查不代表已经成交；来源与等待原因见市场模拟账户。</p>
 {data.researchPipeline&&<ResearchPipeline key={data.researchPipeline.settings.version} pipeline={data.researchPipeline} onChange={onPipeline} busy={busy}/>}
 <NewsCoverage data={data}/>
 <h3>上游来源</h3><div className="ops-scroll"><table className="i-table"><thead><tr><th>来源</th><th>状态</th><th>最近尝试</th><th>冷却至</th></tr></thead><tbody>{Object.entries(data.checks||{}).filter(([key])=>key.startsWith('source:')).map(([key,c])=><tr key={key}><td>{({'source:news.google.com':'Google News / Reuters 聚合','source:www.federalreserve.gov':'美联储官方 RSS','source:api.hkma.gov.hk':'金管局公开 API','source:www.csrc.gov.cn':'证监会公开列表','source:query1.finance.yahoo.com':'Yahoo 公共图表','source:query2.finance.yahoo.com':'Yahoo 公共图表','source:push2his.eastmoney.com':'东方财富公共来源','source:yahoo-public-chart':'Yahoo 公共图表','source:eastmoney-public':'东方财富公共来源'})[key]||'外部来源'}</td><td>{c.state==='ok'?'最近请求成功':'来源不可用'}<small>{safeErrorText(c.error)}</small></td><td>{time(c.attemptedAt)}</td><td>{c.retryAt?time(c.retryAt):'—'}</td></tr>)}</tbody></table>{!Object.keys(data.checks||{}).some(k=>k.startsWith('source:'))&&<p className="m-note">尚无外部来源请求记录；离线演示不会采集。</p>}</div>
 <MarketSourceStatus capabilities={data.dataCapabilities||[]}/>
 <details><summary>查看最近任务记录</summary><div className="ops-scroll"><table className="i-table"><thead><tr><th>任务</th><th>开始</th><th>结束</th><th>结果</th></tr></thead><tbody>{(data.operationHistory||[]).map((r,i)=><tr key={i}><td>{labels[r.name]||r.name}</td><td>{time(r.startedAt)}</td><td>{time(r.completedAt)}</td><td>{r.outcome}<small>{safeErrorText(r.summary?.error)}</small></td></tr>)}</tbody></table></div></details>
 <details><summary>来源与市场日历说明</summary><SourceDetails data={data}/></details>
 </Modal>;
}

export function ResearchPipeline({pipeline,onChange,busy}){
 const [dailyCalls,setDailyCalls]=useState(pipeline.settings.dailyCalls),[includeClues,setIncludeClues]=useState(pipeline.settings.includeClues),[extractEvents,setExtractEvents]=useState(pipeline.settings.extractEvents||false);
 const names={queued:'等待准备',preparing:'读取来源',ready:'等待模型',running:'生成中',candidate:'待复核候选',adopted:'已采纳',failed:'失败待处理',interrupted:'中断待处理',cancelled:'已取消',skipped:'保留未选中',
 invalidated:'依据变化需核对','needs-review':'已有研究需核对'};
 return <section aria-label="自动研究队列"><h3>自动发现与研判</h3><p>过去24小时已调用 {pipeline.callsInLast24Hours} 次。只对筛选选中的新闻建立观察研究，来源无法读取时停止该条目，不把标题当全文。结果到对应研究的 Codex 候选中复核；来源修订和已有研究保留，不自动覆盖。</p>
 <form onSubmit={e=>{e.preventDefault();onChange?.('configure',{version:pipeline.settings.version,dailyCalls:Number(dailyCalls),includeClues,extractEvents});}}><fieldset disabled={busy||!onChange}><legend>自动研究配置</legend><label>滚动24小时最多调用<input type="number" min="1" max="100" required value={dailyCalls} onChange={e=>setDailyCalls(e.target.value)}/></label><label><input type="checkbox" checked={includeClues} onChange={e=>setIncludeClues(e.target.checked)}/>同时选择主题线索（只影响后续扫描）</label><label><input type="checkbox" checked={extractEvents} onChange={e=>setExtractEvents(e.target.checked)}/>自动拆分正文，并续写已选事项（只影响后续扫描）</label><Button type="submit" disabled={busy||!onChange}>保存队列配置</Button></fieldset></form>
 <p>{Object.entries(pipeline.counts).map(([key,count])=>`${names[key]||key} ${count}`).join(' · ')||'尚未扫描新闻；在上方恢复自动发现任务后开始。'}</p>
 <div className="ops-scroll"><table className="i-table"><thead><tr><th>来源与版本</th><th>进度</th><th>处理</th></tr></thead><tbody>{pipeline.items.map(item=><tr key={item.id}><td>{item.title}<small>新闻 v{item.revision}</small>{item.relationCoverage&&<small>关联召回：{item.relationCoverage.newsIndexed}/{item.relationCoverage.newsTotal} 条新闻、{item.relationCoverage.topicsIndexed}/{item.relationCoverage.topicsTotal} 份研究；选取 {item.relationCoverage.selectedTopics} 项</small>}</td><td>{names[item.status]||item.status}<small>{item.reason}</small></td><td>{item.topicId&&<a href={`/?topic=${encodeURIComponent(item.topicId)}`}>打开研究</a>}{['failed','cancelled','interrupted'].includes(item.status)&&<Button disabled={busy||!pipeline.enabled||!onChange} onClick={()=>onChange('retry',{id:item.id})}>重试此项</Button>}</td></tr>)}</tbody></table></div><p className="m-note">最近显示30项，旧条目与历次模型调用保存在本机。调用上限包含自动研判、事项拆分、已选事项续写与自动关联比较；手动研判和手动比较批次仍独立。暂停阻止新的准备和模型调用，已启动模型结果保留。</p>{pipeline.relations&&<details><summary>自动关联比较 · {Object.entries(pipeline.relations.counts).map(([key,n])=>`${names[key]||key} ${n}`).join(' · ')||'尚无计划'}</summary><p className="m-note">先按标题、来源与有限公司目录召回，再选最多3项，用双方最后关联的正文材料比较。摘录仍是摘录；未召回不代表无关。方向为新报道相对于已有材料。比较独立保存，不自动采纳、合并研究或修改研判正文。</p>{pipeline.relations.items.map(r=><article key={r.id}><h4><a href={`/?topic=${encodeURIComponent(r.source.id)}`}>{r.source.title}</a> → <a href={`/?topic=${encodeURIComponent(r.target.id)}`}>{r.target.title}</a></h4><p>{names[r.status]||r.status} · 研究版本 {r.source.version} / {r.target.version}{r.stale?' · 依据已变化，需重新核对':''}</p>{r.reason&&<p>{r.reason}</p>}{r.comparison&&<div><b>{semanticKinds[r.comparison.relation]||r.comparison.relation} · 待复核</b><p>{r.comparison.reason}</p><p>新材料引文：{r.comparison.left.quote}</p><p>已有材料引文：{r.comparison.right.quote}</p>{r.scopes&&<small>{r.scopes.map(s=>semanticScopeLabels[s]||s).join(' / ')}</small>}</div>}{['failed','cancelled','interrupted'].includes(r.status)&&<Button disabled={busy||!pipeline.enabled||!onChange||r.stale} onClick={()=>onChange('retry-relation',{id:r.id})}>重试比较</Button>}</article>)}<p className="m-note">最近显示30项，原材料、计划、结果与历次尝试留库。比较候选在事件追踪的语义比较中复核。</p></details>}{pipeline.events&&<PipelineEventJobs jobs={pipeline.events} enabled={pipeline.enabled} busy={busy} onChange={onChange}/>}</section>;
}
