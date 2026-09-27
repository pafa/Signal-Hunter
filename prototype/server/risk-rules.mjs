// Execution gate, independent of any broker. No call in this file can create an order.
export const RISK_RULES_VERSION='exit-gates/0.2.0';
export function planExit({position,evidence,requestedQty,quote,market,approval}={}) {
 const result={version:RISK_RULES_VERSION,priority:'normal',state:'observe',reasons:[],automaticExecution:false};
 if(!position||!(position.qty>0))return {...result,reasons:['没有相关正式模拟持仓；保留观察，不产生卖单']};
 if(!evidence?.invalidatesThesis)return {...result,reasons:['尚未确认原持仓逻辑被推翻']};
 result.priority='urgent';
 const uncertain=evidence.verification!=='confirmed',a=evidence.assessment;
 if(uncertain&&(!a||!Number.isFinite(a.probability)||a.probability<0||a.probability>100||typeof a.basis!=='string'||!a.basis.trim()||typeof a.impact!=='string'||!a.impact.trim()))return {...result,state:'verify',reasons:['未证实利空进入紧急研判；补充证实概率、依据与影响后可提交风险减仓申请，无须等到消息证实']};
 if(typeof position.id!=='string'||!position.id||!Number.isSafeInteger(position.version)||position.version<1||typeof evidence.id!=='string'||!evidence.id||typeof quote?.id!=='string'||!quote.id)return {...result,state:'needs-parameters',reasons:['必须绑定持仓版本、证据与行情快照标识']};
 if(!Number.isSafeInteger(requestedQty)||requestedQty<=0||!Number.isSafeInteger(position.qty)||!Number.isSafeInteger(position.sellableQty)||position.sellableQty<0||position.sellableQty>position.qty||requestedQty>position.sellableQty)return {...result,state:'needs-parameters',reasons:['需明确减仓或清仓数量，且不得超过可卖数量（含市场可卖限制）']};
 if(!quote||quote.fresh!==true)return {...result,state:'blocked',reasons:['行情缺失、过期或新鲜度未核验，不能假定卖出价格']};
 if(!market||market.open!==true||market.halted!==false||market.sellLiquidity!==true)return {...result,state:'blocked',reasons:['休市、停牌、流动性不足或状态未知；记录未成交并持续复核']};
 const fingerprint=hashExit({positionId:position.id,positionVersion:position.version,requestedQty,quoteId:quote.id,evidenceId:evidence.id,verification:evidence.verification,assessment:uncertain?a:null});
 if(!approval||approval.fingerprint!==fingerprint||approval.valid!==true)return {...result,state:'awaiting-human',fingerprint,reasons:['退出申请可提交；用户必须确认当前数量、证据版本和行情快照']};
 return {...result,state:'eligible-for-paper-engine',fingerprint,reasons:['审批绑定匹配；仍须由正式模拟引擎校验费用、滑点、成交及幂等']};
}
function hashExit(value){return JSON.stringify(value);}
