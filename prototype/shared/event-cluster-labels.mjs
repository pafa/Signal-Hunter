export const clusterErrors=[
 '事件簇参数无效，请填写名称、核对说明和当前版本',
 '事件簇预览已变化，请刷新后重新核对',
 '组内关系不完整、不一致或已失效，暂不能确认事件簇',
 '成员已属于其他事件簇，或未包含原簇全部成员，请先核对',
 '事件簇不存在',
 '事件簇已更新或归档，请刷新后再操作',
 '请求标识已用于另一项事件簇操作',
 '事项延续需逐一对应全部被替换成员，且新事项来自同一材料的更新版本',
 '原事件簇快照校验失败，暂不能延续'
];
export const clusterPairStates={same:'同一事件候选',different:'相关或不同事件',unknown:'无法判断',pending:'比较未完成',stale:'输入已变化',rejected:'决定已撤销或不采纳',superseded:'已由另一比较决定替代'};
export const clusterGroupStates={ready:'可核对归组',conflict:'存在冲突或缺口',single:'暂未归组'};

export const clusterMemberVersion=m=>m.kind==='event'?`事项 v${m.revision} · 材料 v${m.materialRevision}`:`v${m.revision}`;
