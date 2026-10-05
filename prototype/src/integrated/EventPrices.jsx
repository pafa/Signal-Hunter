import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../major/Primitives';
import {request,time} from '../major/api';
import {EVENT_PRICE_WINDOWS} from '../../shared/event-prices.mjs';
const pct=v=>v===null?'不可计算':`${v.toFixed(2)}%`;
export default function EventPrices({batchId}){
 const [catalog,setCatalog]=useState(null),[report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[benchmarks,setBenchmarks]=useState({USD:'',HKD:'',CNY:''}),[page,setPage]=useState(0),[windowId,setWindowId]=useState('1h');
 const alive=useRef(true),pending=useRef(null),base=`/api/evaluations/${batchId}/prices`;
 useEffect(()=>{alive.current=true;request(base).then(r=>{if(alive.current)setCatalog(r);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[base]);
 async function perform(fn){setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
 const inspect=id=>perform(async()=>{const r=await request(`${base}/${id}`);if(alive.current){setReport(r);setPage(0);}});
 async function freeze(e){e.preventDefault();await perform(async()=>{
  const values=Object.fromEntries(Object.entries(benchmarks).filter(([,v])=>v.trim()).map(([k,v])=>[k,v.trim()])),key=JSON.stringify(values);
  if(pending.current?.key!==key)pending.current={key,data:{requestId:crypto.randomUUID(),benchmarks:values}};
  const r=await request(base,'POST',pending.current.data);if(!alive.current)return;pending.current=null;setReport(r);setPage(0);setCatalog(c=>({...c,reports:[{id:r.id,asOf:r.asOf,summary:r.summary},...(c?.reports||[]).filter(x=>x.id!==r.id)]}));
 });}
 function download(){const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`event-prices-${report.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const rows=report?.rows.filter(r=>r.window===windowId)||[],visible=rows.slice(page*50,(page+1)*50),titles=new Map(report?.cohort.batch.samples.map(s=>[s.id,s.input.title])||[]);
 return <section aria-label="信号后价格窗口"><h4>信号后价格窗口 · 独立留档</h4><p>对本批全部初筛层级及其当时提及证券，记录1小时、1/5/20自然日价格变化。使用本机保存的分钟档案，缺价、休市和未到期不填零；不会联网补价或修改原评估报告。</p><p>比较未复权价格，不含分红、拆合股、FX和交易成本，也不是模拟成交收益。自然日按24小时计算，不顺延到下个交易日；没有档案时仍保存缺失结果。</p>
 {error&&<p role="alert">{error}</p>}
 <form className="m-form" onSubmit={freeze}><fieldset disabled={busy||!catalog?.enabled}><legend>可选参照标的（留空只计算原币价格变化）</legend>{[['USD','美股'],['HKD','港股'],['CNY','A股']].map(([k,label])=><label key={k}>{label}参照代码<input maxLength={24} value={benchmarks[k]} onChange={e=>setBenchmarks(b=>({...b,[k]:e.target.value}))}/></label>)}<p>参照必须同市场、同币种、同供应商且具有完全一致的两个端点。本次选择是回溯研究配置，尚未证明行业代表性。</p><Button primary type="submit">冻结全部价格窗口</Button></fieldset></form>
 {catalog&&!catalog.enabled&&<p>离线演示不冻结价格报告；在独立研究实例使用已保存行情。</p>}
 {catalog?.reports.map(r=><p key={r.id}><Button disabled={busy} onClick={()=>inspect(r.id)}>查看价格报告 {r.id.slice(0,8)}</Button> · {time(r.asOf)} · {r.summary.priced}/{r.summary.pairs} 个证券窗口有价格</p>)}
 {report&&<article aria-label="价格窗口结果"><h4>已冻结价格报告</h4><p>截止 {time(report.asOf)} · {report.summary.samples}条初筛 · {report.summary.samplesWithoutUsableSymbol}条无可核验证券 · {report.summary.pairs}个证券窗口 · {report.summary.priced}个可算价格变化 · {report.summary.pairedBenchmark}个可配对参照<br/>报告指纹 {report.hash}</p>
 <label>价格观察窗口<select value={windowId} onChange={e=>{setWindowId(e.target.value);setPage(0);}}>{EVENT_PRICE_WINDOWS.map(w=><option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
 <div className="evaluation-table"><table><caption>固定端点结果；同事件、多证券及重复报道不是独立样本</caption><thead><tr><th>初筛 / 证券</th><th>原币价格变化</th><th>参照变化 / 差（百分点）</th><th>依据与缺口</th></tr></thead><tbody>{visible.map(r=><tr key={`${r.sampleId}:${r.symbol}:${r.window}`}><th>{titles.get(r.sampleId)}<br/>{r.symbol} · {r.bucket}<br/>判断 {time(r.decisionAt)}</th><td>{pct(r.returnPct)}</td><td>{r.benchmark||'未配置'}<br/>{pct(r.benchmarkReturnPct)} / {r.excessPct===null?'不可计算':r.excessPct.toFixed(2)}</td><td>{r.reason}<br/>{r.benchmarkReason}<details><summary>查看价格时点和来源</summary><p>目标 {r.targetAt||'未知'}</p>{[['起点',r.baseline],['终点',r.endpoint],['参照起点',r.benchmarkBaseline],['参照终点',r.benchmarkEndpoint]].map(([k,v])=><p key={k}>{k}：{v?`${v.time} · ${v.price} ${v.currency} · ${v.provider} · 收取 ${v.receivedAt} · 档案 ${v.snapshotHash}`:'无可用观察'}</p>)}</details></td></tr>)}</tbody></table></div>
 <p>{rows.length?`${page*50+1}–${Math.min((page+1)*50,rows.length)} / ${rows.length}`:'本窗口无可核验证券；原样本仍保留在报告中'}</p><Button disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>上一页价格</Button><Button disabled={busy||(page+1)*50>=rows.length} onClick={()=>setPage(p=>p+1)}>下一页价格</Button>
 <details><summary>无证券样本与行情档案检查</summary>{report.noSymbols.map((r,i)=><p key={i}>{titles.get(r.sampleId)}：{r.reason}</p>)}<p>已冻结 {report.archives.length} 份来源快照；完整指纹、逐快照检查及原始输入随报告导出。</p></details><ul>{report.limitations.map(t=><li key={t}>{t}</li>)}</ul><Button disabled={busy} onClick={download}>导出价格报告到本机</Button>
 </article>}
 </section>;
}
