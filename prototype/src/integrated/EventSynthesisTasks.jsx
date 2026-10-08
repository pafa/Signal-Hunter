import React from 'react';
import {Button} from '../major/Primitives';
import {synthesisStates} from '../../shared/event-synthesis-view.mjs';
export default function EventSynthesisTasks({synthesis,onOpen}){
 if(!synthesis?.items.length)return null;
 return <details><summary>事件综合研判 · 最近 {synthesis.items.length} 版</summary><p className="m-note">输入变化旧结果转历史，失败限次重试。系统保存综合结果，不要求逐篇采纳，不创建交易。</p>{synthesis.items.map(j=><article key={j.id}><h4>{j.title} · 综合 v{j.version}</h4><p>{synthesisStates[j.status]||j.status} · {j.current?'当前有效':'非当前有效结论'} · {j.memberCount} 份研究 · {j.attemptCount} 次尝试</p>{j.reason&&<p>{j.reason}</p>}<Button disabled={!onOpen} onClick={()=>onOpen(j)}>查看综合与任务记录</Button></article>)}</details>;
}
