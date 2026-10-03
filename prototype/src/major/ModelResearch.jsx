import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time} from './api';
import ResearchDossier from './ResearchDossier';
import './model-research.css';

const states={running:'生成中',candidate:'待复核候选',adopted:'已采纳为草稿',failed:'生成失败',cancelled:'已取消',interrupted:'运行中断'};
export default function ModelResearch({topic,busy,mutate}){
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),base=`/api/research/${topic.id}/model-runs`;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  let current=true,timer;
  async function load(){try{const next=await request(base);if(!current)return;setData(next);setSelected(id=>id||next.runs[0]?.id||'');if(next.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);}catch(e){if(current)setError(e.message);}}
  void load();return()=>{current=false;clearTimeout(timer);};
 },[base,topic.version,refresh]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{
  let current=true;setDetail(null);if(selected)request(`${base}/${selected}`).then(value=>{if(current)setDetail(value);}).catch(e=>{if(current)setError(e.message);});
  return()=>{current=false;};
 },[base,selected,selectedState,refresh]);
 async function act(action){
  setWorking(true);setError('');
  try{
   if(action==='generate'){const run=await request(base,'POST',{version:topic.version});if(alive.current)setSelected(run.id);}
   else if(action==='cancel')await request(`${base}/${selected}/cancel`,'POST',{});
   else{const updated=await mutate(`${base}/${selected}/adopt`,'POST',{version:topic.version});if(!updated)return;}
   if(alive.current)setRefresh(n=>n+1);
  }catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setWorking(false);}
 }
 const running=data?.runs.some(r=>r.status==='running'),stale=detail&&detail.packet.input.topicVersion!==topic.version,candidate=detail?.candidate;
 return <section className="model-research" aria-label="Codex 研判">
  <div className="model-research-heading"><div><h3>用 Codex 生成研判</h3><p className="m-note">把当前事件的材料交给本机已登录的 Codex 分析，结果先作为候选供你复核。</p></div><Button primary disabled={busy||working||running||!data?.enabled||topic.status==='archived'} onClick={()=>act('generate')}>{running?'Codex 正在研判…':'使用 Codex 生成候选'}</Button></div>
  <p className="m-note">{data?.enabled?<>当前模型 {data.model} · 将通过 Codex 发送本事件的材料，使用当前账号额度；并非离线推理。只分析已有材料，不自动补采或批准交易。</>:data?'当前未启用 Codex 研判。需在研究实例中配置本机 Codex；离线演示不会调用模型。':'正在读取模型状态…'}</p>
  {error&&<p role="alert" className="m-warning">{error}</p>}
  <div className="model-research-controls"><label>生成记录<select aria-label="Codex 生成记录" value={selected} onChange={e=>setSelected(e.target.value)} disabled={!data?.runs.length}><option value="">{data?.runs.length?'选择一份候选':'尚无生成记录'}</option>{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · v{r.topicVersion} · {states[r.status]||r.status}</option>)}</select></label><Button disabled={working} onClick={()=>{setError('');setRefresh(n=>n+1);}}>刷新记录</Button></div>
  {selected&&!detail?<p className="m-note">正在读取候选…</p>:detail&&<>
   <p role="status" className="m-note">{states[detail.status]} · 基于研究 v{detail.packet.input.topicVersion}{detail.status==='adopted'?` · 已保存为 v${detail.acceptedVersion}`:''}</p>
   {detail.status==='running'&&<div className="model-research-actions"><span>可离开此页后返回查看进度。关闭服务会取消本次调用。</span><Button disabled={working} onClick={()=>act('cancel')}>取消本次生成</Button></div>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}。原研究未改动；可检查后重新生成。</p>}
   {candidate&&<>
    {stale&&detail.status==='candidate'&&<p className="m-warning">当前研究已更新到 v{topic.version}，这份候选基于旧版本，不能直接采纳；请重新生成。</p>}
    <ResearchDossier topic={{...detail.packet.input,version:detail.packet.input.topicVersion,dossier:{sections:candidate.sections,reviewStatus:'draft',preparedBy:`Codex · ${candidate.trace.model} · 未经本人复核`,preparedAt:candidate.trace.finishedAt,basedOnResearchVersion:detail.packet.input.topicVersion}}}/>
    {candidate.missingEvidence.length>0&&<div className="model-missing"><h4>还需要核验</h4><ul>{candidate.missingEvidence.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    <details className="model-trace"><summary>本次生成依据</summary><p>模型 {candidate.trace.model} · {candidate.trace.effort} · {candidate.trace.cliVersion}<br/>材料指纹 {candidate.trace.inputHash}<br/>提示词版本 {candidate.trace.promptVersion} · 生成于 {time(candidate.trace.finishedAt)}</p></details>
    {detail.status==='candidate'&&<div className="model-research-actions"><p className="m-note">采纳后保存为新的研判草稿，原版本保留在历史中；你仍可编辑并完成核对。</p><Button primary disabled={busy||working||stale} onClick={()=>act('adopt')}>采纳为研判草稿</Button></div>}
   </>}
  </>}
 </section>;
}
