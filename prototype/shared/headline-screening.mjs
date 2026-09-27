export const SCREENING_VERSION='headline-screening/0.1.0';
// No weighted importance score: amounts without a denominator and expectations are not materiality.
export function headlineScreening(item,triage){
 const text=item.title||'',reversal=/denies|denied|refutes|cancels?|terminates?|否认|辟谣|终止|撤回/iu.test(text);
 const survival=/bankruptcy|default(?:s|ed)? on|accounting fraud|auditor.{0,35}resign|license revok|申请破产|债务违约|财务造假|吊销许可/iu.test(text);
 const interruption=/factory.{0,35}fire|plant.{0,35}shutdown|halts? production|force majeure|不可抗力|工厂火灾|停产/iu.test(text);
 const priority=triage.bucket==='review'&&(reversal||survival||interruption);
 return {version:SCREENING_VERSION,materiality:'unassessed',factProbability:null,priceProbability:null,
  urgency:priority?'priority':'normal',urgencyReason:priority?reversal?'出现否认、撤回或终止线索，先比对既有假设':survival?'存在经营存续风险线索，优先核验主体与影响':'存在供给中断线索，优先核验范围与恢复时间':'按候选层级安排研判；未识别紧急触发',
  dimensions:[
   {key:'novelty',label:'新增量',state:'unknown',question:'与此前公告、报道及研究相比，究竟改变了什么？'},
   {key:'scale',label:'相对量级',state:'unknown',question:triage.magnitudeHints.length?`标题含 ${triage.magnitudeHints.join(' / ')}；需核对单位、期限和相对收入、利润或产能比例`:'补充金额、业务敞口、产能或用户量及其比较基准'},
   {key:'mechanism',label:'公司传导',state:'unknown',question:triage.companies.length?'名称命中只说明提及；逐家公司核对角色、成本及收益路径':'上市主体尚未识别；也可能通过行业影响已关注公司'},
   {key:'expectations',label:'预期差',state:'unknown',question:'变化是否超出事前指引和市场预期，价格已反映多少？'},
   {key:'duration',label:'持续时间',state:'unknown',question:'区分一次性冲击、短期催化和持续经营变化'},
  ],nextAction:triage.bucket==='quiet'?'保留全文入口并抽查漏筛；可人工提升为研究候选':triage.messageStatus==='rumor'?'评估传闻成立概率、成立和落空的条件影响；无需等待证实才能研究':'读取关键材料，补足相对量级与公司传导，再判断重大性',
  limitation:'标题分流与紧急核验提示；尚未识别重大性、校准概率或交易机会',tradeSignal:false};
}
