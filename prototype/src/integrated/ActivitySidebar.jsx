import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
import {activityText,groupActivity,mergeActivity,laneNames,taskDescription} from '../../shared/activity-view.mjs';
const statuses={candidate:'候选待复核',pending:'待处理',queued:'排队中',preparing:'准备正文',ready:'等待模型',running:'生成中',failed:'失败',interrupted:'中断',invalidated:'版本失效','needs-review':'需复核'};
const kinds={all:'全部待办',model:'模型复核',pipeline:'准备与失败',observation:'观察回执',relation:'关联核对',cluster:'事件簇核对',order:'模拟审批'};
export default function ActivitySidebar({instanceId,topicId,onTodo,onRecord,onOperations}){
 const [scope,setScope]=useState('all'),[issues,setIssues]=useState(false),[state,setState]=useState(null),[items,setItems]=useState([]),[error,setError]=useState(''),[connectedAt,setConnectedAt]=useState(null),[following,setFollowing]=useState(true),[tab,setTab]=useState('log'),[kind,setKind]=useState('all'),[queue,setQueue]=useState(null),[offset,setOffset]=useState(0),[queueError,setQueueError]=useState(''),[paging,setPaging]=useState(false);
 const stream=useRef(null),cursor=useRef(null),generation=useRef(0);
 const selectedTopic=scope==='topic'?topicId:'';
 useEffect(()=>{
  let alive=true,timer;const gen=++generation.current;cursor.current=null;setItems([]);setState(null);setError('');setFollowing(true);
  async function poll(){
   try{const params=new URLSearchParams({limit:'100',issues:issues?'1':'0',...(selectedTopic?{topic:selectedTopic}:{}),...(cursor.current===null?{}:{after:String(cursor.current)})});const value=await request(`/api/activity?${params}`);
    if(!alive||gen!==generation.current)return;cursor.current=value.cursor;setItems(old=>mergeActivity(old,value.items));setState(old=>({...value,olderCursor:old?old.olderCursor:value.olderCursor}));setError('');setConnectedAt(value.serverTime);
    const active=Object.values(value.tasks).some(s=>s.running)||value.processing?.length>0;
    timer=setTimeout(poll,value.hasMore?100:active?2000:10000);
   }catch(e){if(alive&&gen===generation.current){setError(e.message);timer=setTimeout(poll,10000);}}
  }
  void poll();return()=>{alive=false;generation.current++;clearTimeout(timer);};
 },[instanceId,selectedTopic,issues]);
 useEffect(()=>{if(following&&stream.current)stream.current.scrollTop=stream.current.scrollHeight;},[items,following,tab]);
 useEffect(()=>{
  let alive=true,flight=false;async function load(){if(flight)return;flight=true;try{const value=await request('/api/workbench-queue?'+new URLSearchParams({kind,offset:String(offset),...(selectedTopic?{topic:selectedTopic}:{})}));if(alive){setQueue(value);setQueueError('');}}catch(e){if(alive)setQueueError(e.message);}finally{flight=false;}}
  setQueue(null);void load();const timer=setInterval(load,15000);return()=>{alive=false;clearInterval(timer);};
 },[instanceId,kind,offset,selectedTopic]);
 async function older(){if(paging||!state?.olderCursor)return;const gen=generation.current;setPaging(true);try{const value=await request('/api/activity?'+new URLSearchParams({before:String(items[0]?.id||state.olderCursor),limit:'100',issues:issues?'1':'0',...(selectedTopic?{topic:selectedTopic}:{})}));if(gen===generation.current){setFollowing(false);setItems(old=>mergeActivity(value.items,old));setState(old=>({...old,olderCursor:value.olderCursor}));}}catch(e){if(gen===generation.current)setError(e.message);}finally{setPaging(false);}}
 const tasks=state?.tasks||{},running=Object.entries(tasks).filter(([,s])=>s.running),next=Object.entries(tasks).filter(([,s])=>!s.paused&&!s.blocked&&!s.running&&s.nextRunAt).sort((a,b)=>a[1].nextRunAt.localeCompare(b[1].nextRunAt))[0],groups=groupActivity(items);
 return <aside className="activity-sidebar i-panel" aria-label="运行日志与待办"><details className="activity-drawer" open><summary>运行日志与待办 <span>{error?'连接中断':connectedAt?'已连接':'连接中'}</span></summary><div className="activity-content">
 <div className="activity-status" role="status"><strong>{error?'连接中断，正在重连':running.length?`执行中 · ${running.map(([k])=>laneNames[k]||k).join(' / ')}`:state?.processing?.length?'本机 Codex 正在生成':state&&Object.values(tasks).every(s=>s.paused)?'全部后台任务已暂停':'等待下一轮任务'}</strong><small>最近同步 {time(connectedAt)}</small>{state?.processing?.map(p=><div key={p.id}><b>{p.title||'模型研判'}</b><small>阶段：本机 Codex · 已运行 {Math.max(0,Math.floor((Date.parse(state.serverTime)-Date.parse(p.createdAt))/1000))} 秒；结果保存后等待本人复核</small></div>)}{next&&<small>下一步：{laneNames[next[0]]||next[0]} · {time(next[1].nextRunAt)}</small>}<Button onClick={onOperations}>控制任务 / 查看等待原因</Button></div>
 <nav className="activity-tabs" aria-label="侧栏内容"><button aria-pressed={tab==='log'} onClick={()=>setTab('log')}>运行日志</button><button aria-pressed={tab==='todo'} onClick={()=>setTab('todo')}>待办 {Object.values(queue?.counts||{}).reduce((a,b)=>a+b,0)}</button></nav>
 <label className="activity-scope">范围<select aria-label="日志与待办范围" value={scope} onChange={e=>{setScope(e.target.value);setOffset(0);}}><option value="all">全部任务</option><option value="topic" disabled={!topicId}>当前研究</option></select></label>
 {tab==='log'?<><div className="activity-tools"><label><input type="checkbox" checked={issues} onChange={e=>setIssues(e.target.checked)}/>只看异常 / 待复核</label><Button aria-pressed={following} onClick={()=>setFollowing(v=>!v)}>{following?'暂停跟随':'跟随最新'}</Button></div>{error&&<p role="alert" className="m-warning">{error} · 旧记录保留；未收到新记录不代表任务已完成。</p>}
 <div className="activity-stream" ref={stream} tabIndex={0} aria-label="连续任务记录" onScroll={e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight>60)setFollowing(false);}}><Button disabled={paging||!state?.olderCursor} onClick={()=>void older()}>加载更早记录</Button>{groups.map(item=><article key={item.ids[0]} className={`activity-line ${item.action}`}><time>{time(item.firstAt)}</time><p>{activityText(item)}</p>{item.count>1&&<small>相同检查合并显示 {item.count} 次 · 至 {time(item.at)}；原记录完整保留</small>}{(item.topicId||item.newsId||item.kind==='intake')&&<button onClick={()=>onRecord(item)}>查看对应记录 ↗</button>}</article>)}{!items.length&&!error&&<p className="m-note">{state?'此范围暂无任务记录。':'正在读取已保存记录…'}</p>}</div>
 <details className="activity-waiting"><summary>各任务的等待原因</summary>{Object.entries(tasks).map(([k,s])=><p key={k}><b>{laneNames[k]||k}</b> · {taskDescription(s)}</p>)}</details></>:<><label className="activity-scope">类型<select value={kind} aria-label="待办类型" onChange={e=>{setKind(e.target.value);setOffset(0);}}>{Object.entries(kinds).map(([k,v])=><option value={k} key={k}>{v}{k==='all'?'':` · ${queue?.counts[k]||0}`}</option>)}</select></label>{queueError&&<p role="alert">{queueError}</p>}<p className="m-note">匹配 {queue?.total??'…'} 项 · 当前页 {queue?.items.length||0} 项。这里仅打开原复核入口，不自动采纳或批准。</p><div className="activity-todos">{queue?.items.map(item=><button key={item.id} onClick={()=>onTodo(item)}><small>{kinds[item.kind]} · {statuses[item.status]||item.status}</small><strong>{item.title||'研究待办'}</strong><span>{item.reason}</span></button>)}{queue&&!queue.items.length&&<p>此范围暂无待办。</p>}</div><div className="activity-tools"><Button disabled={!offset} onClick={()=>setOffset(v=>Math.max(0,v-20))}>上一页</Button><Button disabled={queue?.nextOffset==null} onClick={()=>setOffset(queue.nextOffset)}>下一页</Button></div></>}
 </div></details></aside>;
}
