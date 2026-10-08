export const synthesisStates={pending:'等待综合',queued:'等待综合调用',running:'正在综合材料',completed:'综合研判已保存',historical:'历史综合研判',stale:'依据变化，等待更新',invalidated:'依据已变化',observing:'保留观察',cancelled:'本版任务已取消'};
// The chart is a union of current securities, not an invented merged company judgment.
export function eventChartTopic(row){
 const companies=new Map();
 for(const t of row.topics)for(const c of t.companies){
  if(!companies.has(c.symbol))companies.set(c.symbol,{symbol:c.symbol,name:c.name,role:'事件关联 · 事实待核',note:'各份研究可能存在分歧，详见事件综合中的公司依据'});
 }
 return {id:`event-cluster:${row.cluster.id}`,title:row.title,companies:[...companies.values()],evidence:[]};
}
