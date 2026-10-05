import React from 'react';
import {Button} from '../major/Primitives';
const labels={queued:'等待调用',running:'生成中',candidate:'待复核候选',adopted:'已采纳草稿',failed:'失败待处理',interrupted:'中断待处理',cancelled:'已取消',invalidated:'依据变化需核对'};
export default function PipelineEventJobs({jobs,enabled,busy,onChange}){
 return <details>
  <summary>事项拆分与续写 · {Object.entries(jobs.counts).map(([s,n])=>`${labels[s]||s} ${n}`).join(' · ')||'尚无计划'}</summary>
  <p className="m-note">启用上方选项后，新入队新闻会生成最多12个事项候选。到来源研究的材料面板核对并选择事项，之后自动为已建立的事项生成五章研判，并从最多500项已选事项中召回跨报道线索，最多比较3项。未选择、排除和空结果均保留，不自动采纳或创建订单。</p>
  {jobs.items.map(job=><article key={job.id}>
   <h4>{job.kind==='extract'?'材料拆分':'已选事项研判'} · <a href={`/?topic=${encodeURIComponent(job.topicId)}`}>{job.title}</a></h4>
   <p>{labels[job.status]||job.status}{job.stale?' · 输入已变化，请核对原记录':''}{job.eventCount!==null&&job.eventCount!==undefined?` · ${job.eventCount} 个事项候选`:''}</p>
   {job.relationCoverage&&<p>跨报道事项召回：{job.relationCoverage.topicsIndexed}/{job.relationCoverage.topicsTotal} 项；选取 {job.relationCoverage.selectedTopics} 项比较。未命中不代表无关，结果到自动关联比较中复核。</p>}
   {job.reason&&<p>{job.reason}</p>}
   {job.eventCount===0&&<p>本次未发现可支持的具体事项，保留此结果供复核。</p>}
   {['failed','cancelled','interrupted'].includes(job.status)&&<Button disabled={busy||!enabled||!onChange||job.stale} onClick={()=>onChange('retry-event',{id:job.id})}>重试事项调用</Button>}
  </article>)}
  <p className="m-note">最近显示30项，完整计划、模型记录与历次调用留库。与自动研究共用额度；事项选项只影响后续入队，调用上限立即生效；暂停任务停止后续调用。</p>
 </details>;
}
