import React from 'react';

export default function OccurrenceRecallCoverage({coverage:c}){
 if(!c)return null;
 if(!c.automatic)return <p>跨报道事项召回：{c.topicsIndexed}/{c.topicsTotal} 项；选取 {c.selectedTopics} 项比较。未命中不代表无关，结果到自动关联比较中复核。</p>;
 const counts=c.counts||{},retained=['observing','invalidated','cancelled','skipped','failed','interrupted'].reduce((n,s)=>n+(counts[s]||0),0);
 return <div className="m-note">
  <p>跨报道事项召回：{c.topicsIndexed??'未知'}/{c.topicsTotal??'未知'} 项；命中 {c.recalledTopics} 项 · 已安排 {c.selectedTopics} 项 · 待安排 {c.remainingTopics} 项。</p>
  <p>已保存判断 {counts.completed||0} · 等待比较 {counts.queued||0} · 处理中 {counts.running||0} · 保留观察或缺口 {retained}。</p>
  <p>{c.status==='invalidated'?`原范围已停止续查：${c.reason||'依据已变化，保留旧记录'}`:c.remainingTopics>0?'后台按每批 3 项继续，额度恢复后接续，无需逐项操作。':'本次范围内候选已安排；安排完成不等于比较完成。'}范围固定于本次研判；后续新事项由各自研判补充比较。词项未命中不代表无关。</p>
 </div>;
}
