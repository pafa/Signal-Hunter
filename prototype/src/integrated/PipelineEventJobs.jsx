import OccurrenceRecallCoverage from './OccurrenceRecallCoverage';
import React from 'react';
import {Button} from '../major/Primitives';
const labels={queued:'等待调用',running:'生成中',candidate:'待复核候选',adopted:'已采纳草稿',failed:'失败待处理',interrupted:'中断待处理',cancelled:'已取消',invalidated:'依据变化已保留',completed:'系统处理完成',observing:'继续观察','no-signal':'未发现具体事项'};
export default function PipelineEventJobs({jobs,enabled,busy,onChange}){
 return <details>
  <summary>事项拆分与续写 · {Object.entries(jobs.counts).map(([s,n])=>`${labels[s]||s} ${n}`).join(' · ')||'尚无计划'}</summary>
  <p className="m-note">{jobs.items.some(j=>j.automatic)?'自动模式依次处理正文、事项、公司身份和五章研判。未知项进入观察；系统判断不等于人工核实。':'候选模式：需先选择材料事项，后续生成研判候选。'}启用上方选项后，新入队新闻会生成最多12个事项候选。自动模式遍历本次全部有效事项，命中项每批3项自动续查；候选模式仍从最近500项召回并选最多3项。未选择、排除和空结果均保留；系统研判不会创建或批准订单。</p>
  {jobs.items.map(job=><article key={job.id}>
   <h4>{job.kind==='extract'?'材料拆分':job.kind==='identity'?'公司身份识别':'事项研判'} · <a href={`/?topic=${encodeURIComponent(job.topicId)}`}>{job.title}</a></h4>
   <p>{labels[job.status]||job.status}{job.automatic?' · 系统处理':''}{job.stale?' · 输入已变化，请核对原记录':''}{job.eventCount!==null&&job.eventCount!==undefined?` · ${job.eventCount} 个事项候选`:''}</p>
   <OccurrenceRecallCoverage coverage={job.relationCoverage}/>
   {job.unresolved?.map(m=><p key={m.mentionIndex}>{m.name} · {m.reason}</p>)}
   {job.reason&&<p>{job.reason}</p>}
   {job.eventCount===0&&<p>本次未发现可支持的具体事项，保留此结果供复核。</p>}
   {['failed','cancelled','interrupted'].includes(job.status)&&<Button disabled={busy||!enabled||!onChange||job.stale} onClick={()=>onChange('retry-event',{id:job.id})}>重试事项调用</Button>}
  </article>)}
  <p className="m-note">最近显示30项，完整计划、模型记录与历次调用留库。与自动研究共用额度；事项选项只影响后续入队，调用上限立即生效；暂停任务停止后续调用。</p>
 </details>;
}
