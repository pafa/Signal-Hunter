import History from './ResearchHistory';
import useEditorDraft from './useEditorDraft';
import DossierEditor from './DossierEditor';
import RelatedResearch from './RelatedResearch';
import SourceResearch from './SourceResearch';
import ClaimsEditor from './ClaimsEditor';
import ResearchDossier from './ResearchDossier';
import {CLAIM_STATES} from '../../shared/uncertainty.mjs';
import React,{useState} from 'react';
import {Button} from './Primitives';
import {time,stanceNames,verificationNames} from './api';

function HypothesisEditor({topic,busy,mutate}){
 const initial=()=>({hypothesis:topic.hypothesis,nextEvidence:topic.nextEvidence||''});
 const editor=useEditorDraft(topic,'hypothesis',initial,v=>v&&typeof v.nextEvidence==='string'&&v.hypothesis&&['logic','trigger','invalidation','industryHorizon','holdingHorizon','action','reviewAt'].every(k=>typeof v.hypothesis[k]==='string'));
 const {base,value,dirty,volatile}=editor.draft,{hypothesis:draft,nextEvidence}=value;const [saved,setSaved]=useState(false);
 const fields=[['logic','影响逻辑'],['trigger','交易触发条件'],['invalidation','反证与失效条件'],['industryHorizon','产业假设期限'],['holdingHorizon','单笔预期持有期']];
 const change=(key,value)=>{editor.change(v=>({...v,hypothesis:{...v.hypothesis,[key]:value}}));setSaved(false);};
 return <form className="m-form m-hypothesis" onSubmit={async e=>{e.preventDefault();if(busy||base!==topic.version)return;const submitted=editor.draft;const result=await mutate(`/api/research/${topic.id}`,'PATCH',{version:base,hypothesis:draft,nextEvidence});if(result){const t=result.research.topics.find(t=>t.id===topic.id);editor.ack(submitted,{hypothesis:t.hypothesis,nextEvidence:t.nextEvidence||''},t.version);setSaved(true);}}}>
 <p className="m-note">研究动作是待评估意向，保存不提交交易。未保存输入保留在本浏览器标签页，切换页面或刷新后可恢复。</p>{volatile&&<p role="alert">会话存储不可用，草稿仅保留到页面关闭，请及时保存。</p>}<fieldset className="m-editor-fields" disabled={busy}>
 {base!==topic.version&&<p className="m-warning">主题已有新版本。你的输入仍保留，请先查看版本记录；核对后可明确使用当前版本继续编辑，或丢弃草稿。</p>}
 {fields.map(([key,label])=><label key={key}>{label}<textarea value={draft[key]} maxLength={2000} onChange={e=>change(key,e.target.value)} rows={key==='logic'||key==='invalidation'?3:2}/></label>)}
 <label>下一步观察点<textarea required maxLength={2000} rows={2} value={nextEvidence} onChange={e=>{editor.change(v=>({...v,nextEvidence:e.target.value}));setSaved(false);}}/></label><div className="m-form-row"><label>拟研究动作<select value={draft.action} onChange={e=>change('action',e.target.value)}>{[['observe','继续观察'],['buy','研究买入'],['add','研究增仓'],['reduce','研究减仓'],['exit','研究清仓']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>下次复核日期<input type="date" value={draft.reviewAt} onChange={e=>change('reviewAt',e.target.value)}/></label></div>
 <div className="m-form-actions"><span>{saved&&!dirty?'已保存新版本，未提交交易申请':`编辑基于 v${base}`}</span><Button primary type="submit" disabled={busy||base!==topic.version}>保存交易假设</Button>{dirty&&<Button type="button" onClick={()=>{editor.reset();setSaved(false);}}>丢弃假设草稿并载入最新版本</Button>}{base!==topic.version&&<Button type="button" onClick={()=>editor.change(v=>v,topic.version)}>已核对更新，保留假设草稿继续编辑</Button>}</div>
 </fieldset></form>;
}


export default function TopicDetail({topic,topics=[],busy,mutate,onEvidence,onVerify,onCompany,tab,setTab}){
 const coverage=topic.coverage;
 const groups={brief:'summary','edit-brief':'summary',uncertainty:'summary',evidence:'evidence',materials:'evidence',related:'evidence',hypothesis:'action',companies:'company',company:'company',history:'history',summary:'summary',action:'action'};
 const group=groups[tab]||'summary';
 return <section className={`m-panel m-detail ${topic.dossier?'has-dossier':''}`} aria-label="主题研判"><header className="m-topic-head"><div><h1>{topic.title}</h1><p>{topic.label} · {topic.origin==='material-event-system'?'系统识别 · 事实待核实':topic.origin==='material-event'?'本人选择事项 · 事实待核实':topic.origin==='news-candidate'?'新闻候选 · 未经深度研判':topic.origin==='recent-data-test'?'真实数据 · 研究者复核':topic.origin==='retrospective-case'?'回溯案例':topic.origin==='attachment-research'?'附件研判 · 研究助手':'用户创建'} · <b>{CLAIM_STATES[topic.assessment?.status]||'状态待评估'}</b> · v{topic.version}</p></div><Button onClick={onEvidence} disabled={busy}>补充线索</Button></header>
 <div className="m-assessment"><span>{coverage.families.length} 类支持证据 / {coverage.origins.length} 个来源主体</span><span title={topic.hypothesis.industryHorizon}>产业期限：{topic.hypothesis.industryHorizon||'待评估'}</span><span>尚无交易触发</span></div>
 <nav className="m-tabs" aria-label="研判内容">{[['summary','摘要'],['evidence','证据'],['company','公司与行情'],['action','行动'],['history','历史']].map(([v,l])=><button key={v} aria-current={group===v?'page':undefined} className={group===v?'selected':''} onClick={()=>setTab(v==='summary'?'brief':v==='action'?'hypothesis':v)}>{l}</button>)}</nav>
 <div className="detail-section-tools">{group==='summary'&&[['brief','阅读摘要'],['edit-brief','编辑研判'],['uncertainty','主张与概率']].map(([v,l])=><Button key={v} aria-pressed={tab===v} onClick={()=>setTab(v)}>{l}</Button>)}{group==='evidence'&&[['evidence','证据链'],['materials','来源与模型候选'],['related','关联事件']].map(([v,l])=><Button key={v} aria-pressed={tab===v} onClick={()=>setTab(v)}>{l}</Button>)}</div>
 <div className="m-detail-scroll">{tab==='company'?<section><p className="m-note">公司关系和当前行情在工作台中保留同一研究上下文。关闭详情后可直接选择证券查看曲线；本页不生成另一套行情。</p>{topic.companies.map(c=><article key={c.symbol}><h3>{c.name} · {c.symbol}</h3><Button onClick={()=>onCompany?.(c.symbol)}>打开公司研究与行情</Button><p>{c.note||'关系依据待补充'}</p></article>)}</section>:tab==='edit-brief'?<DossierEditor key={topic.id} topic={topic} busy={busy} mutate={mutate}/>:tab==='brief'?<ResearchDossier topic={topic}/>:tab==='evidence'?<><div className="m-section-caption"><h3>核心因果链 <small>（假设）</small></h3><span>{coverage.missingSteps.length} 个环节缺少支持证据</span></div><div className="m-chain" style={{'--steps':topic.chain.length}}>{topic.chain.map(step=>{const pending=coverage.missingSteps.includes(step.id);return <div key={step.id} className={pending?'pending':'supported'}><h3>{step.title}</h3><span>{pending?'待验证':'部分证据'}</span><p>{step.question}</p></div>;})}</div><p className="m-chain-note">{topic.id==='agent-cpu'?'CPU 与 GPU 需求可能同时增长；配比反转尚未证实。':topic.summary}</p>
 <div className="m-section-caption"><h3>证据清单</h3><span>{coverage.support} 支持 · {coverage.against} 反向约束 · {coverage.pending} 待核实</span></div>
 <div className="m-evidence-list">{topic.evidence.map((e,index)=><details className="m-evidence" key={e.id}><summary><span className="m-evidence-index">{String(index+1).padStart(2,'0')}</span><span className="m-evidence-title">{e.claim}<small>{e.sourceName} · {e.publishedAt?e.publishedAt.slice(0,10):'来源日期待补'}</small></span><span className={`m-stance ${e.stance}`}>{e.verification==='unverified'?'待核实':stanceNames[e.stance]}</span></summary><div className="m-evidence-extra"><p>{verificationNames[e.verification]} · 作用：{stanceNames[e.stance]} · 环节：{topic.chain.find(s=>s.id===e.step)?.title||'背景'}</p><p>本版可用 {time(e.newsId?e.availableAt:e.firstSeen)}{e.retrospective?' · 本轮回溯导入，不代表当时已知':''}</p>{e.interpretation&&<p>关联解释：{e.interpretation}</p>}{e.review&&<p>核验记录：{e.review.note}</p>}{e.url&&<a href={e.url} target="_blank" rel="noreferrer">打开来源 ↗</a>} <Button disabled={busy} onClick={()=>onVerify(e)}>核验 / 修正</Button></div></details>)}</div>
 <div className="m-next-grid"><section><h3>下一条关键证据</h3><p>{topic.nextEvidence}</p></section><section><h3>反证与失效条件</h3><p>{topic.hypothesis.invalidation||'等待补充可证伪条件'}</p></section></div>
 <div className="m-bottom-actions"><span>首建 {time(topic.createdAt)} · 更新 {time(topic.updatedAt)}</span><Button disabled={busy} onClick={()=>mutate(`/api/research/${topic.id}`,'PATCH',{version:topic.version,status:topic.status==='archived'?'active':'archived'})}>{topic.status==='archived'?'恢复跟踪':'归档主题'}</Button></div>
 </>:tab==='related'?<RelatedResearch key={topic.id} topic={topic} topics={topics} busy={busy} mutate={mutate}/>:tab==='materials'?<SourceResearch key={topic.id} topic={topic} busy={busy} mutate={mutate}/>:tab==='uncertainty'?<ClaimsEditor key={topic.id} topic={topic} busy={busy} mutate={mutate}/>:tab==='hypothesis'?<HypothesisEditor key={topic.id} topic={topic} busy={busy} mutate={mutate}/>:<History key={topic.id} topic={topic}/>}</div></section>;
}
