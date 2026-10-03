export const semanticKinds={repeat:'同一信息重复',followup:'同一事件进展',reversal:'同一事件反向变化',related:'有关联，尚非同一事件',analogy:'不同事件的类比',unrelated:'没有足够关联',uncertain:'无法判断'};
export const semanticStates={running:'生成中',candidate:'待本人核对',failed:'生成失败',cancelled:'已取消',interrupted:'调用中断'};
export function semanticRunLabel(run){
 if(run.status!=='candidate'||run.decision?.runId!==run.id)return semanticStates[run.status];
 return run.decision.action==='accept'?(run.stale?'采纳已过期':'已采纳'):run.decision.action==='reject'?'未采纳':'采纳已撤销';
}
export const semanticErrors=['请选择两条不同的新闻或材料及其当前版本','新闻已修订；请重新选择后比较','语义比较记录不存在','语义比较输入已变化；请重新生成','语义比较决定已更新，请刷新后再保存','语义比较操作需要有效版本及核对说明','此语义结果尚不可决定','语义比较参数无效','此新闻对已采纳另一份候选；请先打开该候选撤销采纳','材料已修订、缺失或快照校验失败；请重新选择当前材料','比较依据已变化或不属于这两份研究，请刷新后重新核对'];

export const semanticScopeLabels={'headline-only':'仅标题',excerpt:'摘录','user-supplied-text':'人工提供文本','extracted-text':'网页提取文本'};
