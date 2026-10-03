import React,{useEffect,useState} from 'react';
import {request,time} from '../major/api';
import {Button} from '../major/Primitives';
import {semanticScopeLabels} from '../../shared/semantic-labels.mjs';
export default function SemanticMaterialLibrary({onSelect}){
 const [q,setQ]=useState(''),[offset,setOffset]=useState(0),[result,setResult]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setResult(null);setError('');const timer=setTimeout(()=>request(`/api/semantic-events/materials?${new URLSearchParams({q,offset:String(offset),limit:'20'})}`).then(r=>{if(live)setResult(r);}).catch(e=>{if(live)setError(e.message);}),200);return()=>{live=false;clearTimeout(timer);};},[q,offset]);
 return <section aria-label="已保存比较材料"><p>只选择已保存在研究中的当前材料快照。范围由原保存方式标明，不保证全文完整；添加材料请使用研究中的材料入口。</p><label>搜索材料标题或来源<input value={q} maxLength={200} onChange={e=>{setQ(e.target.value);setOffset(0);}}/></label>
 {error&&<p role="alert" className="m-warning">{error}</p>}
 {!result&&!error&&<p>正在读取材料…</p>}
 {result&&<><p>共 {result.total} 份当前材料 · 显示 {result.items.length} 份</p>{result.items.map(m=><article key={m.id}><h4>{m.title}</h4><p>{m.publisher} · {semanticScopeLabels[m.contentScope]} · v{m.revision} · 获取 {time(m.availableAt)}</p><Button onClick={()=>onSelect(m)}>选择材料：{m.title}</Button></article>)}{!result.items.length&&<p>没有匹配的已保存材料。</p>}<div className="event-actions"><Button disabled={!offset} onClick={()=>setOffset(v=>Math.max(0,v-20))}>上一页</Button><Button disabled={offset+result.items.length>=result.total} onClick={()=>setOffset(v=>v+20)}>下一页</Button></div></>}
 </section>;
}
