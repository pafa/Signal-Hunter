import CrossThemeObservation from './CrossThemeObservation';
import React,{useEffect,useRef,useState} from 'react';
import MarketObservationDetails,{MarketObservationStatus} from './MarketObservationDetails';
import {Modal,Button} from '../major/Primitives';
import ObservationRules,{ObservationResults} from './ObservationRules';
import {request,time} from '../major/api';
const states={pending:'待处理',read:'已读，待处理',completed:'已完成'};
export default function ObservationInbox({data,initialTopicId,initialTodoId,busy,mutate,onClose,onTopic}){
 const [tab,setTab]=useState('inbox'),[filter,setFilter]=useState('pending'),[page,setPage]=useState(null),[pageIndex,setPageIndex]=useState(0),[loading,setLoading]=useState(false);
 const [notes,setNotes]=useState({}),[history,setHistory]=useState({}),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const sequence=useRef(0),pending=useRef(false),writing=useRef(false),queries=useRef([]),current=useRef({state:'pending'});
 async function load(query,index){
  const ticket=++sequence.current;pending.current=true;setLoading(true);setError('');
  try{const result=await request('/api/observations?'+new URLSearchParams(query));if(ticket!==sequence.current)return;
   const pinned={...query,ceiling:result.ceiling};current.current=pinned;queries.current[index]=pinned;queries.current.length=index+1;setPage(result);setPageIndex(index);
  }catch(e){if(ticket===sequence.current){setPage(null);setError(e.message);}}
  finally{if(ticket===sequence.current){pending.current=false;setLoading(false);}}
 }
 useEffect(()=>{setNotes({});setHistory({});setFilter(initialTodoId?'all':'pending');queries.current=[];current.current=initialTodoId?{state:'all',id:initialTodoId}:{state:'pending'};void load(current.current,0);return()=>{sequence.current++;pending.current=false;};},[data.runtime?.instance?.id,initialTodoId]);
 useEffect(()=>{if(page&&initialTodoId)document.getElementById('todo-'+initialTodoId)?.scrollIntoView({block:'center'});},[page,initialTodoId]);
 const rows=page?.items||[],locked=busy||loading||saving,changed=page&&data.observationInbox?.revision!==page.revision;
 async function respond(item,action){
  const draft=notes[item.id];if(pending.current||writing.current||busy||!draft?.text.trim()||draft.revision!==item.revision)return;
  writing.current=true;setSaving(true);const ticket=sequence.current;
  try{const result=await mutate(`/api/observations/${item.id}`,'POST',{revision:draft.revision,action,note:draft.text});if(ticket!==sequence.current)return;
   if(result){setNotes(n=>{if(n[item.id]!==draft)return n;const next={...n};delete next[item.id];return next;});setHistory(h=>({...h,[item.id]:null}));}
   await load(current.current,pageIndex);
  }catch(e){if(ticket===sequence.current)setError(e.message);}
  finally{writing.current=false;setSaving(false);}
 }
 return <Modal title="观察与持仓待办" onClose={onClose}><div className="observation-tabs"><Button aria-pressed={tab==='inbox'} onClick={()=>setTab('inbox')}>待办记录</Button><Button aria-pressed={tab==='rules'} onClick={()=>setTab('rules')}>设置观察条件</Button></div>{tab==='rules'?<ObservationRules data={data} initialTopicId={initialTopicId} busy={busy} mutate={mutate}/>:<><p>到期、研究更新、反证和双策略持仓风险由后台形成待办。已读不会解除风险；回执只记录处理情况，不改变研究或执行交易。</p><p>{data.observationInbox?.retention}</p><MarketObservationStatus checks={data?.observationInbox?.marketChecks}/>
 <label>待办范围<select value={filter} disabled={locked} onChange={e=>{const state=e.target.value;setFilter(state);queries.current=[];void load({state},0);}}><option value="pending">待处理（含已读）</option><option value="completed">已完成</option><option value="all">全部历史</option></select></label>
 <div className="m-form-actions"><Button aria-disabled={locked||pageIndex===0||!page} onClick={()=>{if(!locked&&!pending.current&&pageIndex>0&&page)void load(queries.current[pageIndex-1],pageIndex-1);}}>上一页待办</Button><Button aria-disabled={locked||!page?.nextCursor} onClick={()=>{if(!locked&&!pending.current&&page?.nextCursor)void load({state:filter,ceiling:page.ceiling,before:page.nextCursor},pageIndex+1);}}>下一页待办</Button><Button aria-disabled={locked} onClick={()=>{if(!locked&&!pending.current){queries.current=[];void load({state:filter},0);}}}>刷新到最新待办</Button></div>
 <p role="status">{loading?'正在读取待办':page?`第 ${pageIndex+1} 页 · 当前范围 ${page.total} 条 · 每页最多50条`:'未能读取待办'}</p><p className="m-note">翻页保留本次新待办边界，处理状态按读取时显示；刷新纳入后来新增的待办。处理说明在此弹窗内保留，关闭前请完成回执。</p>{changed&&<p className="m-warning">待办记录已有变化，可刷新查看；草稿不会自动改用新版本。</p>}
 {error&&<p role="alert">{error}</p>}{!loading&&page&&!rows.length&&<p>本页没有符合范围的待办；可返回上一页或刷新。未知日期或缺失行情不会被当作命中。</p>}
 <div aria-busy={loading}>{rows.map(item=>{const draft=notes[item.id],stale=draft&&draft.revision!==item.revision;return <section className="m-form" key={item.id} id={'todo-'+item.id} aria-label={`待办：${item.title}`}><h3>{item.title}{item.topicVersion!=null?` · v${item.topicVersion}`:''}</h3><p>{item.reason} · {states[item.state]} · {time(item.createdAt)}</p><p>{item.symbols.join(' / ')||'研究观察，无关联持仓'}</p>{item.affectedPositions?.map(p=><p key={p.lifecycleId} style={{overflowWrap:'anywhere'}}>{p.symbol} · 建仓 {time(p.openedAt)} · {p.lifecycleId}</p>)}{item.kind==='configured'&&<details><summary>查看命中时的条件与数据</summary><p>{item.input.definition.definition.join==='all'?'全部满足':'任一满足'} · 配置 v{item.input.definition.version} · {time(item.input.evaluatedAt)}</p><ObservationResults results={item.input.results}/></details>}{item.kind==='cross-theme-review'&&<CrossThemeObservation input={item.input}/>} {item.kind==='market-review'&&<MarketObservationDetails input={item.input}/>} {item.topicId&&<Button onClick={()=>onTopic(item.topicId)}>查看当前研究</Button>}
 <label>处理说明<input disabled={locked||stale} maxLength={1000} value={draft?.text||''} onChange={e=>{const text=e.target.value;setNotes(n=>({...n,[item.id]:{revision:n[item.id]?.revision??item.revision,text}}));}}/></label>
 {stale&&<p className="m-warning">待办已由 v{draft.revision} 更新为 v{item.revision}，原说明已保留，请先核对回执。<Button disabled={locked} onClick={()=>setNotes(n=>({...n,[item.id]:{...n[item.id],revision:item.revision}}))}>已核对，保留说明继续</Button><Button disabled={locked} onClick={()=>setNotes(n=>{const next={...n};delete next[item.id];return next;})}>丢弃原说明</Button></p>}
 <div className="m-form-actions">{(item.state==='completed'?['reopen']:['read','complete']).map(action=><Button key={action} disabled={locked||stale||!draft?.text.trim()} onClick={()=>void respond(item,action)}>{{read:'标记已读',complete:'记录已处理',reopen:'重新打开'}[action]}</Button>)}<Button disabled={locked} onClick={async()=>{const ticket=sequence.current;try{const receipts=await request(`/api/observations/${item.id}/receipts`);if(ticket!==sequence.current)return;setHistory(h=>({...h,[item.id]:{revision:item.revision,receipts}}));setError('');}catch(e){if(ticket===sequence.current)setError(e.message);}}}>查看回执</Button></div>{history[item.id]?.revision===item.revision&&history[item.id].receipts.map(r=><p key={r.id}>{time(r.at)} · {r.action} · {r.note}</p>)}</section>;})}</div></>}</Modal>;
}
