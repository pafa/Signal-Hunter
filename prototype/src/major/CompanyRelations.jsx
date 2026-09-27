import React,{useState} from 'react';
import {Modal,Button} from './Primitives';
import {companyIdentity,searchCompanies,COMPANY_RELATIONS,RELATION_STATUS,DIRECTIONS} from '../../shared/company-directory.mjs';
import './screening.css';

const empty={symbol:'',name:'',kind:'mentioned',relationStatus:'pending',direction:'unclear',note:'',url:'',evidenceIds:[],identityReviewed:false};
export default function CompanyRelations({topic,onClose,busy,mutate,watch=[],deferred=[]}){
 const [query,setQuery]=useState(''),[form,setForm]=useState(empty),[editing,setEditing]=useState(false),[base,setBase]=useState(topic.version),[removeReason,setRemoveReason]=useState('');
 const update=(key,value)=>setForm(v=>({...v,[key]:value}));
 let identity=null;try{if(form.symbol)identity=companyIdentity(form.symbol);}catch{}
 function select(company,edit=false){if(edit)company=topic.companies.find(c=>c.symbol===company.symbol)||company;setForm({...empty,...company,kind:Object.hasOwn(COMPANY_RELATIONS,company.kind)?company.kind:'mentioned',relationStatus:Object.hasOwn(RELATION_STATUS,company.relationStatus)?company.relationStatus:'pending',direction:Object.hasOwn(DIRECTIONS,company.direction)?company.direction:'unclear',note:company.note||'',url:company.url||'',evidenceIds:company.evidenceIds||[]});setEditing(edit);setBase(topic.version);setQuery('');setRemoveReason('');}
 const stale=base!==topic.version;
 return <Modal title="公司关联与纠错" onClose={onClose}>
 <p className="m-note">关系与消息真伪分别判断。关联会尝试加入关注，交易仍需单独申请。撤销本事件关联会保留全局关注、其他事件和持仓。</p>
 <div className="company-relations">{topic.companies.map(c=>{const i=companyIdentity(c.symbol),wait=deferred.find(d=>d.topicId===topic.id&&d.symbol===c.symbol);return <article key={c.symbol}>
  <header><span><strong>{c.name}</strong><code>{c.symbol} · {i.currency}</code></span><Button onClick={()=>select(c,true)} disabled={busy}>修订关系</Button></header>
  <p>{COMPANY_RELATIONS[c.kind]||c.role||'历史关联'} · {RELATION_STATUS[c.relationStatus]||'关系待复核'} · {DIRECTIONS[c.direction]||'方向待评估'}</p>
  <p>{c.note}</p><small>{wait?`关注待处理：${wait.reason}`:watch.some(w=>w.symbol===c.symbol)?'已在关注清单':'关注状态以数据源管理为准'}</small>
  <details><summary>身份、依据与跨市场证券</summary><p>{i.identityBasis}</p><p>{i.securityKey} · 发行人分组 {i.issuerKey} · {i.relationStatus}</p>{i.identitySource&&<p><a href={i.identitySource} target="_blank" rel="noreferrer">身份来源 ↗</a></p>}{c.url&&<p><a href={c.url} target="_blank" rel="noreferrer">关系来源 ↗</a></p>}{c.evidenceIds?.map(id=><p key={id}>引用：{topic.evidence.find(e=>e.id===id)?.claim||id}</p>)}<p>同发行人证券分别展示；行业联动不自动视为同等受益。</p></details>
 </article>;})}</div>
 <div className="screening-title"><h3>{editing?`修订 ${form.symbol}`:'新增公司关系'}</h3>{editing&&<Button onClick={()=>select(empty)}>取消修订</Button>}</div>
 {!editing&&<div className="m-form"><label>查找公司或代码<input value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} placeholder="名称、英文名或代码，如 Boeing / 9988"/></label><div className="company-search">{searchCompanies(query).map(c=><button key={c.symbol} onClick={()=>select(c,topic.companies.some(x=>x.symbol===c.symbol))}>{c.name}<code>{c.symbol}</code></button>)}</div>{query&&!searchCompanies(query).length&&<p className="m-note">有限目录未命中，可在下方输入确切代码并核对上市主体。</p>}</div>}
 <form className="m-form" onSubmit={async e=>{e.preventDefault();if(await mutate(`/api/research/${topic.id}/companies`,'POST',{...form,replace:editing,version:base}))onClose();}}>
 {stale&&<p className="m-warning">研究已有更新，输入已保留。重新打开关系后再保存，避免覆盖新版本。</p>}
 <label>股票代码<input required disabled={editing} value={form.symbol} onChange={e=>update('symbol',e.target.value)} placeholder="600825.SH / 00700.HK / SPOT.US"/></label>
 {identity&&<p className="m-note">{identity.name} · {identity.market} · {identity.currency} · {identity.identityBasis}</p>}
 {identity?.identityStatus==='unresolved'&&<><label>上市公司名称<input value={form.name} maxLength={120} onChange={e=>update('name',e.target.value)}/></label><label className="company-check"><input type="checkbox" checked={!!form.identityReviewed} onChange={e=>update('identityReviewed',e.target.checked)}/>我已核对下方来源中的上市主体与代码</label><p className="m-note">可以先保存待核主体；核对后才能自动加入行情关注。</p></>}
 <div className="m-form-row"><label>事件关系<select value={form.kind} onChange={e=>update('kind',e.target.value)}>{Object.entries(COMPANY_RELATIONS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><label>关系核对状态<select value={form.relationStatus} onChange={e=>update('relationStatus',e.target.value)}>{Object.entries(RELATION_STATUS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div>
 <label>条件影响方向<select value={form.direction} onChange={e=>update('direction',e.target.value)}>{Object.entries(DIRECTIONS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
 <label>公司与事件的关系依据<textarea required rows={3} maxLength={1200} value={form.note} onChange={e=>update('note',e.target.value)} placeholder="写明业务传导、事实依据及未确定之处；利好需评估规模和价格是否已反映"/></label>
 <label>关系来源链接<input type="url" value={form.url} onChange={e=>update('url',e.target.value)} placeholder="https://…"/></label>
 {topic.evidence.length>0&&<label>引用本事件证据（可多选）<select multiple value={form.evidenceIds} onChange={e=>update('evidenceIds',Array.from(e.target.selectedOptions,o=>o.value))}>{topic.evidence.map(e=><option key={e.id} value={e.id}>{e.claim}</option>)}</select></label>}
 <Button primary disabled={busy||stale} type="submit">{editing?'保存关系新版本':'保存关联并尝试关注'}</Button>
 </form>
 {editing&&<div className="m-form company-revoke"><label>撤销此关联的原因<input value={removeReason} maxLength={1200} onChange={e=>setRemoveReason(e.target.value)} placeholder="如同名误配、关联逻辑失效"/></label><Button disabled={busy||stale||!removeReason.trim()} onClick={async()=>{if(await mutate(`/api/research/${topic.id}/companies`,'DELETE',{version:base,symbol:form.symbol,note:removeReason}))onClose();}}>撤销本事件关联</Button></div>}
 </Modal>;
}
