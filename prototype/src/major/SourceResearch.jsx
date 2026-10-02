import ArticleReadingScope from './ArticleReadingScope';
import PublicationDateEvidence from './PublicationDateEvidence';
import React,{useEffect,useRef,useState} from 'react';
import {Button} from './Primitives';
import {EvidenceFields} from './ResearchForms';
import {request,time,stanceNames} from './api';
import ModelResearch from './ModelResearch';
import './research-materials.css';

const scopes={'extracted-text':'网页提取正文 · 完整性待核','user-supplied-text':'人工提供正文 · 完整性未保证',excerpt:'摘录 · 仅此范围'};
export default function SourceResearch({topic,busy,mutate}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[mode,setMode]=useState('manual'),[form,setForm]=useState({url:'',title:'',sourceName:'',publishedAt:'',body:'',scope:'excerpt',stance:'unverified',family:'other',step:topic.chain[0]?.id||'',interpretation:''}),[base,setBase]=useState(topic.version),[refresh,setRefresh]=useState(0),[packet,setPacket]=useState(null),[packetBusy,setPacketBusy]=useState(false);
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let current=true;setError('');request(`/api/research/${topic.id}/materials`).then(r=>{if(current)setData(r);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[topic.id,topic.version,refresh]);
 const change=(k,v)=>setForm(f=>({...f,[k]:v}));
 async function save(e){e.preventDefault();const result=await mutate(`/api/research/${topic.id}/${mode==='web'?'read-source':'materials'}`,'POST',{...form,version:base});if(!active.current)return;setRefresh(n=>n+1);if(result){setBase(result.research.topics.find(t=>t.id===topic.id).version);setForm(f=>({...f,body:'',interpretation:''}));setPacket(null);}}
 async function makePacket(){setPacketBusy(true);setError('');try{const p=await request(`/api/research/${topic.id}/packet`);if(active.current)setPacket(p);}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setPacketBusy(false);}}
 return <div className="research-materials">
 <ModelResearch key={topic.id} topic={topic} busy={busy} mutate={mutate}/>
 <div className="source-intro"><div><h3>材料 → 研判 → 条件</h3><p>只读取当前候选需要的来源。保存材料后，在“概率与影响”和“交易假设”记录研判。</p></div><Button onClick={makePacket} disabled={busy||packetBusy}>{packetBusy?'整理中…':'生成研判材料包'}</Button></div>
 {error&&<p className="m-warning" role="alert">{error}</p>}
 {packet&&<details className="source-packet" open><summary>研判材料包 · 研究 v{packet.input.topicVersion} · {packet.inputHash.slice(0,12)}</summary><p className="m-note">包括事实、传闻、反证、公司关系、期限与买卖条件的分析要求。可复制给研究助手；生成材料包本身不会调用模型。此包固定于生成时的版本。{packet.input.topicVersion!==topic.version?' 当前研究已有更新，请重新生成。':''}</p><textarea readOnly aria-label="研判材料包" rows={9} value={JSON.stringify(packet,null,2)} onFocus={e=>e.target.select()}/></details>}
 <details className="source-add" open={!data?.materials.length}><summary>＋ 补充正文 / 公告材料</summary><nav className="source-modes" aria-label="材料导入方式">{[['manual','粘贴材料'],['web','读取公开网页']].map(([v,label])=><Button key={v} aria-pressed={mode===v} disabled={busy} onClick={()=>setMode(v)}>{label}</Button>)}</nav>
 <form className="m-form" onSubmit={save}>
 <p className="m-note">{mode==='web'?'读取公开 HTML 正文，最长等待 20 秒；付费、登录、PDF 或无法提取的来源可自行阅读后粘贴。提取成功不表示内容已证实。':'记录原文或摘录，保留其阅读范围；不要把研判意见混入来源正文。保存时仅存本机；主动调用 Codex 时会发送当前事件材料用于研判。'}</p>
 <label>来源链接{mode==='manual'?'（可选）':''}<input type="url" required={mode==='web'} maxLength={2000} value={form.url} onChange={e=>change('url',e.target.value)} placeholder="https://…"/></label>
 {mode==='manual'&&<><label>材料标题<input required maxLength={200} value={form.title} onChange={e=>change('title',e.target.value)}/></label><div className="m-form-row"><label>来源名称<input required maxLength={160} value={form.sourceName} onChange={e=>change('sourceName',e.target.value)}/></label><label>来源日期（未知可留空）<input type="date" value={form.publishedAt} onChange={e=>change('publishedAt',e.target.value)}/></label></div><label>阅读范围<select value={form.scope} onChange={e=>change('scope',e.target.value)}><option value="excerpt">部分摘录</option><option value="user-supplied-text">人工提供正文</option></select></label><label>材料正文<textarea required rows={7} maxLength={80000} value={form.body} onChange={e=>change('body',e.target.value)}/><small>{form.body.length.toLocaleString()} / 80,000 字符</small></label></>}
 <EvidenceFields topic={topic} form={form} setForm={setForm}/>
 {base!==topic.version&&<p className="m-warning">研究已从 v{base} 更新到 v{topic.version}，输入仍保留。请查看历史，再关闭并重新打开材料页。</p>}
 <div className="m-form-actions"><span>按实际获取时间入库 · 尚待核验</span><Button primary type="submit" disabled={busy||base!==topic.version}>{busy?'读取 / 保存中…':mode==='web'?'读取并保存正文':'保存材料快照'}</Button></div>
 </form></details>
 <h3>已关联材料 <small>{data?.materials.length??'…'} 份</small></h3>
 {!data?<p className="m-note">正在加载材料…</p>:!data.materials.length?<p className="m-note">目前只有已有线索，尚未保存正文材料。补充来源后可逐版复核。</p>:data.materials.map(m=><details className="source-item" key={m.id}><summary><strong>{m.title}</strong><small>材料 v{m.revision} · {scopes[m.scope]} · {stanceNames[m.stance]}</small></summary><p className="m-note">{m.sourceName} · 来源 {m.publishedAt||'日期未知'}{m.datePrecision==='day'?'（仅日期）':''}<br/>本版获取 {time(m.availableAt)} · {m.verification==='unverified'?'内容未证实':'核验状态见证据链'}</p><PublicationDateEvidence evidence={m.publicationDateEvidence} showMissing={m.scope==='extracted-text'}/><ArticleReadingScope evidence={m.extractionEvidence} showMissing={m.scope==='extracted-text'}/>{m.url&&<a href={m.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}<p className="m-note">与事件的关系：{m.interpretation}</p><pre className="source-body">{m.body}</pre><small>内容指纹 {m.contentHash.slice(0,20)} · 旧版保留</small></details>)}
 {data?.attempts.some(a=>a.state==='failed')&&<details className="source-failures" open><summary>读取失败记录</summary>{data.attempts.filter(a=>a.state==='failed').map((a,i)=><p key={`${a.at}:${i}`}><b>{time(a.at)}</b> · {a.error}<small>{a.url}</small></p>)}</details>}
 </div>;
}
