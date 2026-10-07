import NewsReading from './NewsReading';
import HistoricalRecall from './HistoricalRecall';
import ScreeningReview from './ScreeningReview';
import {relatedCandidates} from '../../shared/research-links.mjs';
import React,{useState} from 'react';
import useEditorDraft from './useEditorDraft';
import {Button} from './Primitives';
import {request,time} from './api';
import {EvidenceFields} from './ResearchForms';
export default function NewsInspector(props){return props.news?<NewsContent key={props.news.id} {...props}/>:<p className="m-note">此新闻暂未在当前列表中，请关闭后重新检索。</p>;}
function NewsContent({news:input,topics,mutate,busy,onTarget,onCreated}){
 const [historyOpen,setHistoryOpen]=useState(false);
 const [refreshed,setRefreshed]=useState(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false),news=refreshed&&refreshed.revision>=input.revision?refreshed:input;
 async function refreshNews(){setRefreshing(true);setError('');try{setRefreshed(await request(`/api/news/${news.id}`));}catch(e){setError(e.message);}finally{setRefreshing(false);}}

 const available=topics.filter(t=>t.status==='active');
 const selection=useEditorDraft({id:news.id,createdAt:news.articleFirstSeen||news.firstSeen,version:news.revision},'news-target',()=>({target:news.triage.topicHints?.find(id=>available.some(t=>t.id===id))||''}),v=>v&&typeof v.target==='string'),target=selection.draft.value.target;
 const setTarget=id=>{selection.change({target:id});if(id)onTarget(id);};
 const topic=available.find(t=>t.id===target),existing=topics.find(t=>t.sourceNewsId===news.id);
 async function create(){const result=await mutate('/api/research/from-news','POST',{newsId:news.id,newsRevision:news.revision});if(result){onTarget(result.createdTopicId);onCreated?.(result.createdTopicId);}}
 return <section className="m-panel m-detail m-news-inspector" aria-label="新闻初筛详情">
 <header className="m-topic-head"><div><h1>{news.title}</h1><p>{news.publisher||'新闻来源'} · 标题与原文入口 · v{news.revision}</p></div></header>
 <div className="m-detail-scroll"><p className="m-note">发布 {time(news.publishedAt)} · 原文首次收取 {time(news.articleFirstSeen||news.firstSeen)}<br/>本版可用 {time(news.revisionFirstSeen)} · 初筛 {time(news.processedAt)} · {news.triage.rulesVersion}</p>
 <Button type="button" disabled={busy||refreshing} onClick={refreshNews}>{refreshing?'刷新中…':'刷新新闻版本'}</Button>{error&&<p role="alert">{error}</p>}<a href={news.url} target="_blank" rel="noreferrer">打开新闻来源 ↗</a>
 <NewsReading news={news} busy={busy} mutate={mutate} onRefresh={setRefreshed}/><div className="m-triage-result"><h3>{news.triage.category}</h3><p>{news.triage.messageStatus==='rumor'?'传闻 · ':news.triage.messageStatus==='denial-reported'?'否认报道 · ':news.triage.messageStatus==='proposed'?'拟议阶段 · ':'未证实标题 · '}{news.triage.stage}</p>{news.triage.reasons?.map(r=><p key={r}>{r}</p>)}<p>量级线索：{news.triage.magnitudeHints?.join(' · ')||'标题未提供可识别数值'}；相对业务规模待核验。</p><small>仅凭标题分流，未阅读全文，也未生成买卖信号。</small></div>
 <details onToggle={e=>setHistoryOpen(e.currentTarget.open)}><summary>历史类比 · 查看同机制的更早案例</summary>{historyOpen&&<HistoricalRecall key={`${news.id}:${news.revision}`} news={news} busy={busy}/>}</details>
 <ScreeningReview news={news} mutate={mutate} busy={busy}/><div className="v9-news-create"><h3>{existing?'已有来源事件':'这是一个新的事件？'}</h3><p>保留本版标题与来源，建立观察草稿。明确命中的实体作为待核关系进入关注；未识别公司时保持为空，可继续人工补充。</p><Button primary disabled={busy} onClick={create}>{existing?'打开已有事件草稿':'从此新闻建立事件草稿'}</Button>{existing&&<small>修订标题可在下方加入已有事件；不会重复创建。</small>}</div>
 <h3>或关联到已有研究</h3><div className="source-news-list">{relatedCandidates(news,topics).map(c=><button key={c.topicId} disabled={busy} onClick={()=>setTarget(c.topicId)}><strong>{c.title}</strong><small>{c.reasons.join('；')} · 候选关联，待核对</small></button>)}</div>
 <div className="m-form"><label>关联主题<select disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}><option value="">请选择确实相关的研究</option>{target&&!topic&&<option value={target}>原目标已归档或暂不可用</option>}{available.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
 {topic&&<NewsEvidenceDraft key={`${topic.id}:${topic.createdAt||''}`} news={news} topic={topic} busy={busy} mutate={mutate}/>}
 <h3>标题提及的公司</h3>{news.triage.companies?.length?news.triage.companies.map(c=><p className="m-note" key={c.symbol}>{c.name} · {c.symbol} · {c.role}</p>):<p className="m-note">当前实体表未命中。建立事件后可人工关联确切股票代码，不推测陌生公司的上市主体。</p>}
 </div></section>;
}

function NewsEvidenceDraft({news,topic,busy,mutate}){
 const initial=()=>({newsRevision:news.revision,form:{stance:'unverified',family:'other',step:'',interpretation:''}}),editor=useEditorDraft(topic,`news-evidence:${news.id}`,initial,v=>v&&Number.isSafeInteger(v.newsRevision)&&v.newsRevision>0&&v.form&&['stance','family','step','interpretation'].every(k=>typeof v.form[k]==='string')),{draft}=editor,{form,newsRevision}=draft.value;
 const conflict=draft.base!==topic.version||newsRevision!==news.revision,attached=topic.evidence.some(e=>e.newsId===news.id&&e.newsRevision===news.revision),setForm=f=>editor.change(v=>({...v,form:typeof f==='function'?f(v.form):f}));
 return <form className="m-form" onSubmit={async e=>{e.preventDefault();if(busy||conflict||attached)return;const submitted=draft,result=await mutate(`/api/research/${topic.id}/evidence`,'POST',{...form,newsId:news.id,newsRevision,version:draft.base});if(result)editor.ack(submitted,initial(),result.research.topics.find(t=>t.id===topic.id).version);}}><p className="m-note">关联草稿按新闻和目标研究分别保留在本标签页；关闭或刷新可恢复，尚未入库。</p>{draft.volatile&&<p role="alert">会话存储不可用，关联草稿仅保留在当前页面。</p>}<fieldset className="m-editor-fields" disabled={busy}>
 {conflict&&<p role="alert" className="m-warning">草稿基于新闻 v{newsRevision} / 研究 v{draft.base}，当前为新闻 v{news.revision} / 研究 v{topic.version}。请先核对来源及研究历史，丢弃草稿后按新版重新编辑。</p>}
 <EvidenceFields topic={topic} form={form} setForm={setForm}/><div className="m-form-actions"><Button type="button" onClick={()=>editor.reset()}>丢弃新闻关联草稿并载入最新版本</Button><Button type="submit" disabled={conflict||attached}>{attached?'此版本已加入主题':'加入主题证据'}</Button></div><p className="m-note">关联不会升级为已证实；消息修订版本和实际可用时间保留。</p></fieldset></form>;
}
