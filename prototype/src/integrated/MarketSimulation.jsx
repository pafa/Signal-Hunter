import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
import React,{useEffect,useState} from 'react';
import {Button,Modal} from '../major/Primitives';
import {request,time} from '../major/api';
import {marketConfigFields as fields,marketOrderStates as states} from '../../shared/market-simulation.mjs';
import './market-simulation.css';
const money=n=>n===null||n===undefined?'未知':new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
const localISO=value=>value?new Date(value).toISOString():null;
const readDraft=key=>{try{return JSON.parse(sessionStorage.getItem(key))||{};}catch{return {};}};
export function MarketAccountSummary({book}){
 return <div className="market-account-summary">{[['已结算现金',book.settledCashCents],['未结算卖出款',book.unsettledCashCents],['已批买单预算',book.reservedCents],['可用现金',book.availableCashCents],['当前净值',book.navCents],['已实现收益',book.realizedCents],['累计费用',book.feesCents]].map(([label,v])=><div key={label}><small>{label} · USD</small><strong>{money(v)}</strong></div>)}{book.missing?.length>0&&<p className="m-warning">部分持仓缺少有效估值，净值与未实现收益保留未知。{book.missing.join('；')}</p>}</div>;
}
export default function MarketSimulation({data,onClose}){
 const [accountId,setAccountId]=useState('aggressive');
 return <MarketAccount key={accountId} accountId={accountId} onAccount={setAccountId} data={data} onClose={onClose}/>;
}
function MarketAccount({data,onClose,accountId,onAccount}){
 const preset=strategyProfiles[accountId],endpoint=path=>`/api/market-simulation${path}?account=${accountId}`;
 const key=`signal.market-simulation-draft:${data?.runtime?.instance?.id||'unknown'}:${accountId}`;
 const [draft,setDraft]=useState(()=>({...preset.suggestedConfig,allowOvernight:String(preset.suggestedConfig.allowOvernight),initialUSD:preset.allocationUSD,...readDraft(key)})),[book,setBook]=useState(null),[history,setHistory]=useState([]),[selected,setSelected]=useState(''),[review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[record,setRecord]=useState(null),[confirm,setConfirm]=useState(false);
 const profile=book?.profile||preset;
 const savedConfig=b=>{if(b.config)setDraft(d=>d.configEdited?d:{...d,...b.config,allowOvernight:String(b.config.allowOvernight)});};
 useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{}},[draft,key]);
 async function load(){const [b,h]=await Promise.all([request(endpoint('')),request(endpoint('/history'))]);setBook(b);savedConfig(b);setHistory(h);setReview(null);}
 useEffect(()=>{let live=true;Promise.all([request(endpoint('')),request(endpoint('/history'))]).then(([b,h])=>{if(live){setBook(b);savedConfig(b);setHistory(h);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 const topicId=draft.topicId||data.research.topics[0]?.id||'',topic=data.research.topics.find(t=>t.id===topicId),order=book?.orders?.find(o=>o.id===selected);
 const change=(key,value)=>setDraft(d=>({...d,[key]:value,...(key in fields||key==='allowOvernight'?{configEdited:true}:{})}));
 async function act(path,payload,{command=true}={}){
  setBusy(true);setError('');try{const b=await request(endpoint(`/${path}`),'POST',command?{requestId:crypto.randomUUID(),version:book.version,...payload}:payload);setBook(b);setReview(null);setRecord(null);setHistory(await request(endpoint('/history')));return b;}catch(e){setError(e.message);return null;}finally{setBusy(false);}
 }
 async function inspect(){setBusy(true);setError('');try{setReview(await request(endpoint(`/orders/${order.id}/review`)));}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function configure(e){e.preventDefault();const config=Object.fromEntries(Object.keys(fields).map(k=>[k,Number(draft[k])]));config.allowOvernight=draft.allowOvernight==='true';const result=book.configured?await act('configure',{config,note:draft.configNote}):await act('initialize',{initialUSD:profile.allocationUSD,config,confirmSimulation:confirm});if(result)setDraft(d=>({...d,configEdited:false}));}
 async function propose(e){e.preventDefault();try{const b=await act('orders',{order:{topicId,topicVersion:topic.version,symbol:draft.symbol||topic.companies[0]?.symbol,side:draft.side||'buy',qty:Number(draft.qty),limitPrice:draft.limitPrice,budgetUSD:Number(draft.budgetUSD),expiresAt:localISO(draft.expiresAt),holdUntil:localISO(draft.holdUntil),thesis:draft.thesis,trigger:draft.trigger,invalidation:draft.invalidation}});if(b)setSelected(b.orders.at(-1).id);}catch(e){setError(e.message);}}
 const configuredValues=book?.config&&Object.entries(fields).map(([k,label])=>`${label}：${book.config[k]}`).join(' · ');
 return <Modal title="市场模拟 · 50/50 双策略账户" onClose={onClose}><section className="market-simulation" aria-label="市场模拟">
  <div className="market-actions" aria-label="策略池选择">{Object.values(strategyProfiles).map(p=><Button key={p.id} disabled={busy} primary={accountId===p.id} onClick={()=>onAccount(p.id)}>{p.name} · 50万 USD</Button>)}</div><h3>{profile.name}</h3><p>{profile.description} 建议首次建仓占本池 {profile.initialPositionPct}%（{(profile.allocationUSD*profile.initialPositionPct/100).toLocaleString('zh-CN')} USD）；这是设计起点，逐笔申请仍需填写数量与预算。</p><p>单票退出复核线 {profile.risk.hardStopPct}%；浮盈达到 {profile.risk.trailingArmPct}% 后，较已记录高点回撤 {profile.risk.trailingDrawdownPct}% 触发复核。策略池回撤 {profile.risk.poolWarningPct}% 预警，{profile.risk.poolStopPct}% 暂停新增买入。触发不等于已经卖出或保证损失上限。</p>
  <p>与原“结构演练”账本分开。每笔申请需本人批准；仅在服务端具备有效报价、数量、交易规则和 FX 时才可能模拟成交。当前不会调用券商接口。</p>
  {error&&<p className="m-warning" role="alert">{error}</p>}
  {book?.sourceNote&&<p className="m-warning" role="status">{book.sourceNote}。现有研究收盘价不能用于市场模拟成交。</p>}
  {!book?<p>正在读取账户…</p>:<>
   <div className="market-actions"><Button disabled={busy} onClick={async()=>{setBusy(true);try{await load();}catch(e){setError(e.message);}finally{setBusy(false);}}}>刷新账户</Button>{book.configured&&<Button disabled={busy||!book.enabled} onClick={()=>act('process',{}, {command:false})}>检查订单、成交与结算</Button>}<small>账本 v{book.version} · {book.configured?'已配置':'尚未初始化'}</small></div>
   {book.configured&&<><MarketAccountSummary book={book}/><p>本池净值回撤：{book.strategyRisk?.drawdownPct===null?'未知':`${(book.strategyRisk?.drawdownPct||0).toFixed(2)}%`} · {book.riskPaused?'新增买入已暂停':'仍按逐笔风险检查'}</p>{book.strategyRisk?.alerts.map(a=><p key={a.key} className="m-warning">{a.symbol||profile.name}：{a.message}</p>)}{book.riskPaused&&<div className="m-form"><label>恢复买入前的复核说明<textarea value={note} onChange={e=>setNote(e.target.value)}/></label><Button disabled={busy||!note.trim()} onClick={()=>act('resume',{note})}>回撤恢复后，本人重新启用买入</Button></div>}</>}
   <details open={!book.configured} className="market-config"><summary>{book.configured?'风险与费用配置 · 修改将使未结束申请失效':'初始化本策略池 · 已填入设计候选，可修改后保存'}</summary>
    {book.configured&&<p>{configuredValues} · 允许隔夜：{book.config.allowOvernight?'是':'否'}<br/>综合费率是本人配置的模拟口径，不代表已核验各市场完整税费。</p>}
    <form className="m-form" onSubmit={configure}><div className="market-form-grid">
     {!book.configured&&<label>初始模拟本金 USD<input required type="number" min="1" max="1000000000" step="0.01" value={profile.allocationUSD} readOnly/></label>}
     {Object.entries(fields).map(([k,label])=><label key={k}>{label}<input required type="number" min={k.endsWith('Pct')||k.endsWith('Bps')?0:1} max={k.endsWith('Pct')?100:k.endsWith('Bps')?1000:k==='maxHoldDays'?365:k==='maxOrderMinutes'?10080:3600} step={k.endsWith('Pct')||k.endsWith('Bps')?'0.01':'1'} value={draft[k]??''} onChange={e=>change(k,e.target.value)}/></label>)}
     <label>允许隔夜持有<select required value={draft.allowOvernight??''} onChange={e=>change('allowOvernight',e.target.value)}><option value="">请选择</option><option value="false">不允许</option><option value="true">允许</option></select></label>
    </div>{book.configured?<label>变更说明<textarea required maxLength={1200} value={draft.configNote||''} onChange={e=>change('configNote',e.target.value)}/></label>:<label className="market-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>我确认这些参数只用于新建的独立模拟账户</label>}
     <Button primary disabled={busy||!book.enabled||!book.configured&&!confirm} type="submit">{book.configured?'保存配置新版本':'创建模拟账户'}</Button>
    </form>
   </details>
   {book.configured&&<>
    <details className="market-config"><summary>新建市场模拟申请</summary><form className="m-form" onSubmit={propose}>
     <div className="market-form-grid"><label>关联研究<select required value={topicId} onChange={e=>setDraft(d=>({...d,topicId:e.target.value,symbol:''}))}>{data.research.topics.filter(t=>t.status==='active').map(t=><option key={t.id} value={t.id}>{t.title} · v{t.version}</option>)}</select></label><label>关联证券<select required value={draft.symbol||topic?.companies[0]?.symbol||''} onChange={e=>change('symbol',e.target.value)}>{topic?.companies.map(c=><option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}</select></label><label>方向<select value={draft.side||'buy'} onChange={e=>change('side',e.target.value)}><option value="buy">买入</option><option value="sell">卖出已有可卖持仓</option></select></label><label>股数<input required type="number" min="1" step="1" value={draft.qty||''} onChange={e=>change('qty',e.target.value)}/></label><label>限价（证券原币）<input required type="number" min="0.000001" step="0.000001" value={draft.limitPrice||''} onChange={e=>change('limitPrice',e.target.value)}/></label>{draft.side!=='sell'&&<label>含费用总预算 USD<input required type="number" min="0.01" step="0.01" value={draft.budgetUSD||''} onChange={e=>change('budgetUSD',e.target.value)}/></label>}<label>订单到期（本机时间）<input required type="datetime-local" value={draft.expiresAt||''} onChange={e=>change('expiresAt',e.target.value)}/></label>{draft.side!=='sell'&&<label>持有复核截止（本机时间）<input required type="datetime-local" value={draft.holdUntil||''} onChange={e=>change('holdUntil',e.target.value)}/></label>}</div>
     {[['thesis','交易假设'],['trigger','触发依据'],['invalidation','失效条件']].map(([k,label])=><label key={k}>{label}<textarea required maxLength={1200} value={draft[k]||''} onChange={e=>change(k,e.target.value)}/></label>)}<p className="m-note">申请保存研究版本；截止时提醒复核，不能替本人自动批准卖出。</p><Button primary type="submit" disabled={busy||!topic?.companies.length||!book.enabled}>保存待批申请</Button>
    </form></details>
    <div className="market-workspace"><div className="market-orders" aria-label="市场订单列表">{book.orders.slice().reverse().map(o=><button key={o.id} aria-pressed={selected===o.id} disabled={busy} onClick={()=>{setSelected(o.id);setReview(null);setNote('');}}><strong>{o.symbol} · {o.side==='buy'?'买入':'卖出'} {o.qty} 股</strong><span>{states[o.status]} · 已成交 {o.filledQty}</span><small>限价 {o.limitPrice} {o.currency} · 到期 {time(o.expiresAt)}</small></button>)}{!book.orders.length&&<p>尚无市场模拟申请。</p>}</div>
     <div className="market-order-detail" aria-label="市场订单详情">{order?<><h3>{order.symbol} · {states[order.status]}</h3><p>研究 v{order.topicVersion} · 配置 v{order.configVersion} · {order.filledQty}/{order.qty} 股</p><p>假设：{order.thesis}<br/>触发：{order.trigger}<br/>失效：{order.invalidation}</p><p>{order.waitReason||order.reason||'保存申请不会自动成交。'}</p>{order.approval&&<p>批准时间 {time(order.approvedAt)} · {order.approval.note}</p>}
      {['pending','approved','partial'].includes(order.status)&&<><Button disabled={busy} onClick={inspect}>核对当前风险与市场输入</Button>{review&&<div className={review.eligible?'market-check-ok':'m-warning'}><strong>{review.eligible?'当前检查通过，仍需本人批准':'当前不可批准 / 执行'}</strong>{review.reasons.map(r=><p key={r}>{r}</p>)}<small>核对 {time(review.checkedAt)}</small></div>}<label className="m-form">本人决定说明<textarea maxLength={1200} value={note} onChange={e=>setNote(e.target.value)}/></label><div className="market-actions">{order.status==='pending'&&<><Button primary disabled={busy||!note.trim()||!review?.eligible} onClick={()=>act(`orders/${order.id}`,{action:'approve',note,fingerprint:review.fingerprint,confirmSimulation:true})}>本人批准此模拟申请</Button><Button disabled={busy||!note.trim()} onClick={()=>act(`orders/${order.id}`,{action:'reject',note})}>拒绝申请</Button></>}<Button disabled={busy||!note.trim()} onClick={()=>act(`orders/${order.id}`,{action:'cancel',note})}>撤销未成交数量</Button></div></>}
      {!!book.fills.filter(f=>f.orderId===order.id).length&&<><h4>实际模拟成交记录</h4>{book.fills.filter(f=>f.orderId===order.id).map(f=><p key={f.id}>{time(f.at)} · {f.qty} 股 × {f.price} {order.currency}<br/>费用 {money(f.feeCents)} USD · 汇率 {f.fx.usdPerUnit} USD/原币 · 来源 {f.marketSnapshot.source}</p>)}</>}
     </>:<p>选择申请，核对风险、审批和成交依据。</p>}</div>
    </div>
    <h3>市场模拟持仓批次</h3><div className="market-lots">{book.positions.map(p=><article key={p.id}><strong>{p.symbol} · {p.qty} 股</strong><p>成本 {money(p.costCents)} USD · 估值 {money(p.valueCents)} USD<br/>可卖时间 {time(p.sellableAt)} · 持有复核截止 {time(p.holdUntil)}</p>{p.overdue&&<p className="m-warning">持有复核期限已到，需本人核对与提出退出申请。</p>}</article>)}{!book.positions.length&&<p>尚无市场模拟持仓。</p>}</div>
    <details><summary>不可变账本记录（最近 {history.length} 版）</summary><div className="market-actions">{history.map(h=><Button key={h.version} disabled={busy} onClick={async()=>{try{setRecord(await request(endpoint(`/history/${h.version}`)));}catch(e){setError(e.message);}}}>v{h.version} · {h.kind}</Button>)}</div>{record&&<div><p>v{record.version} · {time(record.at)} · {record.hash}</p><pre>{JSON.stringify(record.detail,null,2)}</pre></div>}</details>
   </>}
  </>}
 </section></Modal>;
}
