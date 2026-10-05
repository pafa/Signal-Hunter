import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {request,time,currentInstanceId} from './api';
import useEditorDraft from './useEditorDraft';
import {validateDossierSections} from '../../shared/research-dossier.mjs';
import ResearchDossier from './ResearchDossier';
import MaterialityReview from './MaterialityReview';
import './model-research.css';

const states={running:'生成中',candidate:'待复核候选',adopted:'已采纳为草稿',failed:'生成失败',cancelled:'已取消',interrupted:'运行中断'};
const emptyRequest=()=>({requestId:'',selectedId:'',selectionGeneration:0});
const validRequest=v=>v&&typeof v.requestId==='string'&&(!v.requestId||/^[-a-zA-Z0-9]{16,80}$/.test(v.requestId))&&typeof v.selectedId==='string'&&Number.isSafeInteger(v.selectionGeneration)&&v.selectionGeneration>=0;
function validSummary(run,topicId){
 return run&&typeof run.id==='string'&&run.id.length>0&&run.id.length<=80&&run.topicId===topicId&&Number.isSafeInteger(run.topicVersion)&&run.topicVersion>0&&/^[a-f0-9]{64}$/.test(run.inputHash||'')&&Object.hasOwn(states,run.status);
}
function validateRecord(run,topicId,id){
 const input=run?.packet?.input;
 if(run?.id!==id||run?.topicId!==topicId||input?.topicId!==topicId||!Number.isSafeInteger(input.topicVersion)||input.topicVersion<1||!Array.isArray(input.evidence)||!/^[a-f0-9]{64}$/.test(run.packet.inputHash||'')||!Object.hasOwn(states,run.status))throw new Error('未能核对研判记录，请刷新重试');
 if(['candidate','adopted'].includes(run.status)&&!run.candidate||run.status==='adopted'&&run.acceptedVersion!==input.topicVersion+1)throw new Error('未能核对研判记录，请刷新重试');
 if(run.candidate){
  const c=run.candidate;
  validateDossierSections(c.sections,input.evidence);
  const reviews=c.materialityReviews,targets=input.materialityReview?.targets;
  if(!Array.isArray(c.missingEvidence)||c.missingEvidence.some(v=>typeof v!=='string')||c.trace?.inputHash!==run.packet.inputHash||c.trace?.topicId!==topicId||c.trace?.topicVersion!==input.topicVersion||c.trace?.model!==run.model||reviews!==undefined&&(!Array.isArray(reviews)||reviews.some(v=>!v||typeof v.targetId!=='string'||typeof v.reason!=='string'||!Array.isArray(v.citations)||v.citations.some(c=>!c||typeof c.quote!=='string')))||reviews?.length&&(!Array.isArray(targets)||targets.some(t=>!t||typeof t.id!=='string')))throw new Error('未能核对研判记录，请刷新重试');
 }
 return run;
}
function adoptedReceipt(updated,run){
 const topic=updated?.research?.topics?.find(t=>t.id===run.topicId),dossier=topic?.dossier,version=run.packet.input.topicVersion+1;
 return topic?.version===version&&dossier?.reviewStatus==='draft'&&dossier.basedOnResearchVersion===version&&dossier.sourceModelRun?.id===run.id&&Object.entries(run.candidate.trace).every(([key,value])=>JSON.stringify(dossier.sourceModelRun[key])===JSON.stringify(value))&&JSON.stringify(dossier.sections)===JSON.stringify(validateDossierSections(run.candidate.sections,run.packet.input.evidence))&&JSON.stringify(dossier.missingEvidence)===JSON.stringify(run.candidate.missingEvidence)&&(!run.candidate.materialityReviews?.length||JSON.stringify(dossier.materialityReview?.checks)===JSON.stringify(run.candidate.materialityReviews));
}
export default function ModelResearch(props){
 const instance=props.instanceId??currentInstanceId();
 return <ModelResearchBody key={JSON.stringify([instance,props.topic.id,props.topic.createdAt||''])} {...props} instance={instance}/>;
}
function ModelResearchBody({topic,busy,mutate,instance}){
 const [data,setData]=useState(null),[detail,setDetail]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false),[refresh,setRefresh]=useState(0),[listVersion,setListVersion]=useState(0),[detailVersion,setDetailVersion]=useState(0);
 const selection=useEditorDraft(topic,'model-research-selection',()=>({id:''}),v=>typeof v?.id==='string',instance);
 const generation=useEditorDraft(topic,'model-research-generation',emptyRequest,validRequest,instance);
 const selected=selection.draft.value.id,selectionRef=useRef(selection),generationRef=useRef(generation),alive=useRef(true),flight=useRef(false),ready=useRef(false),base=`/api/research/${topic.id}/model-runs`;
 selectionRef.current=selection;generationRef.current=generation;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function confirmGeneration(run,submitted){
  if(!validSummary(run,topic.id)||run.topicVersion!==submitted.base||run.requestId!==submitted.value.requestId)throw new Error('未能核对研判生成回执；原请求保留，请刷新记录后重试');
  const ack=generation.ack(submitted,emptyRequest(),submitted.base),current=selectionRef.current;
  if(alive.current&&!ack.retained&&current.draft.generation===submitted.value.selectionGeneration&&current.draft.value.id===submitted.value.selectedId)current.change({id:run.id});
  return ack;
 }
 useEffect(()=>{
  let current=true,timer;setListVersion(0);
  async function load(){try{
   const next=await request(base);if(!current)return;
   if(typeof next?.enabled!=='boolean'||!Array.isArray(next.runs)||next.runs.some(r=>!validSummary(r,topic.id)))throw new Error('未能核对研判记录列表，请刷新重试');
   setData(next);setListVersion(topic.version);
   const pending=generationRef.current.draft,match=pending.dirty&&next.runs.find(r=>r.requestId===pending.value.requestId);
   if(match)confirmGeneration(match,pending);
   else if(!selectionRef.current.draft.value.id&&next.runs[0])selectionRef.current.change({id:next.runs[0].id});
   if(next.runs.some(r=>r.status==='running'))timer=setTimeout(load,3000);
  }catch(e){if(current){setListVersion(0);setError(e.message);}}}
  void load();return()=>{current=false;clearTimeout(timer);};
 },[base,topic.version,refresh]);
 const selectedState=data?.runs.find(r=>r.id===selected)?.status;
 useEffect(()=>{
  let current=true;ready.current=false;setDetailVersion(0);setDetail(old=>old?.id===selected?old:null);
  if(selected)request(`${base}/${selected}`).then(value=>{if(current){setDetail(validateRecord(value,topic.id,selected));setDetailVersion(topic.version);ready.current=true;}}).catch(e=>{if(current){ready.current=false;setDetailVersion(0);setError(e.message);}});
  return()=>{current=false;};
 },[base,selected,selectedState,refresh,topic.version]);
 const locked=busy||working,listReady=listVersion===topic.version,detailReady=detail?.id===selected&&detailVersion===topic.version&&ready.current;
 const pending=generation.draft.dirty&&!!generation.draft.value.requestId,requestStale=pending&&generation.draft.base!==topic.version;
 const running=data?.runs.some(r=>r.status==='running'),stale=detail&&detail.packet.input.topicVersion!==topic.version,candidate=detail?.candidate;
 const begin=()=>{if(busy||flight.current)return false;flight.current=true;setWorking(true);setError('');return true;};
 const end=()=>{flight.current=false;if(alive.current)setWorking(false);};
 const invalidate=()=>{ready.current=false;setListVersion(0);setDetailVersion(0);};
 const reload=()=>{invalidate();setRefresh(n=>n+1);};
 async function act(action){
  if(action==='generate'&&(!listReady||requestStale||running||!data?.enabled||topic.status==='archived'))return;
  if(action==='adopt'&&(!listReady||!detailReady||detail.status!=='candidate'||stale||topic.status==='archived'))return;
  if(action==='cancel'&&(!listReady||!detailReady||detail.status!=='running'))return;
  if(!begin())return;
  const run=detail;
  try{
   if(action==='generate'){
    const submitted=pending?generation.draft:generation.change({requestId:crypto.randomUUID(),selectedId:selection.draft.value.id,selectionGeneration:selection.draft.generation},topic.version);
    const response=await request(base,'POST',{version:submitted.base,requestId:submitted.value.requestId});
    const ack=confirmGeneration(response,submitted);if(alive.current&&!ack.retained)reload();
   }else if(action==='cancel'){
    const response=await request(`${base}/${run.id}/cancel`,'POST',{});
    if(response?.id!==run.id||response.status!=='cancelling')throw new Error('未能核对取消回执，请刷新记录');
    if(alive.current&&selectionRef.current.draft.value.id===run.id)reload();
   }else{
    const updated=await mutate(`${base}/${run.id}/adopt`,'POST',{version:run.packet.input.topicVersion});
    if(!adoptedReceipt(updated,run))throw new Error('未能核对采纳回执，请刷新记录后核对');
    if(alive.current&&selectionRef.current.draft.value.id===run.id){setDetail({...run,status:'adopted',acceptedVersion:run.packet.input.topicVersion+1});reload();}
   }
  }catch(e){if(alive.current){if(action!=='generate')invalidate();setError(e.message);}}finally{end();}
 }
 return <section className="model-research" aria-label="Codex 研判">
  <div className="model-research-heading"><div><h3>用 Codex 生成研判</h3><p className="m-note">把当前事件的材料交给本机已登录的 Codex 分析，结果先作为候选供你复核。</p></div><Button primary disabled={locked||!listReady||requestStale||running||!data?.enabled||topic.status==='archived'} onClick={()=>act('generate')}>{running?'Codex 正在研判…':pending?'重试本次生成':'使用 Codex 生成候选'}</Button></div>
  <p className="m-note">{data?.enabled?<>当前模型 {data.model} · 将通过 Codex 发送本事件的材料，使用当前账号额度；并非离线推理。只分析已有材料，不自动补采或批准交易。</>:data?'当前未启用 Codex 研判。需在研究实例中配置本机 Codex；离线演示不会调用模型。':'正在读取模型状态…'}</p>
  {pending&&<p className="m-warning">上次生成结果尚未核对；重试保留原请求，基于研究 v{generation.draft.base}。{requestStale&&<>当前研究已是 v{topic.version}，请先刷新查看原记录。</>}<Button disabled={locked} onClick={()=>{if(!locked&&!flight.current)generation.reset();}}>丢弃未确认请求并重新核对</Button></p>}
  {generation.draft.volatile&&<p className="m-warning">浏览器无法保存本次请求，刷新前请先核对生成记录。</p>}
  {error&&<p role="alert" className="m-warning">{error}</p>}
  <div className="model-research-controls"><label>生成记录<select aria-label="Codex 生成记录" value={selected} onChange={e=>{if(!locked&&!flight.current){ready.current=false;selection.change({id:e.target.value});}}} disabled={locked||!data?.runs.length}><option value="">{data?.runs.length?'选择一份候选':'尚无生成记录'}</option>{selected&&!data?.runs.some(r=>r.id===selected)&&<option value={selected}>已保存选择 · 列表范围外</option>}{data?.runs.map(r=><option key={r.id} value={r.id}>{time(r.createdAt)} · v{r.topicVersion} · {states[r.status]||r.status}</option>)}</select></label><Button disabled={locked} onClick={()=>{if(!locked&&!flight.current){setError('');reload();}}}>刷新记录</Button></div>
  {selected&&!detail?<p className="m-note">正在读取候选…</p>:detail&&<>
   <p role="status" className="m-note">{states[detail.status]} · 基于研究 v{detail.packet.input.topicVersion}{detail.status==='adopted'?` · 已保存为 v${detail.acceptedVersion}`:''}</p>
   {detail.status==='running'&&<div className="model-research-actions"><span>可离开此页后返回查看进度。关闭服务会取消本次调用。</span><Button disabled={locked||!listReady||!detailReady} onClick={()=>act('cancel')}>取消本次生成</Button></div>}
   {detail.failure&&<p className="m-warning">{detail.failure.message}。原研究未改动；可检查后重新生成。</p>}
   {candidate&&<>
    {stale&&detail.status==='candidate'&&<p className="m-warning">当前研究已更新到 v{topic.version}，这份候选基于旧版本，不能直接采纳；请重新生成。</p>}
    <ResearchDossier topic={{...detail.packet.input,version:detail.packet.input.topicVersion,dossier:{sections:candidate.sections,reviewStatus:'draft',preparedBy:`Codex · ${candidate.trace.model} · 未经本人复核`,preparedAt:candidate.trace.finishedAt,basedOnResearchVersion:detail.packet.input.topicVersion}}}/>
    {candidate.missingEvidence.length>0&&<div className="model-missing"><h4>还需要核验</h4><ul>{candidate.missingEvidence.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    <MaterialityReview review={{...detail.packet.input.materialityReview,topicVersion:detail.packet.input.topicVersion,checks:candidate.materialityReviews}} evidence={detail.packet.input.evidence}/>
    <details className="model-trace"><summary>本次生成依据</summary><p>模型 {candidate.trace.model} · {candidate.trace.effort} · {candidate.trace.cliVersion}<br/>材料指纹 {candidate.trace.inputHash}<br/>提示词版本 {candidate.trace.promptVersion} · 生成于 {time(candidate.trace.finishedAt)}</p></details>
    {detail.status==='candidate'&&<div className="model-research-actions"><p className="m-note">采纳后保存为新的研判草稿，原版本保留在历史中；你仍可编辑并完成核对。</p><Button primary disabled={locked||!listReady||!detailReady||stale||topic.status==='archived'} onClick={()=>act('adopt')}>采纳为研判草稿</Button></div>}
   </>}
  </>}
 </section>;
}
