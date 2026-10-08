import React from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
import {eventGroups} from './event-view';

export default function EventRadar({topics,overview,selected,filters,onFilter,onSelect,onMore,onNews,onRelations,full=false}){
 const shown=full?topics:topics.slice(0,5),events=new Map((overview?.events||[]).map(e=>[e.id,e]));
 return <aside className={`i-radar i-panel dashboard-radar ${full?'dashboard-radar-full':''}`} aria-label={full?'完整事件列表':'重大事件与变化'}>
  <div className="i-section-head"><h2>{full?'完整事件列表':'事件与重大变化'}</h2><small>{topics.length} 项研究</small></div>
  <details className="dashboard-filters"><summary>筛选{filters.search||filters.archived||filters.eventType!=='all'?' · 已生效':''}</summary>
   <div className="v6-radar-filters">
    <input aria-label="搜索事件或公司" placeholder="搜索事件、公司或代码…" value={filters.search} onChange={e=>onFilter('search',e.target.value)}/>
    <select aria-label="研究成熟度" value={filters.researchStage} onChange={e=>onFilter('researchStage',e.target.value)}><option value="ready">已有研究 / 当前事件</option><option value="all">包含全部候选草稿</option></select>
    <select aria-label="事件研究范围" value={filters.eventScope} onChange={e=>onFilter('eventScope',e.target.value)}><option value="all">全部研究</option><option value="holdings">与持仓相关</option><option value="recent">本轮实测</option><option value="attachments">附件研判</option><option value="examples">既有案例</option></select>
    <select aria-label="事件类型" value={filters.eventType} onChange={e=>onFilter('eventType',e.target.value)}><option value="all">全部事件类型</option>{eventGroups.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <label><input type="checkbox" checked={filters.archived} onChange={e=>onFilter('archived',e.target.checked)}/>显示归档研究</label>
   </div>
  </details>
  <div className="i-topics">{shown.map(t=>{const e=events.get(t.id);return <button key={t.id} className={`i-topic ${selected===t.id?'selected':''}`} onClick={()=>onSelect(t)}>
   <div><span>{e?.risk?'持仓风险变化':t.changeSummary?.fromVersion?'研究有更新':'研究记录'}</span><small>v{t.version}</small></div>
   <h3>{t.title}</h3><p>{t.changeSummary?.items?.join('；')||t.summary}</p>
   <footer><span>{time(t.updatedAt)}</span><b>{t.companies.length} 公司{e?.positions?` · ${e.positions} 持仓`:''}</b></footer>
   <small>{e?.label||'重大性待核'} · {t.coverage.support} 支持 / {t.coverage.against} 反证</small>
  </button>;})}{!shown.length&&<p className="i-note">此范围暂无研究。没有结果与采集失败是不同状态，可查看整体运行情况。</p>}</div>
  <div className="dashboard-radar-more">{!full&&<Button onClick={onMore}>查看更多事件 · {topics.length} →</Button>}<Button onClick={onNews}>完整新闻库</Button>{full&&<Button onClick={onRelations}>事件关联与历史比较</Button>}</div>
 </aside>;
}
