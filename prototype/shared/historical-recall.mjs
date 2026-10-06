export const HISTORY_RECALL_VERSION='historical-recall/1';
export const historyReviewEligible=row=>['candidate','no_mechanism','no_context'].includes(row?.status);
export const historyRecallErrors=['历史类比请求参数无效','历史类比来源不存在或已修订，请刷新并选择最新来源','历史类比请求标识已用于其他输入','历史类比报告不存在','历史类比档案或新闻快照校验失败','历史类比库超过本次完整扫描上限，未生成部分结果','恢复副本需先完成核对确认','源码已变化，请重启服务后生成历史类比','缺少完整候选源码，无法生成新的历史类比报告','历史类比核对输入不匹配或已变化，请重新检索后核对'];
export const historyStatusLabels={anchor:'本条新闻',candidate:'待核对类比',same_source:'同一来源入口',duplicate_title:'相同标题',invalid_time:'时间缺失或矛盾',not_earlier:'非更早案例',future_input:'获取时间晚于本次检索',no_mechanism:'未命中共同机制',no_context:'缺少共同领域或发行人依据'};
