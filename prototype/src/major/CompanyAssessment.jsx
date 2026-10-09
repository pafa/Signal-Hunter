import React,{useEffect,useState} from 'react';
import {COMPANY_ASSESSMENT_FIELDS,COMPANY_ASSESSMENT_BASES} from '../../shared/company-assessment.mjs';
import {DIRECTIONS} from '../../shared/company-directory.mjs';
import {Button} from './Primitives';
import {request} from './api';
import './company-assessment.css';

function SavedMaterial({topicId,evidence}){
 const [open,setOpen]=useState(false),[body,setBody]=useState(null),[error,setError]=useState('');
 useEffect(()=>{if(!open||body!==null)return;let active=true;setError('');
  request(`/api/research/${encodeURIComponent(topicId)}/materials/${encodeURIComponent(evidence.materialId)}`).then(m=>{
   if(m.id!==evidence.materialId||m.revision!==evidence.materialRevision||typeof m.body!=='string')throw Error('保存材料版本不匹配');
   if(active)setBody(m.body);
  }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[open,body,topicId,evidence.materialId,evidence.materialRevision]);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>展开本版完整材料</summary>{error?<p role="alert">{error}</p>:body===null?<p role="status">正在读取保存材料…</p>:<pre>{body}</pre>}</details>;
}

export default function CompanyAssessment({assessment,evidence=[],topicId,versionNote,onEvidence,disclosure}){
 if(!assessment)return <p className="m-note">此版本尚无逐公司结构化研判；原长文与人工分析仍可查看。</p>;
 const primary=['impactMechanism','businessExposure','magnitudeBasis'];
 const fold=key=>disclosure?.('assessment:'+assessment.symbol+':'+key)||{};
 const dimension=key=>{const d=assessment.analysis[key];return <div className="assessment-dimension" key={key}>
  <dt>{COMPANY_ASSESSMENT_FIELDS[key]} <small>{COMPANY_ASSESSMENT_BASES[d.basis]}</small></dt><dd><p>{d.text}</p>
   {d.citations.length>0&&<details {...fold(key)}><summary>查看所引原文 · {d.citations.length} 段</summary>{d.citations.map((c,i)=>{const e=evidence.find(e=>e.id===c.evidenceId);return <blockquote key={i}>
    <p>{c.quote}</p><small>{e?.sourceName||'保存材料'} · {c.field==='body'?'正文':'标题'} · 材料 v{e?.materialRevision??'未知'}</small>
    {onEvidence&&<Button onClick={()=>onEvidence(c.evidenceId)}>查看本版材料</Button>}
    {!onEvidence&&topicId&&e?.materialId&&<SavedMaterial key={topicId+':'+e.materialId} topicId={topicId} evidence={e}/>}
   </blockquote>;})}</details>}
  </dd></div>;};
 return <section className="company-assessment" aria-label={`${assessment.symbol} 自动公司研判`}>
  <h3>系统公司研判 · {DIRECTIONS[assessment.direction]}</h3><p className="m-note">{versionNote}。原文引用可回看；来源陈述与模型推断均待核实。</p>
  <dl>{primary.map(dimension)}</dl><details {...fold('more')}><summary>展开时间、反证与进入退出条件</summary><dl>{Object.keys(COMPANY_ASSESSMENT_FIELDS).filter(k=>!primary.includes(k)).map(dimension)}</dl></details>
 </section>;
}
