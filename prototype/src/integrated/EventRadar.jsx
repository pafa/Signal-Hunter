import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {eventGroups} from './event-view';

export default function EventRadar({topics,rows,overview,selected,expanded,onExpand,historyExpanded,onHistoryExpand,filters,onFilter,onSelect,onMore,onNews,onRelations,full=false}){
 const visible=new Set(topics.map(t=>t.id)),matching=rows.filter(row=>row.allTopics.some(t=>visible.has(t.id)));
 const shown=full?matching:matching.slice(0,5),current=matching.find(row=>row.allTopics.some(t=>t.id===selected));
 if(!full&&current&&!shown.includes(current))shown.splice(4,1,current);
 const events=new Map((overview?.events||[]).map(e=>[e.id,e]));
 const historyCount=matching.reduce((n,row)=>n+row.historicalTopics.filter(t=>visible.has(t.id)).length,0);
 return <aside className={`i-radar i-panel dashboard-radar ${full?'dashboard-radar-full':''}`} aria-label={full?'完整事件列表':'重大事件与变化'}>
  <div className="i-section-head"><h2>{full?'完整事件列表':'事件与重大变化'}</h2><small>{matching.length} 项 · {topics.length-historyCount} 份{historyCount?'当前':''}研究{historyCount?` · ${historyCount} 份历史`:''}</small></div>
  <details className="dashboard-filters"><summary>筛选{filters.search||filters.archived||filters.eventType!=='all'?' · 已生效':''}</summary>
   <div className="v6-radar-filters">
    <input aria-label="搜索事件或公司" placeholder="搜索事件、公司或代码…" value={filters.search} onChange={e=>onFilter('search',e.target.value)}/>
    <select aria-label="研究成熟度" value={filters.researchStage} onChange={e=>onFilter('researchStage',e.target.value)}><option value="ready">已有研究 / 当前事件</option><option value="all">包含全部候选草稿</option></select>
    <select aria-label="事件研究范围" value={filters.eventScope} onChange={e=>onFilter('eventScope',e.target.value)}><option value="all">全部研究</option><option value="holdings">与持仓相关</option><option value="recent">本轮实测</option><option value="attachments">附件研判</option><option value="examples">既有案例</option></select>
    <select aria-label="事件类型" value={filters.eventType} onChange={e=>onFilter('eventType',e.target.value)}><option value="all">全部事件类型</option>{eventGroups.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <label><input type="checkbox" checked={filters.archived} onChange={e=>onFilter('archived',e.target.checked)}/>显示归档研究</label>
   </div>
  </details>
  <div className="i-topics">{shown.map(row=>{
   const t=row.allTopics.find(t=>t.id===selected)||row.allTopics.find(t=>visible.has(t.id)),e=events.get(t.id),cluster=row.cluster;
   const matched=row.topics.filter(t=>visible.has(t.id)).length,historyMatched=row.historicalTopics.filter(t=>visible.has(t.id)).length,latest=row.topics[0],isSelected=row.allTopics.some(t=>t.id===selected),historical=row.historicalTopics.some(t=>t.id===selected);
   return <article key={row.id} className={`dashboard-event ${isSelected?'selected':''}`} aria-label={cluster?`事件：${row.title}`:undefined}>
    <button className={`i-topic ${isSelected?'selected':''}`} aria-pressed={isSelected} onClick={()=>onSelect(cluster?latest:t,cluster?'event':'member')}>
     <div><span>{row.risk?'持仓风险变化':cluster?'事件进展':t.changeSummary?.fromVersion?'研究有更新':'研究记录'}</span><small>{cluster?`归组 v${cluster.version}`:`v${t.version}`}</small></div>
     <h3>{row.title}</h3><p>{cluster?.research?.current?'事件综合：':cluster?'最近研究更新：':''}{cluster?.research?.current?cluster.research.summary:(cluster?latest:t).changeSummary?.items?.join('；')||(cluster?latest:t).summary}</p>
     <footer><span>{time(row.updatedAt)}</span><b>{row.companyCount} 公司{row.positions?` · ${row.positions} 持仓`:''}</b></footer>
     <small>{cluster?`${cluster.actor?.kind==='system'?'系统归组':'本人归组'} · ${row.topics.length} 份研究 · 事实待核`: `${e?.label||'重大性待核'} · ${t.coverage.support} 支持 / ${t.coverage.against} 反证`}</small>
     {historical&&<small className="dashboard-group-warning">正在查看历史研究</small>}
     {row.historicalRisk&&<small className="dashboard-group-warning">含历史研究关联持仓风险</small>}
     {row.groupStale&&<small className="dashboard-group-warning">原归组依据已变化，研究单独显示</small>}
    </button>
    {cluster&&<><button className="dashboard-event-expand" aria-expanded={expanded===row.id} aria-controls={`event-members-${cluster.id}`} onClick={()=>onExpand(expanded===row.id?null:row.id)}>{expanded===row.id?'收起':'展开'} {row.topics.length} 份研究{row.historicalTopics.length?` · 历史 ${row.historicalTopics.length} 份`:''}{matched<row.topics.length?` · 筛选命中 ${matched} 份当前${historyMatched?` / ${historyMatched} 份历史`:''}`:''}</button>
     {expanded===row.id&&<div className="dashboard-event-members" id={`event-members-${cluster.id}`} role="region" aria-label={`${row.title}的各份研究`}>
      <p>{cluster.research?.current?'本事件已有综合结论；此处保留各份原研究与引用。':'综合尚未完成；此处保留各份原研究与引用。'}{matched<row.topics.length?'此处显示本事件全部研究。':''}</p>
      {row.topics.map(member=><button key={member.id} aria-pressed={selected===member.id} onClick={()=>onSelect(member)}>
       <strong>{member.title}</strong><span>{member.evidence?.[0]?.sourceName||'来源待核'} · 研究 v{member.version} · {time(member.updatedAt)}</span>
       <small>{member.changeSummary?.items?.join('；')||member.summary}</small>
       {matched<row.topics.length&&visible.has(member.id)&&<em>匹配当前筛选</em>}
      </button>)}
      {!!row.historicalTopics.length&&<><button className="dashboard-history-toggle" aria-expanded={historyExpanded===row.id} aria-controls={`event-history-${cluster.id}`} onClick={()=>onHistoryExpand(historyExpanded===row.id?null:row.id)}>{historyExpanded===row.id?'收起':'查看'}历史研究 · {row.historicalTopics.length} 份</button>
       {historyExpanded===row.id&&<div className="dashboard-event-history" id={`event-history-${cluster.id}`} role="region" aria-label={`${row.title}的历史研究`}><p>已由新版接续；原研究与判断保留，不能作为当前事件结论。</p>{row.historicalTopics.map(member=>{const link=cluster.history.find(h=>h.topicId===member.id);return <button key={member.id} aria-pressed={selected===member.id} onClick={()=>onSelect(member)}><strong>{member.title}</strong><span>历史材料 v{link.materialRevision} · 研究 v{member.version}{member.status==='archived'?' · 已归档':''}</span><small>归组 v{link.clusterVersion} 接续 · {time(link.replacedAt)}</small>{events.get(member.id)?.risk&&<em>有关联持仓风险</em>}{historyMatched<row.historicalTopics.length&&visible.has(member.id)&&<em>匹配当前筛选</em>}</button>;})}</div>}
      </>}
     </div>}
    </>}
   </article>;
  })}{!shown.length&&<p className="i-note">此范围暂无研究。没有结果与采集失败是不同状态，可查看整体运行情况。</p>}</div>
  <div className="dashboard-radar-more">{!full&&<Button onClick={onMore}>查看更多事件 · {matching.length} →</Button>}<Button onClick={onNews}>完整新闻库</Button>{full&&<Button onClick={onRelations}>事件关联与历史比较</Button>}</div>
 </aside>;
}
