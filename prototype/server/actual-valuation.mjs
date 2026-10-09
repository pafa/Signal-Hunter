import {createHash} from 'node:crypto';
import {actualAmount} from '../shared/actual-holdings.mjs';
import {quoteIssues} from './market-sim-risk.mjs';
import {isMarketInstant,compareMarketTime} from './market-time.mjs';

// Same upper age bound as the existing private bridge. Source validUntil can
// expire sooner. This is a reference calculation, never a broker balance.
export const ACTUAL_VALUATION_VERSION='actual-reference-valuation/1';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function actualReferenceValuation(record,{at,inputs,operation,restorePending=false}={}){
 const issues=[],q=inputs?.quotes?.[record.symbol];
 if(restorePending)issues.push('恢复副本尚未核对，当前参考估值暂停');
 if(operation?.paused)issues.push('执行行情任务已暂停，当前参考估值不可用');
 else if(operation?.blocked||operation?.outcome==='error')issues.push('执行行情任务异常，等待来源恢复');
 if(!q)issues.push(`缺少 ${record.symbol} 已核对的估值行情；原记录价格仅供历史查看${!inputs?.frameHash&&inputs?.reason?'；'+inputs.reason:''}`);
 else {
  issues.push(...quoteIssues(record.symbol,q,{quoteMaxAgeSeconds:3600,feeBps:0},at));
  if(q.currency!==record.currency||q.executionFeed!==true||!inputs.frameHash||q.provenance?.frameHash!==inputs.frameHash||!q.authorization?.configurationHash)issues.push('估值输入未绑定已核对的来源包');
  if(!isMarketInstant(q.authorization?.validFrom)||!isMarketInstant(q.authorization?.validUntil)||compareMarketTime(q.authorization.validFrom,at)>0||compareMarketTime(at,q.authorization.validUntil)>0)issues.push('行情来源授权未生效或已过期');
  if(!isMarketInstant(record.asOf)||compareMarketTime(record.asOf,at)>0||compareMarketTime(q.asOf,record.asOf)<0)issues.push('行情早于持仓记录或记录时间无效');
 }
 let valueCents=null,price=null;
 if(!issues.length){try{price=String(q.mark);valueCents=actualAmount(record.quantity,price);}catch{issues.push('行情精度或估值金额无法安全计算');price=null;}}
 const available=issues.length===0,costCents=actualAmount(record.quantity,record.unitCost),unrealizedCents=available&&costCents!==null?valueCents-costCents:null;
 return {schema:ACTUAL_VALUATION_VERSION,state:available?'available':'unavailable',checkedAt:at,recordId:record.id,recordVersion:record.version,quantityAsOf:record.asOf,
  price:available?price:null,valueCents:available?valueCents:null,unrealizedCents,returnPct:unrealizedCents===null||!costCents?null:unrealizedCents/costCents*100,
  priceAt:available?q.asOf:null,source:available?q.source:null,issues:[...new Set(issues)],
  basis:'按已录数量与供应商标记价估算；数量、成本及公司行动后的调整未与券商实时同步；未扣未来卖出费用；不是实际账户收益',
  provenance:available?{quoteId:q.id,quoteHash:digest(q),frameHash:inputs.frameHash,configurationHash:q.authorization.configurationHash,issuerId:q.issuerId,rulesVersion:q.rulesVersion,receivedAt:q.receivedAt,validUntil:q.validUntil,priceBasis:'已核对行情包中的 mark',source:q.source,currency:q.currency}:null};
}
