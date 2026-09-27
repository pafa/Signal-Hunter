import React,{useState} from 'react';
import {Modal,Button} from './Primitives';
import {familyNames,stanceNames,request} from './api';
import {RULEBOOK,RULE_FIELDS} from '../../shared/rulebook.mjs';

export function NewTopic({onClose,onCreate,busy}){
 const [title,setTitle]=useState(''),[summary,setSummary]=useState('');
 return <Modal title="新建研究主题" onClose={onClose}><form className="m-form" onSubmit={e=>{e.preventDefault();void onCreate({title,summary});}}><p className="m-note">可以从单个事件开始，也可以先提出一个跨事件的产业假设。缺少证据时保留为待验证。</p><label>主题标题<input maxLength={140} required value={title} onChange={e=>setTitle(e.target.value)} placeholder="什么变化可能改变一家公司的未来？"/></label><label>初始假设<textarea rows={4} maxLength={2000} required value={summary} onChange={e=>setSummary(e.target.value)} placeholder="写出变化 → 影响机制 → 潜在结果；再逐步补证据"/></label><Button primary type="submit" disabled={busy}>创建主题</Button></form></Modal>;
}

export function EvidenceFields({topic,form,setForm}){
 const update=(key,value)=>setForm(v=>({...v,[key]:value}));
 return <><div className="m-form-row"><label>证据作用<select value={form.stance} onChange={e=>update('stance',e.target.value)}>{Object.entries(stanceNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>证据类别<select value={form.family} onChange={e=>update('family',e.target.value)}>{Object.entries(familyNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><label>对应因果环节<select value={form.step} onChange={e=>update('step',e.target.value)} required><option value="">选择一个环节</option>{topic.chain.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label><label>为什么与这个环节有关？<textarea rows={2} value={form.interpretation} onChange={e=>update('interpretation',e.target.value)} maxLength={1200} required/></label></>;
}

export function AddEvidence({topic,onClose,mutate,busy}){
 const [form,setForm]=useState({claim:'',sourceName:'',url:'',publishedAt:'',stance:'unverified',family:'other',step:'',interpretation:''});
 return <Modal title={`补充线索 · ${topic.title}`} onClose={onClose}><form className="m-form" onSubmit={async e=>{e.preventDefault();if(await mutate(`/api/research/${topic.id}/evidence`,'POST',{...form,version:topic.version}))onClose();}}><p className="m-note">手动输入先记为待核实。来源链接不会自动证明其内容；支持和反对观点都保留。</p><label>证据或线索<textarea rows={3} required maxLength={1200} value={form.claim} onChange={e=>setForm(v=>({...v,claim:e.target.value}))}/></label><div className="m-form-row"><label>来源名称<input value={form.sourceName} maxLength={160} onChange={e=>setForm(v=>({...v,sourceName:e.target.value}))} placeholder="用户线索 / 公告 / 研究报告"/></label><label>来源日期<input type="date" value={form.publishedAt} onChange={e=>setForm(v=>({...v,publishedAt:e.target.value}))}/></label></div><label>来源链接（可留空）<input type="url" value={form.url} onChange={e=>setForm(v=>({...v,url:e.target.value}))} placeholder="https://…"/></label><EvidenceFields topic={topic} form={form} setForm={setForm}/><Button primary type="submit" disabled={busy}>保存到证据链</Button></form></Modal>;
}

export {default as CompanyForm} from './CompanyRelations';

export function VerifyEvidence({topic,evidence,onClose,busy,mutate}){
 const [verdict,setVerdict]=useState('unverified'),[stance,setStance]=useState(evidence.stance),[note,setNote]=useState('');
 return <Modal title="人工核验与修正" onClose={onClose}><form className="m-form" onSubmit={async e=>{e.preventDefault();if(await mutate(`/api/research/${topic.id}/verification`,'POST',{version:topic.version,evidenceId:evidence.id,verdict,stance,note}))onClose();}}><p>{evidence.claim}</p>{evidence.url&&<a href={evidence.url} target="_blank" rel="noreferrer">阅读来源 ↗</a>}<p className="m-note">确认的是这条事实或主张的核验结果，不是股价会涨。旧结果保留在历史版本。</p><div className="m-form-row"><label>核验结论<select value={verdict} onChange={e=>setVerdict(e.target.value)}><option value="unverified">仍待核实 / 撤回确认</option><option value="confirmed">已核对来源，人工确认</option></select></label><label>对本主题的作用<select value={stance} onChange={e=>setStance(e.target.value)}>{Object.entries(stanceNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><label>核验依据与限制<textarea rows={4} required maxLength={1200} value={note} onChange={e=>setNote(e.target.value)} placeholder="记录核对的原文事实、范围，以及它不能证明什么"/></label><Button primary type="submit" disabled={busy}>保存核验版本</Button></form></Modal>;
}

export function Rulebook({onClose}){
 const [scenario,setScenario]=useState('rumor'),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const scenarios={rumor:'未核实重大利空（待评估）',assessed:'传闻已评估（合成 50%）',stale:'行情过期',halted:'停牌 / 无流动性',quantity:'可卖量不足',ready:'可卖、等待人工确认',changed:'审批后行情变化'};
 async function run(){setBusy(true);setError('');try{
  const input={position:{id:'synthetic-position',version:1,qty:100,sellableQty:80},evidence:{id:'synthetic-evidence-v1',invalidatesThesis:true,verification:['rumor','assessed'].includes(scenario)?'unverified':'confirmed',...(scenario==='assessed'?{assessment:{probability:50,basis:'合成测试依据，不对应真实新闻',impact:'合成测试：可能使原持仓逻辑失效'}}:{})},requestedQty:scenario==='quantity'?100:80,quote:{id:'synthetic-quote-v1',fresh:scenario!=='stale'},market:{open:true,halted:scenario==='halted',sellLiquidity:scenario!=='halted'}};
  if(scenario==='changed'){const before=await request('/api/research/exit-preview','POST',input);input.approval={valid:true,fingerprint:before.fingerprint};input.quote.id='synthetic-quote-v2';}
  setResult(await request('/api/research/exit-preview','POST',input));
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Modal title="规则与执行边界" onClose={onClose}><p className="m-note"><a href="/major-event-design.html" target="_blank" rel="noreferrer">打开完整系统设计与评估方法 ↗</a></p><div className="m-rule-demo"><h3>退出门禁演练</h3><p className="m-note">合成持仓 100 股，其中 80 股可卖；演练不创建申请或持仓。行情与交易状态均为测试输入。</p><div className="m-inline"><select aria-label="退出演练场景" value={scenario} onChange={e=>{setScenario(e.target.value);setResult(null);}}>{Object.entries(scenarios).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><Button primary onClick={run} disabled={busy}>{busy?'演练中…':'运行退出门禁'}</Button></div>{error&&<p role="alert">{error}</p>}{result&&<div className="m-preview-result" role="status"><strong>{({verify:'紧急核验',blocked:'阻断执行','needs-parameters':'补齐参数','awaiting-human':'等待人工确认','eligible-for-paper-engine':'可交模拟引擎'})[result.state]||'保持观察'}</strong><p>{result.reasons.join('；')}</p><small>{result.version} · 自动执行：否</small></div>}</div><div className="m-rule-list">{RULEBOOK.map(r=><article key={r.id}><div><code>{r.id}</code><h3>{r.title}</h3><span>{r.state}</span></div><p>{r.description}</p><details><summary>查看输入、判定、异常与验收</summary><dl>{RULE_FIELDS.map(([key,label])=><React.Fragment key={key}><dt>{label}</dt><dd>{r.specification[key]}</dd></React.Fragment>)}</dl></details></article>)}</div></Modal>;
}
