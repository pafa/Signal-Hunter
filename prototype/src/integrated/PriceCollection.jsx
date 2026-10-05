import React,{useState,useRef} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
import {safeErrorText} from '../../shared/safe-errors.mjs';
import './price-collection.css';
const windows={baseline:'判断后起点','1h':'1小时','1d':'1自然日','5d':'5自然日','20d':'20自然日'};
const states={pending:'等待采集',observed:'已保存观察',missed:'窗口错过或缺价','no-baseline':'缺少起点'};
const benchmarkStates={pending:'等待参照',observed:'已保存参照',missed:'参照缺价','not-configured':'未配置参照','same-symbol':'与证券相同','security-price-missing':'研究证券缺价'};
const reasons={'scheduled':'已安排窗口','no-usable-symbol':'无可用证券','input-available-before-activation':'启用前已可用，保留排除','invalid-availability-or-decision-time':'时间缺失或矛盾','future-input-or-decision-time':'时间在未来，保留排除','screening-rules-changed':'初筛规则变化，保留排除'};
export default function PriceCollection({collection,paused,onChange,busy,restorePending}){
 const [benchmarks,setBenchmarks]=useState(collection.config?.benchmarks||{}),[detail,setDetail]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),generation=useRef(0);
 const disabled=busy||!collection.enabled||restorePending;
 async function view(id){const n=++generation.current;setLoading(true);setError('');setDetail(null);try{const value=await request('/api/price-collection/'+id);if(generation.current===n)setDetail(value);}catch(e){if(generation.current===n)setError(safeErrorText(e));}finally{if(generation.current===n)setLoading(false);}}
 return <section aria-label="价格评估采集"><h3>价格评估采集</h3>
 <p className="m-note">{collection.configured?`启用起点 ${time(collection.config.activatedAt)} · 配置 v${collection.config.version}`:'尚未启用。首次保存配置或恢复任务后，只接纳新获取并初筛的新闻。'} 全部初筛层级留样，不要求加入关注池。窗口为1小时及1/5/20自然日，休市或缺价不延展、不填零；这些是公开观察价格，不能用于证明可成交收益。</p>
 {!collection.sourceCurrent&&<p className="m-warning">源码或初筛规则已变化。先暂停，再保存新配置；旧计划和旧记录保留，不由新版本继续执行。</p>}
 <form onSubmit={e=>{e.preventDefault();const selected=Object.fromEntries(Object.entries(benchmarks).map(([k,v])=>[k,v.trim()]).filter(([,v])=>v));onChange?.({version:collection.config?.version||0,requestId:crypto.randomUUID(),benchmarks:selected});}}><fieldset disabled={disabled||!paused||!onChange}><legend>参照标的 · 仅影响新计划</legend>
 <div className="price-collection-fields">{['USD','HKD','CNY'].map(currency=><label key={currency}>{currency} 参照证券<input value={benchmarks[currency]||''} maxLength={40} onChange={e=>setBenchmarks({...benchmarks,[currency]:e.target.value})}/></label>)}</div>
 <p className="m-note">参照可以留空。采用同币种、同来源、精确同一时刻的端点；标的代表性仍需核验。修改前请在上方暂停任务。</p><Button type="submit" disabled={disabled||!paused||!onChange}>保存价格采集配置</Button></fieldset></form>
 <p>已留样 {collection.plans} 条 · 待登记 {collection.pendingEnrollment} 条 · 原版本计划 {collection.incompatiblePlans} 条</p>
 <p className="m-note">{collection.planReasons.map(r=>`${reasons[r.reason]||r.reason} ${r.count}`).join(' · ')||'尚无采集计划。默认暂停，在上方“价格评估采集”中恢复后开始。'}</p>
 <div className="ops-scroll"><table className="i-table"><thead><tr><th>窗口</th><th>观察状态</th><th>参照状态</th><th>数量</th></tr></thead><tbody>{collection.boundaries.map(r=><tr key={[r.window,r.state,r.benchmarkState].join(':')}><td>{windows[r.window]||r.window}</td><td>{states[r.state]||r.state}</td><td>{benchmarkStates[r.benchmarkState]||r.benchmarkState}</td><td>{r.count}</td></tr>)}</tbody></table></div>
 <details><summary>最近采集计划与窗口依据</summary><p className="m-note">显示最近20条；全部计划和历次窗口状态保存在当前数据库，暂停、重启和新配置不会删除旧记录。</p>
 {collection.recent.map(p=><article key={p.id}><b>{p.title}</b><p>判断 {time(p.decisionAt)} · 配置 v{p.configVersion} · {p.symbols.join('、')||'无可用证券'} · {reasons[p.reason]||p.reason}</p><Button disabled={loading} onClick={()=>view(p.id)}>查看窗口依据</Button></article>)}
 {loading&&<p role="status">正在读取窗口依据…</p>}{error&&<p role="alert">{error}</p>}
 {detail&&<div role="region" aria-label="窗口采集依据"><h4>{detail.plan.sample.input.title}</h4><p>原始初筛层级 {detail.plan.sample.triage.bucket} · 判断 {time(detail.plan.sample.decisionAt)} · {reasons[detail.plan.reason]||detail.plan.reason}</p>
 <p className="m-note">{detail.config.policy.maximumBoundaryDelayMs/60000}分钟内的标签；接收截止额外留{detail.config.policy.receiptGraceMs/60000}分钟。错过后不接受迟到行情补救。完整快照指纹随每个观察保存。</p>
 <div className="ops-scroll"><table className="i-table"><thead><tr><th>证券 / 窗口</th><th>标签范围与接收截止</th><th>状态 / 观察</th></tr></thead><tbody>{detail.boundaries.map(b=><tr key={b.symbol+':'+b.window}><td>{b.symbol} · {windows[b.window]}</td><td>{time(new Date(b.minAt).toISOString())} — {time(new Date(b.maxAt).toISOString())}<small>接收截止 {time(new Date(b.deadline).toISOString())}</small></td><td>{states[b.state]}{b.point&&<small>{b.point.price} {b.point.currency} · 标签 {time(b.point.time)} · 保存 {time(b.point.receivedAt)}<br/>快照 #{b.point.snapshotId}</small>}<small>参照：{benchmarkStates[b.benchmarkState]}</small></td></tr>)}</tbody></table></div>
 <p>保留 {detail.history.length} 次窗口状态记录；旧状态不覆盖。采集计划不赋予独立前向评估资格。</p></div>}
 </details></section>;
}
