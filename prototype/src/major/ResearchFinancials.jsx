import React from 'react';
import {FINANCIAL_VALUES,VALUATION_METHODS,VALUATION_SCENARIOS,financialMetricResult,valuationResult} from '../../shared/research-financials.mjs';

const show=value=>value===null||value===undefined?'未知':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:6});
export default function ResearchFinancials({value,evidence,fold,renderCitations}){
 if(!value)return null;
 const v=value.valuation,result=valuationResult(value);
 const datum=(d,unit,key)=>d?<><p><b>{show(d.value)} {unit}</b> · {d.kind==='source'?'材料数值 · 字面单位匹配':'模型假设 · 待核实'}</p><p>{d.reason}</p>{renderCitations(d.citations,key)}</>:<p>未知，未补零</p>;
 return <details {...fold('financials')} className="research-financials"><summary>财务输入与估值情景 · {value.metrics.length} 项量级 · {result?'有情景区间':'估值未知'}</summary>
  <p>{value.reason}</p><p className="m-note">这是该版研判的输入与复算。数字、单位和引用匹配不证明主体、会计口径或假设正确；旧版本只供历史比较。情景估值不是买卖触发价、执行限价或收益承诺。</p>
  {value.metrics.map(row=>{const calc=financialMetricResult(row,evidence);return <details key={row.id} {...fold('metric:'+row.id)}><summary>{row.label} · {row.scope}</summary><p>{row.period} · {row.unit}</p><p>{row.basis}</p><dl>{Object.entries(FINANCIAL_VALUES).map(([key,label])=><div className="assessment-dimension" key={key}><dt>{label}</dt><dd>{datum(row[key],row.unit,'metric:'+row.id+':'+key)}</dd></div>)}</dl><p>新结果－基准：{show(calc.delta)} {row.unit}；相对变化：{show(calc.relativeChange)}%</p><p>涉及规模 / 基准：{show(calc.exposure)}%；新结果－原预期：{show(calc.expectationDelta)} {row.unit}；预期差：{show(calc.expectationGap)}%</p><p className="m-note">原预期时点：{row.expectationAt||'未知'}；事件时点：{row.eventAt||'未知'}。{calc.expectationBasis==='pre-event-source-available'?'所引材料在所填预期时点已可用，尚非独立前向验证。':'当前不能确认为事前预期，不据此认定预期差可交易。'}</p></details>;})}
  <h4>估值情景</h4><p>{v.reason}</p>
  {result?<><p><b>{show(result.low)}–{show(result.high)} {v.currency} / 股</b> · 基准情景 {show(result.base)}</p><p>{VALUATION_METHODS[v.method]} · {v.subject}</p><p>每股口径：{v.shareBasis}；指标期间：{v.metricPeriod}</p><p>资料截至：{v.basisAt}；情景窗口终点：{v.horizonAt}</p><p className="m-note">窗口终点不等于卖出日。乘积最多展示六位小数，实际可交易报价另行核对。</p>{v.scenarios.map(s=><details key={s.id} {...fold('valuation:'+s.id)}><summary>{VALUATION_SCENARIOS[s.id]} · {show(result.scenarios.find(r=>r.id===s.id).price)} {v.currency} / 股</summary><h4>{v.method==='eps-pe'?'每股收益':'每股净资产'}</h4>{datum(s.perShare,v.currency+' / 股','valuation:'+s.id+':perShare')}<h4>估值倍数假设 · {show(s.multiple.value)} 倍</h4><p>{s.multiple.reason}</p>{renderCitations(s.multiple.citations,'valuation:'+s.id+':multiple')}<p>复算：{show(s.perShare.value)} × {show(s.multiple.value)} = {show(result.scenarios.find(r=>r.id===s.id).price)} {v.currency} / 股</p></details>)}</>:<p className="m-note">尚不能形成有依据的目标区间，继续研究与补证。</p>}
 </details>;
}
