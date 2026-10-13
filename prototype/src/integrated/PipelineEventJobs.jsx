import PipelineResearchLinks from './PipelineResearchLinks';
import {marketDataStateName} from './MarketSourceStatus';
import OccurrenceRecallCoverage from './OccurrenceRecallCoverage';
import React from 'react';
import {Button} from '../major/Primitives';
const labels={reused:'沿用已有研究','waiting-source':'等待同一正文研究',queued:'等待调用',running:'生成中',candidate:'待复核候选',adopted:'已采纳草稿',failed:'失败待处理',interrupted:'中断待处理',cancelled:'已取消',invalidated:'依据变化已保留',completed:'系统处理完成',observing:'继续观察','no-signal':'未发现具体事项'};
export default function PipelineEventJobs({jobs,enabled,busy,onChange}){
 return <details>
  <summary>事项拆分与续写 · {Object.entries(jobs.counts).map(([s,n])=>`${labels[s]||s} ${n}`).join(' · ')||'尚无计划'}</summary>
  <p className="m-note">{jobs.items.some(j=>j.automatic)?'自动模式依次处理正文、事项、公司身份和五章研判。未知项进入观察；系统判断不等于人工核实。':'候选模式：需先选择材料事项，后续生成研判候选。'}启用上方选项后，新入队新闻会生成最多12个事项候选。自动模式遍历本次全部有效事项，命中项每批3项自动续查；候选模式仍从最近500项召回并选最多3项。未选择、排除和空结果均保留；系统研判不会创建或批准订单。</p>
  {jobs.items.map(job=><article key={job.id}>
   <h4>{job.kind==='extract'?'材料拆分':job.kind==='identity'?'公司身份识别':job.documentFollowup?'附件补读后更新研判':'事项研判'} · <a href={`/?topic=${encodeURIComponent(job.topicId)}`}>{job.title}</a></h4>
   <p>{labels[job.status]||job.status}{job.automatic?' · 系统处理':''}{job.stale?' · 输入已变化，请核对原记录':''}{job.eventCount!==null&&job.eventCount!==undefined?` · ${job.eventCount} 个事项候选`:''}</p>
   <OccurrenceRecallCoverage coverage={job.relationCoverage}/>
   {job.unresolved?.map(m=><p key={m.mentionIndex}>{m.name} · {m.reason}</p>)}
   {job.reason&&<p>{job.reason}</p>}
   <PipelineResearchLinks results={job.researchResults}/>
   {job.duplicateOf&&<p className="m-note"><a href={`/?topic=${encodeURIComponent(job.duplicateOf.topicId)}`}>查看共用来源记录</a> · 同一已归档正文，不是独立佐证。</p>}
   {job.documentFollowup&&<p className="m-note">在原研究 v{job.documentFollowup.baseVersion} 后追加；旧判断和补读请求保留。</p>}
   {job.documentPreparation&&<p className="m-note">{job.documentPreparation.reason} · 已尝试 {job.documentPreparation.attempts} 次</p>}
   {job.prices&&<details><summary>研究价量准备 · 已处理 {job.prices.results.length} 项</summary>{job.prices.results.map(r=><p key={r.symbol+':'+r.interval}>{r.symbol} · {r.interval==='1d'?'日线':'分钟'} · {r.status==='saved'?'已保存本次快照':'保留缺口，继续研究'}{r.dataAt?' · 数据时点 '+r.dataAt:''}{r.receivedAt?' · 获取 '+r.receivedAt:''}{r.dataState?' · 读取时：'+marketDataStateName(r.dataState):''}{r.reason?' · '+r.reason:''}</p>)}<p className="m-note">读取尝试 {job.prices.attempts.filter(r=>r.state==='started').length} 次；每种周期最多 3 次，失败后台退避。公开价量不证明实时或可成交。</p></details>}
   {job.financial&&<details><summary>官方财务补证 · 已处理 {job.financial.results.length} 家</summary><p className="m-note">在原事项中补充财务背景；来源选摘不证明事件影响或交易可行性。</p>{job.financial.results.map(r=><div key={r.symbol}><p>{r.symbol} · {({saved:'已保存财务选摘',unavailable:'来源未完成，继续研究',unsupported:'本市场暂未覆盖'})[r.status]}{r.reason?' · '+r.reason:''}</p>{r.filings?.map(f=><p className="m-note" key={f.url}>{f.form||'申报目录'} · {f.status==='saved'?'原件已留存，研判读取选段':'原件未完成'} · {f.reason}</p>)}</div>)}<p>读取尝试 {job.financial.attempts.filter(r=>r.state==='started').length} 次；失败与历史记录保留。</p></details>}
   {job.eventCount===0&&<p>本次未发现可支持的具体事项，保留此结果供复核。</p>}
   {['failed','cancelled','interrupted'].includes(job.status)&&<Button disabled={busy||!enabled||!onChange||job.stale} onClick={()=>onChange('retry-event',{id:job.id})}>重试事项调用</Button>}
  </article>)}
  <p className="m-note">最近显示30项，完整计划、模型记录与历次调用留库。与自动研究共用额度；事项选项只影响后续入队，调用上限立即生效；暂停任务停止后续调用。</p>
 </details>;
}
