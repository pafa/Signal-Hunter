// Expose diagnostic categories, never upstream text, URLs or stacks.
const labels={timeout:'上游请求超时',network:'上游连接失败',http:'上游 HTTP 请求失败',format:'响应格式异常','no-data':'未返回有效数据','all-sources-failed':'主源与备用源均失败'};
export function safeErrorText(value){
 if(!value)return '';
 if(Object.hasOwn(labels,value.kind))return labels[value.kind];
 const text=typeof value==='string'?value:typeof value.message==='string'?value.message:'';
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
