import React,{useState} from 'react';
import {Button} from './Primitives';
import {CLAIM_STATES} from '../../shared/uncertainty.mjs';
export function AssessmentSummary({assessment:a}){
 return <div className="v7-uncertainty"><b>{CLAIM_STATES[a?.status]||'状态待评估'}</b><span>证实概率 {a?.probability==null?'待评估':`${a.probability}% · 主观估计`}</span>{a?.impactIfTrue&&<span title={a.impactIfTrue}>若属实：{a.impactIfTrue}</span>}</div>;
}
export default function UncertaintyEditor({topic,busy,mutate}){
 const [form,setForm]=useState((topic.assessment?Object.fromEntries(Object.entries(topic.assessment).filter(([k])=>!['assessedAt','method'].includes(k))):null)||{status:'unverified',claim:'',probability:null,basis:'',impactIfTrue:'',impactIfFalse:'',horizon:'',resolveBy:''}),[base,setBase]=useState(topic.version),[saved,setSaved]=useState(false);
 const update=(k,v)=>{setForm(f=>({...f,[k]:v}));setSaved(false);};
 return <form className="m-form" onSubmit={async e=>{e.preventDefault();const result=await mutate(`/api/research/${topic.id}`,'PATCH',{version:base,assessment:form});if(result){setBase(result.research.topics.find(t=>t.id===topic.id).version);setSaved(true);}}}>
 <p className="m-note">传闻与未证实消息同样可以研究、关联公司及提交模拟申请。证实概率评估特定主张在截止日前被证实的可能性，不是股价上涨概率。保存主观判断及依据，后续按原版本核对。</p>
 <label>要评估的具体主张<textarea required maxLength={2000} rows={2} value={form.claim} onChange={e=>update('claim',e.target.value)} placeholder="例如：公司将在某日期前完成某项收购，定义什么结果算证实"/></label>
 <div className="m-form-row"><label>消息状态<select value={form.status} onChange={e=>update('status',e.target.value)}>{Object.entries(CLAIM_STATES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>证实概率（%）<input type="number" min="0" max="100" step="1" placeholder="待评估" value={form.probability??''} onChange={e=>update('probability',e.target.value===''?null:Number(e.target.value))}/></label><label>检验截止日<input type="date" required={form.probability!==null} value={form.resolveBy} onChange={e=>update('resolveBy',e.target.value)}/></label></div>
 <div className="m-inline">快捷估计 {[20,50,70].map(p=><Button key={p} type="button" onClick={()=>update('probability',p)}>{p}%</Button>)}<small>不预填或自动当成事实</small></div>
 {[['basis','概率依据与反证','来源是否独立、原始出处、历史准确性、当事方回应；转载不重复增加可信度'],['impactIfTrue','若属实：影响多大、利好或利空哪里','受影响公司、收入/利润/供给/估值的传导与量级'],['impactIfFalse','若未兑现：影响与损失风险','辟谣、延期、部分兑现时，预期如何回撤或反转'],['horizon','影响期限与下一观察点','短期情绪冲击和中长期经营变化分别说明']].map(([key,label,hint])=><label key={key}>{label}<textarea required={form.probability!==null&&key!=='horizon'} maxLength={2000} rows={3} value={form[key]} placeholder={hint} onChange={e=>update(key,e.target.value)}/></label>)}
 <p className="m-note">后续确认、否认或部分证实：更新状态与依据，历史概率保留。样本与结局标注不足时不宣称概率已校准；不以概率单独生成仓位。</p>{base!==topic.version&&<p className="m-warning">主题已更新，请重新打开，避免覆盖其他判断。</p>}<Button primary disabled={busy||base!==topic.version}>保存概率与影响评估</Button>{saved&&<p role="status">已保存新版本；未提交或批准交易。</p>}
 </form>;
}
