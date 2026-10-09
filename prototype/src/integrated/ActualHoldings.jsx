import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
import {ACTUAL_COLUMNS,actualTemplate} from '../../shared/actual-holdings.mjs';
import './actual-holdings.css';

const blank=()=>Object.fromEntries(ACTUAL_COLUMNS.map(k=>[k,k==='feeBasis'?'unknown':'']));
const actions={add:'新增',update:'更新快照',correction:'同一时点修正',duplicate:'重复 · 不写入',invalid:'冲突 / 无效'};
const feeNames={included:'成本已含费用',excluded:'成本未含费用',unknown:'费用口径未知'};
const amount=v=>v===null||v===undefined||v===''?'未知':String(v);
function Values({row:r}){return r?<span>{r.account} · {r.symbol} · {r.quantity} 股 · 单位成本 {amount(r.unitCost)} {r.currency} · 记录价 {amount(r.price)} · {time(r.asOf)} · {feeNames[r.feeBasis]} · 来源 {r.source}{r.topicId?` · 研究 ${r.topicId} v${r.topicVersion}`:' · 未绑定研究'}</span>:null;}

export default function ActualHoldings({data,onRefresh,onClose}){
 return <ActualRecords key={data?.runtime?.instance?.id||'unknown'} data={data} onRefresh={onRefresh} onClose={onClose}/>;
}
function ActualRecords({data,onRefresh,onClose}){
 const [book,setBook]=useState(null),[draft,setDraft]=useState(blank),[csv,setCsv]=useState(actualTemplate),[mode,setMode]=useState('single'),[editor,setEditor]=useState(false),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[history,setHistory]=useState(null),[all,setAll]=useState(false);
 const active=useRef(true),flight=useRef(false),sequence=useRef(0),generation=useRef(0);
 useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current++;};},[]);
 const current=n=>active.current&&sequence.current===n;
 useEffect(()=>{if(flight.current)return;const n=++sequence.current;void request('/api/actual-holdings').then(b=>{if(current(n)){setBook(b);setPreview(p=>p&&p.baseVersion!==b.version?null:p);}}).catch(e=>{if(current(n))setError(e.message);});},[data?.serverTime]);
 async function run(fn){if(flight.current)return;flight.current=true;const n=++sequence.current;setBusy(true);setError('');try{await fn(n);}catch(e){if(current(n))setError(e.message);}finally{flight.current=false;if(active.current)setBusy(false);}}
 function change(key,value){generation.current++;setPreview(null);setNotice('');setDraft(d=>({...d,[key]:value}));}
 function selectMode(value){if(flight.current)return;generation.current++;setMode(value);setPreview(null);setEditor(true);}
 async function inspect(e){e.preventDefault();const g=generation.current;await run(async n=>{const p=await request('/api/actual-holdings/preview','POST',mode==='single'?{rows:[draft]}:{csv});if(current(n)&&g===generation.current)setPreview(p);});}
 async function save(){if(!preview)return;const p=preview;await run(async n=>{const b=await request('/api/actual-holdings/apply','POST',{id:p.id,hash:p.hash});if(!current(n))return;setBook(b);setPreview(null);setHistory(null);setNotice(`已保存持仓记录 v${b.version}；原版本保留。`);try{await onRefresh?.();}catch{if(current(n))setNotice(`已保存持仓记录 v${b.version}；首页暂未刷新，可返回后刷新查看。`);}});}
 function edit(r){if(flight.current)return;generation.current++;setDraft(Object.fromEntries(ACTUAL_COLUMNS.map(k=>[k,k==='reason'?'':r[k]??''])));setMode('single');setEditor(true);setPreview(null);setNotice('');}
 async function openHistory(r){await run(async n=>{const rows=await request(`/api/actual-holdings/${r.id}/history`);if(current(n))setHistory({symbol:r.symbol,account:r.account,rows});});}
 const records=book?.records||[],topics=data.research?.topics||[],selectedTopic=topics.find(t=>t.id===draft.topicId),disabled=busy||!book?.enabled;
 return <section className="actual-holdings" aria-label="实际持仓记录">
  <div className="dashboard-page-head"><div><h2>实际持仓记录</h2><p className="m-note">账单快照 · 记录 v{book?.version??'—'} · {records.filter(r=>r.quantity!=='0').length} 项在持</p></div><Button onClick={onClose}>← 返回看板</Button></div>
  <p className="m-note">实际记录独立于模拟账户。这里只保存你已有的持仓；保存不下单。快照价格和盈亏对应记录时点，尚未接入实时估值、完整成交和持续退出监控。</p>
  {book&&!book.enabled&&<p className="m-warning">当前模式不接受实际持仓，请在研究实例中录入。</p>}
  {error&&<p role="alert" className="m-warning">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="detail-section-tools"><Button disabled={disabled} onClick={()=>selectMode('single')}>录入持仓</Button><Button disabled={disabled} onClick={()=>selectMode('csv')}>批量导入 CSV</Button></div>
  <details open={editor} onToggle={e=>setEditor(e.currentTarget.open)} className="actual-editor"><summary>录入 / 导入与修正</summary>
   <div className="detail-section-tools"><Button disabled={busy} aria-pressed={mode==='single'} onClick={()=>selectMode('single')}>单条记录</Button><Button disabled={busy} aria-pressed={mode==='csv'} onClick={()=>selectMode('csv')}>CSV 批量</Button></div>
   <form onSubmit={inspect}>
    {mode==='single'?<div className="actual-fields">
     {[['account','账户别名','例如：长期账户'],['symbol','证券代码','600519.SH / 00700.HK / AAPL.US'],['quantity','持有数量','0 表示不再持有'],['unitCost','单位成本','未知留空'],['price','记录时点价格','未知留空'],['asOf','快照时间（含时区）','2026-10-09T09:30:00+08:00'],['source','记录来源','例如：本人核对的券商账单']].map(([key,label,placeholder])=><label key={key}>{label}<input disabled={disabled} value={draft[key]} onChange={e=>change(key,e.target.value)} placeholder={placeholder} required={!['unitCost','price'].includes(key)} maxLength={key==='source'?160:80}/></label>)}
     <label>成本费用口径<select disabled={disabled} value={draft.feeBasis} onChange={e=>change('feeBasis',e.target.value)}>{Object.entries(feeNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <label>原研究（可选）<select disabled={disabled} value={draft.topicId} onChange={e=>{const t=topics.find(t=>t.id===e.target.value);change('topicId',t?.id||'');change('topicVersion',t?.version||'');}}><option value="">不自动指定建仓依据</option>{topics.filter(t=>t.status!=='archived').map(t=><option key={t.id} value={t.id}>{t.title} · v{t.version}</option>)}{draft.topicId&&!selectedTopic&&<option value={draft.topicId}>原研究 {draft.topicId}</option>}</select><small>记录版本 {draft.topicVersion||'未知'}；仅可绑定含此证券的研究</small></label>
     <label className="actual-wide">更新 / 修正说明<input disabled={disabled} value={draft.reason} onChange={e=>change('reason',e.target.value)} maxLength={300} placeholder="已有记录发生变化时必填；新记录可留空"/></label>
    </div>:<><p className="m-note">每批最多100行。列顺序见模板；未知成本 / 价格留空；feeBasis 使用 included、excluded 或 unknown。时间须含时区。账户与证券相同视为同一汇总持仓，未列出的持仓保留。</p><label>CSV 文本<textarea rows="8" disabled={disabled} value={csv} onChange={e=>{generation.current++;setCsv(e.target.value);setPreview(null);}} maxLength={100000}/></label><Button type="button" disabled={busy} onClick={()=>{generation.current++;setCsv(actualTemplate);setPreview(null);}}>恢复空模板</Button></>}
    <p className="m-note">数量与价格最多六位小数；同币种才汇总，同一账户不同记录时点不合计盈亏。仅录入持仓不推导已实现收益、现金余额或最大回撤。</p>
    <Button primary type="submit" disabled={disabled}>{busy?'处理中…':'预览变化'}</Button>
   </form>
   {preview&&<section className="actual-preview" aria-label="持仓导入预览"><h3>保存前核对 · {preview.items.length} 行</h3><p>基于记录 v{preview.baseVersion} · 有效至 {time(preview.expiresAt)} · 还没有修改持仓</p>
    {preview.items.map(item=><article key={item.index}><strong>第 {item.index} 行 · {actions[item.action]}</strong>{item.issue&&<p className="m-warning">{item.issue}</p>}<p><Values row={item.row}/></p>{item.previous&&<details><summary>展开原记录对照 · v{item.previous.version}</summary><p><Values row={item.previous}/></p></details>}{item.row?.reason&&<p>说明：{item.row.reason}</p>}</article>)}
    <Button primary disabled={disabled||!preview.canApply} onClick={save}>保存本批记录</Button><p className="m-note">有冲突时整批不写入；重复项不重复保存。更改输入后需重新预览。</p>
   </section>}
  </details>
  <div className="actual-table-scroll"><table className="i-table"><thead><tr><th>账户 / 证券</th><th>数量 / 币种</th><th>单位成本 / 记录价</th><th>快照时间 / 口径</th><th>版本与操作</th></tr></thead><tbody>{records.slice(0,all?records.length:10).map(r=><tr key={r.id}><td>{r.account}<small>{r.symbol}</small></td><td>{r.quantity} · {r.currency}{r.quantity==='0'&&<small>已记录不再持有 · 非卖出成交</small>}</td><td>{amount(r.unitCost)} / {amount(r.price)}</td><td>{time(r.asOf)}<small>{feeNames[r.feeBasis]}</small></td><td>v{r.version} <Button disabled={disabled} onClick={()=>edit(r)}>更新 / 修正</Button><Button disabled={busy} onClick={()=>openHistory(r)}>历史</Button></td></tr>)}{!records.length&&<tr><td colSpan="5">{book?'暂无实际记录。录入或导入后，首页可在持仓账户下拉中查看。':'读取中…'}</td></tr>}</tbody></table></div>
  {records.length>10&&<Button onClick={()=>setAll(!all)}>{all?'收起':'查看全部 '+records.length+' 项'}</Button>}
  {history&&<section aria-label="实际持仓历史"><div className="dashboard-page-head"><h3>{history.account} · {history.symbol} · 修订历史</h3><Button onClick={()=>setHistory(null)}>收起历史</Button></div>{history.rows.map(r=><article key={r.version}><h4>v{r.version} · 保存于 {time(r.recordedAt)}</h4><p><Values row={r}/></p><p>{r.reason||'初始记录'}</p></article>)}</section>}
 </section>;
}
