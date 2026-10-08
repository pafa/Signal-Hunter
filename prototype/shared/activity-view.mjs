export const laneNames={news:'新闻收取',daily:'日线更新',minutes:'分钟行情',discovery:'自动研判',semantic:'关联比较',observations:'观察检查',pricecollection:'价格评估',execution:'模拟执行',backup:'本地备份',storage:'容量检查'};
export const actionNames={discovered:'完成标题初筛',running:'开始执行',ok:'完成',error:'失败',partial:'部分失败',skipped:'本次无更新',failed:'失败待处理',interrupted:'中断待处理',candidate:'候选已保存，待本人复核',adopted:'已采纳并保留原版',preparing:'读取来源正文',ready:'正文已保存，等待模型',queued:'选中进入准备队列','model-started':'已调用本机 Codex','needs-review':'已有研究待核对',invalidated:'依据变化需重新核对',cancelled:'已取消',pause:'已暂停',resume:'已恢复',retry:'已安排重试',read:'已读，仍待处理',complete:'回执已保存',reopen:'待办已重新打开'};
Object.assign(actionNames,{processing:'正文已入库，事项研究继续',completed:'系统研判完成',observing:'保留观察结果','no-signal':'未发现具体事项','event-extraction-planned':'已安排事项识别','event-identity-discovered':'已安排公司身份识别','event-dossier-discovered':'已安排事项研判','event-job-started':'开始事项模型调用','event-job-invalidated':'事项依据变化，保留记录','automatic-event-completed':'系统事项识别完成','automatic-event-no-signal':'本次未识别具体事项','automatic-event-observing':'尝试结束，转入观察','automatic-event-cancelled':'本次调用已取消','automatic-event-invalidated':'依据变化，保留旧结果','automatic-event-retry':'后台已安排限次重试','automatic-identity-completed':'公司识别完成，继续研判','automatic-dossier-completed':'系统研判已保存','automatic-source-completed':'本篇自动研究完成','automatic-source-no-signal':'本篇未发现具体事项','automatic-source-observing':'本篇转入观察','automatic-source-invalidated':'本篇依据已变化','automatic-source-cancelled':'本篇已取消'});
export const skipNames={'no-queued-items':'没有待处理候选','model-busy':'模型正被其他任务使用','call-limit':'已达到滚动24小时调用上限','model-disabled':'模型未配置','source-unavailable':'来源正文不可读取','cooldown':'等待采集冷却结束','no-change':'没有新增观察项','all-queries-disabled':'新闻来源均已关闭','offline':'离线模式关闭外部采集','offline-or-legacy':'此模式不采集','not-configured':'账户未配置'};
export function activityText(item){
 const d=item.detail||{},name=item.kind==='material-model'?'材料拆分':item.kind==='identity-model'?'身份识别':laneNames[item.lane]||item.lane||'研究',state=d.automatic?({candidate:'候选已保存，系统继续处理',adopted:'系统研判已保存',failed:'调用失败，后台将限次重试或转观察',interrupted:'调用中断，后台将恢复或转观察'}[item.action]||actionNames[item.action]||item.action):actionNames[item.action]||item.action;
 if(item.kind==='intake')return `${d.label||'新闻入口'} · ${state}${item.action==='ok'?` · 新增 ${d.added||0} / 修订 ${d.updated||0} / 重复 ${d.duplicates||0} / 排除 ${d.rejected||0}`:''}${d.error?' · '+d.error:''}`;
 if(item.kind==='model'||item.kind.endsWith('-model'))return `本机 Codex${d.model?' · '+d.model:''} · ${state}${d.error?' · '+d.error:''}`;
 if(item.kind==='pipeline'&&item.action==='discovered')return `${name}${d.selected&&d.title?' · '+d.title:''} · ${d.selected?'选中，进入正文准备':'保留未选中'} · ${({review:'优先研判',clue:'主题线索',quiet:'普通资讯'})[d.bucket]||d.bucket||'初筛'}${d.reason?' · '+d.reason:''}`;
 const skips=d.skipReasons?.map(x=>`${skipNames[x.reason]||x.reason}${x.count>1?' × '+x.count:''}`).join('；');
 return `${name} · ${state}${skips?' · '+skips:''}${d.error?' · '+d.error:''}${d.added>0?' · 新增 '+d.added+' 项':''}${item.kind==='pipeline'&&d.reason?' · '+d.reason:''}`;
}
export function mergeActivity(previous,incoming){return [...new Map([...previous,...incoming].map(r=>[r.id,r])).values()].sort((a,b)=>a.id-b.id);}
export function groupActivity(items){
 const result=[],quietGroups=new Map();
 for(const item of items){const quiet=item.kind==='pipeline'&&(item.action==='skipped'||item.action==='discovered'&&item.detail?.selected===false)||item.kind==='operation'&&item.action==='skipped';
  const key=quiet?`${Math.floor(Date.parse(item.at)/1800000)}:${item.kind}:${item.lane}:${activityText(item)}`:null,previous=key&&quietGroups.get(key);
  if(previous){previous.count++;previous.at=item.at;previous.ids.push(item.id);}
  else{const row={...item,key,count:1,ids:[item.id],firstAt:item.at};result.push(row);if(key)quietGroups.set(key,row);}
 }return result;
}
export function taskDescription(s){if(s.paused)return '已暂停，等待本人恢复';if(s.recovering)return '上次执行中断，等待恢复';if(s.running)return '执行中';if(s.blocked)return s.automaticRecovery?'连续失败，后台按退避时间重试':'连续失败，等待处理';if(s.skipReasons?.length)return s.skipReasons.map(x=>skipNames[x.reason]||x.reason).join('；');if(s.error)return s.error;return s.completedAt?'等待下次检查':'等待首次调度';}
