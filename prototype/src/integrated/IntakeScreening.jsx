import React from 'react';
import './intake-screening.css';
import {time} from '../major/api';

const states={queued:'等待复核',running:'正在复核',candidate:'判断已保存，等待接续',retrying:'等待后台重试',completed:'入口复核完成',unresolved:'复核未完成，保留缺口',invalidated:'依据变化，旧输入保留'};
export default function IntakeScreening({intake}){
 if(!intake)return null;
 return <details className="intake-review"><summary>未选标题自动复核 · {intake.enabled?'已启用':'已关闭'} · {intake.waitingItems} 条等待分批</summary>
 {intake.totals&&<p>全部批次：已复核 {intake.totals.completedItems} 条 · 正在处理或等待重试 {intake.totals.activeItems} 条 · 未完成 / 依据变化 {intake.totals.unresolvedItems} 条</p>}
 {intake.sources&&<p>正文范围：已归档 {intake.sources.ready} / {intake.sources.total} 条 · 待读取或重试 {intake.sources.pending} 条 · 读取未完成 {intake.sources.unresolved} 条</p>}
 <p className="m-note">{intake.limitation}设置只影响后续扫描；旧的未选记录保留原配置。最近 5 批展开查看，不需要逐条批准。</p>
 {intake.items.map(b=><details key={b.id}><summary>{states[b.status]||b.status} · {b.total} 条 · 已尝试 {b.attempts} 次{b.result?` · 继续研究 ${b.result.selected} / 观察 ${b.result.observed} / 依据变化 ${b.result.invalidated}`:''}</summary>
 <p className="m-note">建立 {time(b.createdAt)}{b.nextRetryAt?` · 下次尝试 ${time(b.nextRetryAt)}`:''}</p>
 <div className="ops-scroll"><table className="i-table"><thead><tr><th>原始标题</th><th>入口判断与依据</th><th>后续核验</th></tr></thead><tbody>{b.items.map((i,n)=><tr key={`${i.newsId}:${i.revision}:${n}`}><td>{i.title}<small>新闻修订 {i.revision}</small></td><td>{i.judgment?<><b>{i.judgment.disposition==='existing-research'?'沿用已有研究':i.judgment.decision==='research'?'已进入深入研究队列':'保留观察'}</b><p>{i.judgment.reason}</p><small>{i.judgment.quoteField==='body'?'正文原句':'标题原句'}：{i.judgment.quote}</small></>:b.status==='completed'?'依据已变化，保留原记录':'尚无可采用的入口判断'}</td><td>{i.judgment?.missingEvidence.map((v,k)=><p key={k}>{v}</p>)}<small>{i.material?`已归档提取文本 ${i.material.characters} 字符 · 取得 ${time(i.material.receivedAt)}；附件/链接目标不因此已读`:'仅标题范围'}；重大性尚未核实</small></td></tr>)}</tbody></table></div>
 </details>)}
 {!intake.items.length&&<p className="m-note">尚无复核批次。后台按原调用额度自动接续；未命中标题不等于低影响。</p>}
 </details>;
}
