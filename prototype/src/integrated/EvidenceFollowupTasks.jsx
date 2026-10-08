import React,{useState} from 'react';
import {Button} from '../major/Primitives';
import {time} from '../major/api';
const states={pending:'后台继续处理',completed:'本轮补充处理结束',observing:'保留缺口观察',invalidated:'依据变化，旧记录保留',historical:'旧检索记录',matched:'发现同事件线索',related:'相关或类比',unrelated:'不属于同一事件',researched:'替代线索已独立研判',cancelled:'已取消'};
export default function EvidenceFollowupTasks({evidence,onTopic,initialExpanded={}}){
 const [expanded,setExpanded]=useState(initialExpanded);
 const disclosure=key=>({open:!!expanded[key],onToggle:e=>{const value=e.currentTarget.open;setExpanded(old=>old[key]===value?old:{...old,[key]:value});}});
 const open=(id,section)=>onTopic?.(id,section,expanded);
 if(!evidence?.items.length)return null;
 return <details className="evidence-followup-tasks" {...disclosure("root")}><summary>自动补充依据 · 最近 {evidence.items.length} / {evidence.total} 次检索</summary>
  <p className="m-note">系统从已收新闻和原文明确引用的网页中补充线索，沿原队列读取正文、独立研判并核对事项。不要求逐条操作；完成检索不等于缺口已核实或补齐。全网搜索、附件正文与财务敞口专项补查尚未接通。</p>
  {evidence.items.map(s=><details key={s.id} {...disclosure(s.id)}><summary>{s.policy==='linked-public-source/1'?'网页补读':'已收新闻'} · {s.anchor.title} · {states[s.status]||s.status}</summary>
   <p>{s.policy==='linked-public-source/1'?'沿原文网页链接补读':s.anchor.kind==='source'?'原文读取失败后的替代线索':'研究缺口的补充检索'} · {time(s.createdAt)} · 原研究 v{s.anchor.topicVersion}</p>
   <p>当时缺口：{s.anchor.missing.join('；')}</p><p>{s.reason}</p>
   <p className="m-note">{s.policy==='linked-public-source/1'?<>本次选择 {s.coverage.selected} / 最多 {s.coverage.maximumCandidates} 个原文链接；新增 {s.coverage.newLeads} 个入口，复用 {s.coverage.reusedNews} 条已有来源。最多延伸 {s.coverage.maximumDepth} 层，不递归抓取；共用原读取重试和模型调用额度。链接不是已读内容，也不证明来源独立。</>:<>本次索引 {s.coverage.newsIndexed} / {s.coverage.newsTotal} 条已收新闻，其中 {s.coverage.automaticRevisions} 条属于自动模式；相距 {s.coverage.windowDays} 天内按事项线索召回 {s.coverage.matches} 条，选取 {s.coverage.selected} / 最多 {s.coverage.maximumCandidates} 条。未命中不代表无关或没有证据。每次最多检查500份系统事项和500条原文失败记录。</>}</p>
   <Button disabled={!onTopic} onClick={()=>open(s.anchor.topicId,"brief")}>查看原研究当前版本</Button>
   {s.candidates.map(c=><article key={c.pipelineId}><h4>{c.title} · {c.created?'线索':'新闻'} v{c.revision}</h4><p>{states[c.status]||c.status}{!c.current?' · 依据已变化':''}{c.created?' · 原文链接新增入口':c.activated?' · 原初筛未选中，补充检索后进入研究':''}</p><p>{c.reason}</p>{c.link&&<div style={{overflowWrap:'anywhere'}}><a href={c.requestedUrl} target="_blank" rel="noreferrer">原文引用：{c.link.label} ↗</a><p className="m-note">引用附近原文：{c.link.context||'未记录'}</p></div>}{c.scopeNote&&<p>{c.scopeNote}</p>}<p className="m-note">召回依据：{c.reasons.join('；')}</p>{c.topicId&&<Button disabled={!onTopic} onClick={()=>open(c.topicId,"materials")}>查看补充来源与保存材料</Button>}{c.pairs.map(r=><details key={r.id} {...disclosure(s.id+":"+r.id)}><summary>事项比较 · {r.active?'系统判断已保存':r.stale?'依据已变化':'处理中或保留观察'}</summary><p>{r.source.title} → {r.target.title}</p><p>{r.reason}</p>{r.comparison&&<><p>左侧事项引文：{r.comparison.left.quote}</p><p>右侧事项引文：{r.comparison.right.quote}</p><p>{r.comparison.reason}</p></>}<p>共 {r.attempts.length} 次调用；与自动研判共用额度。</p><Button disabled={!onTopic} onClick={()=>open(r.source.id,"brief")}>查看左侧事项研究</Button> <Button disabled={!onTopic} onClick={()=>open(r.target.id,"brief")}>查看右侧事项研究</Button></details>)}</article>)}
  </details>)}
 </details>;
}
