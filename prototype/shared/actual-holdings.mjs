import {instrument} from './securities.mjs';

export const actualHoldingErrors=[
 '实际持仓输入无效；请核对字段与行数',
 '账户别名、证券、来源或说明无效',
 '数量、单位成本或记录价格无效；最多六位小数，未知请留空',
 '记录时间无效；需要含时区的真实时间且不能在未来',
 '成本费用口径无效',
 '关联研究与证券或版本不符，请重新选择',
 '同一批包含同账户同证券的冲突记录',
 '新记录早于当前持仓快照，不能倒写；请核对时间',
 '更新或修正已有记录需要填写说明',
 '持仓预览已过期或数据已变化，请重新预览',
 '持仓预览含冲突或没有新增变化，不能保存',
 '当前模式不接受实际持仓；请使用研究实例',
 '恢复副本需先完成核对确认',
 '持仓记录或预览不存在',
 'CSV 格式无效；请使用模板表头，每批最多100行',
 '持仓记录指纹不符，请核对存储',
];
export const failActual=n=>{throw Error(actualHoldingErrors[n]);};
export const ACTUAL_COLUMNS=['account','symbol','quantity','unitCost','price','asOf','source','feeBasis','reason','topicId','topicVersion'];
export const actualTemplate=ACTUAL_COLUMNS.join(',')+'\n';
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=(v,max,required=false)=>{if(v==null&&!required)return '';if(typeof v!=='string'||v.trim().length>max||/[\u0000-\u001f\u007f]/.test(v)||required&&!v.trim())failActual(1);return v.trim().normalize('NFC');};
const scale=1000000n,limit=BigInt(Number.MAX_SAFE_INTEGER);
function decimal(v,required=false){
 if(v==null||v===''){if(required)failActual(2);return null;}
 if(typeof v!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,6})?$/.test(v))failActual(2);
 const [a,b='']=v.split('.');const n=BigInt(a)*scale+BigInt(b.padEnd(6,'0'));
 return {value:n,text:(a+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):''))};
}
export function actualAmount(quantity,unit){
 if(unit==null||unit==='')return null;
 const q=decimal(quantity,true).value,p=decimal(unit,true).value,n=(q*p+5000000000n)/10000000000n;
 if(n>limit)failActual(2);return Number(n);
}
export function normalizeActualRow(input,at){
 if(!plain(input)||Object.keys(input).some(k=>!ACTUAL_COLUMNS.includes(k)))failActual(0);
 const account=text(input.account,60,true),source=text(input.source,160,true),reason=text(input.reason,300);
 let security;try{security=instrument(text(input.symbol,32,true));}catch{failActual(1);}
 const quantity=decimal(input.quantity,true).text,unitCost=decimal(input.unitCost)?.text??null,price=decimal(input.price)?.text??null;
 if(price==='0')failActual(2);
 actualAmount(quantity,unitCost);actualAmount(quantity,price);
 const raw=input.asOf;
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(raw)||!Number.isFinite(Date.parse(raw))||Date.parse(raw)>Date.parse(at)||new Date(raw.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==raw.slice(0,10))failActual(3);
 const feeBasis=input.feeBasis||'unknown';if(!['included','excluded','unknown'].includes(feeBasis))failActual(4);
 const topicId=text(input.topicId,100),v=input.topicVersion;
 if(!topicId&&v!=null&&v!==''||topicId&&(!/^\d{1,9}$/.test(String(v))||Number(v)<1))failActual(5);
 return {account,symbol:security.symbol,currency:security.currency,market:security.market,quantity,unitCost,price,asOf:new Date(raw).toISOString(),source,feeBasis,reason,topicId:topicId||null,topicVersion:topicId?Number(v):null};
}

// Strict bounded CSV, including quoted commas/newlines and escaped quotes. No
// formula execution or broker-specific column inference takes place here.
export function parseActualCsv(input){
 if(typeof input!=='string'||input.length>100000)failActual(14);
 const s=input.replace(/^\uFEFF/,''),rows=[];let row=[],field='',quoted=false,closed=false;
 const cell=()=>{row.push(field);field='';closed=false;};
 const line=()=>{cell();if(row.some(v=>v!==''))rows.push(row);row=[];if(rows.length>101)failActual(14);};
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)failActual(14);quoted=true;}
  else if(c===',')cell();
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;line();}
  else {if(closed)failActual(14);field+=c;}
 }
 if(quoted)failActual(14);if(field||row.length||closed)line();
 const header=rows.shift();if(!header||header.join(',')!==ACTUAL_COLUMNS.join(',')||!rows.length)failActual(14);
 return rows.map(r=>{if(r.length!==header.length)failActual(14);return Object.fromEntries(header.map((key,i)=>[key,r[i]]));});
}
