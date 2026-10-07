import React from 'react';
import {time} from '../major/api';
const warnings={'database-sidecar-unreadable':'数据库旁文件无法读取','free-space-unavailable':'可用磁盘空间未知','backup-root-missing':'尚无备份目录','partial-capacity-measurement':'存在无法计量的条目，占用不是完整总量','backup-capacity-exceeded':'已测备份占用超过提醒阈值','low-free-space':'可用磁盘空间低于提醒阈值'};
const states={ok:'检查完成',failed:'检查失败',interrupted:'检查中断'};
const reasons={'cancelled-or-lease-lost':'已取消或执行租约失效','scan-timeout':'扫描超过时限','scan-unavailable':'无法读取检查范围，请核对本地路径与文件权限'};
export function storageBytes(n){if(n===null||n===undefined)return '未知';if(n<1024)return `${n} B`;for(const [unit,size] of [['GiB',1024**3],['MiB',1024**2],['KiB',1024]])if(n>=size)return `${(n/size).toFixed(2)} ${unit}`;}
export default function StorageStatus({monitor,serverTime}){
 if(!monitor)return null;
 const latest=monitor.latest,last=monitor.lastSuccess,stale=last&&Date.parse(serverTime)-Date.parse(last.completedAt)>2*monitor.intervalSeconds*1000;
 return <section aria-label="容量检查记录"><h3>容量与保留记录</h3>
 <p className="m-note">仅检查当前数据库及配置的备份目录，不含全部研究附件或日志；同目录可能包含其他实例的备份。保留最新 {monitor.policy.keepNewest} 份与 {monitor.policy.maxAgeDays} 天内备份，超出两者才标记预览候选，不会自动删除；实际清理仍须另行核对所属数据集。备份提醒阈值 {storageBytes(monitor.policy.maxBackupBytes)}，磁盘余量提醒阈值 {storageBytes(monitor.policy.minFreeBytes)}。</p>
 {!latest?<p>尚无检查记录；在上方恢复“容量与保留检查”后开始。</p>:<p role="status">最近一次：{states[latest.outcome]} · {time(latest.completedAt)}{latest.reason&&` · ${reasons[latest.reason]||'未知原因'}`}</p>}
 {last&&<><p>最近成功测量 {time(last.completedAt)}{last.scopeId!==monitor.scopeId?' · 来自其他路径的历史测量，需重新检查':stale?' · 超过两次检查间隔，结果已过时':''}{latest.id!==last.id?' · 以下为历史成功记录':''}</p>
 <p>数据库及旁文件 {storageBytes(last.databaseBytes)} · 已测备份 {storageBytes(last.backupBytes)} · 磁盘可用 {storageBytes(last.freeBytes)}</p>
 <p>指纹通过 {last.verifiedBackups} 份 · 未通过 {last.unverifiedBackups} 份 · 保留策略候选 {last.candidateBackups} 份（{storageBytes(last.candidateBytes)}）</p>
 <p>所属实例分类：{last.categories?`同一数据集 ${last.categories.sameDataset} · 其他数据集 ${last.categories.otherDataset} · 身份未知 ${last.categories.identityUnknown} · 指纹不匹配 ${last.categories.fingerprintMismatch} · 格式未知 ${last.categories.unknownFormat} · 无法读取 ${last.categories.unreadable}`:'历史测量尚未分类；需下一次正常检查后更新'}。其他数据集、身份未知和格式未知都保留，不视为损坏；只有指纹不匹配明确表示字节校验不符。</p>
 {last.warnings.map((w,i)=><p className="m-warning" key={i}>{warnings[w.kind]||'检查结果需核对'}{w.entries!==undefined?`（${w.entries} 项）`:''}</p>)}</>}
 <p className="m-note">SHA 指纹通过不等于数据库可恢复；并发写入会改变占用。失败或中断不会替代历史测量；进程异常退出可能只有任务中断记录。页面读取已保存结果，不触发扫描。</p>
 <details><summary>容量历史 · 共 {monitor.total} 次（最近20次）</summary><div className="ops-scroll"><table className="i-table"><thead><tr><th>完成时间</th><th>结果</th><th>数据库 / 备份</th><th>提示</th></tr></thead><tbody>{monitor.history.map(r=><tr key={r.id}><td>{time(r.completedAt)}</td><td>{states[r.outcome]}</td><td>{storageBytes(r.databaseBytes)} / {storageBytes(r.backupBytes)}</td><td>{r.reason?reasons[r.reason]:(r.warnings.length?`${r.warnings.length} 项提醒`:'无阈值提醒')}</td></tr>)}</tbody></table></div></details>
 </section>;
}
