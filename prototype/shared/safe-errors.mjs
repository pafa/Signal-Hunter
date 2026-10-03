import {materialityErrors} from './company-materiality.mjs';
import {newsIntakeErrors} from './news-sources.mjs';
import {evaluationErrors} from './evaluation-review.mjs';
import {marketErrors} from './market-simulation.mjs';
import {semanticErrors} from './semantic-labels.mjs';
import {batchErrors} from './semantic-batch-labels.mjs';
import {clusterErrors} from './event-cluster-labels.mjs';
// Expose diagnostic categories, never upstream text, URLs or stacks.
const labels={timeout:'上游请求超时',network:'上游连接失败',http:'上游 HTTP 请求失败',format:'响应格式异常','no-data':'未返回有效数据','all-sources-failed':'主源与备用源均失败'};
const directoryLabels=new Set(['证券目录快照不存在','证券目录快照校验失败','证券目录查询参数无效','当前模式不启用证券目录联网更新','证券目录更新请求无效','证券目录正在更新，请等待','证券目录更新失败；原快照保留，请检查来源状态']);
const companyEntityLabels=new Set(["事项身份识别只能使用原拆分材料", "材料身份识别记录不存在", "身份识别记录不属于此研究", "身份识别请求参数无效", "当前未启用本机 Codex 材料身份识别", "材料或研究已变化，请刷新识别", "身份核对参数无效", "没有可核对的身份候选", "身份候选快照校验失败", "核对记录已变化；已关联证券请在公司关系中处理", "材料、研究或身份候选已变化，请刷新核对", "排除或重新核对不得指定证券"]);
const materialEventLabels=new Set(['材料拆分参数无效','研究已更新或归档，请刷新后再拆分','材料不属于此研究','材料拆分记录不存在','拆分记录不属于此研究','拆分请求参数无效','请求标识已用于其他输入','当前未启用本机 Codex 材料拆分','此调用不在本实例运行','拆分核对参数无效','没有可核对的事件候选','核对记录已变化；已创建的研究请在研究页处理','材料或研究已变化，或此候选已排除；请刷新核对','只有已排除候选可以重新核对','取消参数无效']);
// Exact application-owned model workflow errors; never accept appended provider details.
const modelLabels=new Set(['模型研判记录不存在','模型研判不属于此研究','当前未启用本机 Codex 研判','请先配置本机 Codex 路径与模型','研究已更新，请刷新后再生成','归档研究不能开始模型研判','模型超时配置无效','已有模型研判正在运行，请等待或取消后再试','此调用不在本实例运行；已结束或等待中断恢复','此模型结果不可采纳或已经处理','研究或材料已变化；此候选保留在历史中，请重新生成','模型候选与当前研究不匹配，请重新生成','此候选已被处理','模型调用仅接受研究版本；模型配置由本机服务管理','模型候选操作参数无效','研判材料包无效、指纹不符或超过 512 KB']);
const observationLabels=new Set(['统计观察需选择关联证券、5–120日基线、1–20倍标准差和偏离方向','时序价格条件参数无效','时序价格条件仅支持分钟采样，最大间隔60–600秒，持续时间60–21600秒','观察条件需要名称、组合方式和 1–8 项规则','观察规则无效；价格条件必须选择本研究关联证券并填写正数阈值','观察检查时间无效','观察配置不存在','研究已更新或归档，请刷新后再配置观察','观察配置请求标识无效','观察配置请求标识已用于其他内容','观察配置已达 500 项，请复用现有配置','观察配置已更新，请刷新后再保存','观察配置操作或变更说明无效']);
export function safeErrorText(value){
 if(!value)return '';
 if(Object.hasOwn(labels,value.kind))return labels[value.kind];
 const text=typeof value==='string'?value:typeof value.message==='string'?value.message:'';
 // Only exact, owned labels survive a second presentation pass.
 if(Object.values(labels).includes(text)||directoryLabels.has(text)||companyEntityLabels.has(text)||materialEventLabels.has(text)||modelLabels.has(text)||newsIntakeErrors.includes(text)||materialityErrors.includes(text)||observationLabels.has(text)||semanticErrors.includes(text)||batchErrors.includes(text)||clusterErrors.includes(text)||marketErrors.includes(text)||evaluationErrors.includes(text))return text;
 if(value?.name==='TimeoutError'||/timeout|timed out|超时/i.test(text))return labels.timeout;
 if(/fetch failed|ECONN|ENOTFOUND|连接失败|网络/i.test(text))return labels.network;
 if(/HTTP|status code/i.test(text))return labels.http;
 return '任务失败，请检查来源或运行配置';
}
// Response projection leaves stored history and research content intact.
export function safeDiagnosticPayload(value){
 if(Array.isArray(value))return value.map(safeDiagnosticPayload);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
 key==='error'||key==='fallbackReason'||key==='message'&&('kind' in value||'attempts' in value)?safeErrorText(item):
 key==='stack'||key==='cause'?'诊断详情已隐藏':safeDiagnosticPayload(item)]));
}
