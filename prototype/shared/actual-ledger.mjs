import {instrument} from './securities.mjs';
import {actualDecimal,actualText,actualTime,failActual} from './actual-holdings.mjs';

export const ACTUAL_LEDGER_VERSION='actual-ledger/1';
export const ledgerTypes={opening:'期初现金与账本启用',opening_position:'期初持仓',buy:'实际买入',sell:'实际卖出',deposit:'入金',withdrawal:'出金',dividend:'现金股息',fee:'账户费用',split:'拆并股后数量',cash_balance:'核对现金余额',position_balance:'核对持仓与成本',void:'撤销错误记录'};
export const ledgerCostMethods={reported:'按账单所列卖出成本',average:'移动加权平均研究口径'};
export const LEDGER_COLUMNS=['account','currency','externalId','revision','type','at','sequence','symbol','quantity','amount','fees','cost','costMethod','topicId','topicVersion','source','reason'];
export const ledgerTemplate=LEDGER_COLUMNS.join(',')+'\n';
export const ledgerAccountKinds={actual:'实际记录','manual-simulation':'手动模拟'};
// Keep existing actual identities unchanged; simulation has its own namespace.
export const ledgerAccountParts=r=>r.accountKind==='manual-simulation'?['manual-simulation',r.account,r.currency]:[r.account,r.currency];
export const ledgerPositionParts=r=>r.accountKind==='manual-simulation'?['manual-simulation',r.account,r.symbol]:[r.account,r.symbol];
export const ledgerGroupKey=r=>JSON.stringify(ledgerAccountParts(r));
export const ledgerEntryKey=r=>JSON.stringify([...ledgerAccountParts(r),r.externalId]);
const max=BigInt(Number.MAX_SAFE_INTEGER),scale=1000000n;
const safe=n=>{if(n>max||n< -max)failActual(17);return Number(n);};
export const ledgerSum=values=>values.some(v=>v===null)?null:safe(values.reduce((a,v)=>a+BigInt(v),0n));
const minus=(a,b)=>a===null||b===null?null:safe(BigInt(a)-BigInt(b));
const qtext=q=>`${q/scale}${q%scale?'.'+String(q%scale).padStart(6,'0').replace(/0+$/,''):''}`;
const money=v=>{if(v==null||v==='')return null;if(typeof v!=='string'||!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(v))failActual(17);const [a,b='']=v.split('.');return safe(BigInt(a)*100n+BigInt(b.padEnd(2,'0')));};
const centsText=v=>v===null?null:`${Math.floor(v/100)}.${String(v%100).padStart(2,'0')}`;
const nonempty=v=>v!==undefined&&v!==null&&v!=='';
export const ledgerFieldsByType={opening:['amount','costMethod'],opening_position:['symbol','quantity','cost','amount','topicId','topicVersion'],buy:['symbol','quantity','amount','fees','topicId','topicVersion'],sell:['symbol','quantity','amount','fees','cost'],deposit:['amount'],withdrawal:['amount'],dividend:['symbol','amount','fees'],fee:['amount'],split:['symbol','quantity'],cash_balance:['amount'],position_balance:['symbol','quantity','cost','topicId','topicVersion'],void:[]};
export function normalizeLedgerRow(input,at){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(k=>!LEDGER_COLUMNS.includes(k)&&k!=='accountKind'))failActual(16);
 if(input.accountKind!==undefined&&(typeof input.accountKind!=='string'||!Object.hasOwn(ledgerAccountKinds,input.accountKind)))failActual(16);
 const type=input.type;if(typeof type!=='string'||!Object.hasOwn(ledgerTypes,type))failActual(16);
 const always=['accountKind','account','currency','externalId','revision','type','at','sequence','source','reason'];
 if(Object.entries(input).some(([k,v])=>nonempty(v)&&!always.includes(k)&&!ledgerFieldsByType[type].includes(k)))failActual(16);
 const account=actualText(input.account,60,true),currency=input.currency,externalId=actualText(input.externalId,100,true),source=actualText(input.source,160,true),reason=actualText(input.reason,300);
 if(!['USD','HKD','CNY'].includes(currency))failActual(16);
 const rev=nonempty(input.revision)?input.revision:'1',seq=nonempty(input.sequence)?input.sequence:'0';if(!/^[1-9]\d{0,8}$/.test(String(rev))||!/^\d{1,8}$/.test(String(seq)))failActual(16);
 const instant=actualTime(input.at,at);let security=null;if(ledgerFieldsByType[type].includes('symbol')){try{security=instrument(actualText(input.symbol,32,true));}catch{failActual(16);}if(security.currency!==currency)failActual(16);}
 const quantity=ledgerFieldsByType[type].includes('quantity')?actualDecimal(input.quantity,true).text:null;
 if(['buy','sell','split'].includes(type)&&quantity==='0')failActual(17);
 const amount=money(input.amount),fees=money(input.fees),cost=money(input.cost);
 if(['buy','sell','deposit','withdrawal','dividend','fee'].includes(type)&&(amount===null||amount<=0))failActual(17);
 if(['sell','dividend'].includes(type)&&fees!==null&&fees>amount)failActual(17);
 if(['opening_position','position_balance'].includes(type)&&quantity==='0'&&(cost!==null&&cost!==0||type==='opening_position'&&amount!==null&&amount!==0))failActual(20);
 const costMethod=type==='opening'?input.costMethod:null;if(type==='opening'&&!Object.hasOwn(ledgerCostMethods,costMethod))failActual(18);
 const topicId=actualText(input.topicId,100)||null,topicVersion=nonempty(input.topicVersion)?Number(input.topicVersion):null;
 if(topicId&&(!Number.isSafeInteger(topicVersion)||topicVersion<1)||!topicId&&topicVersion!==null)failActual(5);
 if(['cash_balance','position_balance','void'].includes(type)&&!reason)failActual(8);
 return {...(input.accountKind==='manual-simulation'?{accountKind:input.accountKind}:{}),account,currency,externalId,revision:Number(rev),type,at:instant,sequence:Number(seq),symbol:security?.symbol||null,quantity,amount:centsText(amount),fees:centsText(fees),cost:centsText(cost),costMethod,topicId,topicVersion,source,reason};
}

// Pure reconstruction of recorded account facts. It does not submit trades,
// infer missing fees, choose a tax method, or treat deposits as investment profit.
export function reconstructActualLedger(entries){
 const groups=new Map();for(const r of entries){const key=ledgerGroupKey(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups.entries()].map(([key,allRows])=>{
  const rows=allRows.filter(r=>r.type!=='void');if(!rows.length)failActual(18);
  rows.sort((a,b)=>a.at.localeCompare(b.at)||a.sequence-b.sequence);
  const first=rows[0];if(first.type!=='opening'||rows.filter(r=>r.type==='opening').length!==1)failActual(18);
  const seen=new Set(),positions=new Map(),issues=new Set();let cash=money(first.amount),realized=0,feesTotal=0,income=0,flows=0,openingValue=cash,performanceKnown=true,openingPhase=true;
  const position=r=>{if(!positions.has(r.symbol))positions.set(r.symbol,{symbol:r.symbol,quantity:0n,cost:0,initialValue:null,topicId:null,topicVersion:null,bindings:[],asOf:r.at,source:r.source,openedAt:null,realizedCents:0});return positions.get(r.symbol);};
  const bind=(p,r)=>{const b=JSON.stringify([r.topicId,r.topicVersion]);if(!p.bindings.includes(b))p.bindings.push(b);if(p.bindings.length===1){p.topicId=r.topicId;p.topicVersion=r.topicVersion;}else {p.topicId=null;p.topicVersion=null;}};
  for(const r of rows){
   const order=JSON.stringify([r.at,r.sequence]);if(seen.has(order))failActual(20);seen.add(order);
   const amount=money(r.amount),fee=money(r.fees),cost=money(r.cost),qty=r.quantity===null?null:actualDecimal(r.quantity,true).value;
   if(r.type==='opening')continue;
   if(r.type!=='opening_position')openingPhase=false;
   if(r.type==='opening_position'){
    if(!openingPhase||r.at!==first.at||positions.has(r.symbol))failActual(20);const p=position(r);p.quantity=qty;p.cost=cost;p.initialValue=amount;p.openedAt=r.at;bind(p,r);openingValue=ledgerSum([openingValue,amount]);
   }else if(r.type==='buy'){
    const p=position(r);if(p.quantity===0n){p.cost=0;p.bindings=[];p.openedAt=r.at;}p.quantity+=qty;actualDecimal(qtext(p.quantity),true);p.cost=ledgerSum([p.cost,amount,fee]);cash=minus(cash,ledgerSum([amount,fee]));feesTotal=ledgerSum([feesTotal,fee]);bind(p,r);
   }else if(r.type==='sell'){
    const p=position(r);if(qty>p.quantity||p.quantity===0n)failActual(20);
    if(first.costMethod==='average'&&cost!==null)failActual(20);
    const allocated=first.costMethod==='reported'?cost:p.cost===null?null:safe((BigInt(p.cost)*qty+p.quantity/2n)/p.quantity);
    if(allocated!==null&&p.cost!==null&&(allocated>p.cost||qty===p.quantity&&allocated!==p.cost))failActual(20);
    const pnl=minus(minus(amount,fee),allocated);realized=ledgerSum([realized,pnl]);p.realizedCents=ledgerSum([p.realizedCents,pnl]);cash=ledgerSum([cash,minus(amount,fee)]);feesTotal=ledgerSum([feesTotal,fee]);p.quantity-=qty;p.cost=p.quantity===0n?0:minus(p.cost,allocated);
   }else if(r.type==='deposit'){cash=ledgerSum([cash,amount]);flows=ledgerSum([flows,amount]);}
   else if(r.type==='withdrawal'){cash=minus(cash,amount);flows=minus(flows,amount);}
   else if(r.type==='dividend'){const net=minus(amount,fee);cash=ledgerSum([cash,net]);income=ledgerSum([income,net]);feesTotal=ledgerSum([feesTotal,fee]);}
   else if(r.type==='fee'){cash=minus(cash,amount);feesTotal=ledgerSum([feesTotal,amount]);income=minus(income,amount);}
   else if(r.type==='split'){const p=position(r);if(p.quantity===0n)failActual(20);p.quantity=qty;}
   else if(r.type==='cash_balance'){if(cash!==amount||cash===null){performanceKnown=false;issues.add('包含余额核对调整，不能从期初推算完整期间收益');}cash=amount;}
   else if(r.type==='position_balance'){const p=position(r);if(p.quantity!==qty||p.cost!==cost||p.cost===null){performanceKnown=false;issues.add('包含数量或成本核对调整，历史期间收益需要另行对账');}if(p.quantity===0n&&qty>0n)p.openedAt=r.at;p.quantity=qty;p.cost=qty===0n?0:cost;if(r.topicId){p.bindings=[];bind(p,r);}}
   if(cash!==null&&cash<0)failActual(20);
   if(r.symbol&&positions.has(r.symbol)&&r.type!=='dividend'){const p=positions.get(r.symbol);p.asOf=r.at;p.source=r.source;}
  }
  if(cash===null)issues.add('现金或交易费用未知，账面现金和参考净值不可确定');
  if(realized===null)issues.add('部分卖出成本或费用未知，已实现收益不合计');
  const basisNote=first.costMethod==='average'?'采用本人选择的移动加权平均研究口径，可能不同于券商或税务成本':'卖出成本按本人所录账单，缺失时已实现收益未知';
  const version=allRows.reduce((v,r)=>Math.max(v,r.appliedVersion||r.revision),0),recordedAt=allRows.reduce((v,r)=>v>(r.recordedAt||r.at)?v:r.recordedAt||r.at,'');
  return {key,...(first.accountKind?{accountKind:first.accountKind}:{}),account:first.account,currency:first.currency,costMethod:first.costMethod,version,recordedAt,startingAt:first.at,asOf:rows.at(-1).at,cashCents:cash,realizedCents:realized,feesCents:feesTotal,incomeCents:income,netFlowsCents:flows,openingValueCents:openingValue,performanceKnown,basisNote,issues:[...issues],entryCount:rows.length,positions:[...positions.values()].map(p=>({...p,quantity:qtext(p.quantity),costCents:p.cost,cost:undefined,bindings:p.bindings.map(v=>JSON.parse(v))}))};
 });
}
