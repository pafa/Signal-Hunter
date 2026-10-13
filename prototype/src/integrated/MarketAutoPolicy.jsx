import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}};
export default function MarketAutoPolicy({book,busy,storageKey,onSave}){
 const [draft,setDraft]=useState(()=>read(storageKey)||{}),[confirm,setConfirm]=useState(false),generation=useRef(0);
 const policy=book.autoPolicy||{enabled:false,targetIssuerPct:null,reducePct:null},v={...policy,...draft};
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{}},[draft,storageKey]);
 const change=(key,value)=>{generation.current++;setDraft(d=>({...d,[key]:value}));};
 async function save(e){e.preventDefault();const g=generation.current,result=await onSave({policy:{enabled:v.enabled,targetIssuerPct:v.targetIssuerPct==null||v.targetIssuerPct===''?null:Number(v.targetIssuerPct),reducePct:v.reducePct==null||v.reducePct===''?null:Number(v.reducePct)},note:'本人保存本模拟账户的自动方案分配配置',confirmSimulation:confirm});if(result&&g===generation.current){setDraft({});setConfirm(false);}}
 return <details className="market-config"><summary>自动准备研究方案 · {policy.enabled?`已启用，配置 v${book.autoPolicyVersion}`:'未启用，首次使用配置一次'}</summary>
  <p>后台只准备方案，每份方案由本人作最后一次决定。买入按本池净值和同一发行人已有持仓计算，费用计入预算，仍受原有现金、发行人、主题及持有期限限制。</p>
  <form className="m-form" onSubmit={save}><label className="market-confirm"><input type="checkbox" checked={v.enabled} onChange={e=>change('enabled',e.target.checked)}/>为此模拟账户自动准备方案</label><div className="market-form-grid">
   <label>单一发行人目标额度（占本池净值 %）<input type="number" required={v.enabled} min="0.01" max="100" step="0.01" value={v.targetIssuerPct??''} onChange={e=>change('targetIssuerPct',e.target.value)}/></label>
   <label>研究建议减仓时的比例（对应持仓 %）<input type="number" required={v.enabled} min="0.01" max="100" step="0.01" value={v.reducePct??''} onChange={e=>change('reducePct',e.target.value)}/></label>
  </div><p className="m-note">“退出”针对对应研究的当前可卖持仓；“减仓”按上述比例取整。比例不会自动填入设计参考值。修改配置会停止旧自动方案尚未成交的部分。</p>
  {v.enabled&&<label className="market-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>我确认这些比例只用于本模拟账户的自动方案</label>}
  <Button type="submit" disabled={busy||!book.enabled||v.enabled&&!confirm}>保存自动方案配置</Button></form>
 </details>;
}
