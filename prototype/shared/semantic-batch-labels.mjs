export const batchErrors=['批次需选择2至10份不同的当前新闻或材料','比较计划已变化，请重新预览输入和调用次数','比较批次不存在','批次操作或请求标识无效','批次模型配置已变化，请重新预览并建立批次','批次冻结输入或提示词已变化，请重新建立批次','只能重试失败、中断或已取消的单项；已取消批次不能重试'];
export const batchStates={active:'逐项执行',paused:'已暂停后续调用',cancelled:'未开始项目已取消',completed:'本批次已结束'};
export const batchItemStates={queued:'等待调用',running:'模型运行中',candidate:'候选待核对',failed:'调用失败',interrupted:'调用中断',cancelled:'已取消',invalidated:'输入或配置已失效'};
