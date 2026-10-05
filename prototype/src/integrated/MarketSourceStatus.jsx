import React from 'react';
import './market-source-status.css';
const sources={'yahoo-public-chart':'Yahoo 公共图表','eastmoney-public':'东方财富公共来源','synthetic-demo':'虚构演示'};
const states={missing:'缺少有效数据',aligned:'收盘日期已对齐',lagging:'落后应有交易日',ahead:'收盘日期异常',unknown:'交易日历待核验',stale:'数据已过期',future:'数据时点异常：晚于当前时间','calendar-unknown':'交易日历未覆盖','recent-unverified':'时点较近，实时性未核验','closed-session-cache':'休市或暂停交易，保留上一时段缓存','time-unverified':'数据时区或时间格式未核验',synthetic:'合成演示数据',unverified:'数据有效性待核验'};
const requests={offline:'离线演示，不请求外部来源',failed:'上次请求失败','last-attempt-succeeded':'上次请求成功','not-attempted':'尚无请求记录'};
const failures={'daily-regression':'来源有效日线倒退，已留档并保留旧缓存',timeout:'请求超时',network:'网络连接失败',http:'上游HTTP错误','empty-response':'来源返回空响应',format:'响应格式异常','no-data':'未返回有效数据','invalid-data':'数据标识、时区或内容异常','all-sources-failed':'主源与备用源均失败'};
const sourceName=value=>sources[value]|| (value?'来源名称待核验':'未记录');
const stamp=value=>{if(!value)return '未记录';const date=new Date(value);return Number.isFinite(+date)?date.toISOString().replace('T',' ').replace('.000Z','Z').replace(/Z$/,' UTC'):'时间格式待核验';};
function Channel({value,title}){
 const d=value?.diagnostics;
 if(!d)return <section className="market-source-channel"><h4>{title}</h4><p>尚无详细诊断记录</p></section>;
 return <section className="market-source-channel" aria-label={`${title}来源诊断`}><h4>{title}</h4><p className="market-source-state"><b>{requests[d.sourceState]||'请求状态待核验'}</b> · {states[d.dataState]||'数据状态待核验'}</p>
 <dl><dt>缓存来源</dt><dd>{sourceName(d.source)}</dd><dt>最近尝试</dt><dd>{stamp(d.attemptedAt)}</dd><dt>最近成功</dt><dd>{stamp(d.lastSuccessfulAt)}</dd><dt>缓存接收</dt><dd>{stamp(d.receivedAt)}</dd><dt>{title==='日线'?'最近收盘日':'数据时点'}</dt><dd>{d.dataAt?(title==='日线'?d.dataAt:stamp(d.dataAt)):'未核验 / 缺失'}</dd><dt>供应商时区</dt><dd>{d.providerTimezone||'未核验'}</dd><dt>交易所时区</dt><dd>{d.marketTimezone||'未核验'}</dd><dt>市场状态</dt><dd>{d.marketState||'待核验'}</dd><dt>本次更新</dt><dd>{d.noNewBar===true?'请求成功，但未增加新bar':d.noNewBar===false?'已获取新的bar时点':'未记录'}</dd></dl>
 {d.dailyCoverage&&<p className="m-note">应有收盘日：{d.dailyCoverage.expectedDate||'未核验'} · {d.dailyCoverage.label}。不使用盘中报价补齐日线。</p>}
 {d.dataState==='time-unverified'&&<p className="m-note">原始时间未转换；无法确认数据年龄。</p>}
 {d.failure&&<div className="market-source-failure"><b>失败原因：{failures[d.failure.kind]||'来源失败，原因待核验'}</b>{d.failure.attempts?.map((failure,i)=><p key={i}>{sourceName(failure.source)}：{failures[failure.kind]||'原因待核验'}</p>)}<p>保留已有缓存；请求失败不改变缓存的数据时点。</p></div>}
 </section>;
}
export default function MarketSourceStatus({capabilities=[]}){
 return <section aria-label="证券行情来源诊断"><h3>证券行情来源与数据时点</h3><p className="m-note">行情仅供研究观察，实时性与成交能力均未验证。bar收盘价不是可执行报价；请求成功不代表新数据，休市不代表来源恢复。以下时间明确按UTC显示，收盘日按交易所日期显示。</p>
 {!capabilities.length&&<p>尚无关注证券或行情诊断记录；缺失数据不补造价格。</p>}
 {capabilities.map(c=><article className="market-source-card" key={c.symbol}><h4>{c.symbol}</h4><div className="market-source-grid"><Channel value={c.daily} title="日线"/><Channel value={c.minutes} title="分钟"/></div><p className="market-source-execution">执行能力未验证 · 不提供可成交报价</p></article>)}
 </section>;
}
