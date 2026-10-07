import SemanticEvents from './SemanticEvents';
import React,{useEffect,useState} from 'react';
import {Button,Modal} from '../major/Primitives';
import {request,time} from '../major/api';
import './event-continuity.css';

import {eventLinkKinds as kinds,eventLinkStates as states,priorityLabels} from '../../shared/event-labels.mjs';

export default function EventContinuity({initialSemantic=false,onClose,onNews,onTopic,mutate,busy}){
 const [semantic,setSemantic]=useState(initialSemantic);
 const [filter,setFilter]=useState('pending'),[q,setQ]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[data,setData]=useState(null),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[notes,setNotes]=useState({}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{let live=true;setLoading(true);setError('');request(`/api/events?${new URLSearchParams({state:filter,q:search,offset,limit:30})}`).then(r=>{if(live){setData(r);setSelected(id=>r.items.some(i=>i.id===id)?id:r.items[0]?.id||'');}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[filter,search,offset,refresh]);
 useEffect(()=>{let live=true;setDetail(null);if(selected)request(`/api/events/${selected}`).then(r=>{if(live)setDetail(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[selected,refresh]);
 const note=notes[selected]||'';
 const setNote=value=>setNotes(previous=>({...previous,[selected]:value}));
 const row=data?.items.find(c=>c.id===selected),item=detail&&row?{...row,...detail}:null;
 async function decide(state){if(!item)return;const result=await mutate(`/api/events/${item.id}`,'POST',{state,note,version:item.decisionVersion});if(result)setRefresh(n=>n+1);}
 if(semantic)return <Modal title="Codex 事件语义比较" onClose={onClose}><SemanticEvents initialPair={item?.type==='news'?{left:item.left,right:item.right}:null} onBack={()=>setSemantic(false)}/></Modal>;
 return <Modal title="事件追踪 · 增量与历史召回" onClose={onClose}><section className="event-continuity" aria-label="事件追踪">
 <Button onClick={()=>setSemantic(true)}>Codex 语义比较</Button>
 <p className="m-note">自动发现重复、进展和反向变化；核对后可保留关联或排除，随时撤销。关联用于组织线索，证据作用仍在研判时指定。</p>
 <form className="event-search" onSubmit={e=>{e.preventDefault();setSearch(q);setOffset(0);setRefresh(n=>n+1);}}><label>检索事件或公司<input value={q} maxLength={120} onChange={e=>setQ(e.target.value)} placeholder="标题关键词 / 股票代码"/></label><label>线索状态<select aria-label="线索状态" value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);}}>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><Button type="submit" disabled={loading}>检索 / 刷新</Button></form>
 {data?.health?.state==='error'&&<p className="m-warning" role="alert">事件索引更新失败：{data.health.error}。保留上次候选；后台会重试，新闻与持仓仍可查看。</p>}
 {error&&<p className="m-warning" role="alert">{error}</p>}
 {data&&<div className="event-coverage"><span>待复核 <b>{data.counts.pending}</b> · 已关联 {data.counts.linked} · 已排除 {data.counts.dismissed}</span><span>已索引 {data.coverage.newsIndexed}/{data.coverage.newsTotal} 条 · 研究 {data.coverage.topicsIndexed}/{data.coverage.topicsTotal} 个</span><small>新闻配对窗口 {data.coverage.newsPairWindowDays} 天；每条主动召回最多 {data.coverage.newsMatchesPerNews} 条新闻与 {data.coverage.topicMatchesPerNews} 个研究候选。未命中仍可从完整新闻库研判。</small></div>}
 <div className="event-workspace" aria-busy={loading}><div className="event-results" aria-label="召回线索列表">{data?.items.map(c=><button key={c.id} aria-pressed={c.id===selected} onClick={()=>setSelected(c.id)}><span className={`event-priority ${c.priority.level}`}>{priorityLabels[c.priority.level]}</span><small>{kinds[c.kind]} · {states[c.state]}</small><strong>{c.left.title}</strong><p>↳ {c.type==='topic'?'研究：':''}{c.right.title}</p><small>本版可用 {time(c.left.availableAt)}</small></button>)}{!loading&&!data?.items.length&&<p className="m-note">没有匹配线索。可切换状态或检索词；来源尚无数据时，从“数据源”启用采集。</p>}</div>
 <div className="event-detail" aria-label="线索核对详情">{item?<>
 <header><span>{kinds[item.kind]}</span><h3>{item.left.title}</h3><p>当前为{states[item.state]} · 规则 {item.ruleVersion} · 决定 v{item.decisionVersion}</p></header>
 <div className="event-priority-reasons"><strong>{priorityLabels[item.priority.level]}</strong>{item.priority.reasons.map(r=><p key={r}>{r}</p>)}<small>这是复核顺序；重大性、消息成真概率和交易方向尚待评估。</small></div>
 <h4>为什么召回这条历史</h4><ul>{item.reasons.map(r=><li key={r}>{r}</li>)}</ul>
 <div className="event-pair"><article><small>新线索 · v{item.left.revision}</small><h4>{item.left.title}</h4><p>{item.left.stage}</p><p>发布 {time(item.left.publishedAt)}<br/>本版可用 {time(item.left.availableAt)}</p><Button disabled={busy} onClick={()=>onNews(item.left.id)}>研判这条新闻</Button></article><article><small>{item.type==='topic'?`既有研究 · v${item.right.version}${item.right.status==='archived'?' · 已归档':''}`:`历史报道 · v${item.right.revision}`}</small><h4>{item.right.title}</h4>{item.right.stage&&<p>{item.right.stage}</p>}{item.right.availableAt&&<p>发布 {time(item.right.publishedAt)}<br/>本版可用 {time(item.right.availableAt)}</p>}<Button disabled={busy} onClick={()=>item.type==='topic'?onTopic(item.right.id):onNews(item.right.id)}>{item.type==='topic'?'打开已有研究':'研判历史报道'}</Button></article></div>
 <h4>来源家族与转载</h4><p>{item.originFamilies.join(' · ')||'未知'} · 独立取证数量未核实</p><p className="m-note">{item.left.origin.label}（{item.left.origin.basis}）。同一来源的多条报道不增加独立证据数；聚合平台不是原始取证来源。</p>
 <form className="m-form" onSubmit={e=>e.preventDefault()}><label>关联 / 排除依据<textarea aria-label="线索决定依据" value={note} maxLength={1200} onChange={e=>setNote(e.target.value)} placeholder="例如：对应同一交易的回应；或属于另一笔交易，因此排除。"/></label><div className="event-actions">{item.state!=='linked'&&<Button primary disabled={busy||!note.trim()||!item.current} onClick={()=>decide('linked')}>保留为相关线索</Button>}{item.state!=='dismissed'&&<Button disabled={busy||!note.trim()||!item.current} onClick={()=>decide('dismissed')}>排除关联</Button>}{item.state!=='pending'&&<Button disabled={busy||!note.trim()||!item.current} onClick={()=>decide('pending')}>撤销决定，重新复核</Button>}</div></form>
 {!!item.history.length&&<details open><summary>决定记录 · {item.history.length}</summary>{item.history.map(h=><p key={h.version}>v{h.version} · {states[h.state]} · {time(h.at)}<br/>{h.note}</p>)}</details>}
 {!!item.previousDecisions?.length&&<details><summary>旧输入的决定 · {item.previousDecisions.length}</summary>{item.previousDecisions.map(p=><div key={p.id}><strong>新闻 v{p.leftRevision} / {p.topicVersion?`研究 v${p.topicVersion}`:`报道 v${p.rightRevision}`}</strong>{p.history.map(h=><p key={h.version}>{states[h.state]} · {time(h.at)} · {h.note}</p>)}</div>)}<p className="m-note">输入修订后重新复核，旧决定不自动沿用。</p></details>}
 <details><summary>已索引的新闻修订 · {item.revisions.length}</summary>{item.revisions.map(r=><p key={`${r.id}:${r.revision}:${r.version}`}>v{r.revision} · 本版可用 {time(r.availableAt)}<br/>{r.title}</p>)}</details>
 </>:<p className="m-note">{selected?'正在读取线索与历史…':'选择一条线索，查看事件变化、来源和处理记录。'}</p>}</div></div>
 <div className="source-pagination"><span>{data?.total||0} 条匹配 · 第 {Math.floor(offset/30)+1} 页</span><Button disabled={loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-30))}>上一页</Button><Button disabled={loading||!data||offset+30>=data.total} onClick={()=>setOffset(n=>n+30)}>下一页</Button></div>
 </section></Modal>;
}
