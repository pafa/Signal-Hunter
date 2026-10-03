// Literal extraction only: no inference of financial metrics, periods or forecasts.
export const QUANTITY_VERSION='source-quantity-literals/1';
const currency='US\\$|HK\\$|USD|HKD|CNY|RMB|人民币|美元|港元|港币|\\$|¥|￥';
const magnitude='trillion|billion|million|thousand|万亿|千亿|百亿|十亿|亿|千万|百万|十万|万|千|百';
const numeric='[+−-]?(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)';
const money=new RegExp(`(?<prefix>${currency})?[ \\t]*(?<number>${numeric})[ \\t]*(?<scale>${magnitude})?[ \\t]*(?<suffix>${currency}|元|%|％|percent|per cent)?`,'gi');
const powers={trillion:12,billion:9,million:6,thousand:3,'万亿':12,'千亿':11,'百亿':10,'十亿':9,'亿':8,'千万':7,'百万':6,'十万':5,'万':4,'千':3,'百':2};
const currencies={'US$':'USD',USD:'USD','美元':'USD','HK$':'HKD',HKD:'HKD','港元':'HKD','港币':'HKD',CNY:'CNY',RMB:'CNY','人民币':'CNY'};
const unitPattern=new RegExp(`^(?:(?<leading>${currency})[ \\t]*(?<after>${magnitude})?|(?<before>${magnitude})?[ \\t]*(?<trailing>${currency})|(?<percent>%|％|percent|per cent))$`,'i');
// Explicit input units only; no FX, inferred currency or semantic metric conversion.
export function quantityInUnit(value,unit){
 if(typeof value!=='number'||!Number.isFinite(value)||typeof unit!=='string'||unit.length>80)return null;
 const literal=String(value),match=unitPattern.exec(unit.trim());
 if(!match||!new RegExp(`^${numeric}$`).test(literal))return null;
 const {leading,after,before,trailing,percent}=match.groups;
 const q=sourceQuantities(percent?`${literal} ${percent}`:`${leading||trailing} ${literal} ${after||before||''}`)[0];
 return q?.normalization==='literal-only'?{unit:q.unit,normalizedValue:q.normalizedValue}:null;
}
function decimal(literal,power){
 let text=literal.replaceAll(',','').replace('−','-'),negative=text.startsWith('-');text=text.replace(/^[+-]/,'');const [whole,fraction='']=text.split('.');
 let digits=(whole+fraction).replace(/^0+(?=\d)/,''),places=fraction.length-power;
 if(places>0){digits=digits.padStart(places+1,'0');digits=digits.slice(0,-places)+'.'+digits.slice(-places);digits=digits.replace(/0+$/,'').replace(/\.$/,'');}else digits+='0'.repeat(-places);
 digits=digits.replace(/^0+(?=\d)/,'');return (negative&&/[1-9]/.test(digits)?'-':'')+digits;
}
export function sourceQuantities(text){
 if(typeof text!=='string'||text.length>80000)throw Error('数值来源文本无效');
 const found=[];money.lastIndex=0;
 for(const match of text.matchAll(money)){
  const raw=match[0].trim(),start=match.index+match[0].indexOf(raw),end=start+raw.length,{prefix,number,scale,suffix}=match.groups;
  if(!prefix&&!suffix)continue;
  // Refuse partial tokens such as 12,34 USD, 1e6 USD or embedded identifiers.
  if(/[A-Za-z0-9_]/.test(text[start-1]||'')||/[.,]/.test(text[start-1]||'')&&/\d/.test(text[start-2]||'')||/[A-Za-z0-9_]/.test(text[end]||'')||/[.,]/.test(text[end]||'')&&/\d/.test(text[end+1]||''))continue;
  if(/^[ \t]+(?:bn|mn|mm|[kmb])(?:\b|$)/i.test(text.slice(end)))continue;
  if(number.replace(/\D/g,'').length>24)continue;
  const pct=/^(?:%|％|percent|per cent)$/i.test(suffix||''),a=currencies[prefix?.toUpperCase()],b=suffix==='元'&&a==='CNY'?'CNY':currencies[suffix?.toUpperCase()];
  const currencyCode=pct?null:a||b||null;
  const conflict=Boolean(prefix&&suffix&&(pct||!a||!b||a!==b));
  const before=text.slice(Math.max(0,start-40),start),after=text.slice(end,end+40);
  const range=/[0-9](?:%|％)?[ \t]*[–—~至到-][ \t]*$/.test(before)||/^[ \t]*[–—~至到-][ \t]*(?:USD|HKD|CNY|RMB|US\$|HK\$|\$|人民币|美元|港元|港币)?[ \t]*[+−-]?(?:\d|\.\d)/i.test(after)||/^[−-]/.test(raw)&&/[0-9](?:%|％)[ \t]*$/.test(before);
  const parenthesized=/[（(][ \t]*$/.test(text.slice(Math.max(0,start-4),start))&&/^[ \t]*[）)]/.test(text.slice(end,end+4));
  const prefixSign=/[−-][ \t]*$/.test(text.slice(Math.max(0,start-4),start));
  const normalization=prefixSign?'prefix-sign-unresolved':conflict?'conflicting-units':range?'range-context':parenthesized?'parenthesized-sign-unresolved':!pct&&!currencyCode?'ambiguous-currency':'literal-only';
  found.push({start,end,raw,number,scale:scale||null,unit:pct?'percent':currencyCode,normalization,normalizedValue:normalization==='literal-only'?decimal(number,powers[scale?.toLowerCase()]||0):null,context:text.slice(Math.max(0,start-60),Math.min(text.length,end+60))});
 }
 return found;
}
export function packetQuantities(evidence){
 const items=[];let total=0;
 for(const e of evidence){const m=e.material;if(!m)continue;for(const field of ['title','body'])for(const q of sourceQuantities(m[field])){total++;if(items.length<80)items.push({evidenceId:e.id,materialId:m.id,materialRevision:m.revision,field,...q});}}
 return {version:QUANTITY_VERSION,total,omitted:total-items.length,items,scope:'Explicit money and percentage literals in supplied material text only. Not verified financial metrics, periods, expectations, guidance, or trading inputs. Bare numbers, inferred units and unsupported notation are not extracted.'};
}
