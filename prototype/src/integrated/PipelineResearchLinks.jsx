import React from 'react';

// These are saved research records, never an instruction to generate or approve.
export default function PipelineResearchLinks({results}){
 if(!results)return null;
 if(results.state==='changed')return <small>结果关联依据已变化；原记录保留。</small>;
 if(results.state==='no-signal')return <small>原研究未发现具体事项。</small>;
 if(!results.items.length&&!results.unavailable)return null;
 return <div className="pipeline-research-results">
  {results.items.map(item=><small key={item.topicId}><a href={`/?topic=${encodeURIComponent(item.topicId)}`}>{item.hasDossier?'查看研判':'查看事项'} · {item.title}</a> · v{item.version}{!item.hasDossier?' · 研判尚未保存':''}</small>)}
  {results.unavailable>0&&<small>{results.unavailable} 项已归档或关联依据变化，详见原记录。</small>}
 </div>;
}
